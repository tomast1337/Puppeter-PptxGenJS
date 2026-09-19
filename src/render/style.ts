import type { NormalizedGeometry, NormalizedLine, NormalizedObjectStyle, NormalizedShadow, NormalizedTransform } from "../model/types";

export function applyGeometry(element: HTMLElement, geometry: NormalizedGeometry): void {
    element.style.left = `${geometry.x}px`;
    element.style.top = `${geometry.y}px`;
    if (geometry.width !== undefined) element.style.width = `${geometry.width}px`;
    if (geometry.height !== undefined) element.style.height = `${geometry.height}px`;
}

export function applyTransform(element: HTMLElement, transform: NormalizedTransform): void {
    const transforms: string[] = [];
    if (transform.rotation) transforms.push(`rotate(${transform.rotation}deg)`);
    if (transform.flipH) transforms.push("scaleX(-1)");
    if (transform.flipV) transforms.push("scaleY(-1)");
    if (transforms.length) element.style.transform = transforms.join(" ");
    element.style.transformOrigin = "center";
    if (transform.opacity !== 1) element.style.opacity = String(transform.opacity);
}

export function applyLine(element: HTMLElement, line?: NormalizedLine): void {
    if (!line?.visible) {
        element.style.borderStyle = "none";
        return;
    }
    element.style.borderColor = line.color;
    element.style.borderWidth = `${line.width}px`;
    element.style.borderStyle = line.style;
}

export function applyShadow(element: HTMLElement, shadow?: NormalizedShadow): void {
    if (!shadow?.visible) return;
    element.style.boxShadow = `${shadow.inset ? "inset " : ""}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`;
}

export function applyObjectStyle(element: HTMLElement, style: NormalizedObjectStyle): void {
    applyGeometry(element, style.geometry);
    applyTransform(element, style.transform);
    if (style.fill) element.style.backgroundColor = style.fill.visible ? style.fill.color : "transparent";
    applyLine(element, style.line);
    applyShadow(element, style.shadow);
    element.dataset.objectName = style.objectName;
}
