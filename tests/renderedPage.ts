import { JSDOM } from "jsdom";
import { createNodeDocument, type PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { unresolvedModelHtml } from "../packages/pptxgenjs/src/render/document";
import type { ComponentLookup } from "../packages/pptxgenjs/src/render/slide";

/**
 * The HTML toHtml() writes, before image resolution, parsed for structural assertions. Slides are no
 * longer written into `pres.page` (#69), so tests render the model the same way toHtml() does.
 */
export function renderedPage(presentation: PuppeteerGen): Document {
    // `as`: the registry is private; toHtml() hands the same object to modelToHtml().
    const components = (presentation as unknown as { components: ComponentLookup }).components;
    return new JSDOM(unresolvedModelHtml(presentation.getModel(), components, createNodeDocument)).window.document;
}

/** One rendered `.slide-container`, by zero-based slide index. */
export function renderedSlide(presentation: PuppeteerGen, index = 0): HTMLElement {
    const slide = renderedPage(presentation).getElementById(`slide-${index + 1}`);
    if (!slide) throw new Error(`The presentation has no slide ${index + 1}`);
    return slide;
}
