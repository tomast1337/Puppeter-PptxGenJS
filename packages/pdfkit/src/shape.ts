// Draws a shape's `svg.shape-svg` (docs/HTML_PROFILE.md "Shape"): its `rect`, `ellipse` or `path` geometry, or the
// faces and outline of a multi-face preset, with fill, stroke and dashes. Arrow heads and shadows are reported.
import { type Color, color } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import { dash, fill, type Paint, stroke } from "./paint";
import type { Frame } from "./text/draw";
import { reportUnread } from "./text/read";

/** SVG's initial `stroke-miterlimit` (PDF's is 10). */
const SVG_MITER_LIMIT = 4;
/** Below this the two viewBox scales count as equal, and the stroke width maps exactly. */
const UNIFORM_EPSILON = 1e-6;
/** Attributes of a geometry element that state no paint of their own (paths, sizes, classes). */
const GEOMETRY_ATTRIBUTES: ReadonlySet<string> = new Set(["class", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "d", "fill", "stroke", "stroke-width", "stroke-dasharray", "vector-effect", "data-fill-modifier", "marker-start", "marker-end"]);

function numberAttribute(element: Element, name: string): number {
    const value = Number(attribute(element, name) ?? Number.NaN);
    if (!Number.isFinite(value)) throw new Error(`invalid PdfLapas HTML: <${element.tagName}> attribute '${name}' is missing or not a number`);
    return value;
}

function paintOf(element: Element, name: "fill" | "stroke", paint: Paint): Color | undefined {
    const value = attribute(element, name);
    if (value === undefined || value === "none") return undefined;
    const parsed = color(value);
    if (!parsed) paint.report(`${name} '${value}' on <${element.tagName}> is not drawn`);
    return parsed && parsed.alpha > 0 ? parsed : undefined;
}

/** Fills and strokes the path `trace` built, in viewBox units scaled by `scale` (stroke widths are screen px). */
function paintGeometry(element: Element, paint: Paint, scale: number, trace: () => void): void {
    const doc = paint.doc;
    for (const { name } of element.attrs) if (!GEOMETRY_ATTRIBUTES.has(name)) paint.report(`attribute '${name}' on <${element.tagName}> is not drawn`);
    const fillColor = paintOf(element, "fill", paint);
    const strokeColor = paintOf(element, "stroke", paint);
    const width = Number(attribute(element, "stroke-width") ?? 1);
    const dashes = (attribute(element, "stroke-dasharray") ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    doc.save();
    let stroked = strokeColor !== undefined && width > 0;
    if (strokeColor && stroked) {
        stroke(paint, strokeColor, width / scale);
        doc.miterLimit(SVG_MITER_LIMIT);
        stroked = dash(
            doc,
            dashes.map(length => length / scale),
        );
    }
    if (fillColor) fill(paint, fillColor);
    if (!fillColor && !stroked) {
        doc.restore();
        return;
    }
    trace();
    if (fillColor && stroked) doc.fillAndStroke();
    else if (fillColor) doc.fill();
    else doc.stroke();
    doc.restore();
}

function drawGeometry(element: Element, paint: Paint, scale: number): void {
    const doc = paint.doc;
    if (attribute(element, "transform") !== undefined) paint.report(`a transformed <${element.tagName}> geometry is not drawn`);
    else if (element.tagName === "rect") {
        const [x, y, width, height] = ["x", "y", "width", "height"].map(name => numberAttribute(element, name)) as [number, number, number, number]; // `as`: four names map to four numbers
        const [rx, ry] = [Number(attribute(element, "rx") ?? 0), Number(attribute(element, "ry") ?? 0)];
        if (rx !== ry) paint.report("a rectangle with unequal corner radii is drawn with the horizontal one");
        paintGeometry(element, paint, scale, () => (rx > 0 ? doc.roundedRect(x, y, width, height, rx) : doc.rect(x, y, width, height)));
    } else if (element.tagName === "ellipse") {
        const [cx, cy, rx, ry] = ["cx", "cy", "rx", "ry"].map(name => numberAttribute(element, name)) as [number, number, number, number]; // `as`: four names map to four numbers
        paintGeometry(element, paint, scale, () => doc.ellipse(cx, cy, rx, ry));
    } else if (element.tagName === "path") {
        const d = attribute(element, "d");
        if (d === undefined) throw new Error("invalid PdfLapas HTML: a shape <path> has no 'd'");
        paintGeometry(element, paint, scale, () => doc.path(d));
    } else if (element.tagName === "g") {
        // A multi-face preset: every face fills (its fill already shaded, #43), then the outline strokes.
        for (const part of children(element)) {
            if (part.tagName === "path" && (hasClass(part, "shape-face") || hasClass(part, "shape-outline"))) drawGeometry(part, paint, scale);
            else paint.report(`<${part.tagName}> in a shape group is not drawn`);
        }
    } else paint.report(`shape geometry <${element.tagName}> is not drawn`);
}

/** Draws `svg` (an `svg.shape-svg`) stretched over `frame`, as `preserveAspectRatio="none"` maps its viewBox. */
export function drawShapeSvg(svg: Element, paint: Paint, frame: Frame): void {
    const viewBox = (attribute(svg, "viewbox") ?? attribute(svg, "viewBox") ?? "").split(/[\s,]+/).map(Number);
    const [, , boxWidth = Number.NaN, boxHeight = Number.NaN] = viewBox;
    if (!(boxWidth > 0 && boxHeight > 0)) throw new Error("invalid PdfLapas HTML: svg.shape-svg has no positive viewBox size");
    // A zero-length side's coordinates are all 0 (a straight line), so any scale maps them; take the other side's.
    const sx = frame.width / boxWidth;
    const sy = frame.height / boxHeight;
    const [scaleX, scaleY] = [sx || sy || 1, sy || sx || 1];
    const uniform = Math.abs(scaleX - scaleY) < UNIFORM_EPSILON;
    if (!uniform) paint.report("a shape stretched off its viewBox's aspect ratio is drawn with an averaged stroke width");
    for (const [name, value] of [
        ["data-line-begin-arrow", attribute(svg, "data-line-begin-arrow")],
        ["data-line-end-arrow", attribute(svg, "data-line-end-arrow")],
    ] as const) {
        if (value !== undefined && value !== "none") paint.report(`line heads (${name.slice("data-line-".length)} '${value}') are not drawn`);
    }
    const style = attribute(svg, "style") ?? "";
    if (style.includes("drop-shadow")) paint.report("shape shadows are not drawn");
    if (attribute(svg, "data-shadow-inset") !== undefined) paint.report("inner shape shadows are not drawn");
    const doc = paint.doc;
    doc.save();
    doc.translate(frame.x, frame.y).scale(scaleX, scaleY);
    for (const child of children(svg)) {
        if (child.tagName === "defs") continue; // only the arrow-head markers, reported above
        if (hasClass(child, "shape-geometry")) drawGeometry(child, paint, Math.sqrt(scaleX * scaleY));
        else paint.report(`<${child.tagName}> in a shape is not drawn`);
    }
    doc.restore();
    reportUnread(svg, new Map(), ["data-line-begin-arrow", "data-line-end-arrow", "data-shape-width", "data-shape-height", "data-shadow-inset"], paint.report);
}
