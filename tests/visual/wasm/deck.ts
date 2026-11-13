// Decks cut from the shared visual fixture, so every engine sees the same slides:
// - text: the first nine slides (title, defaults, primitives, paragraphs, runs, lists, effects,
//   direction, overflow).
// - shapes: every preset-shape slide (core, polygon, arrow, callout, curved, circular, flowchart,
//   brace, ribbon, action button, symbol, generated preset and aspect slides) plus text in shapes and
//   line heads.
// - tables: the defaults slide (default inset table), static sizing and spans, inheritance and cell
//   options, and automatic pagination with its two continuation slides.
// Other slides are swallowed.
import { JSDOM } from "jsdom";
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { populateParityFixture } from "../fixture";

export const TEXT_PAGES = 9;

/** `addSlide` calls of the fixture (1-based) that make the shapes deck: pages 12-45, the text-in-shapes slide and the line-head slide. */
const SHAPE_SLIDE_CALLS = new Set([...Array.from({ length: 34 }, (_, index) => 12 + index), 49, 56]);
export const SHAPE_PAGES = SHAPE_SLIDE_CALLS.size;

/** `addSlide` calls of the tables deck: defaults (2), sizing (46), inheritance (47), pagination (48). */
const TABLE_SLIDE_CALLS = new Set([2, 46, 47, 48]);
/** The pagination slide's table continues on two slides that autoPage adds itself. */
export const TABLE_PAGES = TABLE_SLIDE_CALLS.size + 2;

// installTableToSlidesFixture reads a global document for the PptxGenJS reference.
if (!globalThis.document) Object.assign(globalThis, { document: new JSDOM("<!DOCTYPE html><body></body>").window.document });

/** Populates the fixture keeping only the slides whose 1-based `addSlide` call number passes `keep`. */
function populateFixtureSlides<T extends PptxGenJS | PuppeteerGen>(presentation: T, keep: (call: number) => boolean): T {
    let calls = 0;
    const sink: unknown = new Proxy(() => sink, { get: () => sink, set: () => true, apply: () => sink });
    const proxy = new Proxy(presentation, {
        get(target, property) {
            if (property === "addSlide") return (...args: unknown[]) => (keep(++calls) ? (target.addSlide as (...a: unknown[]) => unknown)(...args) : sink);
            if (property === "tableToSlides") return () => undefined;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    populateParityFixture(proxy);
    // tableToSlides is skipped, so drop its source table or Puppeteer prints it as an extra page.
    if ("page" in presentation) presentation.page.getElementById("visual-html-table")?.parentElement?.remove();
    return presentation;
}

export function populateTextDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    return populateFixtureSlides(presentation, call => call <= TEXT_PAGES);
}

export function populateShapeDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    return populateFixtureSlides(presentation, call => SHAPE_SLIDE_CALLS.has(call));
}

export function populateTableDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    return populateFixtureSlides(presentation, call => TABLE_SLIDE_CALLS.has(call));
}
