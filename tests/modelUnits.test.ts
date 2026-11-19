import { describe, expect, test } from "bun:test";
import { cssPx, degreesToRadians, inches, inchesToPixels, inchesToPoints, millimetersToPixels, type Px, pixelsToInches, pixelsToPoints, pointsToInches, pointsToPixels, pt, px } from "@pdflapas/model";

describe("model unit helpers", () => {
    test("convert between inches, points, millimetres and CSS pixels at 96 px and 72 pt per inch", () => {
        expect(inchesToPixels(1.5)).toBe(px(144));
        expect(pointsToPixels(18)).toBe(px(24));
        expect(millimetersToPixels(25.4)).toBe(px(96));
        expect(pixelsToPoints(24)).toBe(pt(18));
        expect(pixelsToInches(48)).toBe(inches(0.5));
        expect(pointsToInches(36)).toBe(inches(0.5));
        expect(inchesToPoints(2)).toBe(pt(144));
        expect(degreesToRadians(180)).toBe(Math.PI);
    });

    test("cssPx writes a pixel length as a CSS value", () => {
        expect(cssPx(px(12.5))).toBe("12.5px");
        expect(cssPx(pointsToPixels(9))).toBe("12px");
    });

    test("a Pt or a plain number is not a Px (checked by typecheck)", () => {
        const takesPx = (value: Px) => value;
        // @ts-expect-error a Pt is not a Px
        takesPx(pt(12));
        // @ts-expect-error a plain number is not a Px
        takesPx(12);
        // @ts-expect-error an Inches value is not a Px
        cssPx(pixelsToInches(96));
        expect(takesPx(px(12))).toBe(px(12));
    });
});
