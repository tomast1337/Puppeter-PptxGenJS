import { describe, expect, test } from "bun:test";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION } from "../packages/pptxgenjs/src/defaults";

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
