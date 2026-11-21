import type { ComponentRegistry } from "#src/components/registry";
import { PPTX_DEFAULTS } from "#src/defaults";
import { tableMarginToCSS, textMarginToCSS } from "#src/normalize/margin";
import { cssPx, type DataUri, HTML_PROFILE_VERSION, inchesToPixels, type NormalizedPresentation, type NormalizedSlide, type NormalizedSlideObject, pointsToPixels } from "@pdflapas/model";
import { normalizeColor } from "#src/normalize/style";
import type { PageSize } from "#src/pageLayouts";
import { renderChart, renderChartExtension } from "./chart";
import { componentHtml, type RenderedComponent, renderComponent } from "./component";
import { type InlineStyle, styleAttribute } from "./css";
import { renderImage } from "./image";
import { element, escapeText, type Html, rawTextElement, voidElement } from "./markup";
import { renderShape, renderShapeSvg } from "./shape";
import { applyObjectStyle } from "./style";
import { renderTable } from "./table";
import { renderText } from "./text";

/** Prefix for ids inside one object; taken from its position so the same deck always gives the same ids. */
export function objectIdScope(slideIndex: number, objectIndex: number): string {
    return `slide-${slideIndex + 1}-object-${objectIndex}`;
}

/** What rendering needs from a component registry: the definition for a saved type and version. */
export type ComponentLookup = Pick<ComponentRegistry, "get">;

/** What writing the model needs besides the model: its rendered components and its resolved images. */
export interface RenderPass {
    /** Each `component` object of the model, rendered (`renderComponents`). */
    components: ReadonlyMap<NormalizedSlideObject, RenderedComponent>;
    /** Data URIs of path and URL image sources; without one an image keeps `data-source-path` or `data-source-url`. */
    images?: ReadonlyMap<string, DataUri>;
}

/** Default document factory for browser runtimes; the Node entry injects jsdom instead. */
export function createBrowserDocument(): Document {
    const document = (globalThis as { document?: Document }).document;

    if (!document) {
        throw new Error('No DOM is available: pass a createDocument option to PuppeteerGen, or use the Node entry ("@pdflapas/pptxgenjs")');
    }

    return document.implementation.createHTMLDocument();
}

/**
 * Renders the components of the printed (not hidden) slides, in deck order, with their definitions. `getDocument` is called only for a
 * component that reads `context.document`, so a deck without one never creates a document.
 */
export function renderComponents(presentation: NormalizedPresentation, components: ComponentLookup | undefined, getDocument: () => Document): Map<NormalizedSlideObject, RenderedComponent> {
    const rendered = new Map<NormalizedSlideObject, RenderedComponent>();

    for (const [slideIndex, slide] of presentation.slides.entries()) {
        for (const [objectIndex, object] of slide.objects.entries()) {
            if (slide.hidden || object.kind !== "component") {
                continue;
            }

            if (!components) {
                throw new Error(`Rendering component ${object.component.type}@${object.component.version} requires its component registry`);
            }

            const definition = components.get(object.component.type, object.component.version);

            rendered.set(object, renderComponent({ input: object.component, style: object.style }, definition, objectIdScope(slideIndex, objectIndex), getDocument));
        }
    }

    return rendered;
}

/** The model's whole HTML document, written as a string: the pure render pass, no DOM. */
export function presentationHtml(presentation: NormalizedPresentation, pass: RenderPass): string {
    const profile = voidElement("meta", [
        ["name", "pdflapas-profile"],
        ["content", String(HTML_PROFILE_VERSION)],
    ]);
    // The size itself is in the stylesheet; its name ("Screen 16:9 Landscape", a defineLayout() name) is not.
    const pageSize = voidElement("meta", [
        ["name", "pdflapas-page-size"],
        ["content", presentation.pageSize.name],
    ]);
    // <style> holds raw text: its content is not escaped.
    const style = rawTextElement("style", [["id", "puppeteer-gen-styles"]], presentationCSS(presentation.pageSize));
    const slides: Html[] = [];

    for (const [index, slide] of presentation.slides.entries()) {
        // A hidden slide is not printed; the others keep their number in `id`, which slide links jump to.
        if (slide.hidden) {
            continue;
        }

        const objects: Html[] = [];

        for (const [objectIndex, object] of slide.objects.entries()) {
            const idScope = objectIdScope(index, objectIndex);

            switch (object.kind) {
                case "text": {
                    const css: InlineStyle = new Map();
                    const objectAttributes = applyObjectStyle(css, object.shape ? { ...object.style, fill: undefined, line: undefined, shadow: undefined } : object.style);
                    const svg = object.shape ? [renderShapeSvg(object.shape, object.style)] : [];
                    const text = renderText(css, object.text);

                    objects.push(element("div", [["class", "slide-element slide-text"], ...objectAttributes, ["data-shape", object.shape?.name], ...text.attributes, styleAttribute(css)], [...svg, text.content]));
                    break;
                }
                case "shape":
                    objects.push(renderShape(object.shape, object.style));
                    break;
                case "image":
                    objects.push(renderImage(object.image, object.style, pass.images?.get(object.image.source)));
                    break;
                case "table": {
                    const css: InlineStyle = new Map();
                    const objectAttributes = applyObjectStyle(css, object.style);

                    objects.push(element("div", [["class", "slide-element slide-table-container"], ...objectAttributes, styleAttribute(css)], renderTable(object.table)));
                    break;
                }
                case "chart":
                    objects.push(renderChart(object.chart, object.style, idScope));
                    break;
                case "chartExtension":
                    objects.push(renderChartExtension(object.svg, object.style, object.altText, idScope));
                    break;
                case "component": {
                    const component = pass.components.get(object);

                    // renderComponents() renders every component object of the model it is given.
                    if (!component) {
                        throw new Error(`Component ${object.component.type}@${object.component.version} was not rendered before writing its slide`);
                    }

                    objects.push(componentHtml(component, pass.images));
                    break;
                }
            }
        }

        const css: InlineStyle = new Map([
            ["background-color", slide.background],
            ["--slide-text-color", slide.color],
        ]);

        slides.push(element("div", [["class", "slide-container"], ["id", `slide-${index + 1}`], styleAttribute(css)], objects));
    }

    // Document properties: standard HTML where it has a name for one, `pdflapas-*` meta otherwise; empty ones are left out.
    const { title, author, subject, company, revision, keywords, creator, producer, creationDate, modificationDate } = presentation.metadata ?? {};
    const head: Html[] = [profile, pageSize];

    if (title) {
        head.push(element("title", [], escapeText(title)));
    }

    // `description` is HTML's "free-form string describing the page", the PDF Subject's meaning (krilla writes it there too).
    const meta: readonly (readonly [name: string, content: string | undefined])[] = [
        ["author", author],
        ["description", subject],
        ["pdflapas-company", company],
        ["pdflapas-revision", revision],
        ["keywords", keywords],
        ["pdflapas-creator", creator],
        ["pdflapas-producer", producer],
        ["pdflapas-creation-date", creationDate],
        ["pdflapas-modification-date", modificationDate],
    ];

    for (const [name, content] of meta) {
        if (content) {
            head.push(
                voidElement("meta", [
                    ["name", name],
                    ["content", content],
                ]),
            );
        }
    }

    head.push(style);

    // Standards mode: quirks mode drops the line-box strut that text.ts sizes lines with.
    return `<!DOCTYPE html>${element("html", [], [element("head", [], head), element("body", [], slides)])}`;
}

