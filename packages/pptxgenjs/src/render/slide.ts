import type { ComponentRegistry } from "../components/registry";
import { PPTX_DEFAULTS, tableMarginToCSS, textMarginToCSS } from "../defaults";
import type { NormalizedPresentation, NormalizedSlide, NormalizedSlideObject } from "@pdfdeck/model";
import { normalizeColor } from "../normalize/style";
import type { PageSize } from "../pageLayouts";
import { inchesToPixels, pointsToPixels } from "../units";
import { renderChart, renderChartExtension } from "./chart";
import { renderComponent } from "./component";
import { type InlineStyle, writeStyle } from "./css";
import { renderImage } from "./image";
import { renderShape, renderShapeSvg } from "./shape";
import { applyObjectStyle } from "./style";
import { renderTable } from "./table";
import { renderText } from "./text";

/** The pdfdeck HTML profile version (docs/HTML_PROFILE.md) the document follows, in `<meta name="pdfdeck-profile">`. */
export const HTML_PROFILE_VERSION = 1;

/** Prefix for ids inside one object; taken from its position so the same deck always gives the same ids. */
export function objectIdScope(slideIndex: number, objectIndex: number): string {
    return `slide-${slideIndex + 1}-object-${objectIndex}`;
}

/** What rendering needs from a component registry: the definition for a saved type and version. */
export type ComponentLookup = Pick<ComponentRegistry, "get">;

export function renderSlideObject(document: Document, object: NormalizedSlideObject, idScope: string, components?: ComponentLookup): HTMLElement {
    switch (object.kind) {
        case "text": {
            const element = document.createElement("div");
            element.className = "slide-element slide-text";
            const css: InlineStyle = new Map();
            if (object.shape) {
                applyObjectStyle(element, css, { ...object.style, fill: undefined, line: undefined, shadow: undefined });
                element.dataset.shape = object.shape.name;
                element.appendChild(renderShapeSvg(document, object.shape, object.style));
            } else applyObjectStyle(element, css, object.style);
            renderText(document, element, css, object.text);
            writeStyle(element, css);
            return element;
        }
        case "shape":
            return renderShape(document, object.shape, object.style);
        case "image":
            return renderImage(document, object.image, object.style);
        case "table": {
            const element = document.createElement("div");
            element.className = "slide-element slide-table-container";
            const css: InlineStyle = new Map();
            applyObjectStyle(element, css, object.style);
            writeStyle(element, css);
            element.appendChild(renderTable(document, object.table));
            return element;
        }
        case "chart":
            return renderChart(document, object.chart, object.style, idScope);
        case "chartExtension":
            return renderChartExtension(document, object.svg, object.style, object.altText, idScope);
        case "component":
            if (!components) throw new Error(`Rendering component ${object.component.type}@${object.component.version} requires its component registry`);
            return renderComponent(document, { input: object.component, style: object.style }, components.get(object.component.type, object.component.version), idScope);
    }
}

export function renderSlide(document: Document, slide: NormalizedSlide, index: number, components?: ComponentLookup): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "slide-container";
    element.id = `slide-${index + 1}`;
    writeStyle(
        element,
        new Map([
            ["background-color", slide.background],
            ["--slide-text-color", slide.color],
        ]),
    );
    element.dataset.hidden = String(slide.hidden);
    slide.objects.forEach((object, objectIndex) => element.appendChild(renderSlideObject(document, object, objectIdScope(index, objectIndex), components)));
    return element;
}

/** Default document factory for browser runtimes; the Node entry injects jsdom instead. */
export function createBrowserDocument(): Document {
    const document = (globalThis as { document?: Document }).document;
    if (!document) throw new Error('No DOM is available: pass a createDocument option to PuppeteerGen, or use the Node entry ("puppeteer-pptxgenjs")');
    return document.implementation.createHTMLDocument();
}

/** Pure HTML render pass: the normalized model is the only input besides component definitions. */
export function renderPresentationDocument(presentation: NormalizedPresentation, components?: ComponentLookup, createDocument: () => Document = createBrowserDocument): Document {
    const document = createDocument();
    const profile = document.createElement("meta");
    profile.name = "pdfdeck-profile";
    profile.content = String(HTML_PROFILE_VERSION);
    // The size itself is in the stylesheet; its name ("Screen 16:9 Landscape", a defineLayout() name) is not.
    const pageSize = document.createElement("meta");
    pageSize.name = "pdfdeck-page-size";
    pageSize.content = presentation.pageSize.name;
    document.head.append(profile, pageSize);
    const style = document.createElement("style");
    style.id = "puppeteer-gen-styles";
    style.textContent = presentationCSS(presentation.pageSize);
    document.head.appendChild(style);
    presentation.slides.forEach((slide, index) => document.body.appendChild(renderSlide(document, slide, index, components)));
    return document;
}

function presentationCSS(pageSize: PageSize): string {
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

[data-puppeteer-gen-source="true"] {
    display: none !important;
}

.slide-container {
    width: ${widthPx}px;
    height: ${heightPx}px;
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
    overflow: hidden;
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

    .shape-svg {
        transform: var(--print-snap-offset, none);
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
