// Draws an SVG picture (`data:image/svg+xml`) as pdf-core reads one (profile/svg.rs `image`): `g`, `path`, `rect`,
// `circle`, `ellipse`, `line`, `polyline` and `polygon`, with SVG's inherited fill and stroke (colours, opacities,
// width, caps, joins, miter limit, dashes, fill rule), `opacity` and `transform`, sized into the picture box by its
// viewBox and preserveAspectRatio as Chromium sizes an `<img>`. Anything else in the file is reported, not dropped.
import { parseFragment } from "parse5";
import { type Color, color as cssColor, readStyle, type Style, take } from "./css";
import { attribute, children, type Element } from "./dom";
import { opacityGroup } from "./internals";
import { dash, fill, type Paint, stroke } from "./paint";
import { flatten, IDENTITY, record, replay, type Segment } from "./path";
import type { Frame } from "./text/draw";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** Elements that describe the file and draw nothing. */
const INERT_ELEMENTS: ReadonlySet<string> = new Set(["title", "desc", "metadata"]);
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
/** Attributes that never change what is drawn. */
const INERT_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "class", "version", "xmlns", "xmlns:xlink", "baseProfile"]);
const ROOT_ATTRIBUTES: ReadonlySet<string> = new Set(["width", "height", "viewBox", "preserveAspectRatio", "x", "y"]);
/** SVG's inherited paint properties, as attributes or `style` declarations. */
const PAINT_PROPERTIES: ReadonlySet<string> = new Set(["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray"]);
const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
    path: ["d"],
    rect: ["x", "y", "width", "height", "rx", "ry"],
    circle: ["cx", "cy", "r"],
    ellipse: ["cx", "cy", "rx", "ry"],
    line: ["x1", "y1", "x2", "y2"],
    polyline: ["points"],
    polygon: ["points"],
};
const CAPS: ReadonlySet<string> = new Set(["butt", "round", "square"]);
const JOINS: ReadonlySet<string> = new Set(["miter", "round", "bevel"]);
/** SVG's initial `stroke-miterlimit`. */
const SVG_MITER_LIMIT = 4;
const SVG_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i;
const TRANSFORM = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
const ALIGN = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/;
const AXIS: Readonly<Record<string, number>> = { Min: 0, Mid: 0.5, Max: 1 };
const CHANNEL_MAX = 255;
/** Flattening tolerance (user units) for telling a path with area from bare lines. */
const AREA_TOLERANCE = 1;
const RGB_CHANNELS = 3;

/** SVG's inherited properties, as an element's parent resolves them (SVG's initial values at the root). */
interface Inherited {
    readonly fill: Color | undefined;
    readonly fillOpacity: number;
    readonly evenOdd: boolean;
    readonly stroke: Color | undefined;
    readonly strokeWidth: number;
    readonly strokeOpacity: number;
    readonly cap: "butt" | "round" | "square";
    readonly join: "miter" | "round" | "bevel";
    readonly miterLimit: number;
    readonly dashes: readonly number[];
}

const INITIAL: Inherited = { fill: { rgb: [0, 0, 0], alpha: 1 }, fillOpacity: 1, evenOdd: false, stroke: undefined, strokeWidth: 1, strokeOpacity: 1, cap: "butt", join: "miter", miterLimit: SVG_MITER_LIMIT, dashes: [] };

/** PDFKit's colour-name table (the CSS names), which its documents expose; pdfkit is pinned to an exact version. */
interface NamedColors {
    _normalizeColor(value: string): number[] | null;
}

/** The SVG file's text, or why it is not drawn. */
function svgRoot(text: string): Element | string {
    const roots = children(parseFragment(text) as unknown as Element); // `as`: a parse5 fragment has childNodes like an element; only they are read
    const [svg, ...rest] = roots;
    if (!svg || rest.length) return "an SVG image must hold one root <svg> element";
    if (svg.tagName !== "svg") return `an SVG image's root element is <${svg.tagName}>, not <svg>`;
    if (attribute(svg, "xmlns") !== SVG_NAMESPACE) return `an SVG image's <svg> must have xmlns="${SVG_NAMESPACE}" (browsers draw nothing without it)`;
    return svg;
}

