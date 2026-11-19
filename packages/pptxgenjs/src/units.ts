import { CSS_PX_PER_INCH, POINTS_PER_INCH } from "@pdflapas/model";
import { PPTX_DEFAULTS } from "#src/defaults";

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

/** Converts EMU (914400 per inch) to CSS pixels. */
export function emuToPixels(emu: number): number {
    return inchesToPixels(emu / PPTX_DEFAULTS.units.emuPerInch);
}

/**
 * How PptxGenJS 4.0.1 getSmartParseNumber reads a length: a numeric string as its number, a number below 100 as inches
 * and any other number as EMU, a string holding "%" as that share of the slide, and anything else (`"2in"`, NaN) as 0.
 */
function smartParse(value: unknown): { unit: "in" | "emu" | "%"; amount: number } {
    const parsed = typeof value === "string" && !Number.isNaN(Number(value)) ? Number(value) : value;
    if (typeof parsed === "number" && !Number.isNaN(parsed)) return { unit: parsed < PPTX_DEFAULTS.units.inchesBelow ? "in" : "emu", amount: parsed };
    if (typeof parsed === "string" && parsed.includes("%")) return { unit: "%", amount: parseFloat(parsed) };
    return { unit: "in", amount: 0 };
}

/** getSmartParseNumber, in EMU, rounded as it rounds inches and percentages; `containerEmu` is the slide's width or height. */
export function smartParseEmu(value: unknown, containerEmu: number): number {
    const { unit, amount } = smartParse(value);
    return unit === "emu" ? amount : Math.round(unit === "in" ? amount * PPTX_DEFAULTS.units.emuPerInch : (amount / 100) * containerEmu);
}

/**
 * Converts a PptxGenJS position or size (`x`, `y`, `w`, `h` and the like) to CSS pixels as getSmartParseNumber reads it:
 * a number below 100 is inches, any other number EMU, `"50%"` that share of `containerSize` (pixels).
 */
export function convertToPixels(value: number | `${number}%` | undefined, containerSize: number): number {
    const { unit, amount } = smartParse(value);
    return unit === "in" ? inchesToPixels(amount) : unit === "emu" ? emuToPixels(amount) : percentageToPixels(amount, containerSize);
}

/** convertToPixels, in inches; `containerSize` is in inches. */
export function convertToInches(value: number | `${number}%` | undefined, containerSize: number): number {
    const { unit, amount } = smartParse(value);
    return unit === "in" ? amount : unit === "emu" ? amount / PPTX_DEFAULTS.units.emuPerInch : (amount / 100) * containerSize;
}

/**
 * Converts a length to CSS pixels as PptxGenJS 4.0.1 inch2Emu reads it: a number above 100 is EMU, 100 itself and below
 * inches; a string is inches once every "i" and "n" is taken out ("2in" is 2), so it never reads as EMU.
 */
export function inch2EmuToPixels(value: number | string): number {
    if (typeof value === "number" && value > PPTX_DEFAULTS.units.inchesBelow) return emuToPixels(value);
    return inchesToPixels(typeof value === "string" ? Number(value.replace(/in*/gi, "")) : value);
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
