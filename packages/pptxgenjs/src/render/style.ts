import type { NormalizedGeometry, NormalizedLine, NormalizedObjectStyle, NormalizedShadow, NormalizedTransform } from "@pdflapas/model";
import { cssPx } from "@pdflapas/model";
import type { InlineStyle } from "./css";
import type { Attribute } from "./markup";

export function applyGeometry(css: InlineStyle, geometry: NormalizedGeometry): void {
    css.set("left", cssPx(geometry.x));
    css.set("top", cssPx(geometry.y));
    if (geometry.width !== undefined) {
        css.set("width", cssPx(geometry.width));
    }

    if (geometry.height !== undefined) {
        css.set("height", cssPx(geometry.height));
    }
}

export function applyTransform(css: InlineStyle, transform: NormalizedTransform): void {
    const transforms: string[] = [];

    if (transform.rotation) {
        transforms.push(`rotate(${transform.rotation}deg)`);
    }

    if (transform.flipH) {
        transforms.push("scaleX(-1)");
    }

    if (transform.flipV) {
        transforms.push("scaleY(-1)");
    }

    if (transforms.length) {
        css.set("transform", transforms.join(" "));
    }

    css.set("transform-origin", "center");
    if (transform.opacity !== 1) {
        css.set("opacity", String(transform.opacity));
    }
}

/** The arrow types, which SVG only shows as head paths; written on the element that carries the line. */
export function lineArrowAttributes(line?: NormalizedLine): Attribute[] {
    return [
        ["data-line-begin-arrow", line?.beginArrow || undefined],
        ["data-line-end-arrow", line?.endArrow || undefined],
    ];
}

/** `drop-shadow()` and `text-shadow` have no `inset`, so the element that draws such a shadow says it here. */
export function shadowInsetAttribute(shadow?: NormalizedShadow): Attribute {
    return ["data-shadow-inset", shadow?.visible && shadow.inset ? "" : undefined];
}

/** The common object box: its declarations go into `css` (written by the caller); returns the attributes that name it. */
export function applyObjectStyle(css: InlineStyle, style: NormalizedObjectStyle): Attribute[] {
    applyGeometry(css, style.geometry);
    applyTransform(css, style.transform);

    if (style.fill) {
        css.set("background-color", style.fill.visible ? style.fill.color : "transparent");
    }

    const { line, shadow } = style;

    if (line?.visible) {
        css.set("border-color", line.color);
        css.set("border-width", `${line.width}px`);
        css.set("border-style", line.style);
    } else {
        css.set("border-style", "none");
    }

    if (shadow?.visible) {
        css.set("box-shadow", `${shadow.inset ? "inset " : ""}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`);
    }

    // A box's line values that CSS borders cannot state: the dash pattern (only `dashed`) and the arrow types.
    return [["data-line-dash-array", line?.dashArray || undefined], ...lineArrowAttributes(line), ["data-object-name", style.objectName]];
}