function svgNumber(value: string | undefined, fallback: number): number | undefined {
    if (value === undefined) return fallback;
    const trimmed = value.trim();
    return SVG_NUMBER.test(trimmed) ? Number.parseFloat(trimmed) : undefined;
}

function numberList(value: string): number[] | undefined {
    const parts = value
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
    const numbers = parts.map(part => svgNumber(part, 0));
    return numbers.every((number): number is number => number !== undefined) ? numbers : undefined;
}

/** The SVG image's mapping from its user units to the picture box (`x`, `y`, `width`, `height` px). */
function viewport(svg: Element, box: Frame, report: (what: string) => void): [number, number, number, number] | undefined {
    const viewBox = attribute(svg, "viewBox");
    const fitValue = attribute(svg, "preserveAspectRatio");
    let view: number[] | undefined;
    if (viewBox !== undefined) view = numberList(viewBox);
    else {
        // Chromium scales an SVG without a viewBox from its width and height, like a raster picture; without them its user units are px.
        const [w, h] = [attribute(svg, "width"), attribute(svg, "height")];
        if (w === undefined && h === undefined) return [1, 1, box.x, box.y];
        view = [0, 0, svgNumber(w, Number.NaN) ?? Number.NaN, svgNumber(h, Number.NaN) ?? Number.NaN];
        if (fitValue !== undefined) report("preserveAspectRatio on an SVG image without a viewBox is not drawn (it is stretched)");
        return stretch(view, box, report);
    }
    const [, , vw = Number.NaN, vh = Number.NaN] = view ?? [];
    if (!view || view.length !== 4 || !(vw > 0 && vh > 0)) {
        report(`an SVG image's viewBox '${viewBox}' is not four numbers with a positive size; the picture is not drawn`);
        return undefined;
    }
    const [mode, slice] = (fitValue ?? "xMidYMid meet").trim().split(/\s+/);
    if (mode === "none") return stretch(view, box, report);
    const align = ALIGN.exec(mode ?? "");
    if (!align || (slice !== undefined && slice !== "meet" && slice !== "slice")) {
        report(`preserveAspectRatio '${fitValue}' on an SVG image is not drawn; the picture is not drawn`);
        return undefined;
    }
    const scale = (slice === "slice" ? Math.max : Math.min)(box.width / vw, box.height / vh);
    const [ax, ay] = [AXIS[align[1] ?? "Mid"] ?? 0.5, AXIS[align[2] ?? "Mid"] ?? 0.5];
    const [vx = 0, vy = 0] = view;
    return [scale, scale, box.x + (box.width - vw * scale) * ax - vx * scale, box.y + (box.height - vh * scale) * ay - vy * scale];
}

function stretch(view: number[], box: Frame, report: (what: string) => void): [number, number, number, number] | undefined {
    const [vx = 0, vy = 0, vw = Number.NaN, vh = Number.NaN] = view;
    if (!(vw > 0 && vh > 0)) {
        report("an SVG image's size is not two positive numbers; the picture is not drawn");
        return undefined;
    }
    const [sx, sy] = [box.width / vw, box.height / vh];
    return [sx, sy, box.x - vx * sx, box.y - vy * sy];
}

/** The SVG reader for one picture: the document to draw on and where its problems are reported. */
interface Reader {
    readonly paint: Paint;
    readonly report: (what: string) => void;
}

/** A property from the `style` declarations, or else from the attribute of that name. */
function property(element: Element, css: Style, name: string): string | undefined {
    return take(css, name) ?? attribute(element, name);
}

function paintColor(reader: Reader, value: string, name: string): Color | undefined | false {
    if (value === "none") return undefined;
    const parsed = cssColor(value) ?? namedColor(reader.paint.doc, value);
    if (parsed) return parsed;
    reader.report(`${name} '${value}' in an SVG image is not drawn (not a colour the renderer reads)`);
    return false;
}

