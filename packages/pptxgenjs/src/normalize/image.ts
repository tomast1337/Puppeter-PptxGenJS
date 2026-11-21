import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "#src/defaults";
import type { DataUri, NormalizedImage, NormalizedImageSizing, NormalizedImageSource } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";
import { inchesToPixels, px } from "@pdflapas/model";
import { convertToPixels } from "#src/units";
import { normalizeHyperlink } from "./link";

export const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
});

// PptxGenJS 4.0.1 (addImageDefinition) takes any `data` that contains "base64,": its documented form
// "image/png;base64,…", a full data URI, or one without a mime type ("base64,…", "data:;base64,…"), which it
// types by the path extension, else png.
const IMAGE_DATA = /^(data:)?(?:(image\/[\w.+-]+)?;)?base64,([a-z\d+/=\s]+)$/i;

/** Checks image `data` and returns it as the data URI the HTML profile carries. */
function imageDataUri(data: string, path?: string): DataUri {
    const match = data.match(IMAGE_DATA);

    if (!match?.[3]?.replace(/\s/g, "")) {
        throw new Error(`Image data must be base64-encoded image data, like "image/png;base64,iVBORw0KGgo…" or "data:image/png;base64,iVBORw0KGgo…"; got "${data.slice(0, 40)}"`);
    }

    if (match[1] && match[2]) {
        return data as DataUri;
    } // `as`: IMAGE_DATA matched "data:image/…;base64," and a payload

    const fallback = MIME_TYPES[`.${PPTX_DEFAULTS.image.fallbackExtension}`];
    const mime = match[2] ?? MIME_TYPES[path?.match(/\.\w+$/)?.[0]?.toLowerCase() ?? ""] ?? fallback;

    return `data:${mime};base64,${match[3]}` as DataUri; // `as`: mime is image/… from IMAGE_DATA or MIME_TYPES
}

/** One latin1 char per byte, without Buffer. Chunked so large inputs stay under the argument limit. */
export function binaryString(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";

    for (let index = 0; index < view.length; index += 0x8000) {
        binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
    }

    return binary;
}

/** `mime` is an `image/…` type the caller checked (a file extension in MIME_TYPES, a fetched content-type). */
export function dataUri(bytes: ArrayBuffer | Uint8Array, mime: string): DataUri {
    return `data:${mime};base64,${btoa(binaryString(bytes))}` as DataUri; // `as`: see above
}

/**
 * Limits of the default image resolvers. PptxGenJS 4.0.1 has none (readFileSync, https.get); these are generous
 * for any slide image and stop a hung server or a huge body or file from stalling a render or filling memory.
 */
export const IMAGE_SOURCE_LIMITS = Object.freeze({
    /** Per fetch, headers and body. */
    timeoutMs: 30_000,
    /** Per image, remote body or file, before base64. */
    maxBytes: 50 * 1024 * 1024,
    /** Image sources modelToHtml() resolves at once. */
    concurrency: 8,
    /** Redirects one fetch follows: the Fetch standard's limit, which fetch() applies without imageSources. */
    maxRedirects: 20,
});

/**
 * How the default resolvers treat image paths and URLs (PuppeteerGen option `imageSources`). Unset, they accept
 * what PptxGenJS accepts, any readable image path and any http(s) URL, within IMAGE_SOURCE_LIMITS. A server that
 * renders decks built from user input narrows them (docs/USAGE.md, "Running PdfLapas on a server").
 */
export type ImageSourceOptions = {
    /** Abort a fetch (headers and body) after this many milliseconds. Default IMAGE_SOURCE_LIMITS.timeoutMs. */
    timeoutMs?: number;
    /** Reject a remote body or file larger than this many bytes. Default IMAGE_SOURCE_LIMITS.maxBytes. */
    maxBytes?: number;
    /** Node entry: resolve relative paths against this directory and reject any path outside it, symlinks followed. */
    baseDir?: string;
    /** false rejects http(s) URLs. Default true. */
    allowRemote?: boolean;
    /** Node entry: false rejects file paths and file: URLs, leaving data URIs and (when allowed) http(s) URLs. Default true. */
    allowLocalPaths?: boolean;
    /** Fetch http(s) URLs only from these host names (exact, case-insensitive), checked again on every redirect. */
    allowedHosts?: readonly string[];
    /** Follow at most this many redirects per image. Default IMAGE_SOURCE_LIMITS.maxRedirects; 0 follows none. */
    maxRedirects?: number;
};

