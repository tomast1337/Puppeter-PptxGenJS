import type { Attribute } from "./markup";

/**
 * An element's inline CSS, kept as our own strings and never written through the CSSOM: jsdom and Chromium
 * serialize CSSOM writes differently (Chromium rounds lengths to 6 significant digits, collapses `padding`,
 * drops font-family quotes; jsdom turns hex colors into `rgb()`), so the same model gave different bytes
 * per runtime (#69 finding 4). Declarations keep their first-write order; writing a property again
 * replaces its value in place, as the CSSOM does.
 */
export type InlineStyle = Map<string, string>;

// A double-quoted string on one line, its quotes and backslashes escaped: how fontFamilyCSS quotes a face.
const CSS_STRING = /"(?:[^"\\\n]|\\.)*"/g;
// Outside a string: what could end the declaration or the block, escape a character or open another string.
const CSS_DELIMITER = /[;{}\\"']/;
const CSS_FUNCTION = /([\w-]*)\(/g;
// The functions the render code writes; url(), image-set() and the like would make Chromium fetch while printing.
const CSS_FUNCTIONS: ReadonlySet<string> = new Set(["rotate", "scaleX", "scaleY", "rgba", "drop-shadow"]);

/** The `style` attribute, verbatim; an element without declarations gets none. */
export function styleAttribute(style: InlineStyle): Attribute {
    return ["style", style.size ? Array.from(style, ([property, value]) => `${property}: ${checkedValue(property, value)};`).join(" ") : undefined];
}

/**
 * A value as it is, or an error if it could add a declaration or load a URL. Normalization checks every option that
 * reaches a value (GHSA-c8m6-398f-qcxr was an unchecked `align`), so this throwing is a PdfLapas bug, not bad input.
 */
function checkedValue(property: string, value: string): string {
    const bare = value.replace(CSS_STRING, "");
    const calls = Array.from(bare.matchAll(CSS_FUNCTION), ([, name]) => name ?? "");
    if (!CSS_DELIMITER.test(bare) && calls.every(name => CSS_FUNCTIONS.has(name))) return value;
    throw new Error(`Refusing inline CSS ${property}: ${JSON.stringify(value)}: outside a quoted string a value holds no ; { } \\ or quote and calls only ${[...CSS_FUNCTIONS].join(", ")}. This is a PdfLapas bug: the option behind it should have been refused when it was normalized; please report it.`);
}
