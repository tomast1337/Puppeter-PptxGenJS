import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedFill, NormalizedLine, NormalizedShadow } from "@pdfdeck/model";
import { colorToCSS } from "../color";
import { millimetersToPixels, pointsToPixels } from "../units";

type ColorValue = string | { color?: string; transparency?: number; alpha?: number; type?: string };

const SCHEME_COLORS: Readonly<Record<string, string>> = Object.freeze({
    tx1: PPTX_DEFAULTS.theme.colors.dark1,
    tx2: PPTX_DEFAULTS.theme.colors.dark2,
    bg1: PPTX_DEFAULTS.theme.colors.light1,
    bg2: PPTX_DEFAULTS.theme.colors.light2,
    accent1: PPTX_DEFAULTS.theme.colors.accent1,
    accent2: PPTX_DEFAULTS.theme.colors.accent2,
    accent3: PPTX_DEFAULTS.theme.colors.accent3,
    accent4: PPTX_DEFAULTS.theme.colors.accent4,
    accent5: PPTX_DEFAULTS.theme.colors.accent5,
    accent6: PPTX_DEFAULTS.theme.colors.accent6,
});

export function normalizeColor(value?: ColorValue, fallback = "transparent"): string {
    if (!value) return fallback;
    if (typeof value === "string") {
        return colorToCSS(SCHEME_COLORS[value] ?? value);
    }
    const resolved = value.color ? (SCHEME_COLORS[value.color] ?? value.color) : undefined;
    return colorToCSS({ color: resolved, transparency: value.transparency ?? value.alpha });
}

export function normalizeFill(value?: ColorValue): NormalizedFill {
    if (!value || (typeof value === "object" && value.type === "none")) {
        return { visible: false, color: "transparent" };
    }
    return { visible: true, color: normalizeColor(value) };
}

/**
 * Where LibreOffice starts the stroked shaft behind a begin arrowhead (drawinglayer
 * PolygonStrokeArrowPrimitive2D): the head consumes its full length, or half for the centred oval and
 * diamond, less a 1/15 head-width overlap. The dash pattern restarts there, so the phase depends on it.
 * shortcut: also shifts closed outlines that LibreOffice draws without heads; pass the geometry in if that matters.
 */
export function arrowShaftStart(arrow: string, width: number): number {
    if (arrow === "none") return 0;
    const { widthFactor, openArrowWidthFactor, minLineWidthMm } = PPTX_DEFAULTS.shape.arrowHead;
    const head = (arrow === "arrow" ? openArrowWidthFactor : widthFactor) * Math.max(width, millimetersToPixels(minLineWidthMm));
    return head * (arrow === "oval" || arrow === "diamond" ? 0.5 : 1) - head / 15;
}

/**
 * Rotates a dash pattern so its first dash begins `start` px along the path. Renderers take no
 * dash offset, so the split entry is padded with a zero-length dash or gap to keep dash/gap parity.
 */
export function startDashAt(pattern: readonly number[], start: number): number[] {
    const period = pattern.reduce((sum, part) => sum + part, 0);
    let offset = (((period - start) % period) + period) % period;
    if (offset === 0) return [...pattern];
    const index = pattern.findIndex(part => (offset -= part) < 0);
    const rest = [-offset, ...pattern.slice(index + 1), ...pattern.slice(0, index), pattern[index]! + offset];
    return index % 2 === 0 ? [...rest, 0] : [0, ...rest];
}

export function normalizeLine(value?: PptxGenJS.ShapeLineProps): NormalizedLine {
    if (!value || value.type === "none") {
        return { visible: false, color: "transparent", width: 0, style: "solid" };
    }
    const dash = value.dashType ?? value.lineDash ?? "solid";
    const width = pointsToPixels(value.width ?? value.pt ?? value.size ?? PPTX_DEFAULTS.shape.line.widthPt);
    const beginArrow = value.beginArrowType ?? value.lineHead ?? "none";
    const pattern = PPTX_DEFAULTS.shape.dashPatterns[dash]?.map(part => part * width);
    return {
        visible: true,
        color: normalizeColor({ ...value, color: value.color ?? PPTX_DEFAULTS.shape.line.color }),
        width,
        style: dash === "solid" ? "solid" : dash === "sysDot" ? "dotted" : "dashed",
        dashArray: pattern && startDashAt(pattern, arrowShaftStart(beginArrow, width)).join(" "),
        beginArrow,
        endArrow: value.endArrowType ?? value.lineTail ?? "none",
    };
}

export function normalizeShadow(value?: PptxGenJS.ShadowProps): NormalizedShadow {
    if (!value || value.type === "none") {
        return { visible: false, color: "transparent", blur: 0, offsetX: 0, offsetY: 0, inset: false };
    }
    const defaults = PPTX_DEFAULTS.shadow.shapeWhenEnabled;
    const angle = ((value.angle ?? defaults.angle) * Math.PI) / 180;
    const offset = pointsToPixels(value.offset ?? defaults.offsetPt);
    const opacity = value.opacity ?? defaults.opacity;
    const color = normalizeColor({ color: value.color ?? defaults.color, transparency: (1 - opacity) * 100 });
    return {
        visible: true,
        color,
        blur: pointsToPixels(value.blur ?? defaults.blurPt),
        offsetX: Math.cos(angle) * offset,
        offsetY: Math.sin(angle) * offset,
        inset: value.type === "inner",
    };
}
