import type { HtmlPresentationDocument, NormalizedPresentation } from "@pdfdeck/model";
import { resolveRemoteImageSource } from "../normalize/image";
import { componentImageSources } from "./component";
import { type ComponentLookup, createBrowserDocument, presentationHtml, renderComponents } from "./slide";

// The renderer interfaces are the model package's contract; re-exported for existing imports.
export type { HtmlPresentationDocument, ModelRenderer, PresentationRenderer } from "@pdfdeck/model";

/** What modelToHtml() needs besides the model; each one is supplied by the caller (the Node entry passes jsdom and file paths). */
export interface ModelToHtmlOptions {
    /** Definitions for the model's `component` objects; required when it has any. */
    components?: ComponentLookup;
    /** Turns an image path or URL into a data URI. Default: data URIs and http(s) URLs only. */
    resolveImage?: (source: string) => Promise<string>;
    /**
     * Creates the document a component's `context.document` returns, called only when a component reads it.
     * Default: the global `document`'s implementation.
     */
    createDocument?: () => Document;
}

/** One document per call, created on first use. */
function lazyDocument(createDocument: () => Document): () => Document {
    let document: Document | undefined;
    return () => (document ??= createDocument());
}

/** The model's HTML before images are resolved: path and URL images keep `data-source-path` or `data-source-url`. */
export function unresolvedModelHtml(model: NormalizedPresentation, components?: ComponentLookup, createDocument: () => Document = createBrowserDocument): string {
    return presentationHtml(model, { components: renderComponents(model, components, lazyDocument(createDocument)) });
}

/**
 * The model's self-contained HTML document (images inlined as data URIs), the same bytes for the same model.
 * Written as strings: only a component that reads `context.document` needs a DOM. The model is not modified.
 */
export async function modelToHtml(model: NormalizedPresentation, options: ModelToHtmlOptions = {}): Promise<HtmlPresentationDocument> {
    const resolveImage = options.resolveImage ?? resolveRemoteImageSource;
    const components = renderComponents(model, options.components, lazyDocument(options.createDocument ?? createBrowserDocument));
    const modelSources = model.slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "image" && object.image.sourceKind !== "data" ? [object.image.source] : [])));
    const sources = new Set([...modelSources, ...Array.from(components.values()).flatMap(componentImageSources)]);
    // Each distinct source is resolved once.
    const images = new Map(await Promise.all(Array.from(sources, async source => [source, await resolveImage(source)] as const)));
    return { html: presentationHtml(model, { components, images }), pageSize: model.pageSize };
}
