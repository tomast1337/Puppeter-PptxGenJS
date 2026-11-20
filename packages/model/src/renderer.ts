import type { PageSizeInput } from "./types";

/**
 * The /Creator and /Producer every renderer writes to the PDF Info dictionary unless the document sets its own
 * (`PresentationMetadata.creator`, `producer`), as PowerPoint's Save as PDF names
 * itself in both. No version: a release would change every PDF's bytes (tests/visual/wasm/pdf-sha256.json), and the
 * crates have no version of their own. `crates/pdf-core/src/document_info.rs` keeps the same string as `PRODUCER`.
 */
export const PDF_PRODUCER = "PdfLapas";

export interface HtmlPresentationDocument {
    html: string;
    // Plain inches: a renderer also renders a document its caller built (#277).
    pageSize: PageSizeInput;
}

/** Turns the HTML document (`toHtml()`, `modelToHtml()`) into PDF bytes: every renderer reads only the HTML (#69). */
export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}

/**
 * Throws unless `document` carries the HTML string a renderer reads: `render(pptx.toHtml())` without `await` passes
 * the Promise, which would otherwise fail deep in the renderer (the WASM glue's "undefined is not an object").
 */
export function assertHtmlPresentationDocument(document: unknown): asserts document is HtmlPresentationDocument {
    if (typeof document === "object" && document !== null && "html" in document && typeof document.html === "string") return;
    const got = document instanceof Promise ? "a Promise: await toHtml() before passing its result" : `${document === null ? "null" : typeof document} without an html string`;
    throw new TypeError(`render() takes the { html, pageSize } document toHtml() resolves to, got ${got}`);
}