function namedColor(doc: PDFKit.PDFDocument, value: string): Color | undefined {
    if (!/^[a-z]+$/i.test(value)) return undefined;
    const rgb = (doc as unknown as NamedColors)._normalizeColor(value.toLowerCase()); // `as`: every PDFKit 0.20 document has _normalizeColor
    if (!rgb || rgb.length !== RGB_CHANNELS) return undefined;
    const [r = 0, g = 0, b = 0] = rgb.map(channel => Math.round(channel * CHANNEL_MAX));
    return { rgb: [r, g, b], alpha: value.toLowerCase() === "transparent" ? 0 : 1 };
}

/** The properties `element` passes to its children: its own over its parent's. */
function inherit(reader: Reader, element: Element, css: Style, parent: Inherited): Inherited {
    const read = (name: string) => property(element, css, name);
    const unit = (name: string, value: number) => {
        const parsed = svgNumber(read(name), value);
        if (parsed === undefined) reader.report(`${name} '${read(name) ?? ""}' in an SVG image is not a number; inherited instead`);
        return Math.min(Math.max(parsed ?? value, 0), 1);
    };
    const fillValue = read("fill");
    const strokeValue = read("stroke");
    const fillColor = fillValue === undefined ? parent.fill : paintColor(reader, fillValue, "fill");
    const strokeColor = strokeValue === undefined ? parent.stroke : paintColor(reader, strokeValue, "stroke");
    const keyword = <T extends string>(name: string, allowed: ReadonlySet<string>, inherited: T): T => {
        const value = read(name);
        if (value === undefined) return inherited;
        if (allowed.has(value)) return value as T; // `as`: checked against the allowed keywords of T
        reader.report(`${name} '${value}' in an SVG image is not drawn`);
        return inherited;
    };
    const dashValue = read("stroke-dasharray");
    const dashes = dashValue === undefined ? parent.dashes : dashValue === "none" ? [] : numberList(dashValue);
    if (!dashes) reader.report(`stroke-dasharray '${dashValue ?? ""}' in an SVG image is not drawn`);
    const width = svgNumber(read("stroke-width"), parent.strokeWidth);
    const miter = svgNumber(read("stroke-miterlimit"), parent.miterLimit);
    if (width === undefined || miter === undefined) reader.report("a stroke-width or stroke-miterlimit in an SVG image is not a number; inherited instead");
    const rule = read("fill-rule");
    if (rule !== undefined && rule !== "nonzero" && rule !== "evenodd") reader.report(`fill-rule '${rule}' in an SVG image is not drawn`);
    return {
        fill: fillColor === false ? parent.fill : fillColor,
        fillOpacity: unit("fill-opacity", parent.fillOpacity),
        evenOdd: rule === undefined ? parent.evenOdd : rule === "evenodd",
        stroke: strokeColor === false ? parent.stroke : strokeColor,
        strokeWidth: Math.max(width ?? parent.strokeWidth, 0),
        strokeOpacity: unit("stroke-opacity", parent.strokeOpacity),
        cap: keyword("stroke-linecap", CAPS, parent.cap),
        join: keyword("stroke-linejoin", JOINS, parent.join),
        miterLimit: miter ?? parent.miterLimit,
        dashes: dashes ?? parent.dashes,
    };
}

/** Reports the attributes and `style` declarations of `element` outside `allowed`; `css` keeps only those left. */
function reportOthers(reader: Reader, element: Element, css: Style, allowed: readonly ReadonlySet<string>[]): void {
    const known = (name: string) => allowed.some(set => set.has(name));
    for (const { name } of element.attrs) {
        if (name !== "style" && !INERT_ATTRIBUTES.has(name) && !name.startsWith("xmlns:") && !known(name)) reader.report(`attribute '${name}' on <${element.tagName}> in an SVG image is not drawn`);
    }
    for (const [name, value] of css) if (!known(name)) reader.report(`CSS property '${name}: ${value}' on <${element.tagName}> in an SVG image is not drawn`);
}

