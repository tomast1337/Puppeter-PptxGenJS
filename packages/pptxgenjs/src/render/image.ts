import type { NormalizedImage, NormalizedObjectStyle } from "@pdfdeck/model";
import { type InlineStyle, writeStyle } from "./css";
import { applyObjectStyle } from "./style";

export function renderImage(document: Document, image: NormalizedImage, style: NormalizedObjectStyle): HTMLElement {
    const outer = image.link ? document.createElement("a") : document.createElement("div");
    outer.className = "slide-element slide-image";
    const outerCss: InlineStyle = new Map();
    applyObjectStyle(outer, outerCss, style);
    if (image.link) {
        const anchor = outer as HTMLAnchorElement;
        anchor.href = image.link.href;
        if (image.link.tooltip) anchor.title = image.link.tooltip;
        if (image.link.slide) anchor.dataset.slide = String(image.link.slide);
    }
    outer.setAttribute("role", "img");
    outer.setAttribute("aria-label", image.altText);
    if (image.rounding) outerCss.set("border-radius", "50%");
    writeStyle(outer, outerCss);

    const frame = document.createElement("div");
    frame.className = "slide-image-frame";
    const frameCss: InlineStyle = new Map([
        ["width", "100%"],
        ["height", "100%"],
        ["overflow", "hidden"],
        ["position", "relative"],
    ]);
    if (image.rounding) frameCss.set("border-radius", "50%");
    writeStyle(frame, frameCss);

    const element = document.createElement("img");
    element.className = "slide-image-content";
    element.dataset.imageSizing = image.sizing.type;
    element.alt = image.altText;
    const css: InlineStyle = new Map([
        ["display", "block"],
        ["opacity", String(image.opacity)],
    ]);
    if (image.sourceKind === "data") element.src = image.source;
    else if (image.sourceKind === "remote") element.dataset.sourceUrl = image.source;
    else element.dataset.sourcePath = image.source;

    if (image.sizing.type === "crop") {
        css.set("position", "absolute");
        css.set("left", `${-image.sizing.offsetX}px`);
        css.set("top", `${-image.sizing.offsetY}px`);
        css.set("width", `${image.sizing.width}px`);
        css.set("height", `${image.sizing.height}px`);
        css.set("object-fit", "fill");
    } else if (image.sizing.type === "contain" || image.sizing.type === "cover") {
        css.set("position", "absolute");
        css.set("left", `${image.sizing.x}px`);
        css.set("top", `${image.sizing.y}px`);
        css.set("width", `${image.sizing.width}px`);
        css.set("height", `${image.sizing.height}px`);
        css.set("object-fit", "fill");
    } else {
        css.set("width", "100%");
        css.set("height", "100%");
        css.set("object-fit", "fill");
        css.set("object-position", "center center");
    }
    writeStyle(element, css);

    frame.appendChild(element);
    outer.appendChild(frame);
    return outer;
}
