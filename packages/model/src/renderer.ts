import type { PageSize } from "./types";

/**
 * The /Creator and /Producer every renderer writes to the PDF Info dictionary unless the document sets its own
 * (`PresentationMetadata.creator`, `producer`), as PowerPoint's Save as PDF names
 * itself in both. No version: a release would change every PDF's bytes (tests/visual/wasm/pdf-sha256.json), and the
 * crates have no version of their own. `crates/pdf-core/src/document_info.rs` keeps the same string as `PRODUCER`.
 */
export const PDF_PRODUCER = "PdfLapas";

export interface HtmlPresentationDocument {
    html: string;
    pageSize: PageSize;
}

/** Turns the HTML document (`toHtml()`, `modelToHtml()`) into PDF bytes: every renderer reads only the HTML (#69). */
export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}
