import { describe, expect, test } from "bun:test";
import { COMPATIBILITY, SHAPE_GEOMETRY_COMPATIBILITY, type CompatibilityStatus } from "../src/compatibility";

const VALID_STATUSES = new Set<CompatibilityStatus>(["unsupported", "partial", "implemented", "verified"]);
const TEXT_OPTION_KEYS = [
    "x", "y", "w", "h", "data", "path", "objectName",
    "align", "bold", "breakLine", "bullet", "color", "fontFace", "fontSize", "highlight",
    "italic", "lang", "softBreakBefore", "tabStops", "textDirection", "transparency", "underline", "valign",
    "baseline", "charSpacing", "fit", "fill", "flipH", "flipV", "glow", "hyperlink", "indentLevel",
    "isTextBox", "line", "lineSpacing", "lineSpacingMultiple", "margin", "outline", "paraSpaceAfter",
    "paraSpaceBefore", "placeholder", "rectRadius", "rotate", "rtlMode", "shadow", "shape", "strike",
    "subscript", "superscript", "vert", "wrap", "autoFit", "shrinkText", "inset", "lineDash",
    "lineHead", "lineSize", "lineTail",
] as const;
const IMAGE_OPTION_KEYS = [
    "x", "y", "w", "h", "path", "data", "objectName", "altText", "flipH", "flipV",
    "hyperlink", "placeholder", "rotate", "rounding", "shadow", "sizing", "transparency",
] as const;
const SHAPE_OPTION_KEYS = [
    "x", "y", "w", "h", "objectName", "align", "angleRange", "arcThicknessRatio", "fill",
    "flipH", "flipV", "hyperlink", "line", "points", "rectRadius", "rotate", "shadow",
    "lineSize", "lineDash", "lineHead", "lineTail", "shapeName",
] as const;

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

    test("tracks every TextBaseProps and TextPropsOptions field", () => {
        for (const option of TEXT_OPTION_KEYS) {
            expect(COMPATIBILITY.text.options[option]).toBeDefined();
        }
    });

    test("records pinned PptxGenJS text quirks explicitly", () => {
        expect(COMPATIBILITY.text.options.textDirection).toBe("unsupported");
        expect(COMPATIBILITY.text.options.bulletNumberType).toBe("unsupported");
        expect(COMPATIBILITY.text.options.bulletDeprecatedStyle).toBe("implemented");
    });

    test("tracks every ImageProps field", () => {
        for (const option of IMAGE_OPTION_KEYS) {
            expect(COMPATIBILITY.image.options[option]).toBeDefined();
        }
    });

    test("tracks every ShapeProps field and classifies every preset", () => {
        for (const option of SHAPE_OPTION_KEYS) {
            expect(COMPATIBILITY.shape.options[option]).toBeDefined();
        }
        expect(Object.keys(SHAPE_GEOMETRY_COMPATIBILITY)).toHaveLength(179);
        expect(SHAPE_GEOMETRY_COMPATIBILITY.rect).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.custGeom).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.star32).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.quadArrowCallout).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.bentArrow).toBe("unsupported");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.cloud).toBe("unsupported");
    });

    test("does not claim unsupported shape geometry is implemented", () => {
        expect(COMPATIBILITY.shape.options.presetGeometry).toBe("partial");
        expect(COMPATIBILITY.shape.options.customGeometry).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.cloud).toBe("unsupported");
    });
});