/** The shared stylesheet: generated from the page size only. */
export function presentationCSS(pageSize: PageSize): string {
    const widthPx = inchesToPixels(pageSize.width);
    const heightPx = inchesToPixels(pageSize.height);

    return `
@page {
    size: ${pageSize.width}in ${pageSize.height}in;
    margin: 0;
}

body {
    margin: 0;
    padding: 0;
    font-family: ${PPTX_DEFAULTS.text.fontFace}, Arial, Helvetica, sans-serif;
}

.slide-container {
    width: ${cssPx(widthPx)};
    height: ${cssPx(heightPx)};
    position: relative;
    page-break-after: always;
    background: ${normalizeColor(PPTX_DEFAULTS.slide.backgroundColor)};
    overflow: hidden;
    box-sizing: border-box;
}

.slide-container:last-child {
    page-break-after: auto;
}

.slide-element {
    position: absolute;
    box-sizing: border-box;
    /* PowerPoint paints slide objects in insertion order. Give every object a
       stacking context so an earlier object's internal text layer cannot paint
       over a later object's fill. Equal z-index contexts retain DOM order. */
    z-index: 0;
}

.slide-text {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    color: var(--slide-text-color, ${normalizeColor(PPTX_DEFAULTS.text.color)});
    font-family: ${PPTX_DEFAULTS.text.fontFace}, Arial, Helvetica, sans-serif;
    font-size: ${pointsToPixels(PPTX_DEFAULTS.text.fontSizePt)}px;
    padding: ${textMarginToCSS()};
    /* PptxGenJS writes no clip: PowerPoint and LibreOffice draw text past its box, and a shape's outline and
       line heads past the geometry. */
    overflow: visible;
    white-space: pre-wrap;
    word-wrap: break-word;
}

.slide-text > .shape-svg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
}

.slide-text > .text-content {
    position: relative;
    z-index: 1;
}

/* The line-box strut: a 0px font makes each line exactly the paragraph's line-height tall, its baseline
   in the middle, whatever the fonts' ascent and descent; glyphs with line-height 0 do not size it. The
   Puppeteer print step then moves the paragraph so the baseline lands on data-line-baseline. */
.text-paragraph {
    font-size: 0;
}

.text-run,
.text-bullet {
    line-height: 0;
}

/* The marker is an inline-block, which would indent its own text by the paragraph's hanging text-indent. */
.text-bullet {
    text-indent: 0;
}

.slide-shape {
    border-style: none;
}

/* Standards mode puts an inline <svg> on the text baseline: a zero-height line box would drop it by the strut. */
.slide-shape > .shape-svg {
    display: block;
}

.slide-image {
    display: block;
    color: inherit;
    text-decoration: none;
}

.slide-image-content {
    border: 0;
}

.slide-table {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    height: 100%;
    color: ${normalizeColor(PPTX_DEFAULTS.table.color)};
    font-size: ${pointsToPixels(PPTX_DEFAULTS.table.fontSizePt)}px;
}

.slide-table td,
.slide-table th {
    border: none;
    padding: ${tableMarginToCSS()};
    vertical-align: top;
}

@media print {
    body {
        margin: 0;
        padding: 0;
    }

    .slide-container {
        page-break-after: always;
        break-after: page;
    }

    .slide-container:last-child {
        page-break-after: auto;
        break-after: auto;
    }
}
        `.trim();
}
