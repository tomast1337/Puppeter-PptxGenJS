// Draws one slide container: its background, then each object in paint order with the common box
// (docs/HTML_PROFILE.md "Slide objects"): position, size, rotation, flips, opacity, fill and line.
import { color, px, readStyle, type Style, take } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import { drawImage } from "./image";
import { dash, fill, type Paint, stroke, transformBox } from "./paint";
import { drawShapeSvg } from "./shape";
import { drawTable } from "./table";
import { drawLayout, type Frame, layoutBox } from "./text/draw";
import { readTextBox, reportUnread } from "./text/read";

const TRANSFORM_PART = /(rotate|scaleX|scaleY)\(([^)]*)\)/g;
/** Object-box properties the renderer does not need to draw: `toHtml()` states them for Chromium's layout. */
const BOX_LAYOUT: ReadonlySet<string> = new Set(["transform-origin", "position", "overflow", "box-sizing", "white-space", "overflow-wrap"]);
/** Object classes whose kind the renderer does not draw yet, reported as a whole. */
const UNSUPPORTED_KINDS: Readonly<Record<string, string>> = Object.freeze({
    "slide-chart": "charts",
    "slide-component": "components",
});

export interface SlideContext {
    readonly paint: (object: string) => Omit<Paint, "opacity">;
    readonly report: (what: string) => void;
}

interface Box extends Frame {
    readonly rotation: number;
    readonly flipH: boolean;
    readonly flipV: boolean;
    readonly opacity: number;
}

function readBox(style: Style, report: (what: string) => void): Box {
    const x = px(take(style, "left"));
    const y = px(take(style, "top"));
    if (x === undefined || y === undefined) throw new Error("invalid PdfLapas HTML: a slide object has no left and top in px");
    const minHeight = px(take(style, "min-height"));
    const height = px(take(style, "height")) ?? minHeight ?? 0;
    let [rotation, flipH, flipV] = [0, false, false];
    for (const [, name, value] of (take(style, "transform") ?? "").matchAll(TRANSFORM_PART)) {
        if (name === "rotate") rotation = Number.parseFloat(value ?? "0");
        else if (name === "scaleX") flipH = value === "-1";
        else if (name === "scaleY") flipV = value === "-1";
    }
    const opacity = Number(take(style, "opacity") ?? 1);
    if (take(style, "box-shadow") !== undefined) report("object shadows are not drawn");
    return { x, y, width: px(take(style, "width")) ?? 0, height, rotation, flipH, flipV, opacity };
}

/** The box's own fill and line (objects without SVG geometry). A text box's line is centred on its edge, as in DrawingML. */
function drawBoxPaint(element: Element, style: Style, paint: Paint, frame: Frame): void {
    const background = color(take(style, "background-color"));
    const borderStyle = take(style, "border-style") ?? "none";
    const borderWidth = px(take(style, "border-width")) ?? 0;
    const borderColor = color(take(style, "border-color"));
    const dashArray = attribute(element, "data-line-dash-array");
    const doc = paint.doc;
    if (background && background.alpha > 0) {
        fill(paint, background);
        doc.rect(frame.x, frame.y, frame.width, frame.height).fill();
    }
    if (borderStyle === "none" || !borderColor || borderWidth <= 0) return;
    if (borderStyle !== "solid" && borderStyle !== "dashed") paint.report(`border-style '${borderStyle}' is drawn solid`);
    doc.save();
    stroke(paint, borderColor, borderWidth);
    const visible = borderStyle === "dashed" && dashArray ? dash(doc, dashArray.split(/[\s,]+/).map(Number)) : true;
    if (visible) doc.rect(frame.x, frame.y, frame.width, frame.height).stroke();
    doc.restore();
}

function drawText(element: Element, style: Style, paint: Paint, box: Box): void {
    const text = readTextBox(element, style, paint.report);
    const svg = children(element).find(child => hasClass(child, "shape-svg"));
    const laid = text && layoutBox(paint, text, box);
    // `fit: resize` grows the box (its fill, line and shape) to the text.
    const frame = { ...box, height: laid ? Math.max(box.height, laid.height) : box.height };
    drawBoxPaint(element, style, paint, frame);
    if (svg) drawShapeSvg(svg, paint, frame);
    if (laid) drawLayout(paint, laid.layout, box.x + (text?.padding[3] ?? 0), laid.top);
}

/** Draws one `.slide-element`. */
function drawObject(element: Element, context: SlideContext, name: string): void {
    const style = readStyle(element);
    const report = (what: string) => context.report(`object '${name}': ${what}`);
    const kind = Object.keys(UNSUPPORTED_KINDS).find(className => hasClass(element, className));
    if (kind) {
        report(`${UNSUPPORTED_KINDS[kind]} are not drawn by the PDFKit renderer`);
        return;
    }
    const box = readBox(style, report);
    const paint: Paint = { ...context.paint(name), report, opacity: box.opacity };
    const doc = paint.doc;
    doc.save();
    transformBox(doc, box, box.rotation, box.flipH, box.flipV);
    if (hasClass(element, "slide-text")) drawText(element, style, paint, box);
    else if (hasClass(element, "slide-shape")) {
        const svg = children(element).find(child => hasClass(child, "shape-svg"));
        if (!svg) throw new Error("invalid PdfLapas HTML: a shape has no svg.shape-svg");
        drawBoxPaint(element, style, paint, box);
        drawShapeSvg(svg, paint, box);
    } else if (hasClass(element, "slide-image")) {
        drawImage(element, style, paint, box);
        drawBoxPaint(element, style, paint, box);
    } else if (hasClass(element, "slide-table-container")) {
        drawBoxPaint(element, style, paint, box);
        drawTable(element, paint, box);
    } else report(`<${element.tagName} class="${attribute(element, "class") ?? ""}"> is not a slide object the renderer draws`);
    const href = attribute(element, "href");
    const slide = attribute(element, "data-slide");
    if (href !== undefined && element.tagName === "a") doc.link(box.x, box.y, box.width, box.height, href);
    else if (slide !== undefined && element.tagName === "a") doc.goTo(box.x, box.y, box.width, box.height, `slide-${slide}`);
    doc.restore();
    reportUnread(element, style, ["data-object-name", "data-shape", "data-text-fit", "data-text-fit-step", "data-text-fit-max-steps", "data-text-fit-tolerance", "data-text-direction", "data-slide", "data-image-sizing", "data-line-dash-array", "data-line-begin-arrow", "data-line-end-arrow"], report, BOX_LAYOUT);
}

/** Draws the slide container `slide` on the current page. */
export function drawSlide(slide: Element, context: SlideContext, size: { width: number; height: number }): void {
    const style = readStyle(slide);
    const background = color(take(style, "background-color"));
    take(style, "--slide-text-color"); // every run states its own color; this custom property only feeds the stylesheet
    const paint: Paint = { ...context.paint("slide"), report: context.report, opacity: 1 };
    if (background && background.alpha > 0) {
        fill(paint, background);
        paint.doc.rect(0, 0, size.width, size.height).fill();
    }
    reportUnread(slide, style, ["data-hidden"], context.report);
    children(slide).forEach((element, index) => {
        drawObject(element, context, attribute(element, "data-object-name") ?? `#${index}`);
    });
}