const IMAGE_SOURCE_KEYS: ReadonlySet<string> = new Set(["timeoutMs", "maxBytes", "baseDir", "allowRemote", "allowLocalPaths", "allowedHosts", "maxRedirects"]);

function checkPositive(name: string, value: unknown, integer: boolean): void {
    if (value === undefined || (typeof value === "number" && value > 0 && Number.isFinite(value) && (!integer || Number.isInteger(value)))) {
        return;
    }

    throw new TypeError(`PuppeteerGen option \`imageSources.${name}\` must be a positive ${integer ? "integer" : "number"}, got ${JSON.stringify(value)}`);
}

/**
 * The constructor's image resolver: the caller's `resolveImage`, else `resolve` (the entry's default) with the
 * checked `imageSources`. Both at once is an error: the limits would not reach a resolver the caller wrote.
 */
export function imageResolver(options: { resolveImage?: (source: string) => Promise<string>; imageSources?: unknown }, resolve: (source: string, options: ImageSourceOptions) => Promise<string>): (source: string) => Promise<string> {
    // The `imageSources` option, checked where it enters: a mistyped limit would otherwise be ignored silently.
    const sourceOptions = options.imageSources;
    let imageSources: ImageSourceOptions = {};

    if (sourceOptions !== undefined) {
        if (typeof sourceOptions !== "object" || sourceOptions === null) {
            throw new TypeError(`PuppeteerGen option \`imageSources\` must be an object, got ${JSON.stringify(sourceOptions)}`);
        }

        const unknownKey = Object.keys(sourceOptions).find(key => !IMAGE_SOURCE_KEYS.has(key));

        if (unknownKey) {
            throw new TypeError(`PuppeteerGen option \`imageSources\` has unknown key "${unknownKey}"; expected one of ${[...IMAGE_SOURCE_KEYS].join(", ")}`);
        }

        const { timeoutMs, maxBytes, baseDir, allowRemote, allowLocalPaths, allowedHosts, maxRedirects } = sourceOptions as Record<string, unknown>; // `as`: checked it is a non-null object

        checkPositive("timeoutMs", timeoutMs, false);
        checkPositive("maxBytes", maxBytes, true);

        if (baseDir !== undefined && (typeof baseDir !== "string" || !baseDir)) {
            throw new TypeError(`PuppeteerGen option \`imageSources.baseDir\` must be a non-empty directory path, got ${JSON.stringify(baseDir)}`);
        }

        if (allowRemote !== undefined && typeof allowRemote !== "boolean") {
            throw new TypeError(`PuppeteerGen option \`imageSources.allowRemote\` must be a boolean, got ${JSON.stringify(allowRemote)}`);
        }

        if (allowLocalPaths !== undefined && typeof allowLocalPaths !== "boolean") {
            throw new TypeError(`PuppeteerGen option \`imageSources.allowLocalPaths\` must be a boolean, got ${JSON.stringify(allowLocalPaths)}`);
        }

        if (allowedHosts !== undefined && !(Array.isArray(allowedHosts) && allowedHosts.every(host => typeof host === "string" && host.length > 0))) {
            throw new TypeError(`PuppeteerGen option \`imageSources.allowedHosts\` must be an array of host names, got ${JSON.stringify(allowedHosts)}`);
        }

        if (maxRedirects !== undefined && !(typeof maxRedirects === "number" && Number.isInteger(maxRedirects) && maxRedirects >= 0)) {
            throw new TypeError(`PuppeteerGen option \`imageSources.maxRedirects\` must be a whole number from 0, got ${JSON.stringify(maxRedirects)}`);
        }

        imageSources = sourceOptions as ImageSourceOptions; // `as`: every key was checked above
    }

    if (!options.resolveImage) {
        return source => resolve(source, imageSources);
    }

    if (options.imageSources !== undefined) {
        throw new TypeError("PuppeteerGen options `imageSources` and `resolveImage` cannot be combined: `imageSources` configures the default resolver; apply the limits inside your resolveImage instead");
    }

    return options.resolveImage;
}

