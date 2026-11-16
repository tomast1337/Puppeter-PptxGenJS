// Node runtime adapters: jsdom, filesystem image paths, Puppeteer PDF output and file writes.
import { type FileHandle, open, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PuppeteerPdfRenderer } from "@pdflapas/puppeteer";
import { JSDOM } from "jsdom";
import { dataUri, IMAGE_SOURCE_LIMITS, type ImageSourceOptions, imageResolver, imageTooLargeError, MIME_TYPES, resolveRemoteImageSource } from "./normalize/image";
import { resolveFileName } from "./output";
import type { PageSize } from "./pageLayouts";
import type { PptxWriteFileProps } from "./pptx";
import { PuppeteerGen as CorePuppeteerGen, type PuppeteerGenOptions } from "./PuppeteerGen";

export function createNodeDocument(): Document {
    return new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
}

/** `path` with symlinks followed, or the error naming `path` when it cannot be read. */
async function realImagePath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Image file not found: ${path}`, { cause: error }); // `as`: fs errors are ErrnoExceptions
        throw new Error(`Unable to read image file: ${path}`, { cause: error });
    }
}

/**
 * Data URIs and http(s) URLs as in the core, plus file paths and file: URLs relative to the working directory,
 * or to `options.baseDir`, which then confines them.
 */
export async function resolveImageSource(source: string, options: ImageSourceOptions = {}): Promise<string> {
    if (/^(data:|https?:\/\/)/i.test(source)) return resolveRemoteImageSource(source, options);

    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(options.baseDir ?? process.cwd(), source);
    const mime = MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    if (!mime.startsWith("image/")) throw new Error(`Unsupported image type '${mime}': ${path}`);
    const real = await realImagePath(path);
    if (options.baseDir !== undefined) {
        const base = await realpath(options.baseDir).catch((error: unknown) => {
            throw new Error(`PuppeteerGen option imageSources.baseDir is not a readable directory: ${options.baseDir}`, { cause: error });
        });
        const inside = relative(base, real);
        if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
            throw new Error(`Image path is outside imageSources.baseDir (${base}): ${source} resolves to ${real}; move the image into the directory or use a data URI`);
        }
    }
    let file: FileHandle;
    try {
        file = await open(real);
    } catch (error) {
        throw new Error(`Unable to read image file: ${path}`, { cause: error });
    }
    try {
        // The size is checked on the opened file, so it cannot be swapped for a larger one before the read.
        const info = await file.stat();
        if (!info.isFile()) throw new Error(`Image path is not a file: ${path}`);
        const maxBytes = options.maxBytes ?? IMAGE_SOURCE_LIMITS.maxBytes;
        if (info.size > maxBytes) throw imageTooLargeError(path, info.size, maxBytes);
        return dataUri(await file.readFile(), mime);
    } finally {
        await file.close();
    }
}

export class PuppeteerGen extends CorePuppeteerGen {
    constructor(pageSize?: PageSize, options: PuppeteerGenOptions = {}) {
        const { imageSources: _applied, ...rest } = options;
        super(pageSize, {
            ...rest,
            renderer: options.renderer ?? new PuppeteerPdfRenderer(),
            resolveImage: imageResolver(options, resolveImageSource),
            createDocument: options.createDocument ?? createNodeDocument,
        });
    }

    /** PptxGenJS `writeFile()`: writes the PDF to disk and returns the file name it used. */
    override async writeFile(props?: PptxWriteFileProps | string): Promise<string> {
        const fileName = resolveFileName(props);
        await writeFile(fileName, await this.toPdf());
        return fileName;
    }
}

/** PuppeteerGen with the LibreOffice rendering target, the default: the PDF matches LibreOffice's export of the .pptx. */
export class PuppeteerGenLibreOffice extends PuppeteerGen {
    constructor(pageSize?: PageSize, options: Omit<PuppeteerGenOptions, "target"> = {}) {
        super(pageSize, { ...options, target: "libreoffice" });
    }
}

/** PuppeteerGen with the PowerPoint rendering target: the PDF matches PowerPoint's rendering of the .pptx (text under 12pt is not kerned). */
export class PuppeteerGenPowerPoint extends PuppeteerGen {
    constructor(pageSize?: PageSize, options: Omit<PuppeteerGenOptions, "target"> = {}) {
        super(pageSize, { ...options, target: "powerpoint" });
    }
}
