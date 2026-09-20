import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedImage, NormalizedImageSizing } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels } from "../utils";

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
});

function validateDataUri(source: string): string {
    const match = source.match(/^data:(image\/[\w.+-]+);base64,([a-z\d+/=\s]+)$/i);
    if (!match?.[2]?.replace(/\s/g, "")) {
        throw new Error("Image data must be a base64-encoded image data URI");
    }
    return source;
}

function dataUri(bytes: ArrayBuffer, mime: string): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function resolveImageSource(source: string, cwd = process.cwd()): Promise<string> {
    if (/^data:/i.test(source)) return validateDataUri(source);
    if (/^https?:\/\//i.test(source)) {
        let response: Response;
        try {
            response = await fetch(source);
        } catch (error) {
            throw new Error(`Unable to fetch image: ${source}`, { cause: error });
        }
        if (!response.ok) throw new Error(`Unable to fetch image (${response.status}): ${source}`);
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (!mime?.startsWith("image/")) throw new Error(`Remote resource is not an image: ${source}`);
        return dataUri(await response.arrayBuffer(), mime);
    }

    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(cwd, source);
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`Image file not found: ${path}`);

    const mime = MIME_TYPES[extname(path).toLowerCase()] ?? (file.type || "application/octet-stream");
    if (!mime.startsWith("image/")) throw new Error(`Unsupported image type '${mime}': ${path}`);
    try {
        return dataUri(await file.arrayBuffer(), mime);
    } catch (error) {
        throw new Error(`Unable to read image file: ${path}`, { cause: error });
    }
}

export async function resolveDocumentImages(document: Document, cwd = process.cwd()): Promise<void> {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("img[data-source-path], img[data-source-url]"));
    await Promise.all(
        images.map(async image => {
            const source = image.dataset.sourcePath ?? image.dataset.sourceUrl;
            if (!source) return;
            image.src = await resolveImageSource(source, cwd);
            delete image.dataset.sourcePath;
            delete image.dataset.sourceUrl;
        }),
    );
}

function normalizeSizing(
    sizing: NonNullable<PptxGenJS.ImageProps["sizing"]> | undefined,
    sourceWidth: number,
    sourceHeight: number,
    boxWidth: number,
    boxHeight: number,
    pageWidth: number,
    pageHeight: number,
): NormalizedImageSizing {
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
    const scale =
        sizing.type === "contain" ? Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight) : Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { type: sizing.type, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export function normalizeImage(options: PptxGenJS.ImageProps, pageSize: PageSize): NormalizedImage {
    const source = options.data ?? options.path;
    if (!source) throw new Error("addImage() requires either 'data' or 'path'");
    if (typeof source !== "string") throw new Error("Image source must be a string");
    const sourceKind = options.data !== undefined ? "data" : /^https?:\/\//i.test(source) ? "remote" : "path";
    if (sourceKind === "data") validateDataUri(source);
    if (options.hyperlink && !options.hyperlink.url && !options.hyperlink.slide) {
        throw new Error("hyperlink requires either url or slide");
    }
    const sizing = options.sizing;
    const pageWidth = pageSize.width * 96;
    const pageHeight = pageSize.height * 96;
    const sourceWidth = convertToPixels(options.w || PPTX_DEFAULTS.image.w, pageWidth);
    const sourceHeight = convertToPixels(options.h || PPTX_DEFAULTS.image.h, pageHeight);
    const boxWidth = sizing ? convertToPixels(sizing.w || options.w || PPTX_DEFAULTS.image.w, pageWidth) : sourceWidth;
    const boxHeight = sizing ? convertToPixels(sizing.h || options.h || PPTX_DEFAULTS.image.h, pageHeight) : sourceHeight;
    const normalizedSizing = normalizeSizing(sizing, sourceWidth, sourceHeight, boxWidth, boxHeight, pageWidth, pageHeight);
    const transparency = Math.max(0, Math.min(100, options.transparency ?? PPTX_DEFAULTS.image.transparency));
    const link = options.hyperlink?.url
        ? { href: options.hyperlink.url, tooltip: options.hyperlink.tooltip }
        : options.hyperlink?.slide
          ? { href: `#slide-${options.hyperlink.slide}`, tooltip: options.hyperlink.tooltip, slide: options.hyperlink.slide }
          : undefined;
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
