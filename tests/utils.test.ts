import { describe, expect, test } from "bun:test";
import {
    alignToCSS,
    colorToCSS,
    convertToPixels,
    inchesToPixels,
    percentageToPixels,
    pointsToPixels,
    valignToCSS,
} from "../src/utils";

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
        expect(colorToCSS("red")).toBe("red");
        expect(colorToCSS({ color: "4472C4" })).toBe("#4472C4");
        expect(colorToCSS({ color: "FF0000", transparency: 25 }))
            .toBe("rgba(255, 0, 0, 0.75)");
    });

    test("maps text alignment", () => {
        expect(alignToCSS("center")).toBe("center");
        expect(valignToCSS("middle")).toBe("center");
    });
});
