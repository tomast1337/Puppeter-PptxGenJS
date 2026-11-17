import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "#src/defaults";
import type { NormalizedImage, NormalizedImageSizing } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";
import { convertToPixels, inchesToPixels } from "#src/units";
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
function imageDataUri(data: string, path?: string): string {
    const match = data.match(IMAGE_DATA);
    if (!match?.[3]?.replace(/\s/g, "")) {
        throw new Error(`Image data must be base64-encoded image data, like "image/png;base64,iVBORw0KGgo…" or "data:image/png;base64,iVBORw0KGgo…"; got "${data.slice(0, 40)}"`);
    }
    if (match[1] && match[2]) return data;
    const fallback = MIME_TYPES[`.${PPTX_DEFAULTS.image.fallbackExtension}`];
    const mime = match[2] ?? MIME_TYPES[path?.match(/\.\w+$/)?.[0]?.toLowerCase() ?? ""] ?? fallback;
    return `data:${mime};base64,${match[3]}`;
}

/** One latin1 char per byte, without Buffer. Chunked so large inputs stay under the argument limit. */
export function binaryString(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
    return binary;
}

export function dataUri(bytes: ArrayBuffer | Uint8Array, mime: string): string {
    return `data:${mime};base64,${btoa(binaryString(bytes))}`;
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
});

/**
 * How the default resolvers treat image paths and URLs (PuppeteerGen option `imageSources`). Unset, they accept
 * what PptxGenJS accepts, any readable path and any http(s) URL, within IMAGE_SOURCE_LIMITS.
 */
export interface ImageSourceOptions {
    /** Abort a fetch (headers and body) after this many milliseconds. Default IMAGE_SOURCE_LIMITS.timeoutMs. */
    timeoutMs?: number;
    /** Reject a remote body or file larger than this many bytes. Default IMAGE_SOURCE_LIMITS.maxBytes. */
    maxBytes?: number;
    /** Node entry: resolve relative paths against this directory and reject any path outside it, symlinks followed. */
    baseDir?: string;
    /** false rejects http(s) URLs. Default true. */
    allowRemote?: boolean;
}

const IMAGE_SOURCE_KEYS: ReadonlySet<string> = new Set(["timeoutMs", "maxBytes", "baseDir", "allowRemote"]);

function checkPositive(name: string, value: unknown, integer: boolean): void {
    if (value === undefined || (typeof value === "number" && value > 0 && Number.isFinite(value) && (!integer || Number.isInteger(value)))) return;
    throw new TypeError(`PuppeteerGen option \`imageSources.${name}\` must be a positive ${integer ? "integer" : "number"}, got ${JSON.stringify(value)}`);
}

/** The `imageSources` option, checked where it enters: a mistyped limit would otherwise be ignored silently. */
function imageSourceOptions(options: unknown): ImageSourceOptions {
    if (options === undefined) return {};
    if (typeof options !== "object" || options === null) throw new TypeError(`PuppeteerGen option \`imageSources\` must be an object, got ${JSON.stringify(options)}`);
    const unknownKey = Object.keys(options).find(key => !IMAGE_SOURCE_KEYS.has(key));
    if (unknownKey) throw new TypeError(`PuppeteerGen option \`imageSources\` has unknown key "${unknownKey}"; expected one of ${[...IMAGE_SOURCE_KEYS].join(", ")}`);
    const { timeoutMs, maxBytes, baseDir, allowRemote } = options as Record<string, unknown>; // `as`: checked it is a non-null object
    checkPositive("timeoutMs", timeoutMs, false);
    checkPositive("maxBytes", maxBytes, true);
    if (baseDir !== undefined && (typeof baseDir !== "string" || !baseDir)) throw new TypeError(`PuppeteerGen option \`imageSources.baseDir\` must be a non-empty directory path, got ${JSON.stringify(baseDir)}`);
    if (allowRemote !== undefined && typeof allowRemote !== "boolean") throw new TypeError(`PuppeteerGen option \`imageSources.allowRemote\` must be a boolean, got ${JSON.stringify(allowRemote)}`);
    return options as ImageSourceOptions; // `as`: every key was checked above
}

/**
 * The constructor's image resolver: the caller's `resolveImage`, else `resolve` (the entry's default) with the
 * checked `imageSources`. Both at once is an error: the limits would not reach a resolver the caller wrote.
 */
export function imageResolver(options: { resolveImage?: (source: string) => Promise<string>; imageSources?: unknown }, resolve: (source: string, options: ImageSourceOptions) => Promise<string>): (source: string) => Promise<string> {
    const imageSources = imageSourceOptions(options.imageSources);
    if (!options.resolveImage) return source => resolve(source, imageSources);
    if (options.imageSources !== undefined) throw new TypeError("PuppeteerGen options `imageSources` and `resolveImage` cannot be combined: `imageSources` configures the default resolver; apply the limits inside your resolveImage instead");
    return options.resolveImage;
}

