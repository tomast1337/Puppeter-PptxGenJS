/**
 * What the profile reader needs from a document: the attributes of each `<meta>` and the text of each `<style>`, in
 * document order. A tokenizer-level scan after the HTML standard (13.2.5): it skips comments, `<!...>` and `<?...>`
 * bogus comments, CDATA sections in `<svg>` and `<math>`, and the text of raw-text elements (`<script>`, `<style>`,
 * `<textarea>`, ...), so markup inside those is not read as a tag. It builds no tree; the renderers validate the document.
 */
export interface HtmlScan {
    readonly metas: ReadonlyArray<ReadonlyMap<string, string>>;
    readonly styles: readonly string[];
}

/** Elements whose content is text up to their end tag (raw text and escapable raw text, with scripting enabled). */
const RAW_TEXT_ELEMENTS: readonly string[] = Object.freeze(["iframe", "noembed", "noframes", "noscript", "script", "style", "textarea", "title", "xmp"]);
/** Foreign content, where `<![CDATA[` opens a CDATA section and `<style>` and `<script>` hold markup. */
const FOREIGN_ELEMENTS: ReadonlySet<string> = new Set(["math", "svg"]);
// The sticky (y) and global (g) patterns below are shared: every use sets `lastIndex` first.
/** The end tag that closes each raw-text element. */
const RAW_TEXT_END: ReadonlyMap<string, RegExp> = new Map(RAW_TEXT_ELEMENTS.map(name => [name, new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, "gi")]));
const COMMENT_END = /--!?>/g;
const TAG_NAME = /[a-z][^\t\n\f\r />]*/iy;
/**
 * One attribute, or the tag's `>` (group 1), after the whitespace and `/` before it. A name may start with `=`; a quoted
 * value runs to its closing quote (or the end), an unquoted one to whitespace or `>`. No match: the input ended.
 */
const ATTRIBUTE = /[\t\n\f\r /]*(?:(>)|([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"?|'([^']*)'?|([^\t\n\f\r >]*)))?)/y;
// shortcut: decodes numeric character references and the five XML named ones, which is what profile writers emit in
// attribute values; other named references stay as written. Use a full entity table when a producer needs one.
const CHARACTER_REFERENCE = /&(?:#(\d+);?|#x([\da-f]+);?|(amp|lt|gt|quot|apos);)/gi;
const NAMED_REFERENCES: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });
const MAX_CODE_POINT = 0x10ffff;
const SURROGATES = { first: 0xd800, last: 0xdfff } as const;
const REPLACEMENT_CHARACTER = "�";
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

/** The index after the next `text` from `start`, or the end of `html`. */
function after(html: string, text: string, start: number): number {
    const index = html.indexOf(text, start);

    return index < 0 ? html.length : index + text.length;
}

/** Where `pattern` next matches from `start`, or none up to the end of `html`. */
function nextMatch(html: string, pattern: RegExp, start: number): { kind: "match"; match: RegExpExecArray } | { kind: "none" } {
    pattern.lastIndex = start;
    const match = pattern.exec(html);

    return match ? { kind: "match", match } : { kind: "none" };
}

export function scanHtml(html: string): HtmlScan {
    const metas: Array<ReadonlyMap<string, string>> = [];
    const styles: string[] = [];
    let foreignDepth = 0;
    let at = 0;

    while (at < html.length) {
        const open = html.indexOf("<", at);

        if (open < 0) {
            break;
        }

        if (html.startsWith("<!--", open)) {
            // A comment ends at "-->" or "--!>"; searching from its "--" also ends "<!-->" and "<!--->".
            const end = nextMatch(html, COMMENT_END, open + 2);

            at = end.kind === "match" ? COMMENT_END.lastIndex : html.length;
            continue;
        }

        if (foreignDepth > 0 && html.startsWith(CDATA_OPEN, open)) {
            at = after(html, CDATA_CLOSE, open + CDATA_OPEN.length);
            continue;
        }

        if (html.startsWith("<!", open) || html.startsWith("<?", open)) {
            at = after(html, ">", open + 2);
            continue;
        }

        const closing = html.charAt(open + 1) === "/";
        const tagName = nextMatch(html, TAG_NAME, open + (closing ? 2 : 1));

        if (tagName.kind === "none") {
            at = open + 1;
            continue;
        }

        const name = tagName.match[0].toLowerCase();
        const attributes = name === "meta" && !closing ? new Map<string, string>() : undefined;
        // Read the tag's attributes from just after its name to its `>`, into `attributes` for a `<meta>` (the first of
        // repeated names wins, as in HTML), and whether the tag ends with `/>`. An unclosed tag runs to the end of `html`.
        let end = html.length;
        let selfClosing = false;

        ATTRIBUTE.lastIndex = TAG_NAME.lastIndex;
        for (let match = ATTRIBUTE.exec(html); match; match = ATTRIBUTE.exec(html)) {
            if (match[1]) {
                end = ATTRIBUTE.lastIndex;
                selfClosing = match[0].endsWith("/>");
                break;
            }

            const attributeName = match[2]?.toLowerCase();

            if (attributes && attributeName !== undefined && !attributes.has(attributeName)) {
                const value = match[3] ?? match[4] ?? match[5] ?? "";
                // Decode the value's character references.
                const decoded = !value.includes("&")
                    ? value
                    : value.replace(CHARACTER_REFERENCE, (_, decimal: string | undefined, hex: string | undefined, referenceName: string | undefined) => {
                          if (referenceName) {
                              return NAMED_REFERENCES[referenceName.toLowerCase()] ?? `&${referenceName};`;
                          }

                          const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
                          const surrogate = codePoint >= SURROGATES.first && codePoint <= SURROGATES.last;

                          return codePoint > 0 && codePoint <= MAX_CODE_POINT && !surrogate ? String.fromCodePoint(codePoint) : REPLACEMENT_CHARACTER;
                      });

                attributes.set(attributeName, decoded);
            }
        }

        at = end;
        if (attributes) {
            metas.push(attributes);
        }

        if (FOREIGN_ELEMENTS.has(name) && !selfClosing) {
            foreignDepth = Math.max(0, foreignDepth + (closing ? -1 : 1));
        }

        const rawTextEnd = closing || foreignDepth > 0 ? undefined : RAW_TEXT_END.get(name);

        if (!rawTextEnd) {
            continue;
        }

        const textEndMatch = nextMatch(html, rawTextEnd, at);
        const textEnd = textEndMatch.kind === "match" ? textEndMatch.match.index : html.length;

        if (name === "style") {
            styles.push(html.slice(at, textEnd));
        }

        at = textEnd;
    }

    return { metas, styles };
}
