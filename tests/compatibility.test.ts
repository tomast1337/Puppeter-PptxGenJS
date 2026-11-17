import { describe, expect, test } from "bun:test";
import { API_COMPATIBILITY, CHART_OPTION_NAMES, CHART_TYPE_COMPATIBILITY, COMPATIBILITY, type CompatibilityStatus, SHAPE_GEOMETRY_COMPATIBILITY, WASM_COMPATIBILITY } from "../packages/pptxgenjs/src/compatibility";

const VALID_STATUSES = new Set<CompatibilityStatus>(["unsupported", "partial", "implemented", "verified", "ignored"]);
const TEXT_OPTION_KEYS = [
    "x",
    "y",
    "w",
    "h",
    "data",
    "path",
    "objectName",
    "align",
    "bold",
    "breakLine",
    "bullet",
    "color",
    "fontFace",
    "fontSize",
    "highlight",
    "italic",
    "lang",
    "softBreakBefore",
    "tabStops",
    "textDirection",
    "transparency",
    "underline",
    "valign",
    "baseline",
    "charSpacing",
    "fit",
    "fill",
    "flipH",
    "flipV",
    "glow",
    "hyperlink",
    "indentLevel",
    "isTextBox",
    "line",
    "lineSpacing",
    "lineSpacingMultiple",
    "margin",
    "outline",
    "paraSpaceAfter",
    "paraSpaceBefore",
    "placeholder",
    "rectRadius",
    "rotate",
    "rtlMode",
    "shadow",
    "shape",
    "strike",
    "subscript",
    "superscript",
    "vert",
    "wrap",
    "autoFit",
    "shrinkText",
    "inset",
    "lineDash",
    "lineHead",
    "lineSize",
    "lineTail",
] as const;
const IMAGE_OPTION_KEYS = ["x", "y", "w", "h", "path", "data", "objectName", "altText", "flipH", "flipV", "hyperlink", "placeholder", "rotate", "rounding", "shadow", "sizing", "transparency"] as const;
const SHAPE_OPTION_KEYS = ["x", "y", "w", "h", "objectName", "align", "angleRange", "arcThicknessRatio", "fill", "flipH", "flipV", "hyperlink", "line", "points", "rectRadius", "rotate", "shadow", "lineSize", "lineDash", "lineHead", "lineTail", "shapeName"] as const;
const TABLE_TO_SLIDES_OPTION_KEYS = ["tableToSlides", "addImage", "addShape", "addTable", "addText", "slideMargin", "addHeaderToEach", "masterSlideName"] as const;

