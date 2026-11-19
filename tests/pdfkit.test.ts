import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { JSDOM } from "jsdom";
import { PuppeteerGen } from "../packages/pptxgenjs/src/html";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { createPdfkitRenderer as createBrowserPdfkitRenderer, loadSystemFonts as browserLoadSystemFonts, type PdfkitRenderer } from "../packages/pdfkit/src/browser";
import { createPdfkitRenderer, loadSystemFonts } from "../packages/pdfkit/src/node";
import { breakOpportunities } from "../packages/pdfkit/src/lineBreak";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
/** The page height in points: PDFKit flips each text object about it, so a baseline `y` px from the top is written as `PAGE_HEIGHT_PT - y`. */
const PAGE_HEIGHT_PT = 405;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const createDocument = () => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
const systemFonts = await loadSystemFonts();

/** The inflated content streams of every page, in page order (PDFKit starts each with its y flip). */
function pageContents(pdf: Uint8Array): string[] {
    const bytes = Buffer.from(pdf);
    const contents: string[] = [];
    for (const match of bytes.toString("latin1").matchAll(/stream\n/g)) {
        const start = (match.index ?? 0) + match[0].length;
        try {
            const text = inflateSync(bytes.subarray(start, bytes.indexOf("endstream", start))).toString("latin1");
            if (text.startsWith("1 0 0 -1 0 ")) contents.push(text);
        } catch {
            // a stream that is not deflated (or not a content stream): fonts and images
        }
    }
    return contents;
}

/** Each drawn text object's position in CSS px from the slide's top left, and its font size in px. */
function texts(content: string): { x: number; baseline: number; size: number }[] {
    return [...content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\/F\d+ ([\d.]+) Tf/g)].map(([, x, y, size]) => ({ x: Number(x), baseline: PAGE_HEIGHT_PT - Number(y), size: Number(size) }));
}

async function render(renderer: PdfkitRenderer, populate: (pres: PuppeteerGen) => void): Promise<Uint8Array> {
    const pres = new PuppeteerGen(PAGE, { renderer, createDocument });
    populate(pres);
    return pres.toPdf();
}

