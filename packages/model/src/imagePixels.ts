// Decoded-pixel limits on the raster images of a presentation. A few KB of compressed data can declare billions of
// pixels, and decoding them exhausts the renderer's memory or time, so every renderer reads each image's size from
// its header and refuses the same decks before decoding. crates/pdf-core/src/image.rs applies the same defaults.

/** The default limits: 8192 x 8192 pixels per image (256 MiB as RGBA) and four times that per presentation. */
export const IMAGE_PIXEL_LIMITS = Object.freeze({
    /** Most pixels one raster image may have. */
    maxImagePixels: 2 ** 26,
    /** Most pixels the distinct raster images of one presentation may have together. */
    maxDeckImagePixels: 2 ** 28,
});

/** Overrides of `IMAGE_PIXEL_LIMITS` (the Puppeteer and PDFKit renderers' `imageLimits` option). */
export type ImagePixelLimits = {
    readonly maxImagePixels?: number;
    readonly maxDeckImagePixels?: number;
};

/** A header field: its value, or `short` when the bytes end before it does. */
type HeaderField = { kind: "value"; value: number } | { kind: "short" };

const be = (bytes: Uint8Array, at: number, count: number): HeaderField => {
    if (at + count > bytes.length) {
        return { kind: "short" };
    }

    let value = 0;

    for (let index = 0; index < count; index++) {
        value = value * 256 + (bytes[at + index] ?? 0);
    }

    return { kind: "value", value };
};
const le = (bytes: Uint8Array, at: number, count: number): HeaderField => {
    if (at + count > bytes.length) {
        return { kind: "short" };
    }

    let value = 0;

    for (let index = count - 1; index >= 0; index--) {
        value = value * 256 + (bytes[at + index] ?? 0);
    }

    return { kind: "value", value };
};
const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);

/** WebP: the first chunk is VP8X (canvas size minus one), VP8L (14-bit sizes minus one) or VP8 (14-bit sizes). */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function webpSize(bytes: Uint8Array): [number, number] | undefined {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));

    if (chunk === "VP8X") {
        const [w, h] = [le(bytes, 24, 3), le(bytes, 27, 3)];

        return w.kind === "short" || h.kind === "short" ? undefined : [w.value + 1, h.value + 1];
    }

    if (chunk === "VP8L" && bytes[20] === 0x2f) {
        const bits = le(bytes, 21, 4);

        return bits.kind === "short" ? undefined : [(bits.value % 2 ** 14) + 1, (Math.floor(bits.value / 2 ** 14) % 2 ** 14) + 1];
    }

    if (chunk === "VP8 " && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
        const [w, h] = [le(bytes, 26, 2), le(bytes, 28, 2)];

        return w.kind === "short" || h.kind === "short" ? undefined : [w.value % 2 ** 14, h.value % 2 ** 14];
    }

    return undefined;
}

/**
 * The pixel size a raster image declares in its header (PNG IHDR, JPEG SOFn, GIF logical screen, WebP), by its magic
 * bytes; undefined for SVG, another format, or a header cut short.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function rasterImageSize(bytes: Uint8Array): [number, number] | undefined {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) {
            return undefined;
        } // "IHDR"

        const [w, h] = [be(bytes, 16, 4), be(bytes, 20, 4)];

        return w.kind === "short" || h.kind === "short" ? undefined : [w.value, h.value];
    }

    if (startsWith(bytes, [0xff, 0xd8])) {
        // JPEG: the first start-of-frame segment (SOF0-SOF15 except DHT, JPG and DAC) holds the height, then the width.
        for (let at = 2; at < bytes.length;) {
            if (bytes[at] !== 0xff) {
                return undefined;
            }

            const marker = bytes[at + 1];

            if (marker === undefined) {
                return undefined;
            }

            if (marker === 0xff) {
                at += 1;
            } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                at += 2;
            } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                const [height, width] = [be(bytes, at + 5, 2), be(bytes, at + 7, 2)];

                return width.kind === "short" || height.kind === "short" ? undefined : [width.value, height.value];
            } else if (marker === 0xda || marker === 0xd9) {
                return undefined;
            } else {
                const length = be(bytes, at + 2, 2);

                if (length.kind === "short") {
                    return undefined;
                }

                at += 2 + length.value;
            }
        }

        return undefined;
    }

    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
        const [w, h] = [le(bytes, 6, 2), le(bytes, 8, 2)];

        return w.kind === "short" || h.kind === "short" ? undefined : [w.value, h.value];
    }

    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
        return webpSize(bytes);
    }

    return undefined;
}

// A base64 image data URI in the HTML, wherever it is (an <img> src, a CSS url()).
const BASE64_IMAGE = /data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)/gi;
// Base64 characters decoded for the header (a multiple of 4): 48 KiB of bytes holds every header but a JPEG's after
// large metadata, which is then decoded whole.
const HEAD_CHARACTERS = 65_536;

function base64Bytes(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function limit(name: keyof ImagePixelLimits, value: number | undefined): number {
    if (value === undefined) {
        return IMAGE_PIXEL_LIMITS[name];
    }

    if (Number.isInteger(value) && value > 0) {
        return value;
    }

    throw new TypeError(`imageLimits.${name} must be a positive integer, got ${JSON.stringify(value)}`);
}

/** Checks `limits` where they enter (a renderer's constructor) and returns them complete. */
export function imagePixelLimits(limits: ImagePixelLimits = {}): Required<ImagePixelLimits> {
    return { maxImagePixels: limit("maxImagePixels", limits.maxImagePixels), maxDeckImagePixels: limit("maxDeckImagePixels", limits.maxDeckImagePixels) };
}

/**
 * Throws when a base64 image data URI in `html` declares more pixels than `limits.maxImagePixels`, or the distinct
 * images together more than `limits.maxDeckImagePixels`, before any of them is decoded.
 */
export function checkImagePixels(html: string, limits: Required<ImagePixelLimits>): void {
    const seen = new Set<string>();
    let total = 0;

    for (const [, payload = ""] of html.matchAll(BASE64_IMAGE)) {
        if (seen.has(payload)) {
            continue;
        }

        seen.add(payload);
        // The size the payload (base64) declares, decoding only its head unless a JPEG's frame header lies further in.
        const compact = /\s/.test(payload) ? payload.replace(/\s+/g, "") : payload;
        let size: [number, number] | undefined;

        try {
            const head = base64Bytes(compact.slice(0, HEAD_CHARACTERS));

            size = rasterImageSize(head) ?? (compact.length > HEAD_CHARACTERS && startsWith(head, [0xff, 0xd8]) ? rasterImageSize(base64Bytes(compact)) : undefined);
        } catch {
            size = undefined; // Not valid base64: the renderer reports the image it cannot decode.
        }

        if (!size) {
            continue;
        }

        const [w, h] = size;
        const pixels = w * h;

        if (pixels > limits.maxImagePixels) {
            throw new Error(`An image of ${w}x${h} pixels is over the limit of ${limits.maxImagePixels} pixels per image; downscale it, or raise the renderer option imageLimits.maxImagePixels`);
        }

        total += pixels;
        if (total > limits.maxDeckImagePixels) {
            throw new Error(`An image of ${w}x${h} pixels takes the presentation's images over the limit of ${limits.maxDeckImagePixels} pixels in total; downscale its images, or raise the renderer option imageLimits.maxDeckImagePixels`);
        }
    }
}
