import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PRINT_ZOOM, printHtml } from "../packages/puppeteer/src/printWorkarounds";

const printedHtml = async (presentation: PuppeteerGen) => printHtml((await presentation.toHtml()).html);

/** The document Puppeteer prints, parsed for structural assertions. */
async function printedPage(presentation: PuppeteerGen): Promise<Document> {
    return new JSDOM(await printedHtml(presentation)).window.document;
}

describe("Puppeteer print workarounds", () => {
    test("moves each horizontal paragraph so the strut's centred baseline lands on data-line-baseline", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Horizontal", { x: 1, y: 1, w: 4, h: 1 });
        slide.addText("Vertical", { x: 1, y: 3, w: 1, h: 3, vert: "vert270" });
        const [horizontal, vertical] = (await printedPage(presentation)).querySelectorAll<HTMLElement>(".text-paragraph");
        // 18pt (24px) default: a 28.8px line box with its baseline at 24px, so 24 - 28.8 / 2 below the strut's.
        expect(horizontal?.style.position).toBe("relative");
        expect(parseFloat(horizontal?.style.top ?? "")).toBeCloseTo(9.6, 9);
        expect([vertical?.style.position, vertical?.style.top]).toEqual(["", ""]);
    });

    test("undoes Chromium's whole-px SVG root snap, in the object's pre-transform space (issue #42)", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addShape("rect", { x: 1, y: 1, w: 1, h: 1 });
        // 6.55in, 1.6in -> 628.8px, 153.6px: Chromium draws the SVG from the nearest 1 / PRINT_ZOOM px, 628.75, 153.625.
        slide.addShape("line", { x: 6.55, y: 1.6, w: 2.6, h: 0, line: { color: "4472C4", width: 2.25 } });
        slide.addText("Shape text", { x: 6.55, y: 1.6, w: 2, h: 1, shape: "rect" });
        // Chromium applies the page-space difference after the object's rotation and flips.
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, rotate: 90 });
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, flipH: true });
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, rotate: 180, flipH: true, flipV: true });
        const offsets = Array.from((await printedPage(presentation)).querySelectorAll<SVGSVGElement>(".shape-svg"), svg => svg.style.transform);
        expect(offsets).toEqual(["", "translate(0.05px, -0.025px)", "translate(0.05px, -0.025px)", "translate(-0.025px, -0.05px)", "translate(-0.05px, -0.025px)", "translate(0.05px, -0.025px)"]);
    });

    test("draws a dash pattern that starts with a gap as the same pattern shifted by an offset", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addShape("line", { x: 1, y: 1, w: 4, h: 0, line: { color: "ED7D31", width: 2.25, dashType: "dash", beginArrowType: "oval" } });
        slide.addShape("line", { x: 1, y: 2, w: 4, h: 0, line: { color: "ED7D31", width: 2, dashType: "dash" } });
        const [gapFirst, plain] = (await printedPage(presentation)).querySelectorAll(".shape-geometry");
        // The model's "0 3.9 12 9 ..." loses its zero-length dash; the offset leaves the first 3.9px blank.
        const parts = gapFirst?.getAttribute("stroke-dasharray")?.split(" ").map(Number) ?? [];
        expect(parts.slice(0, 2)).toEqual([12, expect.closeTo(9, 9)]);
        expect(Number(gapFirst?.getAttribute("stroke-dashoffset"))).toBeCloseTo(parts.reduce((sum, part) => sum + part, 0) - 3.9, 9);
        expect(plain?.getAttribute("stroke-dasharray")).toBe(presentation.getModel().slides[0]?.objects[1]?.style.line?.dashArray ?? "");
        expect(plain?.hasAttribute("stroke-dashoffset")).toBe(false);
    });

    test("draws a text box's line as an outline centred on its edge, which leaves the text where its inset puts it", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("outlined", { x: 1, y: 1, w: 2, h: 1, line: { color: "FF0000", width: 3, dashType: "dash" } });
        slide.addText("plain", { x: 1, y: 3, w: 2, h: 1 });
        const [outlined, plain] = (await printedPage(presentation)).querySelectorAll<HTMLElement>(".slide-text");
        // 3pt = 4px: centred on the edge, from 2px outside the box to 2px inside it.
        expect(outlined?.getAttribute("style")).toEndWith("border-style: none; outline: 4px dashed #FF0000; outline-offset: -2px;");
        expect(plain?.getAttribute("style")).not.toContain("outline");
    });

    test("offsets a table by half its widest border, which DrawingML centres on the grid", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        const cell = (pt: number) => ({ text: "x", options: { border: { type: "solid" as const, pt, color: "000000" } } });
        slide.addTable([[cell(1), cell(3)]], { x: 1, y: 1, w: 4 });
        slide.addTable([[{ text: "x", options: { border: { type: "none" as const } } }]], { x: 1, y: 3, w: 4 });
        const [bordered, borderless] = (await printedPage(presentation)).querySelectorAll<HTMLElement>("table.slide-table");
        // 3pt = 4px: the grid moves up and left by 2px.
        expect([bordered?.style.position, bordered?.style.left, bordered?.style.top]).toEqual(["relative", "-2px", "-2px"]);
        expect([borderless?.style.position, borderless?.style.left]).toEqual(["", ""]);
    });

    test("grows each bordered cell's text box over the inner half of its borders, where DrawingML measures the margins from", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        const table = (text: string, position: { y: number; h?: number }, textDirection?: "vert") =>
            slide.addTable([[{ text, options: { textDirection, border: [{ type: "solid", pt: 3, color: "000000" }, { type: "none" }, { type: "solid", pt: 1.5, color: "000000" }, { type: "none" }] } }]], { x: 1, w: 4, ...position });
        // Text in a row keeps its box in flow; vertical text in a row with a height fills the cell absolutely.
        table("flow", { y: 1 });
        table("absolute", { y: 3, h: 1 }, "vert");
        slide.addTable([[{ text: "none", options: { border: { type: "none" as const } } }]], { x: 1, y: 5, w: 4 });
        const [flow, absolute, none] = Array.from((await printedPage(presentation)).querySelectorAll(".table-cell-text"), text => text.getAttribute("style") ?? "");
        // 3pt = 4px on top, 1.5pt = 2px at the bottom, hidden sides 0px.
        expect(flow).toEndWith("; margin: -2px 0px -1px 0px; width: calc(100% + 0px);");
        expect(absolute).toEndWith("; inset: -2px 0px -1px 0px;");
        expect(none).not.toMatch(/margin|inset/);
    });

    test("measures the inset and offset from the border width Chromium lays out, floored to a whole print device px", async () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addTable([[{ text: "x", options: { border: { type: "solid", pt: 1, color: "000000" } } }]], { x: 1, y: 1, w: 4 });
        const page = await printedPage(presentation);
        // 1pt = 1.333px is 10.667 device px at PRINT_ZOOM 8; Chromium draws 10, so 1.25px and its half 0.625px.
        expect(page.querySelector(".table-cell-text")?.getAttribute("style")).toEndWith("; margin: -0.625px -0.625px -0.625px -0.625px; width: calc(100% + 1.25px);");
        expect(page.querySelector<HTMLElement>("table.slide-table")?.style.top).toBe("-0.625px");
    });

    test("lays the document out at the print zoom, which page.pdf() scales back", () => {
        const html = `<!DOCTYPE html><html lang="en"><head></head><body></body></html>`;
        expect(printHtml(html)).toBe(`<!DOCTYPE html><html style="zoom: ${PRINT_ZOOM};" lang="en"><head></head><body></body></html>`);
        expect(printHtml(`<!DOCTYPE html><html style="color: red"><body></body></html>`)).toBe(`<!DOCTYPE html><html style="color: red; zoom: ${PRINT_ZOOM};"><body></body></html>`);
        expect(() => printHtml("<p>fragment")).toThrow("Cannot print: <html> must be written out in the document");
    });

    test("appends Chromium's fallback list to each run's and bullet's face", async () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText(
            [
                { text: "a", options: { fontFace: "Calibri Light" } },
                { text: "b", options: { fontFace: 'Odd "Face"' } },
            ],
            { x: 1, y: 1, w: 4, h: 1, bullet: true },
        );
        const page = await printedPage(presentation);
        const family = (selector: string) =>
            page
                .querySelector(selector)
                ?.getAttribute("style")
                ?.match(/font-family: ([^;]+);/)?.[1];
        expect(family(".text-bullet")).toBe('"Calibri Light", "Noto Sans", Arial, "Liberation Sans", sans-serif');
        expect(family(".text-run:nth-of-type(3)")).toBe('"Odd \\"Face\\"", Arial, "Liberation Sans", sans-serif');
    });

    test("names the object when a paragraph has no line box", async () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText("Text", { x: 1, y: 1, w: 4, h: 1, objectName: "Title" });
        const html = (await presentation.toHtml()).html.replace(/ data-line-baseline="[^"]*"/, "");
        expect(() => printHtml(html)).toThrow("Cannot print 'Title': its .text-paragraph has no numeric data-line-baseline");
    });

    // An inner shadow on a shape throws from addShape (tests/shape.test.ts): an outer shadow and a text box's inner
    // one print.
    test("prints outer shadows and a text box's inner shadow", async () => {
        const drawn = new PuppeteerGen();
        drawn
            .addSlide()
            .addShape("ellipse", { x: 1, y: 1, w: 1, h: 1, shadow: { type: "outer", blur: 3, offset: 3, angle: 45 } })
            .addText("Inset", { x: 3, y: 1, w: 2, h: 1, shadow: { type: "inner", blur: 3, offset: 3, angle: 45 } });
        expect(await printedHtml(drawn)).toContain("Inset");
    });

    // Hand-written HTML can still mark a shape's shadow inset; drop-shadow() would draw it outside the shape (#198).
    test("fails on an inner shadow on a shape instead of drawing it as an outer one", async () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addShape("ellipse", { x: 1, y: 1, w: 1, h: 1, objectName: "Inset", shadow: { type: "outer", blur: 3, offset: 3, angle: 45 } });
        const html = (await presentation.toHtml()).html;
        const inner = html.replace('<svg class="shape-svg"', '<svg class="shape-svg" data-shadow-inset=""');
        expect(inner).not.toBe(html);
        expect(() => printHtml(inner)).toThrow("Cannot print 'Inset': its .shape-svg has data-shadow-inset");
    });

    test("changes only the bytes it rewrites, the same way every time", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Text", { x: 1, y: 1, w: 4, h: 1 });
        slide.addShape("line", { x: 6.55, y: 1.6, w: 2.6, h: 0, line: { color: "4472C4", width: 2.25, dashType: "dash", beginArrowType: "oval" } });
        const html = (await presentation.toHtml()).html;
        const printed = printHtml(html);
        expect(printHtml(html)).toBe(printed);
        // Only additions inside start tags: the text and the structure around them are untouched.
        const outsideTags = (markup: string) => markup.replace(/<[^>]*>/g, "<>");
        expect(outsideTags(printed)).toBe(outsideTags(html));
        // Numbers are written as JavaScript prints them, the same text the in-page step gave the CSSOM setters.
        expect(printed).toContain('line-height: 28.799999999999997px; tab-size: 96px; position: relative; top: 9.599999999999998px;"');
        expect(printed).toContain('style="overflow: visible; transform: translate(0.05px, -0.025px);"');
    });

    test("keeps data: URI payloads byte for byte while it skips them in the parse", async () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        slide.addImage({ data: png, x: 1, y: 1, w: 1, h: 1 });
        slide.addImage({ data: png.replace("iVBOR", "iVBOr"), x: 3, y: 1, w: 1, h: 1 });
        // Text that looks like a src attribute is escaped text, not an attribute, and stays as written.
        slide.addText('a src="data:x,y<b>z</b>', { x: 1, y: 3, w: 4, h: 1 });
        const html = (await presentation.toHtml()).html;
        const printed = printHtml(html);
        const uris = (markup: string) => [...markup.matchAll(/src="(data:[^"]*)"/g)].map(match => match[1]);
        expect(uris(printed)).toEqual(uris(html));
        expect(uris(printed)).toHaveLength(2);
        expect(new JSDOM(printed).window.document.querySelector(".text-run")?.textContent).toBe('a src="data:x,y<b>z</b>');
        expect(printed).toContain("position: relative; top:");
    });

    test("passes HTML outside the profile through with only the print zoom added", () => {
        const html = `<!DOCTYPE html><html><head><style>h1 { color: red }</style></head><body><h1 class="title" style="top: 1.5px;">Any HTML</h1><svg><path stroke-dasharray="0 2 4"/></svg></body></html>`;
        expect(printHtml(html)).toBe(html.replace("<html>", `<html style="zoom: ${PRINT_ZOOM};">`));
    });
});