export function imageTooLargeError(source: string, bytes: number, maxBytes: number): Error {
    return new Error(`Image is larger than ${maxBytes} bytes (${bytes} bytes): ${source}; shrink it or raise the PuppeteerGen option imageSources.maxBytes`);
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && error.name === "TimeoutError";
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

// What both renderers decode: an image media type and base64 data, as imageDataUri() and dataUri() write it.
export const RESOLVED_IMAGE = /^data:image\/[\w.+-]+;base64,[a-z\d+/=\s]+$/i;

/** A `resolveImage` result that is not a `data:image/…;base64,` URI, such as a URL or a path the PDF would have to fetch. */
export class UnresolvedImageError extends Error {
    /** The image path or URL from the deck. */
    readonly source: string;
    /** What `resolveImage` returned for it. */
    readonly result: unknown;

    constructor(source: string, result: unknown) {
        const got = typeof result === "string" ? JSON.stringify(result.length > 80 ? `${result.slice(0, 80)}…` : result) : typeof result;

        super(`resolveImage returned ${got} for image "${source}", not a data URI: a resolver must read or fetch the image and return its bytes as "data:image/<type>;base64,<data>", so the PDF does not depend on the network or the filesystem`);
        this.name = "UnresolvedImageError";
        this.source = source;
        this.result = result;
    }
}

/** Checks what `resolveImage` returned for `source`: only a data URI may become an image's `src` (AGENTS.md, images resolve before PDF generation). */
export function resolvedImageDataUri(source: string, result: unknown): DataUri {
    if (typeof result === "string" && RESOLVED_IMAGE.test(result)) {
        return result as DataUri;
    } // `as`: RESOLVED_IMAGE matched

    throw new UnresolvedImageError(source, result);
}

/** Runtime-neutral image resolution: data URIs and http(s) URLs only. File paths need a runtime adapter. */
export async function resolveRemoteImageSource(source: string, options: ImageSourceOptions = {}): Promise<string> {
    if (/^data:/i.test(source)) {
        return imageDataUri(source);
    }

    if (/^https?:\/\//i.test(source)) {
        if (options.allowRemote === false) {
            throw new Error(`Remote image URLs are not allowed (PuppeteerGen option imageSources.allowRemote is false): ${source}`);
        }

        const timeoutMs = options.timeoutMs ?? IMAGE_SOURCE_LIMITS.timeoutMs;
        const timeoutError = (error: unknown) => new Error(`Image fetch timed out after ${timeoutMs} ms: ${source}; check the server or raise the PuppeteerGen option imageSources.timeoutMs`, { cause: error });
        let response: Response;

        try {
            // shortcut: without allowedHosts any host is fetched, as PptxGenJS does, and addresses are not filtered (no
            // private-range check after DNS); a service that must block internal addresses sets allowedHosts or passes its own resolveImage.
            const signal = AbortSignal.timeout(timeoutMs);
            const { allowedHosts, maxRedirects } = options;

            // `source` fetched, following redirects. Without allowedHosts or maxRedirects fetch() follows them itself, as
            // PptxGenJS does; with either, each hop is checked here (`redirect: "manual"`).
            if (allowedHosts === undefined && maxRedirects === undefined) {
                response = await fetch(source, { signal });
            } else {
                let url = new URL(source);

                for (let redirects = 0; ; redirects++) {
                    // Throw unless `url`, `source` itself or a redirect from it, is an http(s) URL on an allowed host.
                    if (url.protocol !== "http:" && url.protocol !== "https:") {
                        throw new Error(`Image fetch redirected to a ${url.protocol} URL: ${source}`);
                    }

                    if (allowedHosts && !allowedHosts.some(host => host.toLowerCase() === url.hostname)) {
                        throw new Error(`Image host '${url.hostname}' is not in the PuppeteerGen option imageSources.allowedHosts: ${source}; add the host or embed the image as a data URI`);
                    }

                    const hop = await fetch(url, { signal, redirect: "manual" });

                    // A browser hides a manual redirect's target (an opaque redirect), so it cannot be checked.
                    if (hop.type === "opaqueredirect") {
                        throw new Error(`Image fetch was redirected and this runtime cannot check the target against imageSources: ${source}`);
                    }

                    const location = hop.headers.get("location");

                    if (!REDIRECT_STATUSES.has(hop.status) || location === null) {
                        response = hop;
                        break;
                    }

                    await hop.body?.cancel();
                    const limit = maxRedirects ?? IMAGE_SOURCE_LIMITS.maxRedirects;

                    if (redirects >= limit) {
                        throw new Error(`Image fetch was redirected more than ${limit} times: ${source}; raise the PuppeteerGen option imageSources.maxRedirects`);
                    }

                    url = new URL(location, url);
                }
            }
        } catch (error) {
            if (isTimeout(error)) {
                throw timeoutError(error);
            }

            if (error instanceof Error && error.message.includes(source)) {
                throw error;
            }

            throw new Error(`Unable to fetch image: ${source}`, { cause: error });
        }

        if (!response.ok) {
            throw new Error(`Unable to fetch image (${response.status}): ${source}`);
        }

        const mime = response.headers.get("content-type")?.split(";")[0]?.trim();

        if (!mime?.startsWith("image/")) {
            throw new Error(`Remote resource is not an image: ${source}`);
        }

        try {
            // The body, read until it ends or passes `maxBytes`, so an oversized one is never buffered whole.
            const maxBytes = options.maxBytes ?? IMAGE_SOURCE_LIMITS.maxBytes;
            const length = Number(response.headers.get("content-length"));

            if (length > maxBytes) {
                throw imageTooLargeError(source, length, maxBytes);
            }

            const chunks: Uint8Array[] = [];
            let total = 0;
            const reader = response.body?.getReader();

            for (let read = await reader?.read(); reader && read && !read.done; read = await reader.read()) {
                total += read.value.byteLength;

                if (total > maxBytes) {
                    await reader.cancel();
                    throw imageTooLargeError(source, total, maxBytes);
                }

                chunks.push(read.value);
            }

            const bytes = new Uint8Array(total);
            let offset = 0;

            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }

            return dataUri(bytes, mime);
        } catch (error) {
            if (isTimeout(error)) {
                throw timeoutError(error);
            }

            throw error;
        }
    }

    throw new Error(`Cannot resolve image path '${source}' without filesystem access: use the Node entry ("@pdflapas/pptxgenjs") or pass a resolveImage option`);
}

