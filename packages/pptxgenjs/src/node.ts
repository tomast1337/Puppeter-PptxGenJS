// Node runtime adapters: jsdom, filesystem image paths, Puppeteer PDF output and file writes.
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PuppeteerPdfRenderer } from "@pdfdeck/puppeteer";
import { JSDOM } from "jsdom";
import { dataUri, MIME_TYPES, resolveRemoteImageSource } from "./normalize/image";
import type { PageSize } from "./pageLayouts";
import type { PptxWriteFileProps } from "./pptx";
import { PuppeteerGen as CorePuppeteerGen, type PuppeteerGenOptions } from "./PuppeterrGen";

export function createNodeDocument(): Document {
    return new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
}

/** Data URIs and http(s) URLs as in the core, plus file paths and file: URLs relative to `cwd`. */
export async function resolveImageSource(source: string, cwd = process.cwd()): Promise<string> {
    if (/^(data:|https?:\/\/)/i.test(source)) return resolveRemoteImageSource(source);

    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(cwd, source);
    const mime = MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    if (!mime.startsWith("image/")) throw new Error(`Unsupported image type '${mime}': ${path}`);
    try {
        return dataUri(await readFile(path), mime);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Image file not found: ${path}`, { cause: error });
        throw new Error(`Unable to read image file: ${path}`, { cause: error });
    }
}

export class PuppeteerGen extends CorePuppeteerGen {
    constructor(pageSize?: PageSize, options: PuppeteerGenOptions = {}) {
        super(pageSize, {
            renderer: options.renderer ?? new PuppeteerPdfRenderer(),
            resolveImage: options.resolveImage ?? (source => resolveImageSource(source)),
            createDocument: options.createDocument ?? createNodeDocument,
        });
    }

    override async writeFile({ fileName }: PptxWriteFileProps): Promise<string> {
        if (!fileName) {
            throw new Error("fileName is required");
        }
        await writeFile(fileName, await this.toPdf());
        return fileName;
    }
}
