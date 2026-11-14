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

    test("names the object when a paragraph has no line box", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText("Text", { x: 1, y: 1, w: 4, h: 1, objectName: "Title" });
        const page = renderedPage(presentation);
        page.querySelector(".text-paragraph")?.removeAttribute("data-line-baseline");
        expect(() => applyPrintWorkarounds(page)).toThrow("Cannot print 'Title': its .text-paragraph has no numeric data-line-baseline");
    });
});
