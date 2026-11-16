import { type FourSideMargin, PPTX_DEFAULTS } from "../defaults";
import { inchesToPixels, pointsToInches, pointsToPixels } from "../units";

type Sides<T> = readonly [T, T, T, T];

/** Converts each of four sides, keeping the four-side tuple type that `Array.map` loses. */
export function mapSides<T>([first, second, third, fourth]: Sides<T>, convert: (value: T) => number): FourSideMargin {
    return [convert(first), convert(second), convert(third), convert(fourth)];
}

/**
 * PptxGenJS 4.0.1 table cell margins (genXmlTextBody, `<a:tcPr marL marR marT marB>`): a number is all four sides,
 * an array is [top, right, bottom, left], and the whole array is points when its top is 1 or more, otherwise inches
 * (`cellMargin[0] >= 1`). Unset is DEF_CELL_MARGIN_IN. Returned as [top, right, bottom, left] with the matching
 * converter applied.
 */
function tableMargin(margin: number | Sides<number> | undefined, fromPoints: (points: number) => number, fromInches: (inches: number) => number): FourSideMargin {
    const sides = margin === undefined ? PPTX_DEFAULTS.table.marginIn : typeof margin === "number" ? ([margin, margin, margin, margin] as const) : margin;
    return mapSides(sides, sides[0] >= 1 ? fromPoints : fromInches);
}

/** Table cell margin in inches, [top, right, bottom, left]. */
export function tableMarginInches(margin?: number | Sides<number>): FourSideMargin {
    return tableMargin(margin, pointsToInches, inches => inches);
}

/** Table cell margin in CSS pixels, [top, right, bottom, left]. */
export function tableMarginPixels(margin?: number | Sides<number>): FourSideMargin {
    return tableMargin(margin, pointsToPixels, inchesToPixels);
}

/**
 * PptxGenJS 4.0.1 text margins (genXmlBodyProperties via `_bodyProp`) are points. An array is written as
 * lIns, rIns, bIns, tIns from indexes 0..3, so it is read as [left, right, bottom, top], despite the type
 * documentation saying [top, right, bottom, left]; this mirrors the emitted OOXML. With no `margin`, the deprecated
 * `inset` (inches, PptxGenJS 3.10) sets all four sides, else the Normal inset. Returned in CSS pixels as
 * [top, right, bottom, left].
 */
export function textMarginPixels(margin?: number | Sides<number>, inset?: number): FourSideMargin {
    if (margin === undefined) {
        if (typeof inset === "number" && !Number.isNaN(inset)) return mapSides([inset, inset, inset, inset], inchesToPixels);
        return mapSides(PPTX_DEFAULTS.text.marginIn, inchesToPixels);
    }
    if (typeof margin === "number") return mapSides([margin, margin, margin, margin], pointsToPixels);
    const [left, right, bottom, top] = margin;
    return mapSides([top, right, bottom, left], pointsToPixels);
}

function padding([top, right, bottom, left]: FourSideMargin): string {
    const px = (value: number) => `${Number(value.toFixed(6))}px`;
    return `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
}

/** A text margin as a CSS `padding` value (see textMarginPixels). */
export function textMarginToCSS(margin?: number | FourSideMargin): string {
    return padding(textMarginPixels(margin));
}

/** A table cell margin as a CSS `padding` value (see tableMarginPixels). */
export function tableMarginToCSS(margin?: number | FourSideMargin): string {
    return padding(tableMarginPixels(margin));
}
