import { createNodeDocument, type PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { type ComponentLookup, renderPresentationDocument } from "../packages/pptxgenjs/src/render/slide";

/**
 * The document toHtml() serializes, before image resolution, for structural assertions. Slides are no
 * longer written into `pres.page` (#69), so tests render the model the same way toHtml() does.
 */
export function renderedPage(presentation: PuppeteerGen): Document {
    // `as`: the registry is private; toHtml() hands the same object to modelToHtml().
    const components = (presentation as unknown as { components: ComponentLookup }).components;
    return renderPresentationDocument(presentation.getModel(), components, createNodeDocument);
}

/** One rendered `.slide-container`, by zero-based slide index. */
export function renderedSlide(presentation: PuppeteerGen, index = 0): HTMLElement {
    const slide = renderedPage(presentation).getElementById(`slide-${index + 1}`);
    if (!slide) throw new Error(`The presentation has no slide ${index + 1}`);
    return slide;
}
