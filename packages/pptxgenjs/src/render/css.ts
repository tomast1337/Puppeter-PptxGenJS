import type { Attribute } from "./markup";

/**
 * An element's inline CSS, kept as our own strings and never written through the CSSOM: jsdom and Chromium
 * serialize CSSOM writes differently (Chromium rounds lengths to 6 significant digits, collapses `padding`,
 * drops font-family quotes; jsdom turns hex colors into `rgb()`), so the same model gave different bytes
 * per runtime (#69 finding 4). Declarations keep their first-write order; writing a property again
 * replaces its value in place, as the CSSOM does.
 */
export type InlineStyle = Map<string, string>;

/** The `style` attribute, verbatim; an element without declarations gets none. */
export function styleAttribute(style: InlineStyle): Attribute {
    return ["style", style.size ? Array.from(style, ([property, value]) => `${property}: ${value};`).join(" ") : undefined];
}
