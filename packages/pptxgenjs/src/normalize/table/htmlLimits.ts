// Limits on the HTML markup tableToSlides() parses, checked before the parse. Parsing is synchronous and its time
// grows with the markup's size and, faster than linearly, with its element nesting depth, so markup built from user
// data could otherwise block the event loop for seconds.

/** Limits on the HTML markup form of `tableToSlides()` (`htmlLimits` in its options). */
export interface TableHtmlLimits {
    /** The longest markup accepted, in UTF-16 code units. Default TABLE_HTML_LIMITS.maxLength. */
    readonly maxLength?: number;
    /** The deepest element nesting accepted. Default TABLE_HTML_LIMITS.maxDepth. */
    readonly maxDepth?: number;
}

export const TABLE_HTML_LIMITS = Object.freeze({
    /** 1 MiB of markup: tens of thousands of cells, which take tens of seconds to read. */
    maxLength: 1024 * 1024,
    /** Chromium's HTML parser stops nesting at this depth (kMaximumHTMLParserDOMTreeDepth). */
    maxDepth: 512,
});

// A comment, or a start or end tag and its name. A tag stops at the next "<", so markup without ">" stays linear.
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][^\s/<>]*)[^<>]*>/g;
const VOID_ELEMENTS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Elements whose content is text up to their end tag: a "<div>" inside them is not an element.
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
// Start tags that close an open element of `closes` (an omitted end tag) unless an element of `scope` is nearer.
const IMPLIED_END: Readonly<Record<string, { readonly closes: ReadonlySet<string>; readonly scope: ReadonlySet<string> }>> = (() => {
    const rule = (closes: string[], scope: string[]) => ({ closes: new Set(closes), scope: new Set(scope) });
    const cell = rule(["td", "th"], ["tr", "table"]);
    const section = rule(["tbody", "thead", "tfoot"], ["table"]);
    const definition = rule(["dt", "dd"], ["dl"]);

    return { td: cell, th: cell, tr: rule(["tr"], ["table", "tbody", "thead", "tfoot"]), tbody: section, thead: section, tfoot: section, li: rule(["li"], ["ul", "ol"]), dt: definition, dd: definition, option: rule(["option"], ["select", "optgroup"]), p: rule(["p"], ["td", "th", "li", "table"]) };
})();

function checkLimit(name: keyof TableHtmlLimits, value: unknown): number {
    if (value === undefined) {
        return TABLE_HTML_LIMITS[name];
    }

    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return value;
    }

    throw new TypeError(`tableToSlides option \`htmlLimits.${name}\` must be a positive integer, got ${JSON.stringify(value)}`);
}

/**
 * Throws when `markup` is longer than `limits.maxLength` or nests elements deeper than `limits.maxDepth`, in one
 * linear pass over its tags. The depth follows the parser's main rules (void elements, end tags closing the elements
 * opened inside them, the omitted end tags of cells, rows, list items and paragraphs), so it is the parsed depth or a
 * little more.
 */
export function checkTableHtmlLimits(markup: string, limits: TableHtmlLimits = {}): void {
    const maxLength = checkLimit("maxLength", limits.maxLength);
    const maxDepth = checkLimit("maxDepth", limits.maxDepth);

    if (markup.length > maxLength) {
        throw new Error(`tableToSlides: the HTML string is ${markup.length} characters long, over the limit of ${maxLength}; pass a smaller table, or raise the limit with the option htmlLimits: { maxLength }`);
    }

    const lower = markup.toLowerCase();
    const open: string[] = [];

    TAG.lastIndex = 0;
    for (let match = TAG.exec(markup); match; match = TAG.exec(markup)) {
        const [, end, rawName] = match;

        if (rawName === undefined) {
            continue;
        } // a comment

        const name = rawName.toLowerCase();

        if (end) {
            const index = open.lastIndexOf(name);

            if (index >= 0) {
                open.length = index;
            }

            continue;
        }

        if (VOID_ELEMENTS.has(name)) {
            continue;
        }

        if (RAW_TEXT_ELEMENTS.has(name)) {
            const close = lower.indexOf(`</${name}`, TAG.lastIndex);

            TAG.lastIndex = close < 0 ? markup.length : close;
        }

        const implied = IMPLIED_END[name];

        if (implied) {
            for (let index = open.length - 1; index >= 0; index--) {
                const element = open[index] ?? "";

                if (implied.scope.has(element)) {
                    break;
                }

                if (implied.closes.has(element)) {
                    open.length = index;
                    break;
                }
            }
        }

        open.push(name);
        if (open.length > maxDepth) {
            throw new Error(`tableToSlides: the HTML string nests elements more than ${maxDepth} deep; flatten the markup, or raise the limit with the option htmlLimits: { maxDepth }`);
        }
    }
}
