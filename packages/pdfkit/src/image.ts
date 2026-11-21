// Draws a picture (docs/HTML_PROFILE.md "Image"): the `img` inside its clipping frame, at the box its style gives
// (`100%` for stretch, the scaled box for contain, cover and crop). PNG and JPEG go to PDFKit as they are; GIF and
// WebP are decoded (their first frame, as Chromium prints them) and embedded as PNG; SVG is drawn as vector paths
// (svgImage.ts). The picture's area is its shadow's silhouette, as in pdf-core's image.rs.
import { webpSize } from "@pdflapas/model";
import { decodeGif, decodeWebP, encodePng } from "image-in-browser";
import { length, readStyle, take } from "./css";
import { attribute, children, type Element, hasClass } from "./dom";
import { opacityGroup } from "./internals";
import { captureFill, type Paint } from "./paint";
import { drawSvgImage } from "./svgImage";
import type { Frame } from "./text/draw";
import { reportUnread } from "./text/read";

const DATA_URI = /^data:([^;,]*)(;base64)?,(.*)$/s;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_SIGNATURE = [0xff, 0xd8] as const;
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38] as const; // "GIF8"
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_FORM = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP", at byte 8 of the RIFF header
const ROUNDED = "50%";
/** `img` properties that only restate the frame layout `toHtml()` writes for Chromium. */
const IMG_LAYOUT: ReadonlySet<string> = new Set(["display", "position"]);
const FRAME_LAYOUT: ReadonlySet<string> = new Set(["width", "height", "overflow", "position"]);

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
    return signature.every((byte, index) => bytes[at + index] === byte);
}

