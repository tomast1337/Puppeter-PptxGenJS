import type { NormalizedImage, NormalizedObjectStyle } from "../model/types";
import { applyObjectStyle } from "./style";

export function renderImage(
    document: Document,
    image: NormalizedImage,
    style: NormalizedObjectStyle,
): HTMLElement {
    const outer = image.link ? document.createElement("a") : document.createElement("div");
    outer.className = "slide-element slide-image";
    applyObjectStyle(outer, style);
    if (image.link) {
        const anchor = outer as HTMLAnchorElement;
        anchor.href = image.link.href;
        if (image.link.tooltip) anchor.title = image.link.tooltip;
        if (image.link.slide) anchor.dataset.slide = String(image.link.slide);
    }
    outer.setAttribute("role", "img");
    outer.setAttribute("aria-label", image.altText);
    if (image.rounding) outer.style.borderRadius = "50%";

    const frame = document.createElement("div");
    frame.className = "slide-image-frame";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.overflow = "hidden";
    frame.style.position = "relative";
    if (image.rounding) frame.style.borderRadius = "50%";

    const element = document.createElement("img");
    element.className = "slide-image-content";
    element.dataset.imageSizing = image.sizing.type;
    element.alt = image.altText;
    element.style.display = "block";
    element.style.opacity = String(image.opacity);
    if (image.sourceKind === "data") element.src = image.source;
    else if (image.sourceKind === "remote") element.dataset.sourceUrl = image.source;
    else element.dataset.sourcePath = image.source;

    if (image.sizing.type === "crop") {
        element.style.position = "absolute";
        element.style.left = `${-image.sizing.offsetX}px`;
        element.style.top = `${-image.sizing.offsetY}px`;
        element.style.width = `${image.sizing.width}px`;
        element.style.height = `${image.sizing.height}px`;
        element.style.objectFit = "fill";
    } else if (image.sizing.type === "contain" || image.sizing.type === "cover") {
        element.style.position = "absolute";
        element.style.left = `${image.sizing.x}px`;
        element.style.top = `${image.sizing.y}px`;
        element.style.width = `${image.sizing.width}px`;
        element.style.height = `${image.sizing.height}px`;
        element.style.objectFit = "fill";
    } else {
        element.style.width = "100%";
        element.style.height = "100%";
        element.style.objectFit = "fill";
        element.style.objectPosition = "center center";
    }

    frame.appendChild(element);
    outer.appendChild(frame);
    return outer;
}
