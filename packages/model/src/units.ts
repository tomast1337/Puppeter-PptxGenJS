// The units the model is expressed in: page sizes in inches, geometry and text sizes in CSS pixels, chart sizes in points.
// Named here so every producer and renderer converts with the same numbers.
export const CSS_PX_PER_INCH = 96;
export const POINTS_PER_INCH = 72;
export const MILLIMETERS_PER_INCH = 25.4;
/** Blink's LayoutUnit, 1/64 CSS px: the grid the HTML profile's line breaker measures widths on (docs/HTML_PROFILE.md). */
export const LAYOUT_UNITS_PER_PX = 64;

// Type-only brands: a `Px` is still a number at runtime and in JSON, but a `Pt` or plain number cannot stand in for it.
declare const unit: unique symbol;
/** CSS pixels, 96 per inch. */
export type Px = number & { readonly [unit]: "px" };
/** Points, 72 per inch. */
export type Pt = number & { readonly [unit]: "pt" };
/** Inches. */
export type Inches = number & { readonly [unit]: "in" };

// The only casts: every branded value is made by one of these.
export const px = (value: number): Px => value as Px;
export const pt = (value: number): Pt => value as Pt;
export const inches = (value: number): Inches => value as Inches;

// The conversions take plain numbers and return brands, so callers holding unbranded model fields compile unchanged.
// shortcut: parameters stay `number` until the model fields are branded (#277 sections 2-4), then they take brands.

/** Converts inches to CSS pixels. */
export function inchesToPixels(value: number): Px {
    return px(value * CSS_PX_PER_INCH);
}

/** Converts CSS pixels to inches. */
export function pixelsToInches(pixels: number): Inches {
    return inches(pixels / CSS_PX_PER_INCH);
}

/** Converts inches to points. */
export function inchesToPoints(value: number): Pt {
    return pt(value * POINTS_PER_INCH);
}

/** Converts points to inches. */
export function pointsToInches(points: number): Inches {
    return inches(points / POINTS_PER_INCH);
}

/** Converts points to CSS pixels. */
export function pointsToPixels(points: number): Px {
    return px(points * (CSS_PX_PER_INCH / POINTS_PER_INCH));
}

/** Converts CSS pixels to points. */
export function pixelsToPoints(pixels: number): Pt {
    return pt(pixels * (POINTS_PER_INCH / CSS_PX_PER_INCH));
}

/** Converts millimetres to CSS pixels. */
export function millimetersToPixels(millimeters: number): Px {
    return inchesToPixels(millimeters / MILLIMETERS_PER_INCH);
}

/** Converts a percentage to pixels of a container `containerSize` pixels long. */
export function percentageToPixels(percentage: number, containerSize: number): Px {
    return px((percentage / 100) * containerSize);
}

/** Writes a pixel length as a CSS value (`12px`). */
export function cssPx(value: Px): string {
    return `${value}px`;
}

/** Converts degrees to radians. */
export function degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}
