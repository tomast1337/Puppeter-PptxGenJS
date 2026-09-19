import type PptxGenJS from "pptxgenjs";
import type { PageSize } from "../pageLayouts";
import type { NormalizedObjectStyle } from "../model/types";
import { normalizeGeometry, normalizeTransform, type PositionOptions, type TransformOptions } from "./geometry";
import { normalizeFill, normalizeLine, normalizeShadow } from "./style";

export interface ObjectStyleOptions extends PositionOptions, TransformOptions {
    objectName?: string;
    fill?: PptxGenJS.ShapeFillProps;
    line?: PptxGenJS.ShapeLineProps;
    shadow?: PptxGenJS.ShadowProps;
}

export interface NormalizeObjectFlags {
    fill?: boolean;
    line?: boolean;
    shadow?: boolean;
}

export function normalizeObjectStyle(
    options: ObjectStyleOptions,
    defaults: PositionOptions,
    pageSize: PageSize,
    objectName: string,
    flags: NormalizeObjectFlags = {},
): NormalizedObjectStyle {
    return {
        geometry: normalizeGeometry(options, defaults, pageSize),
        transform: normalizeTransform(options),
        fill: flags.fill ? normalizeFill(options.fill) : undefined,
        line: flags.line ? normalizeLine(options.line) : undefined,
        shadow: flags.shadow ? normalizeShadow(options.shadow) : undefined,
        objectName: options.objectName ?? objectName,
    };
}
