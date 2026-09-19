import { describe, expect, test } from "bun:test";
import { COMPATIBILITY, type CompatibilityStatus } from "../src/compatibility";

const VALID_STATUSES = new Set<CompatibilityStatus>(["unsupported", "partial", "implemented", "verified"]);

describe("compatibility manifest", () => {
    test("tracks every active renderer family", () => {
        expect(Object.keys(COMPATIBILITY)).toEqual(["text", "image", "shape", "table"]);
    });

    test("contains only explicit compatibility states", () => {
        for (const family of Object.values(COMPATIBILITY)) {
            expect(VALID_STATUSES.has(family.status)).toBe(true);
            expect(Object.keys(family.options).length).toBeGreaterThan(0);
            for (const status of Object.values(family.options)) {
                expect(VALID_STATUSES.has(status)).toBe(true);
            }
        }
    });

    test("enumerates the public option surface instead of broad feature labels", () => {
        expect(Object.keys(COMPATIBILITY.text.options).length).toBeGreaterThanOrEqual(45);
        expect(Object.keys(COMPATIBILITY.image.options).length).toBeGreaterThanOrEqual(18);
        expect(Object.keys(COMPATIBILITY.shape.options).length).toBeGreaterThanOrEqual(30);
        expect(Object.keys(COMPATIBILITY.table.options).length).toBeGreaterThanOrEqual(35);
    });

    test("does not claim unsupported shape geometry is implemented", () => {
        expect(COMPATIBILITY.shape.options.presetGeometry).toBe("unsupported");
        expect(COMPATIBILITY.shape.options.customGeometry).toBe("unsupported");
    });
});
