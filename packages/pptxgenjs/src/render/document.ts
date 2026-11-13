import type { HtmlPresentationDocument, NormalizedPresentation, PageSize } from "@pdfdeck/model";
import { resolveDocumentImages, resolveRemoteImageSource } from "../normalize/image";
import { type ComponentLookup, renderPresentationDocument } from "./slide";

// The renderer interfaces are the model package's contract; re-exported for existing imports.
export type { HtmlPresentationDocument, ModelRenderer, PresentationRenderer } from "@pdfdeck/model";

export function serializeHtmlPresentation(document: Document, pageSize: PageSize): HtmlPresentationDocument {
    return {
        // Standards mode: quirks mode drops the line-box strut that text.ts sizes lines with.
        html: `<!DOCTYPE html>${document.documentElement.outerHTML}`,
        pageSize,
    };
}

/** What modelToHtml() needs besides the model; each one is supplied by the caller (the Node entry passes jsdom and file paths). */
export interface ModelToHtmlOptions {
    /** Definitions for the model's `component` objects; required when it has any. */
    components?: ComponentLookup;
    /** Turns an image path or URL into a data URI. Default: data URIs and http(s) URLs only. */
    resolveImage?: (source: string) => Promise<string>;
    /** Creates the empty document the HTML is built in. Default: the global `document`'s implementation. */
    createDocument?: () => Document;
}

/**
 * The model's self-contained HTML document (images inlined as data URIs), the same bytes for the same model.
 * The model is not modified.
 */
export async function modelToHtml(model: NormalizedPresentation, options: ModelToHtmlOptions = {}): Promise<HtmlPresentationDocument> {
    const document = renderPresentationDocument(model, options.components, options.createDocument);
    await resolveDocumentImages(document, options.resolveImage ?? resolveRemoteImageSource);
    return serializeHtmlPresentation(document, model.pageSize);
}
