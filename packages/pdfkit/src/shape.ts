// Draws a shape's `svg.shape-svg` (docs/HTML_PROFILE.md "Shape"): its `rect`, `ellipse` or `path` geometry, or the
// faces and outline of a multi-face preset, with fill, stroke, dashes and line heads (the arrow-head markers), as
// pdf-core's shape.rs. The shadow on the svg is the object's: slide.ts draws it.
import { type Color, color } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import { captureFill, captureStroke, dash, fill, type Paint, stroke } from "./paint";
import { pathEnds, type Point, record, replay } from "./path";
import type { Frame } from "./text/draw";
import { reportUnread } from "./text/read";

/** SVG's initial `stroke-miterlimit` (PDF's is 10). */
const SVG_MITER_LIMIT = 4;
/** Below this the two viewBox scales count as equal, and the stroke width maps exactly. */
const UNIFORM_EPSILON = 1e-6;
/** Attributes of a geometry element that state no paint of their own (paths, sizes, classes). */
const GEOMETRY_ATTRIBUTES: ReadonlySet<string> = new Set(["class", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "d", "fill", "stroke", "stroke-width", "stroke-dasharray", "vector-effect", "data-fill-modifier", "marker-start", "marker-end"]);
const MARKER_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "markerunits", "markerUnits", "orient", "overflow"]);
const MARKER_URL = /^url\(#(.+)\)$/;

/** The svg's viewBox scale onto the object box, and its arrow-head paths by marker id. */
type ShapeSpace = {
    readonly scaleX: number;
    readonly scaleY: number;
    readonly heads: ReadonlyMap<string, string>;
};

function numberAttribute(element: Element, name: string): number {
    const value = Number(attribute(element, name) ?? Number.NaN);

    if (!Number.isFinite(value)) {
        throw new Error(`invalid PdfLapas HTML: <${element.tagName}> attribute '${name}' is missing or not a number`);
    }

    return value;
}

/** The element's fill or stroke: a visible colour, none, one fully transparent, or a value the renderer does not read (reported). */
type PaintOf = { readonly kind: "color"; readonly color: Color } | { readonly kind: "none" } | { readonly kind: "transparent" } | { readonly kind: "invalid"; readonly value: string };

function paintOf(element: Element, name: "fill" | "stroke", paint: Paint): PaintOf {
    const value = attribute(element, name);

    if (value === undefined || value === "none") {
        return { kind: "none" };
    }

    const parsed = color(value);

    if (!parsed) {
        paint.report(`${name} '${value}' on <${element.tagName}> is not drawn`);

        return { kind: "invalid", value };
    }

    return parsed.alpha > 0 ? { kind: "color", color: parsed } : { kind: "transparent" };
}

/** Fills and strokes the path `trace` builds, in viewBox units scaled by `scale` (stroke widths are screen px). */
function paintGeometry(element: Element, paint: Paint, space: ShapeSpace, trace: (pen: PDFKit.PDFDocument) => void): void {
    const doc = paint.doc;
    const scale = Math.sqrt(space.scaleX * space.scaleY);

    for (const { name } of element.attrs) {
        if (!GEOMETRY_ATTRIBUTES.has(name)) {
            paint.report(`attribute '${name}' on <${element.tagName}> is not drawn`);
        }
    }

    const fillPaint = paintOf(element, "fill", paint);
    const strokePaint = paintOf(element, "stroke", paint);
    const fillColor = fillPaint.kind === "color" ? fillPaint.color : undefined;
    const strokeColor = strokePaint.kind === "color" ? strokePaint.color : undefined;
    const width = Number(attribute(element, "stroke-width") ?? 1);
    const dashes: number[] = [];

    for (const part of (attribute(element, "stroke-dasharray") ?? "").split(/[\s,]+/)) {
        if (part) {
            dashes.push(Number(part) / scale);
        }
    }

    doc.save();
    let stroked = strokeColor !== undefined && width > 0;

    if (strokeColor && stroked) {
        stroke(paint, strokeColor, width / scale);
        doc.miterLimit(SVG_MITER_LIMIT);
        stroked = dash(doc, dashes);
    }

    if (fillColor) {
        fill(paint, fillColor);
    }

    if (fillColor || stroked) {
        trace(doc);
        if (fillColor && stroked) {
            doc.fillAndStroke();
        } else if (fillColor) {
            doc.fill();
        } else {
            doc.stroke();
        }

        if (fillColor) {
            captureFill(paint, fillColor.alpha, trace);
        }

        if (strokeColor && stroked) {
            captureStroke(paint, strokeColor.alpha, { width: width / scale, cap: "butt", join: "miter", miterLimit: SVG_MITER_LIMIT, dashes }, trace);
        }
    }

    doc.restore();
    // SVG draws markers on paths only; the head is the line's, so it is drawn with a visible stroke.
    const marked = attribute(element, "marker-start") !== undefined || attribute(element, "marker-end") !== undefined;

    // Fills each line head the element's `marker-start`/`marker-end` names at the ends of its path (viewBox units), in
    // the stroke's color: the head path in box px, turned to the path's direction there (pdf-core's `stroke_with_arrows`).
    if (marked && strokeColor && width > 0) {
        const ends = pathEnds(record(doc, trace));

        for (const [name, at] of [
            ["marker-start", ends && { point: ends.start, toward: ends.startDirection }],
            ["marker-end", ends && { point: ends.end, toward: ends.endDirection }],
        ] as const) {
            const reference = attribute(element, name);

            if (reference === undefined || !at) {
                continue;
            }

            const id = MARKER_URL.exec(reference)?.[1];
            const head = id === undefined ? undefined : space.heads.get(id);

            if (head === undefined) {
                paint.report(`${name} '${reference}' names no marker; its line head is not drawn`);
                continue;
            }

            const map = ([x, y]: Point): Point => [x * space.scaleX, y * space.scaleY];
            const [x, y] = map(at.point);
            const [dx, dy] = map(at.toward);
            const angle = Math.atan2(dy, dx);
            const [cos, sin] = [Math.cos(angle), Math.sin(angle)];

            doc.save();
            // Out of the viewBox scale, back to box px: the head is not stretched with the shape.
            doc.scale(1 / space.scaleX, 1 / space.scaleY).transform(cos, sin, -sin, cos, x, y);
            fill(paint, strokeColor);
            const segments = record(doc, pen => pen.path(head));

            replay(doc, segments);
            doc.fill();
            captureFill(paint, strokeColor.alpha, pen => replay(pen, segments));
            doc.restore();
        }
    }
}

function drawGeometry(element: Element, paint: Paint, space: ShapeSpace): void {
    if (attribute(element, "transform") !== undefined) {
        paint.report(`a transformed <${element.tagName}> geometry is not drawn`);
    } else if (element.tagName === "rect") {
        const [x, y, width, height] = ["x", "y", "width", "height"].map(name => numberAttribute(element, name)) as [number, number, number, number]; // `as`: four names map to four numbers
        const [rx, ry] = [Number(attribute(element, "rx") ?? 0), Number(attribute(element, "ry") ?? 0)];

        if (rx !== ry) {
            paint.report("a rectangle with unequal corner radii is drawn with the horizontal one");
        }

        paintGeometry(element, paint, space, pen => (rx > 0 ? pen.roundedRect(x, y, width, height, rx) : pen.rect(x, y, width, height)));
    } else if (element.tagName === "ellipse") {
        const [cx, cy, rx, ry] = ["cx", "cy", "rx", "ry"].map(name => numberAttribute(element, name)) as [number, number, number, number]; // `as`: four names map to four numbers

        paintGeometry(element, paint, space, pen => pen.ellipse(cx, cy, rx, ry));
    } else if (element.tagName === "path") {
        const d = attribute(element, "d");

        if (d === undefined) {
            throw new Error("invalid PdfLapas HTML: a shape <path> has no 'd'");
        }

        // Parsed once: the drawing, the silhouette and the line heads replay the same segments.
        const segments = record(paint.doc, pen => pen.path(d));

        paintGeometry(element, paint, space, pen => replay(pen, segments));
    } else if (element.tagName === "g") {
        // A multi-face preset: every face fills (its fill already shaded, #43), then the outline strokes.
        for (const part of children(element)) {
            if (part.tagName === "path" && (hasClass(part, "shape-face") || hasClass(part, "shape-outline"))) {
                drawGeometry(part, paint, space);
            } else {
                paint.report(`<${part.tagName}> in a shape group is not drawn`);
            }
        }
    } else {
        paint.report(`shape geometry <${element.tagName}> is not drawn`);
    }
}

/** Draws `svg` (an `svg.shape-svg`) stretched over `frame`, as `preserveAspectRatio="none"` maps its viewBox. */
export function drawShapeSvg(svg: Element, paint: Paint, frame: Frame): void {
    const viewBox = (attribute(svg, "viewbox") ?? attribute(svg, "viewBox") ?? "").split(/[\s,]+/).map(Number);
    const [, , boxWidth = Number.NaN, boxHeight = Number.NaN] = viewBox;

    if (!(boxWidth > 0 && boxHeight > 0)) {
        throw new Error("invalid PdfLapas HTML: svg.shape-svg has no positive viewBox size");
    }

    // A zero-length side's coordinates are all 0 (a straight line), so any scale maps them; take the other side's.
    const sx = frame.width / boxWidth;
    const sy = frame.height / boxHeight;
    const [scaleX, scaleY] = [sx || sy || 1, sy || sx || 1];
    const uniform = Math.abs(scaleX - scaleY) < UNIFORM_EPSILON;

    if (!uniform) {
        paint.report("a shape stretched off its viewBox's aspect ratio is drawn with an averaged stroke width");
    }

    // The arrow-head markers of `<defs>`: each `<marker>` holds one `<path>`, its head outline in px about the line's end.
    const heads = new Map<string, string>();

    for (const defs of children(svg).filter(child => child.tagName === "defs")) {
        for (const marker of children(defs)) {
            const [head, ...rest] = children(marker);
            const id = attribute(marker, "id");
            const d = head && attribute(head, "d");

            if (marker.tagName !== "marker" || head?.tagName !== "path" || rest.length || id === undefined || d === undefined) {
                paint.report(`<${marker.tagName}> in a shape's <defs> is not drawn (expected <marker id><path d></marker>)`);
                continue;
            }

            for (const { name } of marker.attrs) {
                if (!MARKER_ATTRIBUTES.has(name)) {
                    paint.report(`attribute '${name}' on <marker> is not drawn`);
                }
            }

            heads.set(id, d);
        }
    }

    const space: ShapeSpace = { scaleX, scaleY, heads };
    const doc = paint.doc;

    doc.save();
    doc.translate(frame.x, frame.y).scale(scaleX, scaleY);
    for (const child of children(svg)) {
        if (child.tagName === "defs") {
            continue;
        } // the arrow-head markers, read above

        if (hasClass(child, "shape-geometry")) {
            drawGeometry(child, paint, space);
        } else {
            paint.report(`<${child.tagName}> in a shape is not drawn`);
        }
    }

    doc.restore();
    // The arrow types only name the heads the markers draw; the shadow attributes are read with the object's shadow.
    reportUnread(svg, new Map(), ["data-line-begin-arrow", "data-line-end-arrow", "data-shape-width", "data-shape-height", "data-shadow-inset"], paint.report);
}
