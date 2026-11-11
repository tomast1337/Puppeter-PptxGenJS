import * as jsdom from "jsdom";
import type { ComponentRegistry } from "../components/registry";
import { PPTX_DEFAULTS, tableMarginToCSS, textMarginToCSS } from "../defaults";
import type { NormalizedPresentation, NormalizedSlide, NormalizedSlideObject } from "../model/types";
import { normalizeColor } from "../normalize/style";
import type { PageSize } from "../pageLayouts";
import { inchesToPixels, pointsToPixels } from "../utils";
import { renderChart, renderChartExtension } from "./chart";
import { renderComponent } from "./component";
import { renderImage } from "./image";
import { renderShape, renderShapeSvg } from "./shape";
import { applyObjectStyle } from "./style";
import { renderTable } from "./table";
import { renderText } from "./text";

export function renderSlideObject(document: Document, object: NormalizedSlideObject, components?: ComponentRegistry): HTMLElement {
    switch (object.kind) {
        case "text": {
            const element = document.createElement("div");
            element.className = "slide-element slide-text";
            if (object.shape) {
                applyObjectStyle(element, { ...object.style, fill: undefined, line: undefined, shadow: undefined });
                element.dataset.shape = object.shape.name;
                element.appendChild(renderShapeSvg(document, object.shape, object.style));
            } else applyObjectStyle(element, object.style);
            renderText(document, element, object.text);
            return element;
        }
        case "shape":
            return renderShape(document, object.shape, object.style);
        case "image":
            return renderImage(document, object.image, object.style);
        case "table": {
            const element = document.createElement("div");
            element.className = "slide-element slide-table-container";
            applyObjectStyle(element, object.style);
            element.appendChild(renderTable(document, object.table));
            return element;
        }
        case "chart":
            return renderChart(document, object.chart, object.style);
        case "chartExtension":
            return renderChartExtension(document, object.svg, object.style, object.altText);
        case "component":
            if (!components) throw new Error(`Rendering component ${object.component.type}@${object.component.version} requires its component registry`);
            return renderComponent(document, { input: object.component, style: object.style }, components.get(object.component.type, object.component.version));
    }
}

export function applySlideBackground(element: HTMLElement, slide: NormalizedSlide): void {
    element.style.backgroundColor = slide.background;
}

export function applySlideColor(element: HTMLElement, slide: NormalizedSlide): void {
    element.style.setProperty("--slide-text-color", slide.color);
}

export function applySlideHidden(element: HTMLElement, slide: NormalizedSlide): void {
    element.dataset.hidden = String(slide.hidden);
}

export function renderSlide(document: Document, slide: NormalizedSlide, index: number, components?: ComponentRegistry): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "slide-container";
    element.id = `slide-${index + 1}`;
    applySlideBackground(element, slide);
    applySlideColor(element, slide);
    applySlideHidden(element, slide);
    for (const object of slide.objects) element.appendChild(renderSlideObject(document, object, components));
    return element;
}

export function createPresentationDocument(pageSize: PageSize): Document {
    const document = new jsdom.JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
    applyPresentationStyles(document, pageSize);
    return document;
}

export function applyPresentationStyles(document: Document, pageSize: PageSize): void {
    document.querySelector("style#puppeteer-gen-styles")?.remove();
    const style = document.createElement("style");
    style.id = "puppeteer-gen-styles";
    style.textContent = presentationCSS(pageSize);
    document.head.appendChild(style);
}

/** Pure HTML render pass: the normalized model is the only input besides component definitions. */
export function renderPresentationDocument(presentation: NormalizedPresentation, components?: ComponentRegistry): Document {
    const document = createPresentationDocument(presentation.pageSize);
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
