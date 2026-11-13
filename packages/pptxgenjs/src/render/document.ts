import type { HtmlPresentationDocument, PageSize } from "@pdfdeck/model";

// The renderer interfaces are the model package's contract; re-exported for existing imports.
export type { HtmlPresentationDocument, ModelRenderer, PresentationRenderer } from "@pdfdeck/model";

export function serializeHtmlPresentation(document: Document, pageSize: PageSize): HtmlPresentationDocument {
    return {
        // Standards mode: quirks mode drops the line-box strut that text.ts sizes lines with.
        html: `<!DOCTYPE html>${document.documentElement.outerHTML}`,
        pageSize,
    };
}
