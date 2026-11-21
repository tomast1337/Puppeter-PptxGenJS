/**
 * The schemes a link in the PDF may open, in every renderer. PptxGenJS writes any `url` into the slide relationships;
 * a PDF link that runs `javascript:` or opens `file:` is a hazard in a shared document, so other schemes are refused.
 * crates/pdf-core/src/link.rs applies the same rule.
 */
export const LINK_URL_SCHEME = /^(?:https?|mailto):/i;

/** Throws unless `href` is an http, https or mailto URL; `where` names the object holding the link. */
export function assertLinkUrl(href: string, where: string): void {
    if (!LINK_URL_SCHEME.test(href)) {
        throw new Error(`Cannot link ${where} to '${href}': a link must be an http:, https: or mailto: URL, or a slide link (PdfLapas HTML profile)`);
    }
}
