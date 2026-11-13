import type { NormalizedObjectStyle, NormalizedShape } from "@pdfdeck/model";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element } from "./markup";
import { applyGeometry, applyTransform, lineDataAttributes, shadowInsetAttribute } from "./style";

type ColorModifier = "darken" | "darkenLess" | "lighten" | "lightenLess";

const HEX_COLOR = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;
const RGB_COLOR = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i;
const MARKER_ID_DOTS = /\./g;
const MARKER_ID_MINUS = /-/g;
const MARKER_ID_OTHER = /\W/g;

function modifyColor(color: string, modifier: ColorModifier): string {
    const transform = (value: number) => (modifier === "lighten" ? Math.floor(value + (255 - value) * 0.6) : modifier === "lightenLess" ? Math.floor(value + (255 - value) * 0.2) : Math.floor(value * (modifier === "darken" ? 0.6 : 0.8)));
    const hex = color.match(HEX_COLOR);
    if (hex) {
        const channel = (value: string) => transform(parseInt(value, 16)).toString(16).padStart(2, "0");
        return `#${hex.slice(1, 4).map(channel).join("")}`;
    }
    const rgb = color.match(RGB_COLOR);
    if (!rgb) return color;
    const channels = [rgb[1], rgb[2], rgb[3]].map(value => transform(Number(value)));
    return rgb[4] === undefined ? `rgb(${channels.join(", ")})` : `rgba(${channels.join(", ")}, ${rgb[4]})`;
}

/**
 * A marker that fills the model's head outline: drawn in user space, its origin on the line end and +x along
 * the path. Its id spells out the outline and color, because object names repeat across slides and url(#id)
 * resolves to the first match in the document; equal ids then always mean equal markers.
 */
function marker(path: string, color: string): { id: string; markup: string } {
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

/** The stroke attributes of the element that draws the outline, and the arrow-head markers they point at. */
function strokeAttributes(style: NormalizedObjectStyle): { attributes: Attribute[]; markers: string } {
    const line = style.line;
    const attributes: Attribute[] = [
        ["stroke", line?.visible ? line.color : "none"],
        ["stroke-width", String(line?.visible ? line.width : 0)],
        ["vector-effect", "non-scaling-stroke"],
    ];
    if (line?.dashArray) {
        const [first, gap = 0, ...rest] = line.dashArray.split(" ").map(Number);
        const last = rest.at(-1);
        // Chromium's PDF keeps a zero-length dash, which poppler paints as a hairline in every gap: draw a
        // pattern that starts with a gap (startDashAt) as the same pattern shifted by stroke-dashoffset.
        if (first === 0 && last !== undefined) {
            const pattern = [...rest.slice(0, -1), last + gap];
            attributes.push(["stroke-dasharray", pattern.join(" ")], ["stroke-dashoffset", String(pattern.reduce((sum, part) => sum + part, 0) - gap)]);
        } else attributes.push(["stroke-dasharray", line.dashArray]);
    }
    let markers = "";
    if (line?.visible) {
        if (line.beginHeadPath) {
            const start = marker(line.beginHeadPath, line.color);
            attributes.push(["marker-start", `url(#${start.id})`]);
            markers += start.markup;
        }
        if (line.endHeadPath) {
            const end = marker(line.endHeadPath, line.color);
            attributes.push(["marker-end", `url(#${end.id})`]);
            markers += end.markup;
        }
    }
    return { attributes, markers };
}

/** The drawn geometry; `stroke` goes on the element that draws the outline. */
function geometryElement(shape: NormalizedShape, fill: string, stroke: readonly Attribute[]): string {
    const geometry = shape.geometry;
    const painted: Attribute[] = [["class", "shape-geometry"], ["fill", fill], ...stroke];
    if (geometry.kind === "rect") {
        const radius = String(geometry.radius);
        return element("rect", [["x", "0"], ["y", "0"], ["width", String(shape.width)], ["height", String(shape.height)], ["rx", radius], ["ry", radius], ...painted]);
    }
    if (geometry.kind === "ellipse") {
        const rx = String(shape.width / 2);
        const ry = String(shape.height / 2);
        return element("ellipse", [["cx", rx], ["cy", ry], ["rx", rx], ["ry", ry], ...painted]);
    }
    if (geometry.kind === "path" && geometry.faces?.length) {
        const faces = geometry.faces.map(face =>
            element("path", [
                ["class", "shape-face"],
                ["d", face.data],
                ["data-fill-modifier", face.fillModifier || undefined],
                ["stroke", "none"],
                ["fill", face.fillModifier ? modifyColor(fill, face.fillModifier) : fill],
            ]),
        );
        const outline = geometry.outlineData ? element("path", [["class", "shape-outline"], ["d", geometry.outlineData], ["fill", "none"], ...stroke]) : "";
        // Without an outline path the group itself carries the stroke.
        return element("g", [["transform", geometry.transform || undefined], ["class", "shape-geometry"], ...(outline ? [] : stroke)], `${faces.join("")}${outline}`);
    }
    if (geometry.kind === "line") {
        return element("path", [["d", geometry.inverse ? `M 0 ${shape.height} L ${shape.width} 0` : `M 0 0 L ${shape.width} ${shape.height}`], ...painted]);
    }
    return element("path", [["d", geometry.data], ["transform", geometry.transform || undefined], ...painted]);
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

export function renderShapeSvg(shape: NormalizedShape, style: NormalizedObjectStyle): string {
    const css: InlineStyle = new Map([["overflow", "visible"]]);
    const snapOffset = printSnapOffset(style);
    if (snapOffset) css.set("--print-snap-offset", snapOffset);
    if (style.shadow?.visible) {
        css.set("filter", `drop-shadow(${style.shadow.offsetX}px ${style.shadow.offsetY}px ${style.shadow.blur}px ${style.shadow.color})`);
    }
    const fill = shape.geometry.kind === "line" || !style.fill?.visible ? "none" : style.fill.color;
    const stroke = strokeAttributes(style);
    return element(
        "svg",
        [
            ["class", "shape-svg"],
            // A near-zero viewBox height gives horizontal lines an extreme vertical
            // transform. Chromium still paints their non-scaling stroke, but drops
            // its SVG markers. The unit-high box keeps the line on its top edge, at the object's y.
            ["viewBox", `0 0 ${Math.max(shape.width, 0.001)} ${shape.height || 1}`],
            ["width", "100%"],
            ["height", shape.height === 0 ? "1" : "100%"],
            ["preserveAspectRatio", "none"],
            // The viewBox clamps these; keep the model values when it does.
            ["data-shape-width", shape.width < 0.001 ? String(shape.width) : undefined],
            ["data-shape-height", shape.height ? undefined : String(shape.height)],
            ...lineDataAttributes(style.line),
            shadowInsetAttribute(style.shadow),
            styleAttribute(css),
        ],
        `${element("defs", [], stroke.markers)}${geometryElement(shape, fill, stroke.attributes)}`,
    );
}

export function renderShape(shape: NormalizedShape, style: NormalizedObjectStyle): string {
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
