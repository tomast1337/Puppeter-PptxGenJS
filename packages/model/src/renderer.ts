import type { NormalizedPresentation, PageSize } from "./types";

export interface HtmlPresentationDocument {
    html: string;
    pageSize: PageSize;
}

/** Prints the serialized HTML document (the Puppeteer default). */
export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}

/** Renders the normalized model directly, without HTML (the opt-in WASM backend). */
export interface ModelRenderer {
    renderModel(model: NormalizedPresentation): Promise<Uint8Array>;
}
