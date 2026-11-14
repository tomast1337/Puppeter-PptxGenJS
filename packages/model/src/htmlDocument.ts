import type { HtmlPresentationDocument } from "./renderer";
import type { PageSize } from "./types";

/** The pdfdeck HTML profile version (docs/HTML_PROFILE.md) a document follows, in `<meta name="pdfdeck-profile">`. */
export const HTML_PROFILE_VERSION = 1;
/** `PageSize.name` of a document whose `<meta name="pdfdeck-page-size">` names none. */
export const CUSTOM_PAGE_SIZE_NAME = "Custom";

const PROFILE_META = `<meta name="pdfdeck-profile" content="${HTML_PROFILE_VERSION}">`;
// shortcut: a regex scan, not a parser: it also matches tags inside comments, <script> or CDATA and does not decode
// entities in attribute values. Enough to pick the version and page size; the renderers validate the whole document.
const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const PAGE_RULE = /@page\s*\{[^}]*?\bsize:\s*([^\s;}]+)in\s+([^\s;}]+)in\s*[;}]/;

/** The `content` of the first `<meta name="<name>">`. */
function metaContent(html: string, name: string): string | undefined {
    for (const [tag] of html.matchAll(META_TAG)) {
        const attributes = new Map([...tag.matchAll(ATTRIBUTE)].map(([, key = "", ...values]) => [key.toLowerCase(), values.find(value => value !== undefined) ?? ""]));
        if (attributes.get("name") === name) return attributes.get("content");
    }
    return undefined;
}

/**
 * The renderer input for a complete profile v1 document: checks the version and reads the page size from the
 * `@page` rule, with the name `<meta name="pdfdeck-page-size">` gives. Fills nothing: a producer completes its own
 * defaults first (PptxGenJS: `pptxHtmlDocument`). Throws when `html` is empty, has no
 * `<meta name="pdfdeck-profile" content="1">`, is of another version or has no `@page { size: <w>in <h>in }`.
 */
export function htmlDocument(html: string): HtmlPresentationDocument {
    if (typeof html !== "string" || !html.trim()) throw new Error(`invalid pdfdeck HTML: expected a non-empty HTML string, got ${typeof html === "string" ? "an empty string" : typeof html}`);
    const version = metaContent(html, "pdfdeck-profile");
    if (version === undefined) throw new Error(`invalid pdfdeck HTML: not a pdfdeck profile document: add ${PROFILE_META} to <head>. Puppeteer prints any HTML through renderer.render({ html, pageSize }).`);
    if (version !== String(HTML_PROFILE_VERSION)) throw new Error(`invalid pdfdeck HTML: pdfdeck profile version '${version}' is not supported (this library reads version ${HTML_PROFILE_VERSION})`);
    return { html, pageSize: pageSizeOf(html) };
}

function pageSizeOf(html: string): PageSize {
    const match = PAGE_RULE.exec(html);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
        throw new Error("invalid pdfdeck HTML: the stylesheet's @page rule has no 'size: <width>in <height>in'; write the page size in inches, as <style>@page { size: 10in 5.625in; margin: 0 }</style> in <head>");
    }
    return { width, height, name: metaContent(html, "pdfdeck-page-size") ?? CUSTOM_PAGE_SIZE_NAME };
}