describe("compatibility manifest", () => {
    test("tracks every active renderer family", () => {
        expect(Object.keys(COMPATIBILITY)).toEqual(["component", "chart", "text", "image", "shape", "table", "slide"]);
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
        expect(Object.keys(COMPATIBILITY.chart.options)).toHaveLength(CHART_OPTION_NAMES.length);
        expect(CHART_OPTION_NAMES.length).toBeGreaterThanOrEqual(170);
        expect(Object.keys(COMPATIBILITY.text.options).length).toBeGreaterThanOrEqual(45);
        expect(Object.keys(COMPATIBILITY.image.options).length).toBeGreaterThanOrEqual(18);
        expect(Object.keys(COMPATIBILITY.shape.options).length).toBeGreaterThanOrEqual(30);
        expect(Object.keys(COMPATIBILITY.table.options).length).toBeGreaterThanOrEqual(35);
    });

    test("tracks the complete pinned IChartOpts surface", () => {
        expect(COMPATIBILITY.chart.options.x).toBe("implemented");
        expect(COMPATIBILITY.chart.options.chartColors).toBe("implemented");
        expect(COMPATIBILITY.chart.options.bar3DShape).toBe("implemented");
        expect(COMPATIBILITY.chart.options.barGapDepthPct).toBe("implemented");
        expect(COMPATIBILITY.chart.options.v3DRotX).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valAxes).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valAxisMinVal).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valAxisLogScaleBase).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valAxisLineStyle).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valGridLine).toBe("implemented");
        expect(COMPATIBILITY.chart.options.valAxisLabelFormatCode).toBe("partial");
        expect(COMPATIBILITY.chart.options.showDataTable).toBe("unsupported");
        // PptxGenJS 4.0.1 declares IChartOpts.fontFace and fontSize but no chart writer reads them.
        expect(COMPATIBILITY.chart.options.fontFace).toBe("ignored");
        expect(COMPATIBILITY.chart.options.fontSize).toBe("ignored");
        expect(CHART_TYPE_COMPATIBILITY.bar).toBe("implemented");
        expect(CHART_TYPE_COMPATIBILITY.bar3D).toBe("implemented");
        expect(CHART_TYPE_COMPATIBILITY.mixed).toBe("partial");
    });

    test("tracks every TextBaseProps and TextPropsOptions field", () => {
        for (const option of TEXT_OPTION_KEYS) {
            expect(COMPATIBILITY.text.options[option]).toBeDefined();
        }
    });

    test("records pinned PptxGenJS text quirks explicitly", () => {
        // Declared, but without effect on what PptxGenJS 4.0.1 draws (tests/text.test.ts checks the model is unchanged).
        for (const option of ["textDirection", "bulletNumberType", "isTextBox", "data", "path"] as const) expect(COMPATIBILITY.text.options[option]).toBe("ignored");
        expect(COMPATIBILITY.shape.options.align).toBe("ignored");
        expect(COMPATIBILITY.table.options.verbose).toBe("ignored");
        expect(COMPATIBILITY.text.options.bulletDeprecatedStyle).toBe("implemented");
    });

    test("tracks every ImageProps field", () => {
        for (const option of IMAGE_OPTION_KEYS) {
            expect(COMPATIBILITY.image.options[option]).toBeDefined();
        }
    });

    test("tracks the WASM backend's shape and image support on the same option surface", () => {
        expect(Object.keys(WASM_COMPATIBILITY.shape.options).sort()).toEqual(Object.keys(COMPATIBILITY.shape.options).sort());
        expect(Object.keys(WASM_COMPATIBILITY.image.options).sort()).toEqual(Object.keys(COMPATIBILITY.image.options).sort());
        expect(WASM_COMPATIBILITY.image.options.svg).toBe("partial");
        expect(WASM_COMPATIBILITY.image.options.gifFirstFrame).toBe("verified");
        expect(WASM_COMPATIBILITY.image.options.webp).toBe("verified");
        expect(WASM_COMPATIBILITY.image.options.hyperlink).toBe("implemented");
        expect(WASM_COMPATIBILITY.shape.status).toBe("partial");
        expect(WASM_COMPATIBILITY.component.status).toBe("partial");
        expect(WASM_COMPATIBILITY.shape.options.presetGeometry).toBe("implemented");
        expect(WASM_COMPATIBILITY.shape.options.lineEndArrow).toBe("implemented");
        expect(WASM_COMPATIBILITY.shape.options.shadow).toBe("partial");
        expect(WASM_COMPATIBILITY.image.options.shadow).toBe("partial");
        expect(WASM_COMPATIBILITY.text.options.glow).toBe("implemented");
        expect(WASM_COMPATIBILITY.shape.options.hyperlink).toBe("implemented");
        expect(WASM_COMPATIBILITY.shape.options.text).toBe("partial");
    });

    test("tracks the WASM backend's table support on the same option surface", () => {
        expect(Object.keys(WASM_COMPATIBILITY.table.options).sort()).toEqual(Object.keys(COMPATIBILITY.table.options).sort());
        expect(WASM_COMPATIBILITY.table.status).toBe("partial");
        expect(WASM_COMPATIBILITY.table.options.rowspan).toBe("verified");
        expect(WASM_COMPATIBILITY.table.options.tableToSlides).toBe("implemented");
        expect(WASM_COMPATIBILITY.table.options.underline).toBe("implemented");
    });

    test("tracks the WASM backend's text support on the same option surface", () => {
        expect(Object.keys(WASM_COMPATIBILITY.text.options).sort()).toEqual(Object.keys(COMPATIBILITY.text.options).sort());
        expect(WASM_COMPATIBILITY.text.options.lineSpacingMultiple).toBe("implemented");
        expect(WASM_COMPATIBILITY.text.options.superscript).toBe("implemented");
        expect(WASM_COMPATIBILITY.text.options.hyperlink).toBe("implemented");
        expect(WASM_COMPATIBILITY.text.options.textDirection).toBe("ignored");
    });

    test("tracks the slide properties on both backends", () => {
        expect(Object.keys(COMPATIBILITY.slide.options).sort()).toEqual(["backgroundColor", "backgroundImage", "color", "hidden", "slideNumber"]);
        expect(WASM_COMPATIBILITY.slide.options).toEqual(COMPATIBILITY.slide.options);
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
        expect(SHAPE_GEOMETRY_COMPATIBILITY.bentArrow).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.curvedDownArrow).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.swooshArrow).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.cloud).toBe("implemented");
        expect(Object.values(SHAPE_GEOMETRY_COMPATIBILITY).every(status => status === "implemented")).toBe(true);
    });

    test("reports complete preset and custom shape geometry coverage", () => {
        expect(COMPATIBILITY.shape.options.presetGeometry).toBe("implemented");
        expect(COMPATIBILITY.shape.options.customGeometry).toBe("implemented");
        expect(SHAPE_GEOMETRY_COMPATIBILITY.cloud).toBe("implemented");
    });

    test("tracks the tableToSlides option surface and unsupported master behavior", () => {
        for (const option of TABLE_TO_SLIDES_OPTION_KEYS) {
            expect(COMPATIBILITY.table.options[option]).toBeDefined();
        }
        expect(COMPATIBILITY.table.options.tableToSlides).toBe("verified");
        expect(COMPATIBILITY.table.options.masterSlideName).toBe("unsupported");
        // Both master-name options throw the same UnsupportedFeatureError (tests/unsupportedMethods.test.ts).
        expect(API_COMPATIBILITY.presentation.addSlide?.note).toContain("masterName");
        expect(API_COMPATIBILITY.presentation.addSlide?.note).toContain("throws UnsupportedFeatureError");
    });
});
