import type PptxGenJS from "pptxgenjs";
import type { NormalizedShape, NormalizedTextBox } from "@pdflapas/model";
import type { PageSize } from "../../pageLayouts";
import { inchesToPixels } from "../../units";
import { GENERATED_PRESET_NAMES, generatedPresetGeometry, presetTextInsets } from "../generatedPreset";
import { normalizeHyperlink } from "../link";
import { ACTION_BUTTON_GEOMETRY } from "./actionButton";
import { ARROW_GEOMETRY } from "./arrow";
import { BRACE_BRACKET_GEOMETRY } from "./braceBracket";
import { CIRCULAR_GEOMETRY } from "./circular";
import { normalizeCustomPath } from "./custom";
import { FLOWCHART_GEOMETRY } from "./flowchart";
import { OOXML_PERCENT, type ShapeGeometry } from "./path";
import { POLYGON_GEOMETRY } from "./polygon";
import { RIBBON_SCROLL_GEOMETRY } from "./ribbonScroll";
import { SYMBOL_GEOMETRY } from "./symbol";

type CustomShapeName = PptxGenJS.SHAPE_NAME | "custGeom";

const BASIC_GEOMETRY = {
    rect: () => ({ kind: "rect", radius: 0 }),
    roundRect: (width, height, options) => {
        // PptxGenJS 4.0.1 writes the `adj` guide only for a truthy rectRadius; 0 keeps the preset's 1/6 corner.
        const radius = !options.rectRadius ? Math.min(width, height) / 6 : Math.min(Math.min(width, height) / 2, inchesToPixels(Math.max(0, options.rectRadius)));
        return { kind: "rect", radius };
    },
    ellipse: () => ({ kind: "ellipse" }),
    line: () => ({ kind: "line", inverse: false }),
    lineInv: () => ({ kind: "line", inverse: true }),
    custGeom: (_width, _height, options, pageSize) => ({ kind: "path", data: normalizeCustomPath(options.points, pageSize) }),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;

const GENERATED_GEOMETRY: Readonly<Record<string, ShapeGeometry>> = Object.fromEntries(GENERATED_PRESET_NAMES.map(name => [name, (width: number, height: number) => generatedPresetGeometry(name, width, height)]));

/** Every preset PdfLapas draws, by name; a name is supported exactly when it has an entry here. */
const SHAPE_GEOMETRY: ReadonlyMap<string, ShapeGeometry> = new Map(
    Object.entries({
        ...BASIC_GEOMETRY,
        ...POLYGON_GEOMETRY,
        ...ARROW_GEOMETRY,
        ...CIRCULAR_GEOMETRY,
        ...BRACE_BRACKET_GEOMETRY,
        ...RIBBON_SCROLL_GEOMETRY,
        ...ACTION_BUTTON_GEOMETRY,
        ...SYMBOL_GEOMETRY,
        ...FLOWCHART_GEOMETRY,
        ...GENERATED_GEOMETRY,
    }),
);

export const CORE_SVG_SHAPES = Object.freeze([...SHAPE_GEOMETRY.keys()]);

function shapeTextInsets(shapeName: CustomShapeName, options: PptxGenJS.ShapeProps, width: number, height: number): NormalizedShape["textInsets"] {
    // The roundRect corner is the only adjustment PdfLapas reads (rectRadius in inches, as the `adj` PptxGenJS writes).
    const corner: Record<string, number> = shapeName === "roundRect" && options.rectRadius ? { adj: (inchesToPixels(options.rectRadius) * OOXML_PERCENT) / Math.min(width, height) } : {};
    return presetTextInsets(shapeName, width, height, corner);
}

export function normalizeShape(shapeName: CustomShapeName, options: PptxGenJS.ShapeProps, width: number, height: number, pageSize: PageSize): NormalizedShape {
    const geometry = SHAPE_GEOMETRY.get(shapeName);
    if (!geometry) throw new Error(`Unsupported shape geometry: ${shapeName}`);
    const link = normalizeHyperlink(options.hyperlink);
    return { name: shapeName, width, height, geometry: geometry(width, height, options, pageSize), textInsets: shapeTextInsets(shapeName, options, width, height), link };
}

export function normalizeShapeTextBox(text: NormalizedTextBox, shape: NormalizedShape): NormalizedTextBox {
    if (!shape.textInsets) return text;
    const [insetTop, insetRight, insetBottom, insetLeft] = shape.textInsets;
    const [marginTop, marginRight, marginBottom, marginLeft] = text.margin;
    return {
        ...text,
        margin: [marginTop + insetTop, marginRight + insetRight, marginBottom + insetBottom, marginLeft + insetLeft],
    };
}
