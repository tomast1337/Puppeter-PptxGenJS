import type { NormalizedImage, NormalizedObjectStyle } from "@pdfdeck/model";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, voidElement } from "./markup";
import { applyObjectStyle } from "./style";

/**
 * `resolved` is the data URI of a path or URL source. It goes last, where resolving the image used to
 * append it; without it the source stays in `data-source-path` or `data-source-url`.
 */
function sourceAttributes(image: NormalizedImage, resolved: string | undefined): { before: Attribute[]; after: Attribute[] } {
    if (image.sourceKind === "data") return { before: [["src", image.source]], after: [] };
    if (resolved !== undefined) return { before: [], after: [["src", resolved]] };
    return { before: [[image.sourceKind === "remote" ? "data-source-url" : "data-source-path", image.source]], after: [] };
}

export function renderImage(image: NormalizedImage, style: NormalizedObjectStyle, resolved?: string): string {
    const outerCss: InlineStyle = new Map();
    const objectAttributes = applyObjectStyle(outerCss, style);
    if (image.rounding) outerCss.set("border-radius", "50%");

    const frameCss: InlineStyle = new Map([
        ["width", "100%"],
        ["height", "100%"],
        ["overflow", "hidden"],
        ["position", "relative"],
    ]);
    if (image.rounding) frameCss.set("border-radius", "50%");

    const css: InlineStyle = new Map([
        ["display", "block"],
        ["opacity", String(image.opacity)],
    ]);
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
    const source = sourceAttributes(image, resolved);
    const img = voidElement("img", [["class", "slide-image-content"], ["data-image-sizing", image.sizing.type], ["alt", image.altText], ...source.before, styleAttribute(css), ...source.after]);
    const frame = element("div", [["class", "slide-image-frame"], styleAttribute(frameCss)], img);

    const link = image.link;
    return element(link ? "a" : "div", [["class", "slide-element slide-image"], ...objectAttributes, ["href", link?.href], ["title", link?.tooltip || undefined], ["data-slide", link?.slide ? String(link.slide) : undefined], ["role", "img"], ["aria-label", image.altText], styleAttribute(outerCss)], frame);
}
