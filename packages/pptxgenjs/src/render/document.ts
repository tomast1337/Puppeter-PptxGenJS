import type { HtmlPresentationDocument, PageSize } from "@pdfdeck/model";

// The renderer interfaces are the model package's contract; re-exported for existing imports.
export type { HtmlPresentationDocument, ModelRenderer, PresentationRenderer } from "@pdfdeck/model";

export function serializeHtmlPresentation(document: Document, pageSize: PageSize): HtmlPresentationDocument {
    return {
        html: document.documentElement.outerHTML,
        pageSize,
    };
}
