import { describe, expect, test } from "bun:test";
import { parse } from "parse5";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { completeProfileHtml } from "../packages/pptxgenjs/src/render/completion";
import { pointsToPixels } from "@pdflapas/model";
import { HAND_WRITTEN_OBJECTS, handWrittenDocument } from "./handWrittenHtml";

/** The `style` and attributes of the first element matching `selector` (a class name or a tag), from a parse. */
function find(html: string, selector: string): { style: string; attributes: Record<string, string> } {
    const stack = [...parse(html).childNodes];
    while (stack.length) {
        const node = stack.shift();
        if (!node || !("tagName" in node)) continue;
        const attributes = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]));
        if (node.tagName === selector || (attributes.class ?? "").split(" ").includes(selector)) return { style: attributes.style ?? "", attributes };
        stack.unshift(...node.childNodes);
    }
    throw new Error(`no ${selector}`);
}

describe("completeProfileHtml()", () => {
    const completed = completeProfileHtml(handWrittenDocument(Object.values(HAND_WRITTEN_OBJECTS).join("\n")));

    test("fills the text box, paragraph and run defaults from PPTX_DEFAULTS", () => {
        expect(find(completed, "slide-text")).toMatchObject({
            style: "left: 96px; top: 48px; width: 768px; height: 96px; padding: 4.800000000000001px 9.600000000000001px 4.800000000000001px 9.600000000000001px; align-items: center; white-space: pre-wrap; overflow-wrap: break-word;",
            attributes: { "data-text-fit": "none", "data-text-direction": "horizontal" },
        });
        // The run states 48px: the line box is 1.2 of it, the baseline 0.2 above its bottom, as normalization computes it.
        expect(find(completed, "text-paragraph")).toMatchObject({
            style: "text-align: left; direction: ltr; margin-top: 0px; margin-bottom: 0px; tab-size: 96px; line-height: 57.599999999999994px;",
            attributes: { "data-line-baseline": "47.99999999999999" },
        });
        expect(find(completed, "text-run").style).toBe('font-size: 48px; font-weight: bold; font-family: "Calibri"; color: #000000; font-style: normal;');
        expect(find(completed, "slide-container").style).toBe("background-color: #FFFFFF;");
    });

    test("gives a shrink box the shrink rule from PPTX_DEFAULTS, keeping a stated one", () => {
        const { step, maxSteps, tolerancePx } = PPTX_DEFAULTS.text.shrink;
        const box = (attributes: string) => `<div class="slide-element slide-text" data-text-fit="shrink"${attributes} style="left: 0px; top: 0px;"><div class="text-content"></div></div>`;
        expect(find(completeProfileHtml(handWrittenDocument(box(""))), "slide-text").attributes).toMatchObject({
            "data-text-fit-step": String(step),
            "data-text-fit-max-steps": String(maxSteps),
            "data-text-fit-tolerance": String(tolerancePx),
        });
        expect(find(completeProfileHtml(handWrittenDocument(box(' data-text-fit-step="0.5"'))), "slide-text").attributes["data-text-fit-step"]).toBe("0.5");
        expect(find(completed, "slide-text").attributes).not.toHaveProperty("data-text-fit-step");
    });

    test("uses the table defaults inside a cell, and the hyperlink color on a linked run", () => {
        const cellSize = `${pointsToPixels(PPTX_DEFAULTS.table.fontSizePt)}px`;
        expect(find(completed, "td")).toMatchObject({
            style: "border-bottom: 1px solid #000000; border-top: 0px none transparent; border-right: 0px none transparent; border-left: 0px none transparent;",
            attributes: { colspan: "1", rowspan: "1" },
        });
        expect(find(completed, "table-cell-text").style).toContain("align-items: flex-start;");
        expect(find(completed, "text-run").style).not.toContain(cellSize);
        const link = find(completed.slice(completed.indexOf("<a ")), "a");
        expect(link.style).toBe(`font-family: "Calibri"; font-size: ${cellSize}; color: #0563C1; font-weight: normal; font-style: normal;`);
    });

    test("fills the image sizing and opacity, keeping a self-closed tag well formed", () => {
        expect(find(completed, "slide-image-content")).toMatchObject({
            style: "display: block; width: 100%; height: 100%; opacity: 1;",
            attributes: { "data-image-sizing": "stretch" },
        });
        expect(completed).toContain('opacity: 1;" data-image-sizing="stretch" />');
        const bare = completeProfileHtml(handWrittenDocument(`<img class="slide-image-content" src="x"/>`));
        expect(bare).toContain('<img style="opacity: 1;" data-image-sizing="stretch" class="slide-image-content" src="x"/>');
    });

    test("adds the doctype and the shared stylesheet for the named page size, or PptxGenJS's default", () => {
        expect(completed.startsWith("<!DOCTYPE html>")).toBe(true);
        expect(completed).toContain("size: 10in 5.625in;");
        const a4 = completeProfileHtml(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><meta name="pdfdeck-page-size" content="A4 Portrait">`));
        expect(a4).toContain("size: 8.27in 11.69in;");
        // The page-size meta it writes is spelled as the version's: pdfdeck- in version 1, pdflapas- in version 2.
        expect(completed).toContain('<meta name="pdfdeck-page-size" content="Screen 16:9 Landscape">');
        const v2 = handWrittenDocument("", `<meta name="pdflapas-profile" content="2">`);
        expect(completeProfileHtml(v2)).toContain('<meta name="pdflapas-page-size" content="Screen 16:9 Landscape">');
        const a4v2 = handWrittenDocument("", `<meta name="pdflapas-profile" content="2"><meta name="pdflapas-page-size" content="A4 Portrait">`);
        expect(completeProfileHtml(a4v2)).toContain("size: 8.27in 11.69in;");
        expect(() => completeProfileHtml(handWrittenDocument("", `<meta name="pdfdeck-profile" content="2">`))).toThrow(`profile version '2' in <meta name="pdfdeck-profile"> is not supported`);
        // A stylesheet with its own @page is kept as it is.
        const own = handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><style>@page { size: 4in 3in; }</style>`);
        expect(completeProfileHtml(own)).not.toContain("puppeteer-gen-styles");
    });

    test("keeps stated values, completes an explicit line-height's baseline, and is idempotent", () => {
        const paragraph = `<div class="slide-element slide-text" style="left: 0px; top: 0px; padding: 0px 0px 0px 0px;"><div class="text-content"><div class="text-paragraph" style="line-height: 40px; text-align: right"><span class="text-run" style="font-size: 20px;">x</span><span class="text-run">y</span></div></div></div>`;
        const once = completeProfileHtml(handWrittenDocument(paragraph));
        // The largest run is the default 24px: baseline = 40 - 0.2 * 24.
        expect(find(once, "text-paragraph")).toMatchObject({
            style: "line-height: 40px; text-align: right; direction: ltr; margin-top: 0px; margin-bottom: 0px; tab-size: 96px;",
            attributes: { "data-line-baseline": String(40 - PPTX_DEFAULTS.text.lineDescentEm * 24) },
        });
        expect(find(once, "slide-text").style).toStartWith("left: 0px; top: 0px; padding: 0px 0px 0px 0px; align-items: center;");
        expect(completeProfileHtml(once)).toBe(once);
    });

    test("leaves chart and component subtrees alone", () => {
        const opaque = `<div class="slide-element slide-component" style="left: 0px; top: 0px;"><span class="text-run">x</span></div>`;
        expect(completeProfileHtml(handWrittenDocument(opaque))).toContain('<span class="text-run">x</span>');
    });

    test("rejects input that is not a profile document, naming the fix", () => {
        expect(() => completeProfileHtml("")).toThrow("expected a non-empty HTML string, got an empty string");
        expect(() => completeProfileHtml(42 as unknown as string)).toThrow("expected a non-empty HTML string, got number");
        expect(() => completeProfileHtml("<html><body><p>Hi</p></body></html>")).toThrow('not a PdfLapas profile document: add <meta name="pdflapas-profile" content="2"> to <head>');
        expect(() => completeProfileHtml(handWrittenDocument("", `<meta name="pdflapas-profile" content="3">`))).toThrow(`profile version '3' in <meta name="pdflapas-profile"> is not supported (this library reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)`);
        expect(() => completeProfileHtml(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><meta name="pdfdeck-page-size" content="Huge">`))).toThrow("page size 'Huge' is not a known size");
        const em = handWrittenDocument(`<div class="slide-element slide-text" data-object-name="T"><div class="text-content"><div class="text-paragraph"><span class="text-run" style="font-size: 2em;">x</span></div></div></div>`);
        expect(() => completeProfileHtml(em)).toThrow("slide 1: object 'T': CSS property 'font-size': '2em' is not a px length");
    });
});
