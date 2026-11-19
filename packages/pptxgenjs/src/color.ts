import type { CssColor } from "@pdflapas/model";

/**
 * Converts PptxGenJS color format to CSS color
 */
export interface ColorProps {
    color?: string;
    transparency?: number;
}

// PptxGenJS 4.0.1 (createColorElement) strips one leading "#" and accepts only 6-digit hex RGB.
export const HEX_COLOR = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

/** The one place a CssColor is made; the template types admit only the forms the brand lists. */
const cssColor = (value: `#${string}` | `rgba(${string})` | "transparent"): CssColor => value as CssColor;

export const TRANSPARENT = cssColor("transparent");

/**
 * Converts a PptxGenJS color string or fill/line object to a CSS color.
 * Throws on anything but 6-digit hex: the result goes into inline CSS and SVG, so a free-form string could add
 * declarations (`red; background: url(...)`). PptxGenJS warns and writes black instead; we fail loudly.
 */
export function colorToCSS(value?: string | ColorProps): CssColor {
    if (!value) return TRANSPARENT;

    const color = typeof value === "string" ? value : value.color;
    if (!color) return TRANSPARENT;

    const hex = HEX_COLOR.exec(color);
    if (!hex) throw new Error(`color ${JSON.stringify(color)} is not a valid color: use a 6-digit hex RGB value such as "FF0000" or a scheme color (tx1, tx2, bg1, bg2, accent1 to accent6)`);
    const [, red = "", green = "", blue = ""] = hex;

    const transparency = typeof value === "object" ? value.transparency : undefined;
    if (transparency === undefined || transparency <= 0) return cssColor(`#${red}${green}${blue}`);

    const alpha = Math.max(0, Math.min(1, 1 - transparency / 100));
    return cssColor(`rgba(${parseInt(red, 16)}, ${parseInt(green, 16)}, ${parseInt(blue, 16)}, ${alpha})`);
}

// The rgba() colorToCSS writes; the alpha is a JavaScript number string, which can take an exponent (1e-7).
const RGBA_COLOR = /^rgba\((\d+), (\d+), (\d+), ([^)]+)\)$/;

/** A CssColor split back into the form colorToCSS made: a `switch` over `form` with a `never` default is exhaustive. */
export type CssColorParts = { readonly form: "hex"; readonly channels: readonly number[] } | { readonly form: "rgba"; readonly channels: readonly number[]; readonly alpha: string } | { readonly form: "transparent" };

/**
 * Parses a CssColor in each form colorToCSS makes. Anything else can only come from model JSON another producer
 * built without colorToCSS, so it throws rather than draw the color unchanged (#285).
 */
export function cssColorParts(color: CssColor): CssColorParts {
    if (color === TRANSPARENT) return { form: "transparent" };
    const hex = HEX_COLOR.exec(color);
    if (hex) return { form: "hex", channels: hex.slice(1, 4).map(channel => parseInt(channel, 16)) };
    const rgba = RGBA_COLOR.exec(color);
    if (rgba) return { form: "rgba", channels: rgba.slice(1, 4).map(Number), alpha: rgba[4] ?? "" };
    throw new Error(`color ${JSON.stringify(color)} is not a CssColor: colorToCSS makes only #RRGGBB, rgba(r, g, b, a) and transparent, so build model colors with it`);
}
