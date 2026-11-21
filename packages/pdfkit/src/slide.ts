// Draws one slide container: its background, then each object in paint order with the common box
// (docs/HTML_PROFILE.md "Slide objects"): position, size, rotation, flips, opacity, fill and line.
import { assertLinkUrl } from "@pdflapas/model";
import { color, px, readStyle, type Style, take } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import { type Effect, shadowEffect } from "./effect/index";
import { drawImage } from "./image";
import { captureFill, captureStroke, dash, fill, type Paint, stroke, transformBox } from "./paint";
import { drawShapeSvg } from "./shape";
import { drawTable } from "./table";
import { drawLayout, type Frame, layoutBox } from "./text/draw";
import { readTextBox, reportUnread } from "./text/read";

const TRANSFORM_PART = /(rotate|scaleX|scaleY)\(([^)]*)\)/g;
const DROP_SHADOW = /^drop-shadow\((.*)\)$/;
/** pdf-core's warning for an inner shadow it does not draw (on anything but a picture). */
const INNER_SHADOW_NOT_DRAWN = "inner shadow not rendered";
/** PDF's initial miter limit, which a box line keeps. */
const PDF_MITER_LIMIT = 10;
/** Object-box properties the renderer does not need to draw: `toHtml()` states them for Chromium's layout. */
const BOX_LAYOUT: ReadonlySet<string> = new Set(["transform-origin", "position", "overflow", "box-sizing", "white-space", "overflow-wrap"]);
/** Object classes whose kind the renderer does not draw yet, reported as a whole. */
const UNSUPPORTED_KINDS: Readonly<Record<string, string>> = Object.freeze({
    "slide-chart": "charts",
    "slide-component": "components",
});

export type SlideContext = {
    readonly paint: (object: string) => Omit<Paint, "opacity">;
    readonly report: (what: string) => void;
};

type Box = {
    readonly rotation: number;
    readonly flipH: boolean;
    readonly flipV: boolean;
    readonly opacity: number;
} & Frame;

/** The box's own fill and line (objects without SVG geometry). A text box's line is centred on its edge, as in DrawingML. */
function drawBoxPaint(element: Element, style: Style, paint: Paint, frame: Frame): void {
    const background = color(take(style, "background-color"));
    const borderStyle = take(style, "border-style") ?? "none";
    const borderWidth = px(take(style, "border-width")) ?? 0;
    const borderColor = color(take(style, "border-color"));
    const dashArray = attribute(element, "data-line-dash-array");
    const doc = paint.doc;
    const trace = (pen: PDFKit.PDFDocument) => pen.rect(frame.x, frame.y, frame.width, frame.height);

    if (background && background.alpha > 0) {
        fill(paint, background);
        trace(doc).fill();
        captureFill(paint, background.alpha, trace);
    }

    if (borderStyle === "none" || !borderColor || borderWidth <= 0) {
        return;
    }

    if (borderStyle !== "solid" && borderStyle !== "dashed") {
        paint.report(`border-style '${borderStyle}' is drawn solid`);
    }

    doc.save();
    stroke(paint, borderColor, borderWidth);
    const dashes = borderStyle === "dashed" && dashArray ? dashArray.split(/[\s,]+/).map(Number) : [];

    if (dash(doc, dashes)) {
        trace(doc).stroke();
        captureStroke(paint, borderColor.alpha, { width: borderWidth, cap: "butt", join: "miter", miterLimit: PDF_MITER_LIMIT, dashes }, trace);
    }

    doc.restore();
}

/** Draws the object `element` in its box, transformed, with its link. */
function drawBox(element: Element, style: Style, paint: Paint, box: Box): void {
    const doc = paint.doc;
    const report = paint.report;

    doc.save();
    transformBox(doc, box, box.rotation, box.flipH, box.flipV);
    if (hasClass(element, "slide-text")) {
        const text = readTextBox(element, style, paint.report);
        const svg = children(element).find(child => hasClass(child, "shape-svg"));
        const laid = text && layoutBox(paint, text, box);
        // `fit: resize` grows the box (its fill, line and shape) to the text.
        const frame = { ...box, height: laid ? Math.max(box.height, laid.height) : box.height };

        drawBoxPaint(element, style, paint, frame);
        if (svg) {
            drawShapeSvg(svg, paint, frame);
        }

        if (laid) {
            drawLayout(paint, laid.layout, box.x + (text?.padding[3] ?? 0), laid.top);
        }
    } else if (hasClass(element, "slide-shape")) {
        const svg = children(element).find(child => hasClass(child, "shape-svg"));

        if (!svg) {
            throw new Error("invalid PdfLapas HTML: a shape has no svg.shape-svg");
        }

        drawBoxPaint(element, style, paint, box);
        drawShapeSvg(svg, paint, box);
    } else if (hasClass(element, "slide-image")) {
        drawImage(element, style, paint, box);
        drawBoxPaint(element, style, paint, box);
    } else if (hasClass(element, "slide-table-container")) {
        drawBoxPaint(element, style, paint, box);
        drawTable(element, paint, box);
    } else {
        report(`<${element.tagName} class="${attribute(element, "class") ?? ""}"> is not a slide object the renderer draws`);
    }

    const href = attribute(element, "href");
    const slide = attribute(element, "data-slide");

    // A slide link carries href="#slide-N" too: data-slide decides, as in pdf-core.
    if (slide !== undefined && element.tagName === "a") {
        doc.goTo(box.x, box.y, box.width, box.height, `slide-${slide}`);
    } else if (href !== undefined && element.tagName === "a") {
        assertLinkUrl(href, `'${attribute(element, "data-object-name") ?? "unnamed object"}'`);
        doc.link(box.x, box.y, box.width, box.height, href);
    }

    doc.restore();
}

