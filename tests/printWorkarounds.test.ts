import { describe, expect, test } from "bun:test";
import { applyPrintWorkarounds } from "../packages/puppeteer/src/printWorkarounds";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { renderedPage } from "./renderedPage";

/** The rendered page after the Puppeteer print step, which runs the same function in Chromium. */
function printedPage(presentation: PuppeteerGen): Document {
    const page = renderedPage(presentation);
    applyPrintWorkarounds(page);
    return page;
}

describe("Puppeteer print workarounds", () => {
    test("moves each horizontal paragraph so the strut's centred baseline lands on data-line-baseline", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Horizontal", { x: 1, y: 1, w: 4, h: 1 });
        slide.addText("Vertical", { x: 1, y: 3, w: 1, h: 3, vert: "vert270" });
        const [horizontal, vertical] = printedPage(presentation).querySelectorAll<HTMLElement>(".text-paragraph");
        // 18pt (24px) default: a 28.8px line box with its baseline at 24px, so 24 - 28.8 / 2 below the strut's.
        expect(horizontal?.style.position).toBe("relative");
        expect(parseFloat(horizontal?.style.top ?? "")).toBeCloseTo(9.6, 9);
        expect([vertical?.style.position, vertical?.style.top]).toEqual(["", ""]);
    });

    test("undoes Chromium's whole-px SVG root snap, in the object's pre-transform space (issue #42)", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addShape("rect", { x: 1, y: 1, w: 1, h: 1 });
        // 6.55in, 1.6in -> 628.8px, 153.6px: Chromium draws the SVG from 629, 154.
        slide.addShape("line", { x: 6.55, y: 1.6, w: 2.6, h: 0, line: { color: "4472C4", width: 2.25 } });
        slide.addText("Shape text", { x: 6.55, y: 1.6, w: 2, h: 1, shape: "rect" });
        // Chromium applies the page-space difference after the object's rotation and flips.
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, rotate: 90 });
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, flipH: true });
        slide.addShape("rect", { x: 6.55, y: 1.6, w: 1, h: 1, rotate: 180, flipH: true, flipV: true });
        const offsets = Array.from(printedPage(presentation).querySelectorAll<SVGSVGElement>(".shape-svg"), svg => svg.style.transform);
        expect(offsets).toEqual(["", "translate(-0.2px, -0.4px)", "translate(-0.2px, -0.4px)", "translate(-0.4px, 0.2px)", "translate(0.2px, -0.4px)", "translate(-0.2px, -0.4px)"]);
    });

    test("draws a dash pattern that starts with a gap as the same pattern shifted by an offset", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addShape("line", { x: 1, y: 1, w: 4, h: 0, line: { color: "ED7D31", width: 2.25, dashType: "dash", beginArrowType: "oval" } });
        slide.addShape("line", { x: 1, y: 2, w: 4, h: 0, line: { color: "ED7D31", width: 2, dashType: "dash" } });
        const [gapFirst, plain] = printedPage(presentation).querySelectorAll(".shape-geometry");
        // The model's "0 3.9 12 9 ..." loses its zero-length dash; the offset leaves the first 3.9px blank.
        const parts = gapFirst?.getAttribute("stroke-dasharray")?.split(" ").map(Number) ?? [];
        expect(parts.slice(0, 2)).toEqual([12, expect.closeTo(9, 9)]);
        expect(Number(gapFirst?.getAttribute("stroke-dashoffset"))).toBeCloseTo(parts.reduce((sum, part) => sum + part, 0) - 3.9, 9);
        expect(plain?.getAttribute("stroke-dasharray")).toBe(presentation.getModel().slides[0]?.objects[1]?.style.line?.dashArray ?? "");
        expect(plain?.hasAttribute("stroke-dashoffset")).toBe(false);
    });

    test("offsets a table by half its widest border, which DrawingML centres on the grid", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        const cell = (pt: number) => ({ text: "x", options: { border: { type: "solid" as const, pt, color: "000000" } } });
        slide.addTable([[cell(1), cell(3)]], { x: 1, y: 1, w: 4 });
        slide.addTable([[{ text: "x", options: { border: { type: "none" as const } } }]], { x: 1, y: 3, w: 4 });
        const [bordered, borderless] = printedPage(presentation).querySelectorAll<HTMLElement>("table.slide-table");
        // 3pt = 4px: the grid moves up and left by 2px.
        expect([bordered?.style.position, bordered?.style.left, bordered?.style.top]).toEqual(["relative", "-2px", "-2px"]);
        expect([borderless?.style.position, borderless?.style.left]).toEqual(["", ""]);
    });

    test("appends Chromium's fallback list to each run's and bullet's face", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText(
            [
                { text: "a", options: { fontFace: "Calibri Light" } },
                { text: "b", options: { fontFace: 'Odd "Face"' } },
            ],
            { x: 1, y: 1, w: 4, h: 1, bullet: true },
        );
        const page = printedPage(presentation);
        const family = (selector: string) =>
            page
                .querySelector(selector)
                ?.getAttribute("style")
                ?.match(/font-family: ([^;]+);/)?.[1];
        expect(family(".text-bullet")).toBe('"Calibri Light", "Noto Sans", Arial, "Liberation Sans", sans-serif');
        expect(family(".text-run:nth-of-type(3)")).toBe('"Odd \\"Face\\"", Arial, "Liberation Sans", sans-serif');
    });

    test("names the object when a paragraph has no line box", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText("Text", { x: 1, y: 1, w: 4, h: 1, objectName: "Title" });
        const page = renderedPage(presentation);
        page.querySelector(".text-paragraph")?.removeAttribute("data-line-baseline");
        expect(() => applyPrintWorkarounds(page)).toThrow("Cannot print 'Title': its .text-paragraph has no numeric data-line-baseline");
    });
});
