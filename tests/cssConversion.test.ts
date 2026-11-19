import { describe, expect, test } from "bun:test";
import type { NormalizedFill } from "../packages/model/src/types";
import { alignToCSS, valignToCSS } from "../packages/pptxgenjs/src/alignment";
import { colorToCSS } from "../packages/pptxgenjs/src/color";
import { inchesToPixels, percentageToPixels, pointsToPixels, px } from "@pdflapas/model";
import { convertToPixels } from "../packages/pptxgenjs/src/units";

describe("measurement conversion", () => {
    test("converts inches and points at 96 DPI", () => {
        expect(inchesToPixels(1)).toBe(px(96));
        expect(pointsToPixels(72)).toBe(px(96));
    });

    test("converts percentage coordinates relative to the slide", () => {
        expect(percentageToPixels(25, 960)).toBe(px(240));
        expect(convertToPixels("25%", 960)).toBe(240);
        expect(convertToPixels(2.5, 960)).toBe(240);
    });
});

describe("style conversion", () => {
    test("supports PptxGenJS hex and fill objects", () => {
        expect<string>(colorToCSS("4472C4")).toBe("#4472C4");
        expect<string>(colorToCSS("FFFFFF")).toBe("#FFFFFF");
        expect<string>(colorToCSS("#4472c4")).toBe("#4472c4");
        expect<string>(colorToCSS({ color: "4472C4" })).toBe("#4472C4");
        expect<string>(colorToCSS({ color: "FF0000", transparency: 25 })).toBe("rgba(255, 0, 0, 0.75)");
        expect<string>(colorToCSS({ color: "#FF0000", transparency: 25 })).toBe("rgba(255, 0, 0, 0.75)");
    });

    // The result is written into inline CSS and SVG attributes (#148); PptxGenJS 4.0.1 accepts only 6-digit hex here.
    test("rejects colors that are not 6-digit hex", () => {
        for (const color of ["red", "rgb(1, 2, 3)", "FF000080", "FFF", "##FF0000", "FF0000 ", "red;background:url(http://x)", "FF0000;background:url(http://x)", "#FF0000;color:red", "}", "url(http://x)", '"FF0000"', "'FF0000'", "FF0000\n"]) {
            expect(() => colorToCSS(color)).toThrow(`color ${JSON.stringify(color)} is not a valid color: use a 6-digit hex RGB value`);
            expect(() => colorToCSS({ color })).toThrow("is not a valid color");
        }
    });

    // A model color is written into CSS and SVG unchecked, so only colorToCSS may make one; typecheck enforces it.
    test("types a model color as a CssColor", () => {
        const fill: NormalizedFill = { visible: true, color: colorToCSS("FF0000") };
        // @ts-expect-error a plain string is not a CssColor: it has not been through colorToCSS.
        const raw: NormalizedFill = { visible: true, color: "red; background: url(http://x)" };
        expect<string>(fill.color).toBe("#FF0000");
        expect(raw.visible).toBe(true);
    });

    test("maps text alignment", () => {
        expect(alignToCSS("center")).toBe("center");
        expect(valignToCSS("middle")).toBe("center");
    });
});