/** Applies `transform` (SVG's transform list) to the document, reporting the parts the renderer does not read. */
function applyTransform(reader: Reader, value: string | undefined): void {
    if (value === undefined) return;
    const doc = reader.paint.doc;
    let consumed = "";
    for (const [whole, name, args] of value.matchAll(TRANSFORM)) {
        consumed += whole;
        const n = numberList(args ?? "") ?? [];
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = n;
        if (name === "matrix" && n.length === 6) doc.transform(a, b, c, d, e, f);
        else if (name === "translate" && (n.length === 1 || n.length === 2)) doc.translate(a, b);
        else if (name === "scale" && (n.length === 1 || n.length === 2)) doc.transform(a, 0, 0, n.length === 2 ? b : a, 0, 0);
        else if (name === "rotate" && (n.length === 1 || n.length === 3)) {
            const angle = (a * Math.PI) / 180;
            const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
            doc.translate(b, c).transform(cos, sin, -sin, cos, 0, 0).translate(-b, -c);
        } else if (name === "skewX" && n.length === 1) doc.transform(1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0);
        else if (name === "skewY" && n.length === 1) doc.transform(1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0);
        else reader.report(`transform '${whole}' in an SVG image is not drawn`);
    }
    if (consumed.replace(/[\s,]/g, "") !== value.replace(/[\s,]/g, "")) reader.report(`transform '${value}' in an SVG image is not entirely read`);
}

/** The path `element` (a basic shape) traces; undefined when its geometry is broken (reported). */
function geometry(reader: Reader, element: Element): ((pen: PDFKit.PDFDocument) => void) | undefined {
    const value = (name: string) => svgNumber(attribute(element, name), 0);
    const numbers = GEOMETRY[element.tagName]?.filter(name => name !== "d" && name !== "points").map(value) ?? [];
    if (numbers.some(number => number === undefined)) {
        reader.report(`<${element.tagName}> in an SVG image has a geometry attribute that is not a number; not drawn`);
        return undefined;
    }
    const [n0 = 0, n1 = 0, n2 = 0, n3 = 0] = numbers as number[]; // `as`: every entry was checked above
    if (element.tagName === "path") {
        const d = attribute(element, "d");
        if (d === undefined) return undefined;
        // Replayed, so quadratics are drawn as the curves they are (see `record`).
        const segments = record(reader.paint.doc, pen => pen.path(d));
        return pen => replay(pen, segments);
    }
    if (element.tagName === "rect") {
        // SVG: a missing rx or ry takes the other; both are capped at half the side.
        const [rxValue, ryValue] = [attribute(element, "rx"), attribute(element, "ry")];
        const rx = Math.min(svgNumber(rxValue ?? ryValue, 0) ?? 0, n2 / 2);
        const ry = Math.min(svgNumber(ryValue ?? rxValue, 0) ?? 0, n3 / 2);
        if (!(n2 > 0 && n3 > 0)) return undefined;
        if (rx !== ry) reader.report("a <rect> with unequal rx and ry in an SVG image is drawn with rx");
        return pen => (rx > 0 ? pen.roundedRect(n0, n1, n2, n3, rx) : pen.rect(n0, n1, n2, n3));
    }
    if (element.tagName === "circle") return n2 > 0 ? pen => pen.circle(n0, n1, n2) : undefined;
    if (element.tagName === "ellipse") return n2 > 0 && n3 > 0 ? pen => pen.ellipse(n0, n1, n2, n3) : undefined;
    if (element.tagName === "line") return pen => pen.moveTo(n0, n1).lineTo(n2, n3);
    const points = numberList(attribute(element, "points") ?? "");
    if (!points || points.length % 2) {
        reader.report(`<${element.tagName}> points in an SVG image are not pairs of numbers; not drawn`);
        return undefined;
    }
    return pen => {
        for (let index = 0; index + 1 < points.length; index += 2) {
            const [x = 0, y = 0] = [points[index], points[index + 1]];
            if (index === 0) pen.moveTo(x, y);
            else pen.lineTo(x, y);
        }
        if (element.tagName === "polygon") pen.closePath();
    };
}

/** Whether any closed outline of `segments` encloses area (shoelace sum of its flattened subpaths). */
function hasArea(segments: readonly Segment[]): boolean {
    return flatten(segments, IDENTITY, AREA_TOLERANCE).some(
        ({ points }) =>
            Math.abs(
                points.reduce((sum, [x, y], index) => {
                    const [nx, ny] = points[(index + 1) % points.length] ?? [x, y];
                    return sum + x * ny - nx * y;
                }, 0),
            ) > 0,
    );
}

