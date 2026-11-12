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
 * Converts point size to pixels
 */
export function pointsToPixels(points: number): number {
    return points * (96 / 72); // 72 points = 1 inch
}
