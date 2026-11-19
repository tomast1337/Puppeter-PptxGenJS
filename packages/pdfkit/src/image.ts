// Draws a picture (docs/HTML_PROFILE.md "Image"): the `img` inside its clipping frame, at the box its style gives
// (`100%` for stretch, the scaled box for contain, cover and crop). PDFKit embeds PNG and JPEG; others are reported.
import { length, readStyle, take } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import type { Paint } from "./paint";
import type { Frame } from "./text/draw";
import { reportUnread } from "./text/read";

const DATA_URI = /^data:([^;,]*)(;base64)?,(.*)$/s;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_SIGNATURE = [0xff, 0xd8] as const;
const ROUNDED = "50%";
/** `img` properties that only restate the frame layout `toHtml()` writes for Chromium. */
const IMG_LAYOUT: ReadonlySet<string> = new Set(["display", "position"]);
const FRAME_LAYOUT: ReadonlySet<string> = new Set(["width", "height", "overflow", "position"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return signature.every((byte, index) => bytes[index] === byte);
}

/** The bytes of a `data:` URI; undefined for anything else. */
function dataUriBytes(src: string): Uint8Array | undefined {
    const match = DATA_URI.exec(src);
    if (!match) return undefined;
    const payload = match[3] ?? "";
    if (match[2]) return Uint8Array.from(atob(payload), char => char.charCodeAt(0));
    return new TextEncoder().encode(decodeURIComponent(payload));
}

export function drawImage(element: Element, objectStyle: Map<string, string>, paint: Paint, box: Frame): void {
    const rounded = take(objectStyle, "border-radius") === ROUNDED;
    const frame = children(element).find(child => hasClass(child, "slide-image-frame"));
    const img = frame && children(frame).find(child => hasClass(child, "slide-image-content"));
    if (!frame || !img) throw new Error("invalid PdfLapas HTML: an image has no .slide-image-frame > img.slide-image-content");
    const frameStyle = readStyle(frame);
    take(frameStyle, "border-radius");
    reportUnread(frame, frameStyle, [], paint.report, FRAME_LAYOUT);
    const style = readStyle(img);
    const opacity = Number(take(style, "opacity") ?? 1);
    const x = length(take(style, "left"), box.width) ?? 0;
    const y = length(take(style, "top"), box.height) ?? 0;
    const width = length(take(style, "width"), box.width);
    const height = length(take(style, "height"), box.height);
    // `object-fit: fill` maps the image onto the img box the profile sizes for every sizing mode; there object-position does nothing.
    const fit = take(style, "object-fit");
    if (fit !== "fill") paint.report(`object-fit '${fit ?? "none"}' is drawn as 'fill'`);
    else take(style, "object-position");
    reportUnread(img, style, ["data-image-sizing"], paint.report, IMG_LAYOUT);
    const src = attribute(img, "src") ?? "";
    const bytes = dataUriBytes(src);
    if (!bytes) throw new Error("invalid PdfLapas HTML: an image's src is not a data: URI (toHtml() inlines every image)");
    if (!startsWith(bytes, PNG_SIGNATURE) && !startsWith(bytes, JPEG_SIGNATURE)) {
        paint.report(`image format '${DATA_URI.exec(src)?.[1] || "unknown"}' is not drawn (PDFKit embeds PNG and JPEG)`);
        return;
    }
    const doc = paint.doc;
    doc.save();
    if (rounded) doc.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2).clip();
    else doc.rect(box.x, box.y, box.width, box.height).clip();
    // An image XObject is painted with the fill alpha (ISO 32000-1 11.6.4.4).
    doc.fillOpacity(opacity * paint.opacity);
    if (width === undefined || height === undefined) throw new Error("invalid PdfLapas HTML: an image's img has no width and height in px or %");
    // `as`: dataUriBytes builds a fresh array over its own ArrayBuffer (never shared memory), which PDFKit takes whole.
    doc.image(bytes.buffer as ArrayBuffer, box.x + x, box.y + y, { width, height });
    doc.restore();
}