export function normalizeImage(options: PptxGenJS.ImageProps, pageSize: PageSize): NormalizedImage {
    const raw = options.data ?? options.path;

    if (!raw) {
        throw new Error("addImage() requires either 'data' or 'path'");
    }

    if (typeof raw !== "string") {
        throw new Error("Image source must be a string");
    }

    const source: NormalizedImageSource = options.data !== undefined ? { source: imageDataUri(raw, options.path), sourceKind: "data" } : { source: raw, sourceKind: /^https?:\/\//i.test(raw) ? "remote" : "path" };
    const sizing = options.sizing;
    const pageWidth = inchesToPixels(pageSize.width);
    const pageHeight = inchesToPixels(pageSize.height);
    const sourceWidth = convertToPixels(options.w || PPTX_DEFAULTS.image.w, pageWidth);
    const sourceHeight = convertToPixels(options.h || PPTX_DEFAULTS.image.h, pageHeight);
    const boxWidth = sizing ? convertToPixels(sizing.w || options.w || PPTX_DEFAULTS.image.w, pageWidth) : sourceWidth;
    const boxHeight = sizing ? convertToPixels(sizing.h || options.h || PPTX_DEFAULTS.image.h, pageHeight) : sourceHeight;
    let normalizedSizing: NormalizedImageSizing;

    if (!sizing) {
        normalizedSizing = { type: "stretch" };
    } else if (sizing.type === "crop") {
        normalizedSizing = {
            type: "crop",
            offsetX: convertToPixels(sizing.x ?? 0, pageWidth),
            offsetY: convertToPixels(sizing.y ?? 0, pageHeight),
            width: px(sourceWidth),
            height: px(sourceHeight),
        };
    } else {
        const scale = sizing.type === "contain" ? Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight) : Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;

        normalizedSizing = { type: sizing.type, x: px((boxWidth - width) / 2), y: px((boxHeight - height) / 2), width: px(width), height: px(height) };
    }

    const transparency = Math.max(0, Math.min(100, options.transparency ?? PPTX_DEFAULTS.image.transparency));
    const link = normalizeHyperlink(options.hyperlink);

    return {
        ...source,
        sizing: normalizedSizing,
        rounding: options.rounding ?? PPTX_DEFAULTS.image.rounding,
        opacity: 1 - transparency / 100,
        altText: options.altText ?? PPTX_DEFAULTS.image.altText,
        link,
    };
}
