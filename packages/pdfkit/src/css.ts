// Inline `style` attributes as the profile writes them (docs/HTML_PROFILE.md "Conventions"): `property: value;` pairs,
// lengths in px, colors in the model's spelling. Each reader takes the properties it draws out of the map, so what is
// left is what the renderer does not draw, and is reported instead of being ignored.
import { attribute, type Element } from "./dom";

export type Style = Map<string, string>;

/** An sRGB color with its alpha, as PDFKit takes it: 0-255 channels, alpha 0-1. */
export type Color = {
    readonly rgb: readonly [number, number, number];
    readonly alpha: number;
};

const HEX_COLOR = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const PX_LENGTH = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)px$/i;
const EM_LENGTH = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)em$/i;
const PERCENT_LENGTH = /^(-?\d*\.?\d+)%$/;
const FULL_ALPHA = 255;
const SHORT_HEX_LENGTH = 3;
const TRANSPARENT: Color = { rgb: [0, 0, 0], alpha: 0 };

export function readStyle(element: Element): Style {
    const style: Style = new Map();
    const text = attribute(element, "style") ?? "";
    // The declarations: the list split at the `;` outside quotes and parentheses (`font-family: "a;b"`, `rgba(...)`).
    const parts: string[] = [];
    let [start, depth, quote] = [0, 0, ""];

    for (let index = 0; index < text.length; index++) {
        const char = text.charAt(index);

        if (quote) {
            if (char === "\\") {
                index++;
            } else if (char === quote) {
                quote = "";
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth = Math.max(0, depth - 1);
        } else if (char === ";" && depth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }

    parts.push(text.slice(start));

    for (const declaration of parts) {
        const colon = declaration.indexOf(":");

        if (colon < 0) {
            continue;
        }

        style.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
    }

    return style;
}

/** The property's value, removed from `style` so it does not count as unread. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function take(style: Style, property: string): string | undefined {
    const value = style.get(property);

    style.delete(property);

    return value;
}

/** A `<n>px` length (or a bare `0`); undefined for anything else. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function px(value: string | undefined): number | undefined {
    if (value === "0") {
        return 0;
    }

    const match = value === undefined ? null : PX_LENGTH.exec(value);

    return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** An `<n>em` length; undefined for anything else. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function em(value: string | undefined): number | undefined {
    const match = value === undefined ? null : EM_LENGTH.exec(value);

    return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** A px length, or a percentage of `base`. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function length(value: string | undefined, base: number): number | undefined {
    const percent = value === undefined ? null : PERCENT_LENGTH.exec(value);

    return percent?.[1] === undefined ? px(value) : (Number(percent[1]) / 100) * base;
}

/** The four px lengths of a `padding: <top> <right> <bottom> <left>` value. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function sides(value: string | undefined): [number, number, number, number] | undefined {
    const parts = value?.split(/\s+/).map(px) ?? [];
    const [top, right, bottom, left] = parts;

    return parts.length === 4 && top !== undefined && right !== undefined && bottom !== undefined && left !== undefined ? [top, right, bottom, left] : undefined;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` or `transparent`: the forms the profile writes. Undefined for others. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function color(value: string | undefined): Color | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === "transparent" || value === "none") {
        return TRANSPARENT;
    }

    const hex = HEX_COLOR.exec(value)?.[1];

    if (hex !== undefined) {
        const full = hex.length === SHORT_HEX_LENGTH ? [...hex].map(digit => digit + digit).join("") : hex;
        const channel = (index: number) => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);

        return { rgb: [channel(0), channel(1), channel(2)], alpha: full.length > 6 ? channel(3) / FULL_ALPHA : 1 };
    }

    const rgb = RGB_COLOR.exec(value);

    if (!rgb) {
        return undefined;
    }

    return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

const CSS_STRING = /"((?:[^"\\]|\\.)*)"/y;
const FAMILY_SEPARATOR = ", ";

/**
 * The families of a profile `font-family`: one or more CSS strings separated by `, ` (`"Calibri", "Arial"`), without
 * their quotes and escapes. Undefined for anything else, a bare name included: those are the print step's.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function cssStrings(value: string): string[] | undefined {
    const families: string[] = [];
    let index = 0;

    while (index < value.length) {
        if (families.length) {
            if (!value.startsWith(FAMILY_SEPARATOR, index)) {
                return undefined;
            }

            index += FAMILY_SEPARATOR.length;
        }

        CSS_STRING.lastIndex = index;
        const quoted = CSS_STRING.exec(value)?.[1];

        if (quoted === undefined) {
            return undefined;
        }

        families.push(quoted.replace(/\\(.)/g, "$1"));
        index = CSS_STRING.lastIndex;
    }

    return families.length ? families : undefined;
}
