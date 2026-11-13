import type { PageSize } from "./types";

export interface HtmlPresentationDocument {
    html: string;
    pageSize: PageSize;
}

/** Turns the HTML document (`toHtml()`, `modelToHtml()`) into PDF bytes: every renderer reads only the HTML (#69). */
export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}
