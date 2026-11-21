import type { CssColor, NormalizedObjectStyle, NormalizedShape } from "@pdflapas/model";
import { cssColorParts } from "#src/color";
import { PPTX_DEFAULTS } from "#src/defaults";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, type Html } from "./markup";
import { applyGeometry, applyTransform, lineArrowAttributes, shadowInsetAttribute } from "./style";

const MARKER_ID_DOTS = /\./g;
const MARKER_ID_MINUS = /-/g;
const MARKER_ID_OTHER = /\W/g;

/**
 * A marker that fills the model's head outline: drawn in user space, its origin on the line end and +x along
 * the path. Its id spells out the outline and color, because object names repeat across slides and url(#id)
 * resolves to the first match in the document; equal ids then always mean equal markers.
 */
function marker(path: string, color: string): { id: string; markup: Html } {
    const id = `line-head-${`${color}_${path}`.replace(MARKER_ID_DOTS, "p").replace(MARKER_ID_MINUS, "m").replace(MARKER_ID_OTHER, "_")}`;
    const head = element("path", [
        ["d", path],
        ["fill", color],
    ]);
    const markup = element(
        "marker",
        [
            ["id", id],
            ["markerUnits", "userSpaceOnUse"],
            ["orient", "auto-start-reverse"],
            ["overflow", "visible"],
        ],
        head,
    );

    return { id, markup };
}

export function renderShapeSvg(shape: NormalizedShape, style: NormalizedObjectStyle): Html {
    const css: InlineStyle = new Map([["overflow", "visible"]]);

    if (style.shadow?.visible) {
        css.set("filter", `drop-shadow(${style.shadow.offsetX}px ${style.shadow.offsetY}px ${style.shadow.blur}px ${style.shadow.color})`);
    }

    const fill = shape.geometry.kind === "line" || !style.fill?.visible ? "none" : style.fill.color;
    // The stroke attributes of the element that draws the outline, and the arrow-head markers they point at.
    const line = style.line;
    const stroke: Attribute[] = [
        ["stroke", line?.visible ? line.color : "none"],
        ["stroke-width", String(line?.visible ? line.width : 0)],
        ["vector-effect", "non-scaling-stroke"],
        // The model's pattern verbatim; the Puppeteer print step redraws one that starts with a gap.
        ["stroke-dasharray", line?.dashArray || undefined],
    ];
    const markers: Html[] = [];

    if (line?.visible) {
        if (line.beginHeadPath) {
            const start = marker(line.beginHeadPath, line.color);

            stroke.push(["marker-start", `url(#${start.id})`]);
            markers.push(start.markup);
        }

        if (line.endHeadPath) {
            const end = marker(line.endHeadPath, line.color);

            stroke.push(["marker-end", `url(#${end.id})`]);
            markers.push(end.markup);
        }
    }

    // The drawn geometry; `stroke` goes on the element that draws the outline.
    const geometry = shape.geometry;
    const painted: Attribute[] = [["class", "shape-geometry"], ["fill", fill], ...stroke];
    let drawn: Html;

    if (geometry.kind === "rect") {
        const radius = String(geometry.radius);

        drawn = element("rect", [["x", "0"], ["y", "0"], ["width", String(shape.width)], ["height", String(shape.height)], ["rx", radius], ["ry", radius], ...painted]);
    } else if (geometry.kind === "ellipse") {
        const rx = String(shape.width / 2);
        const ry = String(shape.height / 2);

        drawn = element("ellipse", [["cx", rx], ["cy", ry], ["rx", rx], ["ry", ry], ...painted]);
    } else if (geometry.kind === "path" && geometry.faces?.length) {
        const faces: Html[] = [];

        for (const face of geometry.faces) {
            let faceFill: string = fill;

            // No fill and a transparent one have no color to shade.
            if (face.fillModifier && fill !== "none") {
                const modifier = face.fillModifier;
                const factor = PPTX_DEFAULTS.shape.faceShading[modifier];
                const transform = (value: number) => Math.floor(modifier === "lighten" || modifier === "lightenLess" ? value + (255 - value) * factor : value * (1 - factor));
                const parts = cssColorParts(fill);

                switch (parts.form) {
                    case "transparent":
                        break;
                    case "hex":
                        faceFill = `#${parts.channels.map(value => transform(value).toString(16).padStart(2, "0")).join("")}`;
                        break;
                    case "rgba":
                        faceFill = `rgba(${parts.channels.map(transform).join(", ")}, ${parts.alpha})`;
                        break;
                    default:
                        parts satisfies never;
                }
            }

            faces.push(
                element("path", [
                    ["class", "shape-face"],
                    ["d", face.data],
                    ["data-fill-modifier", face.fillModifier || undefined],
                    ["stroke", "none"],
                    ["fill", faceFill],
                ]),
            );
        }

        const outline = geometry.outlineData ? element("path", [["class", "shape-outline"], ["d", geometry.outlineData], ["fill", "none"], ...stroke]) : undefined;

        // Without an outline path the group itself carries the stroke.
        drawn = element("g", [["transform", geometry.transform || undefined], ["class", "shape-geometry"], ...(outline ? [] : stroke)], outline ? [...faces, outline] : faces);
    } else if (geometry.kind === "line") {
        drawn = element("path", [["d", geometry.inverse ? `M 0 ${shape.height} L ${shape.width} 0` : `M 0 0 L ${shape.width} ${shape.height}`], ...painted]);
    } else {
        drawn = element("path", [["d", geometry.data], ["transform", geometry.transform || undefined], ...painted]);
    }

    return element(
        "svg",
        [
            ["class", "shape-svg"],
            // A near-zero viewBox side gives a horizontal or vertical line an extreme transform, and Chromium
            // then drops its SVG markers; an SVG root whose used width is 0 it does not paint at all. The unit
            // box keeps the line on its top or left edge, at the object's y or x.
            ["viewBox", `0 0 ${shape.width < 0.001 ? 1 : shape.width} ${shape.height || 1}`],
            ["width", shape.width < 0.001 ? "1" : "100%"],
            ["height", shape.height === 0 ? "1" : "100%"],
            ["preserveAspectRatio", "none"],
            // The viewBox clamps these; keep the model values when it does.
            ["data-shape-width", shape.width < 0.001 ? String(shape.width) : undefined],
            ["data-shape-height", shape.height ? undefined : String(shape.height)],
            ...lineArrowAttributes(style.line),
            shadowInsetAttribute(style.shadow),
            styleAttribute(css),
        ],
        [element("defs", [], markers), drawn],
    );
}

export function renderShape(shape: NormalizedShape, style: NormalizedObjectStyle): Html {
    const css: InlineStyle = new Map();

    applyGeometry(css, style.geometry);
    applyTransform(css, style.transform);
    const link = shape.link;

    return element(
        link ? "a" : "div",
        [["class", "slide-element slide-shape"], styleAttribute(css), ["data-object-name", style.objectName], ["data-shape", shape.name], ["href", link?.href], ["title", link?.tooltip || undefined], ["data-slide", link?.slide ? String(link.slide) : undefined]],
        renderShapeSvg(shape, style),
    );
}
