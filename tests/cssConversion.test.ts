import { describe, expect, test } from "bun:test";
import { alignToCSS, valignToCSS } from "../packages/pptxgenjs/src/alignment";
import { colorToCSS } from "../packages/pptxgenjs/src/color";
import { convertToPixels, inchesToPixels, percentageToPixels, pointsToPixels } from "../packages/pptxgenjs/src/units";

describe("measurement conversion", () => {
    test("converts inches and points at 96 DPI", () => {
        expect(inchesToPixels(1)).toBe(96);
        expect(pointsToPixels(72)).toBe(96);
    });

    test("converts percentage coordinates relative to the slide", () => {
        expect(percentageToPixels(25, 960)).toBe(240);
        expect(convertToPixels("25%", 960)).toBe(240);
        expect(convertToPixels(2.5, 960)).toBe(240);
    });
});

describe("style conversion", () => {
    test("supports PptxGenJS hex and fill objects", () => {
        expect(colorToCSS("4472C4")).toBe("#4472C4");
        expect(colorToCSS("FFFFFF")).toBe("#FFFFFF");
        expect(colorToCSS("#4472c4")).toBe("#4472c4");
        expect(colorToCSS({ color: "4472C4" })).toBe("#4472C4");
        expect(colorToCSS({ color: "FF0000", transparency: 25 })).toBe("rgba(255, 0, 0, 0.75)");
        expect(colorToCSS({ color: "#FF0000", transparency: 25 })).toBe("rgba(255, 0, 0, 0.75)");
    });

    // The result is written into inline CSS and SVG attributes (#148); PptxGenJS 4.0.1 accepts only 6-digit hex here.
    test("rejects colors that are not 6-digit hex", () => {
        for (const color of ["red", "rgb(1, 2, 3)", "FF000080", "FFF", "##FF0000", "FF0000 ", "red;background:url(http://x)", "FF0000;background:url(http://x)", "#FF0000;color:red", "}", "url(http://x)", '"FF0000"', "'FF0000'", "FF0000\n"]) {
            expect(() => colorToCSS(color)).toThrow(`color ${JSON.stringify(color)} is not a valid color: use a 6-digit hex RGB value`);
            expect(() => colorToCSS({ color })).toThrow("is not a valid color");
        }
    });

    test("maps text alignment", () => {
        expect(alignToCSS("center")).toBe("center");
        expect(valignToCSS("middle")).toBe("center");
    });
});
