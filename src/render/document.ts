import type { PageSize } from "../pageLayouts";

export interface HtmlPresentationDocument {
    html: string;
    pageSize: PageSize;
}

export interface PresentationRenderer {
    render(document: HtmlPresentationDocument): Promise<Uint8Array>;
}

export function serializeHtmlPresentation(document: Document, pageSize: PageSize): HtmlPresentationDocument {
    return {
        html: document.documentElement.outerHTML,
        pageSize,
    };
}
