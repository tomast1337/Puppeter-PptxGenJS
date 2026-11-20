import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { create as createFont, type Font } from "fontkit";
import { JSDOM } from "jsdom";
import PDFDocument from "pdfkit";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen } from "../packages/pptxgenjs/src/html";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { createPdfkitRenderer as createBrowserPdfkitRenderer, loadSystemFonts as browserLoadSystemFonts, type PdfkitRenderer } from "../packages/pdfkit/src/browser";
import { createPdfkitRenderer, loadSystemFonts } from "../packages/pdfkit/src/node";
import { boxRadii, dilate, gaussianBlur } from "../packages/pdfkit/src/effect/filter";
import { composite } from "../packages/pdfkit/src/effect/raster";
import { breakOpportunities } from "../packages/pdfkit/src/lineBreak";
import { record } from "../packages/pdfkit/src/path";

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

/** The dictionaries of the image XObjects in `pdf`, in object order. */
function imageObjects(pdf: Uint8Array): string[] {
    return [
        ...Buffer.from(pdf)
            .toString("latin1")
            .matchAll(/<<[^<>]*\/Subtype \/Image[^<>]*>>/g),
    ]
        .map(([match]) => match)
        .filter(image => !image.includes("/DeviceGray"));
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
        const populate = (pres: PuppeteerGen) => pres.addSlide().addTable([[{ text: "cell", options: { textDirection: "vert" } }]], { x: 1, y: 1, w: 2 });
        await expect(render(await createPdfkitRenderer({ fonts: systemFonts }), populate)).rejects.toThrow(/The PDFKit renderer cannot draw everything in this presentation \(pass \{ onUnsupported: "warn" \} to render anyway\):\n- slide 1: object 'Table 0': vertical text is not drawn/);
        const renderer = await createPdfkitRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        const pdf = await render(renderer, populate);
        expect(Buffer.from(pdf).toString("latin1").startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual(["slide 1: object 'Table 0': vertical text is not drawn"]);
    });

    describe("tables", () => {
        const solid = { type: "solid", pt: 3, color: "FF0000" } as const;
        const none = { type: "none" } as const;
        // Two 1 in columns, two 0.5 in rows, at (1 in, 1 in): grid lines at x 96/192/288 px and y 96/144/192 px.
        const grid = { x: 1, y: 1, colW: [1, 1], rowH: [0.5, 0.5], margin: 0, fontFace: "Arial", fontSize: 12 } satisfies PptxGenJS.TableProps;

        test("fills each cell's rect on the column grid, a merged cell over every column it spans", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres => pres.addSlide().addTable([[{ text: "", options: { colspan: 2, fill: { color: "00FF00" } } }], [{ text: "", options: { fill: { color: "0000FF" } } }, { text: "" }]], grid));
            const content = pageContents(pdf)[0] ?? "";
            expect(content).toContain("0 1 0 scn\n/Gs1 gs\n96 96 192 48 re\nf");
            expect(content).toContain("0 0 1 scn\n/Gs1 gs\n96 144 96 48 re\nf");
            expect(renderer.warnings()).toEqual([]);
        });

        test("strokes each shared grid edge once, a run of equal edges as one line centred on the grid line", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres =>
                pres.addSlide().addTable(
                    [
                        [
                            { text: "", options: { border: [solid, none, none, none] } },
                            { text: "", options: { border: [solid, none, none, none] } },
                        ],
                        [{ text: "" }, { text: "", options: { border: [none, none, none, { type: "dash", pt: 3, color: "0000FF" }] } }],
                    ],
                    { ...grid, border: none },
                ),
            );
            const strokes = [...(pageContents(pdf)[0] ?? "").matchAll(/([\d.]+) w\n(\d+) J\n(?:\[[^\]]*\] [\d.]+ d\n)?([\d.]+) ([\d.]+) m\n([\d.]+) ([\d.]+) l\nS/g)].map(([, width, cap, ...points]) => ({ width: Number(width), cap: Number(cap), points: points.map(Number) }));
            // 3 pt = 4 px: the two top sides are one square-capped line across both columns; the dashed left side of the
            // second row's second cell is the shared vertical edge at x 192, butt-capped.
            expect(strokes).toEqual([
                { width: 4, cap: 2, points: [96, 96, 288, 96] },
                { width: 4, cap: 0, points: [192, 144, 192, 192] },
            ]);
        });

        test("places a cell's text at its margins, anchored in the row, and grows a row to its text", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres =>
                pres.addSlide().addTable(
                    [
                        [
                            { text: "Top", options: { valign: "top", margin: [6, 0, 0, 12] } },
                            { text: "Bottom", options: { valign: "bottom" } },
                        ],
                        [{ text: "one\ntwo\nthree\nfour", options: { colspan: 2 } }],
                    ],
                    grid,
                ),
            );
            const drawn = texts(pageContents(pdf)[0] ?? "");
            // 12 pt = 16 px Arial: 19.2 px line boxes with the baseline (data-line-baseline) 16 px below their top.
            const baseline = 16;
            // Margins are in pt: top 6 pt = 8 px, left 12 pt = 16 px.
            expect(drawn[0]).toEqual({ x: 112, baseline: 104 + baseline, size: 16 });
            // Bottom anchored in the 48 px first row: one 19.2 px line box ending at 144.
            expect(drawn[1]?.x).toBe(192);
            expect(drawn[1]?.baseline).toBeCloseTo(144 - 19.2 + baseline, 3);
            // Four 19.2 px lines are taller than the 48 px row minimum, so the second row grows to 76.8 px.
            expect(drawn.slice(2).map(text => text.baseline)).toEqual([0, 1, 2, 3].map(line => expect.closeTo(144 + line * 19.2 + baseline, 3)));
            expect(renderer.warnings()).toEqual([]);
        });
    });

    test("reports image formats PDFKit cannot embed", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        await render(renderer, pres => pres.addSlide().addImage({ data: GIF, x: 1, y: 1, w: 1, h: 1 }));
        expect(renderer.warnings()).toEqual(["slide 1: object 'Image 0': image format 'image/gif' is not drawn (PDFKit embeds PNG and JPEG)"]);
    });

    test("records a quadratic as the cubic with its curve, not PDFKit's `v`", () => {
        const doc = new PDFDocument({ autoFirstPage: false });
        // The controls sit two thirds of the way from each end to the quadratic's control (30, 60).
        expect(record(doc, pen => pen.path("M 0 0 Q 30 60 90 0"))).toEqual([
            ["M", 0, 0],
            ["C", 20, 40, 50, 40, 90, 0],
        ]);
    });

    describe("line heads and effects", () => {
        test("fills each line head in the line's colour at its end, turned along the line", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres => pres.addSlide().addShape("line", { x: 1, y: 1, w: 2, h: 0, line: { color: "FF0000", width: 2, beginArrowType: "oval", endArrowType: "triangle" } }));
            const [content = ""] = pageContents(pdf);
            // The page background, the stroke, then two filled heads; the line runs left to right, so the end head is not
            // turned (cos 1, sin 0) and the start head points back (cos -1).
            expect(content.match(/^f$/gm)?.length).toBe(3);
            expect(content).toMatch(/\n-1 0 -?0 -1 0 0 cm\n/);
            expect(content).toMatch(/\n1 0 -?0 1 192 0 cm\n/);
            expect(renderer.warnings()).toEqual([]);
        });

        test("puts an outer shadow under its shape, as a blurred image whose soft mask is the silhouette", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres => pres.addSlide().addShape("rect", { x: 1, y: 1, w: 1, h: 1, fill: { color: "FF0000" }, shadow: { type: "outer", blur: 6, offset: 4, angle: 45, color: "000000", opacity: 0.5 } }));
            const [image = ""] = imageObjects(pdf).filter(object => object.includes("/SMask"));
            expect(image).toContain("/Interpolate true");
            expect(image).toContain("/ColorSpace /DeviceRGB");
            const [content = ""] = pageContents(pdf);
            expect(content.indexOf("/FX1 Do")).toBeGreaterThan(-1);
            expect(content.indexOf("/FX1 Do")).toBeLessThan(content.indexOf("1 0 0 scn"));
            expect(renderer.warnings()).toEqual([]);
        });

        test("glows text under its glyphs", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts });
            const pdf = await render(renderer, pres => pres.addSlide().addText("Glow", { x: 1, y: 1, w: 3, h: 1, glow: { size: 8, opacity: 0.5, color: "FFC000" } }));
            const [content = ""] = pageContents(pdf);
            expect(content.indexOf("/FX1 Do")).toBeGreaterThan(-1);
            expect(content.indexOf("/FX1 Do")).toBeLessThan(content.indexOf("BT"));
            expect(renderer.warnings()).toEqual([]);
        });

        test("draws a picture's inner shadow over it, and reports one on a shape as pdf-core does", async () => {
            const renderer = await createPdfkitRenderer({ fonts: systemFonts, onUnsupported: "warn" });
            const picture = new PuppeteerGen(PAGE, { renderer, createDocument, target: "powerpoint" });
            picture.addSlide().addImage({ data: PNG, x: 1, y: 1, w: 1, h: 1, shadow: { type: "inner", blur: 6, offset: 4, angle: 45, color: "000000", opacity: 0.5 } });
            const [content = ""] = pageContents(await picture.toPdf());
            expect(content.indexOf("/FX1 Do")).toBeGreaterThan(content.indexOf("/I1 Do"));
            const shape = new PuppeteerGen(PAGE, { renderer, createDocument });
            shape.addSlide().addShape("rect", { x: 1, y: 1, w: 1, h: 1, fill: { color: "FF0000" }, shadow: { type: "outer", blur: 6, offset: 4, angle: 45, color: "000000", opacity: 0.5 } });
            const { html, pageSize } = await shape.toHtml();
            const pdf = await renderer.render({ html: html.replace('<svg class="shape-svg"', '<svg class="shape-svg" data-shadow-inset=""'), pageSize });
            expect(pageContents(pdf).join("")).not.toContain(" Do");
            expect(renderer.warnings()).toEqual(["slide 1: object 'Shape 0': inner shadow not rendered"]);
        });

        test("blurs and dilates a mask as pdf-core's filters do", () => {
            const [w, h] = [21, 21];
            const mask = new Float32Array(w * h);
            composite(
                [
                    [8, 8, 13, 8],
                    [13, 8, 13, 13],
                    [13, 13, 8, 13],
                    [8, 13, 8, 8],
                ],
                1,
                w,
                h,
                new Float32Array(w * h + 2),
                mask,
            );
            const sum = (values: Float32Array) => values.reduce((total, value) => total + value, 0);
            // The 5 x 5 square is covered exactly.
            expect(sum(mask)).toBeCloseTo(25, 4);
            expect(mask[10 * w + 10]).toBe(1);
            gaussianBlur(mask, w, h, 1.5);
            // A blur away from the edges moves coverage, never adds or loses it.
            expect(sum(mask)).toBeCloseTo(25, 2);
            expect(mask[10 * w + 10]).toBeLessThan(1);
            const point = new Float32Array(w * h);
            point[10 * w + 10] = 1;
            dilate(point, w, h, 3);
            // Grown by 3 px with an anti-aliased edge, half a px each side of it.
            expect(point[10 * w + 12]).toBe(1);
            expect(point[10 * w + 13]).toBe(0.5);
            expect(point[10 * w + 14]).toBe(0);
            expect(point[10 * w + 10]).toBe(1);
            // The three box blurs' cascade has about the Gaussian's standard deviation (pdf-core's own test).
            for (const sigma of [1, 2.5, 3.7, 7, 20]) {
                const variance = boxRadii(sigma).reduce((total, radius) => total + ((2 * radius + 1) ** 2 - 1) / 12, 0);
                expect(Math.abs(Math.sqrt(variance) - sigma)).toBeLessThan(0.25 * Math.max(sigma, 1));
            }
        });
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
        // PDFKit derives the file ID from a date: the fixed epoch keeps it stable, and the Info dictionary has no date.
        const source = pdf.toString("latin1");
        expect(source).toMatch(/\/Producer \d+ 0 R\n\/Creator \d+ 0 R\n>>/);
        expect(source).toContain("(PdfLapas)");
        expect(source).not.toContain("/CreationDate");
    });

    test("writes the deck's PDF properties, a date alone as both dates, and refuses a date that is not UTC ISO", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer, createDocument, pdfMetadata: { keywords: "a, b", creator: "Maker", producer: "Press", creationDate: new Date("2026-11-19T12:34:56.789Z") } });
        pres.addSlide();
        const source = Buffer.from(await pres.toPdf()).toString("latin1");
        for (const value of ["(a, b)", "(Maker)", "(Press)"]) expect(source).toContain(value);
        expect(source.match(/\(D:20261119123456Z\)/g)?.length).toBe(2);
        const document = await pres.toHtml();
        const html = document.html.replace("2026-11-19T12:34:56.789Z", "2026-11-19T12:34:56+01:00");
        await expect(renderer.render({ ...document, html })).rejects.toThrow('"2026-11-19T12:34:56+01:00" is not a UTC date');
    });

    test("reads the PowerPoint target's word spans, fallback faces and non-breaking hyphen", async () => {
        const renderer = await createPdfkitRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer, createDocument, target: "powerpoint" });
        pres.addSlide().addText("Lorem ipsum dolor sit amet non\u2011breaking", { x: 1, y: 1, w: 6, h: 1, fontFace: "Arial", fontSize: 10, margin: 0 });
        const document = await pres.toHtml();
        expect(document.html).toContain("font-family: &quot;Arial&quot;, &quot;Cambria Math&quot;");
        expect(document.html).toContain('data-non-breaking-hyphen="hyphen-minus"');
        // Word spans as the profile writes them under 12pt for a face whose advances are known.
        const html = document.html.replace(">Lorem ipsum", '><span style="letter-spacing: 1.5px;">Lorem</span> <span style="letter-spacing: 0.5px;">ipsum</span>');
        const content = pageContents(await renderer.render({ ...document, html }))[0] ?? "";
        expect(renderer.warnings()).toEqual([]);
        // Each word at its own spacing (Tc); PDFKit writes none for the bare text's, the run's 0.
        expect([...content.matchAll(/([\d.-]+) Tc/g)].map(match => match[1])).toEqual(["1.5", "0.5"]);
        const doc = new PuppeteerGen(PAGE, { renderer, createDocument, target: "powerpoint" });
        doc.addSlide().addText("x", { x: 1, y: 1, w: 1, h: 1 });
        const bare = await doc.toHtml();
        await expect(renderer.render({ ...bare, html: bare.html.replace("font-family: &quot;", "font-family: Arial, &quot;") })).rejects.toThrow("is not one or more quoted families");
    });

    test("kerns a pair across a break opportunity, as one shaped run", async () => {
        const fonts = await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ });
        const [file] = fonts;
        if (!file) throw new Error("Liberation Sans is not installed");
        const font = createFont(Buffer.from(file)) as Font; // `as`: a .ttf holds one font, not a collection
        const renderer = await createPdfkitRenderer({ fonts });
        const pdf = await render(renderer, pres => pres.addSlide().addText("Same API", { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial", fontSize: 18, margin: 0 }));
        const [same, api] = texts(pageContents(pdf)[0] ?? "");
        // " A" is a kern pair: "API" starts where shaping the whole run puts it, not after an unkerned "Same ".
        const kerned = (font.layout("Same API").advanceWidth - font.layout("API").advanceWidth) / font.unitsPerEm;
        expect(font.layout("Same ").advanceWidth / font.unitsPerEm).not.toBeCloseTo(kerned, 4);
        expect((api?.x ?? 0) - (same?.x ?? 0)).toBeCloseTo(kerned * 24, 3);
    });

    test("fills an underline as pdf-core's band: from the font's underline position down, one thickness tall", async () => {
        const fonts = await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ });
        const [file] = fonts;
        if (!file) throw new Error("Liberation Sans is not installed");
        const font = createFont(Buffer.from(file)) as Font; // `as`: a .ttf holds one font, not a collection
        const renderer = await createPdfkitRenderer({ fonts });
        const pdf = await render(renderer, pres => pres.addSlide().addText("Under", { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial", fontSize: 18, underline: { style: "dbl" }, margin: 0, valign: "top" }));
        const content = pageContents(pdf)[0] ?? "";
        const [text] = texts(content);
        const scale = 24 / font.unitsPerEm;
        const [top, t] = [(text?.baseline ?? 0) - font.underlinePosition * scale, font.underlineThickness * scale];
        // Double: two half-thickness lines one thickness apart, centred on the single band.
        // The first rect is the slide background.
        const rects = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)].slice(1).map(match => match.slice(1).map(Number));
        expect(rects.map(rect => rect[1])).toEqual([expect.closeTo(top - t / 2, 2), expect.closeTo(top + t, 2)]);
        expect(rects.map(rect => rect[3])).toEqual([expect.closeTo(t / 2, 2), expect.closeTo(t / 2, 2)]);
    });

    test("puts text on explicit tab stops: a right stop ends it there, a decimal stop puts its '.' there", async () => {
        const fonts = await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ });
        const [file] = fonts;
        if (!file) throw new Error("Liberation Sans is not installed");
        const font = createFont(Buffer.from(file)) as Font; // `as`: a .ttf holds one font, not a collection
        const width = (text: string) => (font.layout(text).advanceWidth / font.unitsPerEm) * 24;
        const renderer = await createPdfkitRenderer({ fonts });
        const tabStops = [
            { position: 2, alignment: "r" },
            { position: 3, alignment: "dec" },
        ] as PptxGenJS.TextPropsOptions["tabStops"]; // `as`: PptxGenJS types the alignment as a string union the literals widen from
        const pdf = await render(renderer, pres => pres.addSlide().addText("a\tbb\t12.5", { x: 1, y: 1, w: 5, h: 1, fontFace: "Arial", fontSize: 18, margin: 0, tabStops }));
        expect(renderer.warnings()).toEqual([]);
        const [, right, decimal] = texts(pageContents(pdf)[0] ?? "");
        // Stops are measured from the text area's left edge: the box's x, 96 px.
        expect((right?.x ?? 0) + width("bb")).toBeCloseTo(96 + 192, 2);
        expect((decimal?.x ?? 0) + width("12")).toBeCloseTo(96 + 288, 2);
    });

    test("runs a right-to-left paragraph's words from the right, and reports mixed directions", async () => {
        const renderer = await createPdfkitRenderer({ fonts: await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ }), onUnsupported: "warn" });
        const pdf = await render(renderer, pres => pres.addSlide().addText("שלום עולם", { x: 1, y: 1, w: 5, h: 1, fontFace: "Arial", align: "right", rtlMode: true }));
        expect(renderer.warnings()).toEqual([]);
        const [first, second] = texts(pageContents(pdf)[0] ?? "");
        expect(first?.x ?? 0).toBeGreaterThan(second?.x ?? 0);
        await render(renderer, pres => pres.addSlide().addText("PDF שלום", { x: 1, y: 1, w: 5, h: 1, fontFace: "Arial", rtlMode: true }));
        expect(renderer.warnings()).toEqual(["slide 1: object 'Text 0': left-to-right words in a right-to-left paragraph are ordered in the paragraph's direction"]);
    });

    test("synthesizes bold and italic where the face has neither, as the HTML says", async () => {
        const regularOnly = await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ });
        const renderer = await createPdfkitRenderer({ fonts: regularOnly });
        const pdf = await render(renderer, pres => pres.addSlide().addText("Bold", { x: 1, y: 1, w: 2, h: 1, fontFace: "Arial", fontSize: 18, bold: true, italic: true, margin: 0 }));
        const content = pageContents(pdf)[0] ?? "";
        // The LibreOffice target writes a 1/30 em stroke (24 px / 30) and a 0.3462535606 shear about the baseline.
        expect(content).toContain("0.8 w");
        expect(content).toContain("2 Tr");
        expect(content).toMatch(/1 0 -0\.34625\d* 1 [\d.]+ 0 cm/);
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
