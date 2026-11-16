import { type HtmlScan, scanHtml } from "./htmlScan";
import type { HtmlPresentationDocument } from "./renderer";
import type { PageSize } from "./types";

/** The PdfLapas HTML profile version (docs/HTML_PROFILE.md) a document follows, in `<meta name="pdflapas-profile">`. */
export const HTML_PROFILE_VERSION = 2;
/** The profile versions readers accept: version 1 documents keep rendering as before (docs/HTML_PROFILE.md). */
export const READABLE_HTML_PROFILE_VERSIONS: readonly string[] = Object.freeze(["1", String(HTML_PROFILE_VERSION)]);
/** `PageSize.name` of a document whose `<meta name="pdflapas-page-size">` names none. */
export const CUSTOM_PAGE_SIZE_NAME = "Custom";

/** The prefix of the profile's `<meta>` names (`pdflapas-profile`, `pdflapas-page-size`, ...). */
const META_PREFIX = "pdflapas-";
/** Version 1 is frozen with the project's former name: its documents keep their `pdfdeck-` meta names. */
const META_PREFIX_V1 = "pdfdeck-";
const PROFILE_META = `<meta name="${META_PREFIX}profile" content="${HTML_PROFILE_VERSION}">`;
const READABLE_PROFILE_METAS = `<meta name="${META_PREFIX_V1}profile" content="1"> and ${PROFILE_META}`;
const PAGE_RULE = /@page\s*\{[^}]*?\bsize:\s*([^\s;}]+)in\s+([^\s;}]+)in\s*[;}]/;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/** The `content` of the first `<meta name="<name>">`. */
function metaContent(scan: HtmlScan, name: string): string | undefined {
    return scan.metas.find(attributes => attributes.get("name") === name)?.get("content");
}

/**
 * The renderer input for a complete profile document (version 1 or 2): checks the version and reads the page size from the
 * `@page` rule, with the name `<meta name="pdflapas-page-size">` (`pdfdeck-page-size` in version 1) gives. Fills nothing: a producer completes its own
 * defaults first (PptxGenJS: `pptxHtmlDocument`). Throws when `html` is empty, has no
 * `<meta name="pdflapas-profile" content="2">`, is of another version or has no `@page { size: <w>in <h>in }`.
 */
export function htmlDocument(html: string): HtmlPresentationDocument {
    if (typeof html !== "string" || !html.trim()) throw new Error(`invalid PdfLapas HTML: expected a non-empty HTML string, got ${typeof html === "string" ? "an empty string" : typeof html}`);
    const scan = scanHtml(html);
    const prefix = profileMetaPrefix(name => metaContent(scan, name));
    return { html, pageSize: pageSizeOf(scan, prefix) };
}

/**
 * The prefix of a profile document's `<meta>` names: `pdflapas-` in version 2, `pdfdeck-` in version 1. `metaContent`
 * reads the `content` of the document's `<meta name="<name>">`. Throws when the document declares no profile version, or
 * one no reader here accepts (version 2 under the `pdfdeck-` name too).
 */
export function profileMetaPrefix(metaContent: (name: string) => string | undefined): string {
    const version = metaContent(`${META_PREFIX}profile`);
    const versionV1 = metaContent(`${META_PREFIX_V1}profile`);
    if (version === String(HTML_PROFILE_VERSION)) return META_PREFIX;
    if (version === undefined && versionV1 === "1") return META_PREFIX_V1;
    if (version === undefined && versionV1 === undefined) {
        throw new Error(`invalid PdfLapas HTML: not a PdfLapas profile document: add ${PROFILE_META} to <head>. Puppeteer prints any HTML through renderer.render({ html, pageSize }).`);
    }
    const [name, content] = version === undefined ? [`${META_PREFIX_V1}profile`, versionV1] : [`${META_PREFIX}profile`, version];
    throw new Error(`invalid PdfLapas HTML: profile version '${content}' in <meta name="${name}"> is not supported (this library reads ${READABLE_PROFILE_METAS})`);
}

/** The size of the first `@page` rule in the document's `<style>` elements, outside CSS comments. */
function pageSizeOf(scan: HtmlScan, prefix: string): PageSize {
    let match: RegExpExecArray | null = null;
    for (const css of scan.styles) {
        match = PAGE_RULE.exec(css.replace(CSS_COMMENT, ""));
        if (match) break;
    }
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
        throw new Error("invalid PdfLapas HTML: the stylesheet's @page rule has no 'size: <width>in <height>in'; write the page size in inches, as <style>@page { size: 10in 5.625in; margin: 0 }</style> in <head>");
    }
    return { width, height, name: metaContent(scan, `${prefix}page-size`) ?? CUSTOM_PAGE_SIZE_NAME };
}
