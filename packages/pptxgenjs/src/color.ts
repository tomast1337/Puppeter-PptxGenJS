/**
 * Converts PptxGenJS color format to CSS color
 */
export interface ColorProps {
    color?: string;
    transparency?: number;
}

// PptxGenJS 4.0.1 (createColorElement) strips one leading "#" and accepts only 6-digit hex RGB.
export const HEX_COLOR = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

/**
 * Converts a PptxGenJS color string or fill/line object to a CSS color.
 * Throws on anything but 6-digit hex: the result goes into inline CSS and SVG, so a free-form string could add
 * declarations (`red; background: url(...)`). PptxGenJS warns and writes black instead; we fail loudly.
 */
export function colorToCSS(value?: string | ColorProps): string {
    if (!value) return "transparent";

    const color = typeof value === "string" ? value : value.color;
    if (!color) return "transparent";

    const hex = HEX_COLOR.exec(color);
    if (!hex) throw new Error(`color ${JSON.stringify(color)} is not a valid color: use a 6-digit hex RGB value such as "FF0000" or a scheme color (tx1, tx2, bg1, bg2, accent1 to accent6)`);
    const [, red = "", green = "", blue = ""] = hex;

    const transparency = typeof value === "object" ? value.transparency : undefined;
    if (transparency === undefined || transparency <= 0) return `#${red}${green}${blue}`;

    const alpha = Math.max(0, Math.min(1, 1 - transparency / 100));
    return `rgba(${parseInt(red, 16)}, ${parseInt(green, 16)}, ${parseInt(blue, 16)}, ${alpha})`;
}