/** Draws the slide container `slide` on the current page. */
export function drawSlide(slide: Element, context: SlideContext, size: { width: number; height: number }): void {
    const slideStyle = readStyle(slide);
    const background = color(take(slideStyle, "background-color"));

    take(slideStyle, "--slide-text-color"); // every run states its own color; this custom property only feeds the stylesheet
    const slidePaint: Paint = { ...context.paint("slide"), report: context.report, opacity: 1 };

    if (background && background.alpha > 0) {
        fill(slidePaint, background);
        slidePaint.doc.rect(0, 0, size.width, size.height).fill();
    }

    reportUnread(slide, slideStyle, ["data-hidden"], context.report);
    // Each `.slide-element`, in paint order.
    for (const [index, element] of children(slide).entries()) {
        const name = attribute(element, "data-object-name") ?? `#${index}`;
        const style = readStyle(element);
        const report = (what: string) => context.report(`object '${name}': ${what}`);
        const kind = Object.keys(UNSUPPORTED_KINDS).find(className => hasClass(element, className));

        if (kind) {
            report(`${UNSUPPORTED_KINDS[kind]} are not drawn by the PDFKit renderer`);
            continue;
        }

        // The object's box.
        const x = px(take(style, "left"));
        const y = px(take(style, "top"));

        if (x === undefined || y === undefined) {
            throw new Error("invalid PdfLapas HTML: a slide object has no left and top in px");
        }

        const minHeight = px(take(style, "min-height"));
        const height = px(take(style, "height")) ?? minHeight ?? 0;
        let [rotation, flipH, flipV] = [0, false, false];

        for (const [, part, value] of (take(style, "transform") ?? "").matchAll(TRANSFORM_PART)) {
            if (part === "rotate") {
                rotation = Number.parseFloat(value ?? "0");
            } else if (part === "scaleX") {
                flipH = value === "-1";
            } else if (part === "scaleY") {
                flipV = value === "-1";
            }
        }

        const opacity = Number(take(style, "opacity") ?? 1);
        const box: Box = { x, y, width: px(take(style, "width")) ?? 0, height, rotation, flipH, flipV, opacity };
        // The object's shadow: `box-shadow` on the box (`inset`, a picture's inner shadow), or `filter: drop-shadow()`
        // on a shape's svg. pdf-core draws an inner shadow on pictures only and reports it on anything else.
        const boxShadow = take(style, "box-shadow");
        const svg = children(element).find(child => hasClass(child, "shape-svg"));
        const svgStyle = svg ? readStyle(svg) : new Map<string, string>();
        const filter = take(svgStyle, "filter");

        take(svgStyle, "overflow"); // `visible`, so Chromium does not clip the strokes and heads past the viewBox
        for (const [property, value] of svgStyle) {
            report(`CSS property '${property}: ${value}' on <svg> is not drawn`);
        }

        const inner = boxShadow?.startsWith("inset ") ?? false;
        let shadow: Effect | undefined;

        if (svg && attribute(svg, "data-shadow-inset") !== undefined) {
            report(INNER_SHADOW_NOT_DRAWN);
        } else if (inner && !hasClass(element, "slide-image")) {
            report(INNER_SHADOW_NOT_DRAWN);
        } else {
            const drop = filter === undefined ? undefined : DROP_SHADOW.exec(filter)?.[1];

            if (filter !== undefined && drop === undefined) {
                report(`filter '${filter}' on a shape is not drawn`);
            }

            const value = boxShadow === undefined ? drop : inner ? boxShadow.slice("inset ".length) : boxShadow;
            const effect = value === undefined ? undefined : shadowEffect(value, inner);

            if (typeof effect === "string") {
                report(effect);
            } else {
                shadow = effect;
            }
        }

        const paint: Paint = { ...context.paint(name), report, opacity: box.opacity };

        // The shadow is cast in slide space, outside the object's rotation and flips (DrawingML `rotWithShape="0"`).
        if (shadow) {
            paint.effects.under(paint.doc, shadow, false, box.opacity, report, () => drawBox(element, style, paint, box));
        } else {
            drawBox(element, style, paint, box);
        }

        reportUnread(element, style, ["data-object-name", "data-shape", "data-text-fit", "data-text-fit-step", "data-text-fit-max-steps", "data-text-fit-tolerance", "data-text-direction", "data-slide", "data-image-sizing", "data-line-dash-array", "data-line-begin-arrow", "data-line-end-arrow"], report, BOX_LAYOUT);
    }
}
