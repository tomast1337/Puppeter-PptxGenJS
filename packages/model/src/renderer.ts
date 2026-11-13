import type { NormalizedPresentation, PageSize } from "./types";

export interface HtmlPresentationDocument {
    html: string;
    pageSize: PageSize;
}

/** Prints the serialized HTML document (the Puppeteer default). */
export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}

/** Renders the normalized model directly, without HTML. toPdf() hands every renderer the HTML instead; #69 phase 5 removes this. */
export interface ModelRenderer {
    renderModel(model: NormalizedPresentation): Promise<Uint8Array>;
}