export function imageTooLargeError(source: string, bytes: number, maxBytes: number): Error {
    return new Error(`Image is larger than ${maxBytes} bytes (${bytes} bytes): ${source}; shrink it or raise the PuppeteerGen option imageSources.maxBytes`);
}

/** The body, read until it ends or passes `maxBytes`, so an oversized one is never buffered whole. */
async function readImageBody(response: Response, source: string, maxBytes: number): Promise<Uint8Array> {
    const length = Number(response.headers.get("content-length"));
    if (length > maxBytes) throw imageTooLargeError(source, length, maxBytes);
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
    return bytes;
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && error.name === "TimeoutError";
}

async function fetchImage(source: string, options: ImageSourceOptions): Promise<string> {
    if (options.allowRemote === false) throw new Error(`Remote image URLs are not allowed (PuppeteerGen option imageSources.allowRemote is false): ${source}`);
    const timeoutMs = options.timeoutMs ?? IMAGE_SOURCE_LIMITS.timeoutMs;
    const timeoutError = (error: unknown) => new Error(`Image fetch timed out after ${timeoutMs} ms: ${source}; check the server or raise the PuppeteerGen option imageSources.timeoutMs`, { cause: error });
    let response: Response;
    try {
        // shortcut: redirects are followed and any host is fetched, as PptxGenJS does; a service that must block internal addresses passes its own resolveImage.
        response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
        if (isTimeout(error)) throw timeoutError(error);
        throw new Error(`Unable to fetch image: ${source}`, { cause: error });
    }
    if (!response.ok) throw new Error(`Unable to fetch image (${response.status}): ${source}`);
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!mime?.startsWith("image/")) throw new Error(`Remote resource is not an image: ${source}`);
    try {
        return dataUri(await readImageBody(response, source, options.maxBytes ?? IMAGE_SOURCE_LIMITS.maxBytes), mime);
    } catch (error) {
        if (isTimeout(error)) throw timeoutError(error);
        throw error;
    }
}

/** Runtime-neutral image resolution: data URIs and http(s) URLs only. File paths need a runtime adapter. */
export async function resolveRemoteImageSource(source: string, options: ImageSourceOptions = {}): Promise<string> {
    if (/^data:/i.test(source)) return imageDataUri(source);
    if (/^https?:\/\//i.test(source)) return fetchImage(source, options);
    throw new Error(`Cannot resolve image path '${source}' without filesystem access: use the Node entry ("puppeteer-pptxgenjs") or pass a resolveImage option`);
}

function normalizeSizing(sizing: NonNullable<PptxGenJS.ImageProps["sizing"]> | undefined, sourceWidth: number, sourceHeight: number, boxWidth: number, boxHeight: number, pageWidth: number, pageHeight: number): NormalizedImageSizing {
    if (!sizing) return { type: "stretch" };
    if (sizing.type === "crop") {
        return {
            type: "crop",
            offsetX: convertToPixels(sizing.x ?? 0, pageWidth),
            offsetY: convertToPixels(sizing.y ?? 0, pageHeight),
            width: sourceWidth,
            height: sourceHeight,
        };
    }
    const scale = sizing.type === "contain" ? Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight) : Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { type: sizing.type, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export function normalizeImage(options: PptxGenJS.ImageProps, pageSize: PageSize): NormalizedImage {
    const raw = options.data ?? options.path;
    if (!raw) throw new Error("addImage() requires either 'data' or 'path'");
    if (typeof raw !== "string") throw new Error("Image source must be a string");
    const sourceKind = options.data !== undefined ? "data" : /^https?:\/\//i.test(raw) ? "remote" : "path";
    const source = sourceKind === "data" ? imageDataUri(raw, options.path) : raw;
    const sizing = options.sizing;
    const pageWidth = inchesToPixels(pageSize.width);
    const pageHeight = inchesToPixels(pageSize.height);
    const sourceWidth = convertToPixels(options.w || PPTX_DEFAULTS.image.w, pageWidth);
    const sourceHeight = convertToPixels(options.h || PPTX_DEFAULTS.image.h, pageHeight);
    const boxWidth = sizing ? convertToPixels(sizing.w || options.w || PPTX_DEFAULTS.image.w, pageWidth) : sourceWidth;
    const boxHeight = sizing ? convertToPixels(sizing.h || options.h || PPTX_DEFAULTS.image.h, pageHeight) : sourceHeight;
    const normalizedSizing = normalizeSizing(sizing, sourceWidth, sourceHeight, boxWidth, boxHeight, pageWidth, pageHeight);
    const transparency = Math.max(0, Math.min(100, options.transparency ?? PPTX_DEFAULTS.image.transparency));
    const link = normalizeHyperlink(options.hyperlink);
    return {
        source,
        sourceKind,
        sizing: normalizedSizing,
        rounding: options.rounding ?? PPTX_DEFAULTS.image.rounding,
        opacity: 1 - transparency / 100,
        altText: options.altText ?? PPTX_DEFAULTS.image.altText,
        link,
    };
}
