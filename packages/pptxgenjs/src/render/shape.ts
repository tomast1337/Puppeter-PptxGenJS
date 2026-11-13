import type { NormalizedObjectStyle, NormalizedShape } from "@pdfdeck/model";
import { applyGeometry, applyTransform } from "./style";

const SVG_NS = "http://www.w3.org/2000/svg";

function modifyColor(color: string, modifier: "darken" | "darkenLess" | "lighten" | "lightenLess"): string {
    const transform = (value: number) => (modifier === "lighten" ? Math.floor(value + (255 - value) * 0.6) : modifier === "lightenLess" ? Math.floor(value + (255 - value) * 0.2) : Math.floor(value * (modifier === "darken" ? 0.6 : 0.8)));
    const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    if (hex) {
        const channel = (value: string) => transform(parseInt(value, 16)).toString(16).padStart(2, "0");
        return `#${hex.slice(1, 4).map(channel).join("")}`;
    }
    const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!rgb) return color;
    const channels = [rgb[1], rgb[2], rgb[3]].map(value => transform(Number(value)));
    return rgb[4] === undefined ? `rgb(${channels.join(", ")})` : `rgba(${channels.join(", ")}, ${rgb[4]})`;
}

/**
 * A marker that fills the model's head outline: drawn in user space, its origin on the line end and +x along
 * the path. Its id spells out the outline and color, because object names repeat across slides and url(#id)
 * resolves to the first match in the document; equal ids then always mean equal markers. Returns the url.
 */
function addMarker(document: Document, defs: SVGDefsElement, path: string, color: string): string {
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.id = `line-head-${`${color}_${path}`.replace(/\./g, "p").replace(/-/g, "m").replace(/\W/g, "_")}`;
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.setAttribute("overflow", "visible");
    const head = document.createElementNS(SVG_NS, "path");
    head.setAttribute("d", path);
    head.setAttribute("fill", color);
    marker.appendChild(head);
    defs.appendChild(marker);
    return `url(#${marker.id})`;
}

function geometryElement(document: Document, shape: NormalizedShape): SVGElement {
    const geometry = shape.geometry;
    if (geometry.kind === "rect") {
        const element = document.createElementNS(SVG_NS, "rect");
        element.setAttribute("x", "0");
        element.setAttribute("y", "0");
        element.setAttribute("width", String(shape.width));
        element.setAttribute("height", String(shape.height));
        element.setAttribute("rx", String(geometry.radius));
        element.setAttribute("ry", String(geometry.radius));
        return element;
    }
    if (geometry.kind === "ellipse") {
        const element = document.createElementNS(SVG_NS, "ellipse");
        element.setAttribute("cx", String(shape.width / 2));
        element.setAttribute("cy", String(shape.height / 2));
        element.setAttribute("rx", String(shape.width / 2));
        element.setAttribute("ry", String(shape.height / 2));
        return element;
    }
    if (geometry.kind === "path" && geometry.faces?.length) {
        const group = document.createElementNS(SVG_NS, "g");
        if (geometry.transform) group.setAttribute("transform", geometry.transform);
        for (const face of geometry.faces) {
            const path = document.createElementNS(SVG_NS, "path");
            path.classList.add("shape-face");
            path.setAttribute("d", face.data);
            if (face.fillModifier) path.dataset.fillModifier = face.fillModifier;
            path.setAttribute("stroke", "none");
            group.appendChild(path);
        }
        if (geometry.outlineData) {
            const outline = document.createElementNS(SVG_NS, "path");
            outline.classList.add("shape-outline");
            outline.setAttribute("d", geometry.outlineData);
            outline.setAttribute("fill", "none");
            group.appendChild(outline);
        }
        return group;
    }
    const element = document.createElementNS(SVG_NS, "path");
    if (geometry.kind === "line") {
        element.setAttribute("d", geometry.inverse ? `M 0 ${shape.height} L ${shape.width} 0` : `M 0 0 L ${shape.width} ${shape.height}`);
    } else {
        element.setAttribute("d", geometry.data);
        if (geometry.transform) element.setAttribute("transform", geometry.transform);
    }
    return element;
}

/**
 * Chromium paints an SVG root from a whole CSS px: in print it rounds the object's offset on its page
 * half up (-10.5 -> -10) and moves the drawing by the difference, in page space even under the object's
 * rotation or flip. Measured from the PDF matrices (issue #42), also on later A4 pages, whose 793.92px
 * height puts them at fractional document offsets. This returns the translate, in the SVG's own
 * pre-transform space, that puts the drawing back on the exact offset. slide.ts applies it under
 * `@media print` only, because on screen the snap step is 1 / devicePixelRatio.
 */
