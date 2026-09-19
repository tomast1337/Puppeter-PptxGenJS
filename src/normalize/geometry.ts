import type { PageSize } from "../pageLayouts";
import type { Coord, NormalizedGeometry, NormalizedTransform } from "../model/types";
import { convertToPixels } from "../utils";

export interface PositionOptions {
    x?: Coord;
    y?: Coord;
    w?: Coord;
    h?: Coord;
}

export interface TransformOptions {
    rotate?: number;
    flipH?: boolean;
    flipV?: boolean;
    transparency?: number;
}

export function normalizeGeometry(
    options: PositionOptions,
    defaults: PositionOptions,
    pageSize: PageSize,
): NormalizedGeometry {
    const width = pageSize.width * 96;
    const height = pageSize.height * 96;
    const x = options.x ?? defaults.x ?? 0;
    const y = options.y ?? defaults.y ?? 0;
    const w = options.w ?? defaults.w;
    const h = options.h ?? defaults.h;

    return {
        x: convertToPixels(x, width),
        y: convertToPixels(y, height),
        width: w === undefined ? undefined : convertToPixels(w, width),
        height: h === undefined ? undefined : convertToPixels(h, height),
    };
}

export function normalizeTransform(options: TransformOptions = {}): NormalizedTransform {
    const transparency = Math.max(0, Math.min(100, options.transparency ?? 0));
    return {
        rotation: Number.isFinite(options.rotate) ? options.rotate! : 0,
        flipH: options.flipH ?? false,
        flipV: options.flipV ?? false,
        opacity: 1 - transparency / 100,
    };
}
