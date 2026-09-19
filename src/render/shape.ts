import type { NormalizedLine, NormalizedObjectStyle, NormalizedShape } from "../model/types";
import { applyGeometry, applyTransform } from "./style";

const SVG_NS = "http://www.w3.org/2000/svg";

function markerPath(type: NonNullable<NormalizedLine["beginArrow"]>): { tag: "path" | "ellipse" | "polygon"; value: string } | undefined {
    if (type === "none") return undefined;
    if (type === "oval") return { tag: "ellipse", value: "5,5,4,3" };
    if (type === "diamond") return { tag: "polygon", value: "0,5 5,1 10,5 5,9" };
    if (type === "arrow") return { tag: "path", value: "M 10 1 L 2 5 L 10 9" };
    if (type === "stealth") return { tag: "path", value: "M 0 0 L 10 5 L 0 10 L 3 5 Z" };
    return { tag: "path", value: "M 0 0 L 10 5 L 0 10 Z" };
}

function addMarker(document: Document, defs: SVGDefsElement, id: string, type: NonNullable<NormalizedLine["beginArrow"]>, color: string): boolean {
    const shape = markerPath(type);
    if (!shape) return false;
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.id = id;
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "5");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "4");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.setAttribute("markerUnits", "strokeWidth");
    const element = document.createElementNS(SVG_NS, shape.tag);
    if (shape.tag === "ellipse") {
        const [cx, cy, rx, ry] = shape.value.split(",");
        element.setAttribute("cx", cx!); element.setAttribute("cy", cy!);
        element.setAttribute("rx", rx!); element.setAttribute("ry", ry!);
    } else if (shape.tag === "polygon") element.setAttribute("points", shape.value);
    else element.setAttribute("d", shape.value);
    element.setAttribute("fill", type === "arrow" ? "none" : color);
    element.setAttribute("stroke", color);
    element.setAttribute("stroke-width", type === "arrow" ? "1.5" : "0");
    marker.appendChild(element);
    defs.appendChild(marker);
    return true;
}

function geometryElement(document: Document, shape: NormalizedShape): SVGElement {
    const geometry = shape.geometry;
    if (geometry.kind === "rect") {
        const element = document.createElementNS(SVG_NS, "rect");
        element.setAttribute("x", "0"); element.setAttribute("y", "0");
        element.setAttribute("width", String(shape.width)); element.setAttribute("height", String(shape.height));
        element.setAttribute("rx", String(geometry.radius)); element.setAttribute("ry", String(geometry.radius));
        return element;
    }
    if (geometry.kind === "ellipse") {
        const element = document.createElementNS(SVG_NS, "ellipse");
        element.setAttribute("cx", String(shape.width / 2)); element.setAttribute("cy", String(shape.height / 2));
        element.setAttribute("rx", String(shape.width / 2)); element.setAttribute("ry", String(shape.height / 2));
        return element;
    }
    const element = document.createElementNS(SVG_NS, "path");
    if (geometry.kind === "line") {
        element.setAttribute("d", geometry.inverse ? `M 0 ${shape.height} L ${shape.width} 0` : `M 0 0 L ${shape.width} ${shape.height}`);
    } else element.setAttribute("d", geometry.data);
    return element;
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

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("shape-svg");
    svg.setAttribute("viewBox", `0 0 ${Math.max(shape.width, 0.001)} ${Math.max(shape.height, 0.001)}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", shape.height === 0 ? "1" : "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.overflow = "visible";
    if (style.shadow?.visible) {
        svg.style.filter = `drop-shadow(${style.shadow.offsetX}px ${style.shadow.offsetY}px ${style.shadow.blur}px ${style.shadow.color})`;
    }
    const defs = document.createElementNS(SVG_NS, "defs");
    const geometry = geometryElement(document, shape);
    geometry.classList.add("shape-geometry");
    geometry.setAttribute("fill", shape.geometry.kind === "line" || !style.fill?.visible ? "none" : style.fill.color);
    geometry.setAttribute("stroke", style.line?.visible ? style.line.color : "none");
    geometry.setAttribute("stroke-width", String(style.line?.visible ? style.line.width : 0));
    geometry.setAttribute("vector-effect", "non-scaling-stroke");
    if (style.line?.dashArray) geometry.setAttribute("stroke-dasharray", style.line.dashArray);
    if (style.line?.visible) {
        const base = `shape-${style.objectName.replace(/[^a-z\d]/gi, "-")}`;
        if (addMarker(document, defs, `${base}-begin`, style.line.beginArrow ?? "none", style.line.color)) geometry.setAttribute("marker-start", `url(#${base}-begin)`);
        if (addMarker(document, defs, `${base}-end`, style.line.endArrow ?? "none", style.line.color)) geometry.setAttribute("marker-end", `url(#${base}-end)`);
    }
    svg.append(defs, geometry);
    outer.appendChild(svg);
    return outer;
}
