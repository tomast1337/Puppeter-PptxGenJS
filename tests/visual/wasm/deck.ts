// The text-only deck: the first nine slides of the shared visual fixture
// (title, defaults, primitives, paragraphs, runs, lists, effects, direction,
// overflow). Later slides are swallowed so every engine sees the same deck.
import { JSDOM } from "jsdom";
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { populateParityFixture } from "../../../tests/visual/fixture";

export const TEXT_PAGES = 9;

// installTableToSlidesFixture reads a global document for the PptxGenJS reference.
if (!globalThis.document) Object.assign(globalThis, { document: new JSDOM("<!DOCTYPE html><body></body>").window.document });

export function populateTextDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    let slides = 0;
    const sink: unknown = new Proxy(() => sink, { get: () => sink, set: () => true, apply: () => sink });
    const proxy = new Proxy(presentation, {
        get(target, property) {
            if (property === "addSlide") return (...args: unknown[]) => (++slides <= TEXT_PAGES ? (target.addSlide as (...a: unknown[]) => unknown)(...args) : sink);
            if (property === "tableToSlides") return () => undefined;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    populateParityFixture(proxy);
    // tableToSlides is skipped, so drop its source table or Puppeteer prints it as a 10th page.
    if ("page" in presentation) presentation.page.getElementById("visual-html-table")?.parentElement?.remove();
    return presentation;
}
