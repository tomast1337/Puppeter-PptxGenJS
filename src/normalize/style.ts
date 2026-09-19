import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedFill, NormalizedLine, NormalizedShadow } from "../model/types";
import { colorToCSS, pointsToPixels } from "../utils";

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
    const resolved = value.color ? SCHEME_COLORS[value.color] ?? value.color : undefined;
    return colorToCSS({ color: resolved, transparency: value.transparency ?? value.alpha });
}

export function normalizeFill(value?: ColorValue): NormalizedFill {
    if (!value || (typeof value === "object" && value.type === "none")) {
        return { visible: false, color: "transparent" };
    }
    return { visible: true, color: normalizeColor(value) };
}

export function normalizeLine(value?: PptxGenJS.ShapeLineProps): NormalizedLine {
    if (!value || value.type === "none") {
        return { visible: false, color: "transparent", width: 0, style: "solid" };
    }
    const dash = value.dashType ?? value.lineDash ?? "solid";
    const width = pointsToPixels(value.width ?? value.pt ?? value.size ?? PPTX_DEFAULTS.shape.line.widthPt);
    const dashPatterns: Readonly<Record<string, number[] | undefined>> = {
        solid: undefined,
        dash: [4, 3],
        dashDot: [4, 3, 1, 3],
        lgDash: [8, 3],
        lgDashDot: [8, 3, 1, 3],
        lgDashDotDot: [8, 3, 1, 3, 1, 3],
        sysDash: [3, 2],
        sysDot: [1, 2],
    };
    return {
        visible: true,
        color: normalizeColor({ ...value, color: value.color ?? PPTX_DEFAULTS.shape.line.color }),
        width,
        style: dash === "solid" ? "solid" : dash === "sysDot" ? "dotted" : "dashed",
        dashArray: dashPatterns[dash]?.map(part => part * width).join(" "),
        beginArrow: value.beginArrowType ?? value.lineHead ?? "none",
        endArrow: value.endArrowType ?? value.lineTail ?? "none",
    };
}

export function normalizeShadow(value?: PptxGenJS.ShadowProps): NormalizedShadow {
    if (!value || value.type === "none") {
        return { visible: false, color: "transparent", blur: 0, offsetX: 0, offsetY: 0, inset: false };
    }
    const defaults = PPTX_DEFAULTS.shadow.shapeWhenEnabled;
    const angle = (value.angle ?? defaults.angle) * Math.PI / 180;
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