/** An element's `opacity`, which fades it and its content as one group. */
function opacityOf(element: Element, css: Style): number {
    return Math.min(Math.max(svgNumber(property(element, css, "opacity"), 1) ?? 1, 0), 1);
}

function drawShape(reader: Reader, element: Element, parent: Inherited): void {
    const css = readStyle(element);
    const own = inherit(reader, element, css, parent);
    const opacity = opacityOf(element, css);
    reportOthers(reader, element, css, [new Set(GEOMETRY[element.tagName]), new Set(["transform", "opacity"]), PAINT_PROPERTIES]);
    if (children(element).length) reader.report(`content inside <${element.tagName}> in an SVG image is not drawn`);
    const fillColor = element.tagName === "line" || !own.fill ? undefined : { ...own.fill, alpha: own.fill.alpha * own.fillOpacity };
    const strokeColor = own.stroke && own.strokeWidth > 0 ? { ...own.stroke, alpha: own.stroke.alpha * own.strokeOpacity } : undefined;
    const trace = geometry(reader, element);
    if (!trace) return;
    const doc = reader.paint.doc;
    const stroked = !!strokeColor && strokeColor.alpha > 0;
    // A path without area (open lines, filled black by default) fills nothing.
    const filled = !!fillColor && fillColor.alpha > 0 && hasArea(record(doc, trace));
    if (!filled && !stroked) return;
    opacityGroup(doc, opacity, () => {
        doc.save();
        applyTransform(reader, attribute(element, "transform"));
        let visible = stroked;
        if (strokeColor && stroked) {
            stroke(reader.paint, strokeColor, own.strokeWidth);
            doc.lineCap(own.cap).lineJoin(own.join).miterLimit(own.miterLimit);
            visible = dash(doc, own.dashes);
        }
        if (fillColor && filled) fill(reader.paint, fillColor);
        const rule = own.evenOdd ? "even-odd" : "non-zero";
        if (filled || visible) {
            trace(doc);
            if (filled && visible) doc.fillAndStroke(rule);
            else if (filled) doc.fill(rule);
            else doc.stroke();
        }
        doc.restore();
    });
}

function drawChildren(reader: Reader, parent: Element, inherited: Inherited): void {
    const doc = reader.paint.doc;
    for (const child of children(parent)) {
        if (INERT_ELEMENTS.has(child.tagName)) continue;
        if (SHAPES.has(child.tagName)) drawShape(reader, child, inherited);
        else if (child.tagName === "g") {
            const css = readStyle(child);
            const own = inherit(reader, child, css, inherited);
            const opacity = opacityOf(child, css);
            reportOthers(reader, child, css, [new Set(["transform", "opacity"]), PAINT_PROPERTIES]);
            opacityGroup(doc, opacity, () => {
                doc.save();
                applyTransform(reader, attribute(child, "transform"));
                drawChildren(reader, child, own);
                doc.restore();
            });
        } else reader.report(`<${child.tagName}> in an SVG image is not drawn`);
    }
}

/** Draws the SVG file `text` into `box` (px) with `paint`; problems name the picture through `paint.report`. */
export function drawSvgImage(text: string, paint: Paint, box: Frame): void {
    const report = (what: string) => paint.report(what);
    const svg = svgRoot(text);
    if (typeof svg === "string") {
        report(`${svg}; the picture is not drawn`);
        return;
    }
    const reader: Reader = { paint, report };
    const css = readStyle(svg);
    const inherited = inherit(reader, svg, css, INITIAL);
    reportOthers(reader, svg, css, [ROOT_ATTRIBUTES, PAINT_PROPERTIES]);
    const map = viewport(svg, box, report);
    if (!map) return;
    const [sx, sy, tx, ty] = map;
    const doc = paint.doc;
    doc.save();
    doc.transform(sx, 0, 0, sy, tx, ty);
    drawChildren(reader, svg, inherited);
    doc.restore();
}
