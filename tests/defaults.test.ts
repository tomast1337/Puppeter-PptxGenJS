import { describe, expect, test } from "bun:test";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION, tableMarginToCSS, textMarginToCSS } from "../src/defaults";

describe("defaults contract", () => {
    test("is pinned to the audited PptxGenJS version", () => {
        expect(PPTX_DEFAULTS_VERSION).toBe("pptxgenjs@4.0.1");
        expect(PPTX_DEFAULTS.sourceVersion).toBe(PPTX_DEFAULTS_VERSION);
    });

    test("covers implemented and future renderer families", () => {
        expect(Object.keys(PPTX_DEFAULTS)).toEqual(expect.arrayContaining(["presentation", "theme", "write", "slide", "text", "table", "shape", "image", "media", "bullet", "chart", "fill", "border", "shadow"]));
        expect(PPTX_DEFAULTS.image).toMatchObject({ x: 0, y: 0, w: 1, h: 1, transparency: 0 });
        expect(PPTX_DEFAULTS.media).toMatchObject({ x: 0, y: 0, w: 2, h: 2, type: "audio" });
        expect(PPTX_DEFAULTS.chart).toMatchObject({ x: 1, y: 1, w: "50%", h: "50%" });
    });

    test("freezes the contract and its mutable-looking palettes", () => {
        expect(Object.isFrozen(PPTX_DEFAULTS)).toBe(true);
        expect(Object.isFrozen(PPTX_DEFAULTS.chart)).toBe(true);
        expect(Object.isFrozen(PPTX_DEFAULTS.chart.colors.bar)).toBe(true);
        expect(Object.isFrozen(PPTX_DEFAULTS.chart.colors.pie)).toBe(true);
    });
});

describe("PptxGenJS defaults", () => {
    test("captures the normal PowerPoint text inset", () => {
        expect(PPTX_DEFAULTS.text.marginIn).toEqual([0.05, 0.1, 0.05, 0.1]);
        expect(textMarginToCSS()).toBe("4.8px 9.6px 4.8px 9.6px");
    });

    test("mirrors PptxGenJS 4.0.1 text margin array ordering", () => {
        expect(textMarginToCSS([1, 2, 3, 4])).toBe("5.333333px 2.666667px 4px 1.333333px");
    });

    test("uses TRBL ordering and dual units for table margins", () => {
        expect(tableMarginToCSS([0.05, 0.1, 0.05, 0.1])).toBe("4.8px 9.6px 4.8px 9.6px");
        expect(tableMarginToCSS(6)).toBe("8px 8px 8px 8px");
    });
});