export function drawImage(element: Element, objectStyle: Map<string, string>, paint: Paint, box: Frame): void {
    const rounded = take(objectStyle, "border-radius") === ROUNDED;
    const frame = children(element).find(child => hasClass(child, "slide-image-frame"));
    const img = frame && children(frame).find(child => hasClass(child, "slide-image-content"));

    if (!frame || !img) {
        throw new Error("invalid PdfLapas HTML: an image has no .slide-image-frame > img.slide-image-content");
    }

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

    if (fit !== "fill") {
        paint.report(`object-fit '${fit ?? "none"}' is drawn as 'fill'`);
    } else {
        take(style, "object-position");
    }

    reportUnread(img, style, ["data-image-sizing"], paint.report, IMG_LAYOUT);
    const src = attribute(img, "src") ?? "";
    const dataUri = DATA_URI.exec(src);

    if (!dataUri) {
        throw new Error("invalid PdfLapas HTML: an image's src is not a data: URI (toHtml() inlines every image)");
    }

    const payload = dataUri[3] ?? "";
    const bytes = dataUri[2] ? Uint8Array.from(atob(payload.replace(/\s+/g, "")), char => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload));

    if (width === undefined || height === undefined) {
        throw new Error("invalid PdfLapas HTML: an image's img has no width and height in px or %");
    }

    const mime = dataUri[1] || "unknown";
    // By magic bytes, as browsers sniff: a mislabelled PNG still draws.
    let raster: Uint8Array | undefined;

    if (startsWith(bytes, PNG_SIGNATURE) || startsWith(bytes, JPEG_SIGNATURE)) {
        raster = bytes;
    } else if (startsWith(bytes, GIF_SIGNATURE) || (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_FORM, 8))) {
        // The first frame of a GIF or WebP as a PNG file, for PDFKit, which embeds only PNG and JPEG. Its pixels are
        // within the renderer's imageLimits: render() checks every image's header first.
        const gif = startsWith(bytes, GIF_SIGNATURE);
        let screen: [number, number] | undefined;

        if (gif) {
            // The GIF's logical screen size, once its first frame is known to fill it (pdf-core's
            // `gif_first_frame_fills_screen`): a smaller first frame would need the later frames drawn over it, which a
            // still picture does not have.
            const word = (at: number) => {
                if (at + 2 > bytes.length) {
                    return undefined;
                }

                let value = 0;

                for (let index = 1; index >= 0; index--) {
                    value = value * 256 + (bytes[at + index] ?? 0);
                }

                return value;
            };
            // GIF89a: the logical screen descriptor (width, height, packed flags) follows the 6-byte signature.
            const [sw, sh] = [word(6), word(8)];
            const packed = bytes[10] ?? 0;
            // The packed field: bit 7 flags a global colour table, bits 0-2 give its size.
            let at = 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);

            // Extensions (0x21, a label and data sub-blocks up to an empty one) come before the first image descriptor (0x2C).
            while (bytes[at] === 0x21) {
                at += 2;
                for (let size = bytes[at]; size !== undefined; size = bytes[at]) {
                    at += 1 + size;
                    if (size === 0) {
                        break;
                    }
                }
            }

            const [frameX, frameY, frameW, frameH] = [word(at + 1), word(at + 3), word(at + 5), word(at + 7)];

            if (bytes[at] !== 0x2c || [frameX, frameY, frameW, frameH, sw, sh].includes(undefined)) {
                throw new Error("cannot decode image/gif data: no image descriptor");
            }

            if (frameX !== 0 || frameY !== 0 || frameW !== sw || frameH !== sh) {
                throw new Error(`the GIF's first frame (${frameW}x${frameH} at ${frameX},${frameY}) does not fill its ${sw}x${sh} screen; save it with a full first frame`);
            }

            screen = [sw ?? 0, sh ?? 0];
        } else {
            screen = webpSize(bytes);
        }

        if (!screen) {
            throw new Error(`cannot decode ${mime} data: no image size in its header`);
        }

        const image = gif ? decodeGif({ data: bytes, frameIndex: 0 }) : decodeWebP({ data: bytes, frameIndex: 0 });

        if (!image) {
            throw new Error(`cannot decode ${mime} data`);
        }

        raster = encodePng({ image, singleFrame: true });
    }

    const svg = !raster && mime.toLowerCase() === "image/svg+xml";

    if (!raster && !svg) {
        paint.report(`image format '${mime}' is not drawn (not a PNG, JPEG, GIF, WebP or SVG image)`);

        return;
    }

    const doc = paint.doc;
    const [left, top] = [box.x + x, box.y + y];
    // Contained and cropped pictures may not fill the box: the silhouette is what is drawn.
    // shortcut: the shadow is cast by the picture rectangle, not by its transparent pixels (LibreOffice follows the
    // alpha channel), as in pdf-core; decode the alpha for it when a deck shadows a cut-out picture.
    const [l, t] = [Math.max(box.x, left), Math.max(box.y, top)];
    const [r, b] = [Math.min(box.x + box.width, left + width), Math.min(box.y + box.height, top + height)];

    captureFill(paint, opacity, pen => (rounded ? pen.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2) : pen.rect(l, t, r - l, b - t)));
    doc.save();
    if (rounded) {
        doc.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2).clip();
    } else {
        doc.rect(box.x, box.y, box.width, box.height).clip();
    }

    if (raster) {
        // An image XObject is painted with the fill alpha (ISO 32000-1 11.6.4.4).
        doc.fillOpacity(opacity * paint.opacity);
        // `as`: a slice owns a fresh ArrayBuffer of exactly its bytes (never shared memory), which PDFKit takes whole.
        doc.image(raster.slice().buffer as ArrayBuffer, left, top, { width, height });
    } else {
        // The picture's area was captured above: what the SVG draws casts no shadow of its own.
        // The picture fades as one, as Chromium composites an `<img>`.
        paint.effects.pause();
        opacityGroup(doc, opacity * paint.opacity, () => drawSvgImage(new TextDecoder().decode(bytes), { ...paint, opacity: 1 }, { x: left, y: top, width, height }));
        paint.effects.resume();
    }

    doc.restore();
}
