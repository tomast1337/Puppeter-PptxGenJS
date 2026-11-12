/**
 * Converts PptxGenJS color format to CSS color
 */
export interface ColorProps {
    color?: string;
    transparency?: number;
}

/**
 * Converts a PptxGenJS color string or fill/line object to a CSS color.
 */
export function colorToCSS(value?: string | ColorProps): string {
    if (!value) return "transparent";

    const color = typeof value === "string" ? value : value.color;
    if (!color) return "transparent";

    const normalized = color.startsWith("#") || color.startsWith("rgb") ? color : /^[\da-f]{6}([\da-f]{2})?$/i.test(color) ? `#${color}` : color;

    const transparency = typeof value === "object" ? value.transparency : undefined;
    if (transparency === undefined || transparency <= 0) return normalized;

    const alpha = Math.max(0, Math.min(1, 1 - transparency / 100));
    const hex = normalized.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    if (!hex) return normalized;

    const [red, green, blue] = hex.slice(1, 4).map(channel => parseInt(channel, 16));
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
