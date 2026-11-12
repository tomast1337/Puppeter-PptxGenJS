import type { PageSize } from "./pageLayouts";

/**
 * Converts inches to pixels (96 DPI standard)
 */
export function inchesToPixels(inches: number): number {
    return inches * 96;
}

/**
 * Converts percentage to pixels based on container size
 */
export function percentageToPixels(percentage: number, containerSize: number): number {
    return (percentage / 100) * containerSize;
}

/**
 * Converts a value that can be in inches or percentage to pixels
 * @param value - The value to convert (e.g., 1 for 1 inch, or with "%" suffix)
 * @param containerSize - The container size in pixels (for percentage calculations)
 * @returns The value in pixels
 */
export function convertToPixels(value: number | `${number}%` | undefined, containerSize: number): number {
    if (value === undefined) return 0;

    if (typeof value === "string") {
        if (value.endsWith("%")) {
            const percentage = parseFloat(value);
            return percentageToPixels(percentage, containerSize);
        }
        return parseFloat(value) * 96; // assume inches if no unit
    }

    // Numbers are assumed to be in inches (PptxGenJS convention)
    return inchesToPixels(value);
}

/**
 * Generates CSS for a slide page with specific dimensions
 */
export function generatePageCSS(pageSize: PageSize): string {
    const widthPx = inchesToPixels(pageSize.width);
    const heightPx = inchesToPixels(pageSize.height);

    return `
@page {
    size: ${pageSize.width}in ${pageSize.height}in;
    margin: 0;
}

body {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
}

.slide-container {
    width: ${widthPx}px;
    height: ${heightPx}px;
    position: relative;
    page-break-after: always;
    background: white;
    overflow: hidden;
}

.slide-container:last-child {
    page-break-after: auto;
}

.slide-element {
    position: absolute;
    box-sizing: border-box;
}

.slide-text {
    display: flex;
    align-items: center;
    overflow: hidden;
    word-wrap: break-word;
}

.slide-shape {
    border-style: solid;
}

.slide-table {
    border-collapse: collapse;
}

.slide-table td,
.slide-table th {
    border: 1px solid #ddd;
    padding: 8px;
}

@media print {
    body {
        margin: 0;
        padding: 0;
    }
    
    .slide-container {
        page-break-after: always;
        break-after: page;
    }
    
    .slide-container:last-child {
        page-break-after: auto;
        break-after: auto;
    }
}
    `.trim();
}

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

    return `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, ${alpha})`;
}

/**
 * Converts PptxGenJS alignment to CSS text-align
 */
export function alignToCSS(align?: string): string {
    switch (align?.toLowerCase()) {
        case "left":
            return "left";
        case "center":
            return "center";
        case "right":
            return "right";
        case "justify":
            return "justify";
        default:
            return "left";
    }
}

/**
 * Converts PptxGenJS vertical alignment to CSS align-items
 */
export function valignToCSS(valign?: string): string {
    switch (valign?.toLowerCase()) {
        case "top":
            return "flex-start";
        case "middle":
        case "center":
            return "center";
        case "bottom":
            return "flex-end";
        default:
            return "flex-start";
    }
}

/**
 * Converts point size to pixels
 */
export function pointsToPixels(points: number): number {
    return points * (96 / 72); // 72 points = 1 inch
}
