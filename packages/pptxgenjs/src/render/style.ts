import type { NormalizedGeometry, NormalizedLine, NormalizedObjectStyle, NormalizedShadow, NormalizedTransform } from "@pdfdeck/model";
import type { InlineStyle } from "./css";

export function applyGeometry(css: InlineStyle, geometry: NormalizedGeometry): void {
    css.set("left", `${geometry.x}px`);
    css.set("top", `${geometry.y}px`);
    if (geometry.width !== undefined) css.set("width", `${geometry.width}px`);
    if (geometry.height !== undefined) css.set("height", `${geometry.height}px`);
}

export function applyTransform(css: InlineStyle, transform: NormalizedTransform): void {
    const transforms: string[] = [];
    if (transform.rotation) transforms.push(`rotate(${transform.rotation}deg)`);
    if (transform.flipH) transforms.push("scaleX(-1)");
    if (transform.flipV) transforms.push("scaleY(-1)");
    if (transforms.length) css.set("transform", transforms.join(" "));
    css.set("transform-origin", "center");
    if (transform.opacity !== 1) css.set("opacity", String(transform.opacity));
}

export function applyLine(css: InlineStyle, line?: NormalizedLine): void {
    if (!line?.visible) {
        css.set("border-style", "none");
        return;
    }
    css.set("border-color", line.color);
    css.set("border-width", `${line.width}px`);
    css.set("border-style", line.style);
}

export function applyShadow(css: InlineStyle, shadow?: NormalizedShadow): void {
    if (!shadow?.visible) return;
    css.set("box-shadow", `${shadow.inset ? "inset " : ""}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`);
}

/** The common object box: its declarations go into `css` (written by the caller), its name onto `element`. */
export function applyObjectStyle(element: HTMLElement, css: InlineStyle, style: NormalizedObjectStyle): void {
    applyGeometry(css, style.geometry);
    applyTransform(css, style.transform);
    if (style.fill) css.set("background-color", style.fill.visible ? style.fill.color : "transparent");
    applyLine(css, style.line);
    applyShadow(css, style.shadow);
    element.dataset.objectName = style.objectName;
}
