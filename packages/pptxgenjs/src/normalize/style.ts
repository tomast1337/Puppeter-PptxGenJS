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

/** Width and length (px) of a "med" line head, the only size PptxGenJS writes (see PPTX_DEFAULTS.shape.arrowHead). */
function arrowHeadSize(arrow: string, width: number): number {
    const { widthFactor, openArrowWidthFactor, minLineWidthMm } = PPTX_DEFAULTS.shape.arrowHead;
    return (arrow === "arrow" ? openArrowWidthFactor : widthFactor) * Math.max(width, millimetersToPixels(minLineWidthMm));
}

/**
 * Where LibreOffice starts the stroked shaft behind a begin arrowhead (drawinglayer
 * PolygonStrokeArrowPrimitive2D): the head consumes its full length, or half for the centred oval and
 * diamond, less a 1/15 head-width overlap. The dash pattern restarts there, so the phase depends on it.
 * shortcut: also shifts closed outlines that LibreOffice draws without heads; pass the geometry in if that matters.
 */
export function arrowShaftStart(arrow: string, width: number): number {
    if (arrow === "none") return 0;
    const head = arrowHeadSize(arrow, width);
    return head * (arrow === "oval" || arrow === "diamond" ? 0.5 : 1) - head / 15;
}

/**
 * The head outline as closed SVG path data (px), with the line end at the origin and +x pointing out of
 * the line, so renderers only rotate it onto each end. Outlines follow the marker polygons LibreOffice 26.2
 * builds for OOXML heads (oox lineproperties.cxx lclPushMarkerProperties), in percent of the head with the
 * tip at (50, 0): the oval and diamond are centred on the line end, the others put their tip on it. The
 * oval is a true ellipse as in PowerPoint (LibreOffice approximates it with 12 points).
 */
export function arrowHeadPath(arrow: string, width: number): string | undefined {
    if (arrow === "none") return undefined;
    const size = arrowHeadSize(arrow, width);
    const r = size / 2;
    if (arrow === "oval") return `M ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 Z`;
    // The open arrow is a filled chevron whose arms and stem are one line width thick.
    const half = Math.max((50 * width) / size, 1);
    const percent: Record<string, readonly (readonly [number, number])[]> = {
        triangle: [
            [50, 0],
            [100, 100],
            [0, 100],
        ],
        stealth: [
            [50, 0],
            [100, 100],
            [50, 60],
            [0, 100],
        ],
        diamond: [
            [50, 0],
            [100, 50],
            [50, 100],
            [0, 50],
        ],
        arrow: [
            [50, 0],
            [100, 100 - half * 1.5],
            [100 - half * 1.5, 100],
            [50 + half, 5.5 * half],
            [50 + half, 100],
            [50 - half, 100],
            [50 - half, 5.5 * half],
            [half * 1.5, 100],
            [0, 100 - half * 1.5],
        ],
    };
    const points = percent[arrow];
    if (!points) throw new Error(`Unknown line arrow type '${arrow}': use one of none, arrow, diamond, oval, stealth or triangle`);
    const shift = arrow === "diamond" ? r : 0;
    return `${points.map(([x, y], index) => `${index ? "L" : "M"} ${shift - (y * size) / 100} ${((x - 50) * size) / 100}`).join(" ")} Z`;
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

/**
 * An explicit dash array that strokes `pattern` from `start` to `end` px along a path of `length` px and
 * leaves the rest blank. The leading zero-length dash keeps dash/gap parity, as in startDashAt.
 */
export function shaftDashes(pattern: readonly number[], start: number, end: number, length: number): number[] {
    const parts = [0, start];
    for (let at = start, index = 0; at < end; index = (index + 1) % pattern.length) {
        const part = pattern[index] ?? 0;
        parts.push(Math.min(part, end - at));
        at += part;
    }
    // Close on a gap that runs past the end, so the pattern never repeats onto the line.
    if (parts.length % 2) parts.push(length);
    else parts[parts.length - 1]! += length;
    return parts;
}

/**
 * `straightLength` is the length (px) of a straight line preset. LibreOffice strokes such a line only between
 * its heads (arrowShaftStart at each end), so the stroke neither pokes out of a pointed tip nor fills the
 * stealth notch; the model spells that out as an explicit dash array.
 * shortcut: other open paths keep the full stroke under their heads; trim them by arc length if a fixture needs it.
 */
export function normalizeLine(value?: PptxGenJS.ShapeLineProps, straightLength?: number): NormalizedLine {
    if (!value || value.type === "none") {
        return { visible: false, color: "transparent", width: 0, style: "solid" };
    }
    const dash = value.dashType ?? value.lineDash ?? "solid";
    const width = pointsToPixels(value.width ?? value.pt ?? value.size ?? PPTX_DEFAULTS.shape.line.widthPt);
    const beginArrow = value.beginArrowType ?? value.lineHead ?? "none";
    const endArrow = value.endArrowType ?? value.lineTail ?? "none";
    const pattern = width > 0 ? PPTX_DEFAULTS.shape.dashPatterns[dash]?.map(part => part * width) : undefined;
    const trimmed = straightLength !== undefined && (beginArrow !== "none" || endArrow !== "none");
    const dashArray = trimmed ? shaftDashes(pattern ?? [straightLength, straightLength], arrowShaftStart(beginArrow, width), straightLength - arrowShaftStart(endArrow, width), straightLength) : pattern && startDashAt(pattern, arrowShaftStart(beginArrow, width));
    return {
        visible: true,
        color: normalizeColor({ ...value, color: value.color ?? PPTX_DEFAULTS.shape.line.color }),
        width,
        style: dash === "solid" ? "solid" : dash === "sysDot" ? "dotted" : "dashed",
        dashArray: dashArray?.join(" "),
        beginArrow,
        endArrow,
        beginHeadPath: arrowHeadPath(beginArrow, width),
        endHeadPath: arrowHeadPath(endArrow, width),
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