describe("PDFKit renderer", () => {
    test("places a line at the box's inset and the profile's baseline, at the run's size", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const pdf = await render(renderer, pres => pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial", fontSize: 18, margin: 0, valign: "top" }));
        // 1 in = 96 px; 18 pt = 24 px; the first baseline sits data-line-baseline (24 px for 1.2 x 24 px lines) below the top.
        expect(texts(pageContents(pdf)[0] ?? "")).toEqual([{ x: 96, baseline: 120, size: 24 }]);
        expect(renderer.warnings()).toEqual([]);
    });

    test("wraps a paragraph onto line boxes one line-height apart, and centres each line", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const words = "one two three four five six seven eight nine ten eleven twelve";
        const pdf = await render(renderer, pres => pres.addSlide().addText(words, { x: 1, y: 1, w: 1.5, h: 2, fontFace: "Arial", fontSize: 12, margin: 0, valign: "top", align: "center" }));
        // Each word is its own text object; a line is the words on one baseline.
        const drawn = texts(pageContents(pdf)[0] ?? "");
        const baselines = [...new Set(drawn.map(text => text.baseline))];
        expect(baselines.length).toBeGreaterThan(2);
        // 12 pt = 16 px at 1.2 line spacing: 19.2 px per line.
        for (const [index, baseline] of baselines.entries()) expect(baseline).toBeCloseTo((baselines[0] ?? 0) + index * 19.2, 3);
        for (const baseline of baselines) expect(Math.min(...drawn.filter(text => text.baseline === baseline).map(text => text.x))).toBeGreaterThan(96);
    });

    test("draws a stretched image over its box, clipped to it", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const pdf = await render(renderer, pres => pres.addSlide().addImage({ data: PNG, x: 2, y: 1, w: 1, h: 0.5 }));
        const content = pageContents(pdf)[0] ?? "";
        expect(content).toContain("192 96 96 48 re\nW n");
        // The image matrix maps the unit square onto the box, flipped to PDFKit's y-down space: bottom edge at 144 px.
        expect(content).toContain("96 0 0 -48 192 144 cm\n/I1 Do");
    });

    test("throws on what it cannot draw, or lists it in warnings() under onUnsupported: warn", async () => {
        const populate = (pres: PuppeteerGen) => pres.addSlide().addTable([[{ text: "cell" }]], { x: 1, y: 1, w: 2 });
        await expect(render(await createPdfkitRenderer({ fonts: systemFonts }), populate)).rejects.toThrow(/The PDFKit renderer cannot draw everything in this presentation \(pass \{ onUnsupported: "warn" \} to render anyway\):\n- slide 1: object 'Table 0': tables are not drawn/);
        const renderer = await createPdfkitRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        const pdf = await render(renderer, populate);
        expect(Buffer.from(pdf).toString("latin1").startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual(["slide 1: object 'Table 0': tables are not drawn by the PDFKit renderer"]);
    });

    test("reports image formats PDFKit cannot embed", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        await render(renderer, pres => pres.addSlide().addImage({ data: GIF, x: 1, y: 1, w: 1, h: 1 }));
        expect(renderer.warnings()).toEqual(["slide 1: object 'Image 0': image format 'image/gif' is not drawn (PDFKit embeds PNG and JPEG)"]);
    });

    test("lists a face no font provides, with the face drawn instead", async () => {
        const missing: unknown[] = [];
        const renderer = await createPdfkitRenderer({ fonts: systemFonts, onMissingFont: list => missing.push(...list) });
        await render(renderer, pres => pres.addSlide().addText("x", { x: 1, y: 1, w: 1, h: 1, fontFace: "No Such Face" }));
        expect(missing).toEqual([{ face: "No Such Face", objects: ["slide 1 'Text 0'"], usedFace: expect.any(String) }]);
        expect(renderer.missingFonts()).toEqual(missing as never);
    });

    test("writes the same bytes for the same deck, produced by PdfLapas", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const populate = (pres: PuppeteerGen) => pres.addSlide().addText("Same", { x: 1, y: 1, w: 2, h: 1 });
        const pdf = Buffer.from(await render(renderer, populate));
        expect(pdf.equals(Buffer.from(await render(renderer, populate)))).toBe(true);
        // PDFKit always writes a creation date: the fixed epoch keeps the bytes (and the file ID) stable.
        const source = pdf.toString("latin1");
        expect(source).toMatch(/\/Producer \d+ 0 R\n\/Creator \d+ 0 R\n\/CreationDate \d+ 0 R/);
        expect(source).toContain("(PdfLapas)");
        expect(source).toContain("(D:19700101000000Z)");
    });

    test("needs font bytes, and reads system fonts only under Node/Bun", async () => {
        await expect(createBrowserPdfkitRenderer({ fonts: [] })).rejects.toThrow("createPdfkitRenderer() requires at least one font");
        await expect(createBrowserPdfkitRenderer({ fonts: [new Uint8Array([1, 2, 3])] })).rejects.toThrow("Font #0 is not a TTF, OTF or TTC font file");
        await expect(browserLoadSystemFonts()).rejects.toThrow("only available under Node/Bun");
        await expect(createBrowserPdfkitRenderer({ fonts: systemFonts, onUnsupported: "ignore" as never })).rejects.toThrow('onUnsupported must be "error" or "warn"');
    });

    test("breaks lines where Chromium does: after spaces, not inside a minus before a digit", () => {
        const split = (text: string) => {
            const cuts = [0, ...breakOpportunities(text), text.length];
            return cuts.slice(1).map((end, index) => text.slice(cuts[index], end));
        };
        expect(split("Hello world. Again")).toEqual(["Hello ", "world. ", "Again"]);
        expect(split("a - b x-1 AA-22")).toEqual(["a ", "- ", "b ", "x-", "1 ", "AA-", "22"]);
        expect(split("foo  bar")).toEqual(["foo  ", "bar"]);
    });
});