export function printSnapOffset({ geometry, transform }: Pick<NormalizedObjectStyle, "geometry" | "transform">): string | undefined {
    // 1e-4 px is far below Chromium's 1/64 px layout unit; it drops float noise from inch conversions.
    const fraction = (value: number) => Math.round((value - Math.round(value)) * 1e4) / 1e4;
    const dx = fraction(geometry.x);
    const dy = fraction(geometry.y);
    if (!dx && !dy) return undefined;
    // Undo the object's `rotate() scaleX() scaleY()` (applyTransform) on the page-space offset.
    const angle = (transform.rotation * Math.PI) / 180;
    const local = (value: number) => Number(value.toFixed(4)) || 0;
    const x = local((dx * Math.cos(angle) + dy * Math.sin(angle)) * (transform.flipH ? -1 : 1));
    const y = local((dy * Math.cos(angle) - dx * Math.sin(angle)) * (transform.flipV ? -1 : 1));
    return `translate(${x}px, ${y}px)`;
}

export function renderShapeSvg(document: Document, shape: NormalizedShape, style: NormalizedObjectStyle): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("shape-svg");
    // A near-zero viewBox height gives horizontal lines an extreme vertical
    // transform. Chromium still paints their non-scaling stroke, but drops
    // its SVG markers. The unit-high box keeps the line on its top edge, at the object's y.
    svg.setAttribute("viewBox", `0 0 ${Math.max(shape.width, 0.001)} ${shape.height || 1}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", shape.height === 0 ? "1" : "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.overflow = "visible";
    const snapOffset = printSnapOffset(style);
    if (snapOffset) svg.style.setProperty("--print-snap-offset", snapOffset);
    if (style.shadow?.visible) {
        svg.style.filter = `drop-shadow(${style.shadow.offsetX}px ${style.shadow.offsetY}px ${style.shadow.blur}px ${style.shadow.color})`;
    }
    const defs = document.createElementNS(SVG_NS, "defs");
    const geometry = geometryElement(document, shape);
    geometry.classList.add("shape-geometry");
    const multiFace = shape.geometry.kind === "path" && Boolean(shape.geometry.faces?.length);
    const baseFill = shape.geometry.kind === "line" || !style.fill?.visible ? "none" : style.fill.color;
    const strokeTarget = multiFace ? (geometry.querySelector<SVGPathElement>(".shape-outline") ?? geometry) : geometry;
    if (multiFace) {
        geometry.querySelectorAll<SVGPathElement>(".shape-face").forEach(face => {
            const modifier = face.dataset.fillModifier as "darken" | "darkenLess" | "lighten" | "lightenLess" | undefined;
            face.setAttribute("fill", modifier ? modifyColor(baseFill, modifier) : baseFill);
        });
    } else geometry.setAttribute("fill", baseFill);
    strokeTarget.setAttribute("stroke", style.line?.visible ? style.line.color : "none");
    strokeTarget.setAttribute("stroke-width", String(style.line?.visible ? style.line.width : 0));
    strokeTarget.setAttribute("vector-effect", "non-scaling-stroke");
    if (style.line?.dashArray) {
        const [first, gap, ...rest] = style.line.dashArray.split(" ").map(Number);
        // Chromium's PDF keeps a zero-length dash, which poppler paints as a hairline in every gap: draw a
        // pattern that starts with a gap (startDashAt) as the same pattern shifted by stroke-dashoffset.
        if (first === 0 && rest.length > 0) {
            rest[rest.length - 1]! += gap!;
            strokeTarget.setAttribute("stroke-dasharray", rest.join(" "));
            strokeTarget.setAttribute("stroke-dashoffset", String(rest.reduce((sum, part) => sum + part, 0) - gap!));
        } else strokeTarget.setAttribute("stroke-dasharray", style.line.dashArray);
    }
    if (style.line?.visible) {
        if (style.line.beginHeadPath) strokeTarget.setAttribute("marker-start", addMarker(document, defs, style.line.beginHeadPath, style.line.color));
        if (style.line.endHeadPath) strokeTarget.setAttribute("marker-end", addMarker(document, defs, style.line.endHeadPath, style.line.color));
    }
    svg.append(defs, geometry);
    return svg;
}

export function renderShape(document: Document, shape: NormalizedShape, style: NormalizedObjectStyle): HTMLElement {
    const outer = shape.link ? document.createElement("a") : document.createElement("div");
    outer.className = "slide-element slide-shape";
    applyGeometry(outer, style.geometry);
    applyTransform(outer, style.transform);
    outer.dataset.objectName = style.objectName;
    outer.dataset.shape = shape.name;
    if (shape.link) {
        const anchor = outer as HTMLAnchorElement;
        anchor.href = shape.link.href;
        if (shape.link.tooltip) anchor.title = shape.link.tooltip;
        if (shape.link.slide) anchor.dataset.slide = String(shape.link.slide);
    }

    const svg = renderShapeSvg(document, shape, style);
    outer.appendChild(svg);
    return outer;
}
