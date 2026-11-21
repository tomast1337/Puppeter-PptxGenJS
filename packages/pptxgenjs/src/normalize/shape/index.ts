import type PptxGenJS from "pptxgenjs";
import type { NormalizedShape, NormalizedTextBox } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";
import { inchesToPixels, px } from "@pdflapas/model";
import { innerShadowError } from "#src/normalize/style";
import { GENERATED_PRESET_NAMES, type GeneratedPresetName, generatedPresetGeometry, isGeneratedPreset, presetTextInsets } from "#src/normalize/generatedPreset";
import { normalizeHyperlink } from "#src/normalize/link";
import { ACTION_BUTTON_GEOMETRY } from "./actionButton";
import { CIRCULAR_GEOMETRY } from "./circular";
import { normalizeCustomPath } from "./custom";
import { OOXML_PERCENT, type ShapeGeometry } from "./path";
import { RIBBON_SCROLL_GEOMETRY } from "./ribbonScroll";

type CustomShapeName = PptxGenJS.SHAPE_NAME | "custGeom";

const BASIC_GEOMETRY = {
    rect: () => ({ kind: "rect", radius: px(0) }),
    roundRect: (width, height, options) => {
        // PptxGenJS 4.0.1 writes the `adj` guide only for a truthy rectRadius; 0 keeps the preset's 1/6 corner.
        const radius = !options.rectRadius ? Math.min(width, height) / 6 : Math.min(Math.min(width, height) / 2, inchesToPixels(Math.max(0, options.rectRadius)));

        return { kind: "rect", radius: px(radius) };
    },
    ellipse: () => ({ kind: "ellipse" }),
    // Kept as an ellipse (#153): the generated flowChartConnector, four quarter arcs, draws the same in Chromium but
    // scores 0.0055 against this ellipse's 0.0054 in the WASM shapes deck crop (p10-Shape2; 13 edge pixels differ).
    flowChartConnector: () => ({ kind: "ellipse" }),
    line: () => ({ kind: "line", inverse: false }),
    lineInv: () => ({ kind: "line", inverse: true }),
    custGeom: (_width, _height, options, pageSize) => ({ kind: "path", data: normalizeCustomPath(options.points, pageSize) }),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;

/**
 * The presets drawn by hand (scripts/generate-preset-shapes.ts says why for each): every name PptxGenJS can write
 * that is not generated must have an entry, and a generated name must not, or this does not type-check.
 */
const HAND_DRAWN_GEOMETRY = {
    ...BASIC_GEOMETRY,
    ...CIRCULAR_GEOMETRY,
    ...RIBBON_SCROLL_GEOMETRY,
    ...ACTION_BUTTON_GEOMETRY,
} as const satisfies Readonly<Record<Exclude<CustomShapeName, GeneratedPresetName>, ShapeGeometry>> & { readonly [name in GeneratedPresetName]?: never };

type HandDrawnName = keyof typeof HAND_DRAWN_GEOMETRY;

function isHandDrawn(name: string): name is HandDrawnName {
    return Object.hasOwn(HAND_DRAWN_GEOMETRY, name);
}

/** Every preset PdfLapas draws, by name. */
export const CORE_SVG_SHAPES: readonly string[] = Object.freeze([...Object.keys(HAND_DRAWN_GEOMETRY), ...GENERATED_PRESET_NAMES]);

function shapeTextInsets(shapeName: CustomShapeName, options: PptxGenJS.ShapeProps, width: number, height: number): NormalizedShape["textInsets"] {
    // The roundRect corner is the only adjustment PdfLapas reads (rectRadius in inches, as the `adj` PptxGenJS writes).
    const corner: Record<string, number> = shapeName === "roundRect" && options.rectRadius ? { adj: (inchesToPixels(options.rectRadius) * OOXML_PERCENT) / Math.min(width, height) } : {};

    return presetTextInsets(shapeName, width, height, corner);
}

export function normalizeShape(shapeName: CustomShapeName, options: PptxGenJS.ShapeProps, width: number, height: number, pageSize: PageSize): NormalizedShape {
    // The name comes from the caller: check it, so an Object.prototype name never reaches a lookup.
    const geometry: ShapeGeometry | undefined = isGeneratedPreset(shapeName) ? (w, h) => generatedPresetGeometry(shapeName, w, h) : isHandDrawn(shapeName) ? HAND_DRAWN_GEOMETRY[shapeName] : undefined;

    if (!geometry) {
        throw new Error(`Unsupported shape geometry: ${shapeName}`);
    }

    if (options.shadow?.type === "inner") {
        throw innerShadowError(`shape "${shapeName}"`);
    }

    const link = normalizeHyperlink(options.hyperlink);

    return { name: shapeName, width: px(width), height: px(height), geometry: geometry(width, height, options, pageSize), textInsets: shapeTextInsets(shapeName, options, width, height), link };
}

export function normalizeShapeTextBox(text: NormalizedTextBox, shape: NormalizedShape): NormalizedTextBox {
    if (!shape.textInsets) {
        return text;
    }

    const [insetTop, insetRight, insetBottom, insetLeft] = shape.textInsets;
    const [marginTop, marginRight, marginBottom, marginLeft] = text.margin;

    return {
        ...text,
        margin: [marginTop + insetTop, marginRight + insetRight, marginBottom + insetBottom, marginLeft + insetLeft],
    };
}
