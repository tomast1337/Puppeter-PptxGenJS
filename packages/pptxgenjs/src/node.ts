// Node runtime adapters: jsdom, filesystem image paths, installed font metrics, Puppeteer PDF output and file writes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type FileHandle, open, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PuppeteerPdfRenderer } from "@pdflapas/puppeteer";
import { JSDOM } from "jsdom";
import type { FontWinMetrics } from "./defaults";
import { readFontWinMetrics } from "./fontMetrics";
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

// fc-match's output: the matched file, its face index and its family names (comma-separated), one per line.
const FC_MATCH_FORMAT = "%{file}\\n%{index}\\n%{family}";
// fc-match builds fontconfig's cache on a cold start, which can take seconds.
const FC_MATCH_TIMEOUT_MS = 10_000;
// fontconfig's face index keeps a variable font's named instance in its upper 16 bits; the face is the lower 16.
const FC_FACE_INDEX_MASK = 0xffff;
// Characters fontconfig's pattern syntax reads (family list, size, properties), escaped to stay part of the name.
const FC_PATTERN_SPECIAL = /[\\\-:,]/g;

/**
 * Installed fonts' metrics by lower-case face name, undefined when the face is not installed. Global because the
 * installed fonts are the process's environment, not a deck's, and each lookup spawns fc-match and reads a font file:
 * every presentation in the process shares it. Owned by resolveInstalledFontMetrics(); never released (one small entry
 * per face name the process has used). A font installed after a face was looked up is seen by a new process.
 */
const installedFontMetrics = new Map<string, FontWinMetrics | undefined>();

/** The font fontconfig resolves `fontFace` to, when its family is `fontFace` itself (not a substitute); undefined otherwise. */
function installedFontFile(fontFace: string): { file: string; index: number } | undefined {
    let output: string;
    try {
        output = execFileSync("fc-match", ["-f", FC_MATCH_FORMAT, fontFace.replace(FC_PATTERN_SPECIAL, "\\$&")], { encoding: "utf8", timeout: FC_MATCH_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return undefined; // No fontconfig (macOS and Windows without it) or it failed: FONT_WIN_METRICS applies.
    }
    const [file, index, families = ""] = output.split("\n");
    const face = fontFace.toLowerCase();
    // fc-match always answers with some font; only a font of the face's own family is the face.
    if (!file || !families.split(",").some(family => family.toLowerCase() === face)) return undefined;
    return { file, index: Number(index) & FC_FACE_INDEX_MASK };
}

/**
 * The default `resolveFontMetrics` of the Node entry: head.unitsPerEm and OS/2 usWinAscent and usWinDescent of the
 * regular font fontconfig resolves `fontFace` to, as Chromium does on Linux. Undefined when fontconfig is missing or has
 * no font of that family (a substitute does not count), or the font file cannot be read (with a warning). Cached per process.
 */
export function resolveInstalledFontMetrics(fontFace: string): FontWinMetrics | undefined {
    const key = fontFace.toLowerCase();
    if (installedFontMetrics.has(key)) return installedFontMetrics.get(key);
    const font = installedFontFile(fontFace);
    let metrics: FontWinMetrics | undefined;
    if (font) {
        try {
            metrics = readFontWinMetrics(readFileSync(font.file), font.index);
        } catch (error) {
            console.warn(`PdfLapas: cannot read the metrics of ${JSON.stringify(fontFace)} from ${font.file} (${error instanceof Error ? error.message : String(error)}); the PowerPoint target uses FONT_WIN_METRICS or the font-independent baseline for it.`);
        }
    }
    installedFontMetrics.set(key, metrics);
    return metrics;
}

export class PuppeteerGen extends CorePuppeteerGen {
    constructor(pageSize?: PageSize, options: PuppeteerGenOptions = {}) {
        const { imageSources: _applied, ...rest } = options;
        super(pageSize, {
            ...rest,
            renderer: options.renderer ?? new PuppeteerPdfRenderer(),
            resolveImage: imageResolver(options, resolveImageSource),
            createDocument: options.createDocument ?? createNodeDocument,
            resolveFontMetrics: options.resolveFontMetrics === undefined ? resolveInstalledFontMetrics : options.resolveFontMetrics,
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
