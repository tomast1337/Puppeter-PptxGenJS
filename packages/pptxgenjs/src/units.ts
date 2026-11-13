import { CSS_PX_PER_INCH, POINTS_PER_INCH } from "@pdfdeck/model";

/**
 * Converts inches to CSS pixels
 */
export function inchesToPixels(inches: number): number {
    return inches * CSS_PX_PER_INCH;
}

/**
 * Converts CSS pixels to inches
 */
export function pixelsToInches(pixels: number): number {
    return pixels / CSS_PX_PER_INCH;
}

/**
 * Converts inches to points
 */
export function inchesToPoints(inches: number): number {
    return inches * POINTS_PER_INCH;
}

/**
 * Converts points to inches
 */
export function pointsToInches(points: number): number {
    return points / POINTS_PER_INCH;
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
        return inchesToPixels(parseFloat(value)); // assume inches if no unit
    }

    // Numbers are assumed to be in inches (PptxGenJS convention)
    return inchesToPixels(value);
}

/**
 * Converts point size to pixels
 */
export function pointsToPixels(points: number): number {
    return points * (CSS_PX_PER_INCH / POINTS_PER_INCH);
}

/**
 * Converts millimetres to CSS pixels
 */
export function millimetersToPixels(millimeters: number): number {
    return inchesToPixels(millimeters / 25.4);
}
