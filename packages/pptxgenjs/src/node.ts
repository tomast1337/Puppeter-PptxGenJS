// Node runtime adapters: jsdom, filesystem image paths, installed font metrics and advances, Puppeteer PDF output and file writes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type FileHandle, open, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PuppeteerPdfRenderer } from "@pdflapas/puppeteer";
import { JSDOM } from "jsdom";
import type { FontWinMetrics, GlyphAdvances } from "./defaults";
import { readFontWinMetrics, readGlyphAdvances } from "./fontMetrics";
import { dataUri, IMAGE_SOURCE_LIMITS, type ImageSourceOptions, imageResolver, imageTooLargeError, MIME_TYPES, resolveRemoteImageSource } from "./normalize/image";
import { resolveFileName } from "./output";
import type { PageSizeInput } from "./pageLayouts";
import type { PptxWriteFileProps } from "./pptx";
import { PuppeteerGen as CorePuppeteerGen, type PuppeteerGenOptions } from "./PuppeteerGen";
import { POWERPOINT_FACES } from "./target";

export function createNodeDocument(): Document {
    return new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
}

/** The image media type of `path` by its extension; `source` names it in the error. */
function imageMime(path: string, source: string): string {
    const mime = MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

    if (!mime.startsWith("image/")) {
        throw new Error(`Unsupported image type '${mime}': ${source}; an image path must end in .png, .jpg, .jpeg, .gif, .svg or .webp`);
    }

    return mime;
}

/**
 * Data URIs and http(s) URLs as in the core, plus file paths and file: URLs relative to the working directory,
 * or to `options.baseDir`, which then confines them. Errors name the path as given, not where it resolves, so
 * a service that passes them on does not disclose its directory layout.
 */
export async function resolveImageSource(source: string, options: ImageSourceOptions = {}): Promise<string> {
    if (/^(data:|https?:\/\/)/i.test(source)) {
        return resolveRemoteImageSource(source, options);
    }

    if (options.allowLocalPaths === false) {
        throw new Error(`Local image paths are not allowed (PuppeteerGen option imageSources.allowLocalPaths is false): ${source}; use a data URI${options.allowRemote === false ? "" : " or an http(s) URL"}`);
    }

    const path = source.startsWith("file:") ? fileURLToPath(source) : resolve(options.baseDir ?? process.cwd(), source);

    imageMime(path, source);
    // `path` with symlinks followed, or the error naming `source` when it cannot be read.
    let real: string;

    try {
        real = await realpath(path);
    } catch (error) {
        // `as`: fs errors are ErrnoExceptions
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Image file not found: ${source}`, { cause: error });
        }

        throw new Error(`Unable to read image file: ${source}`, { cause: error });
    }

    // The extension of the file actually read counts too: a symlink named like an image may point at anything.
    const mime = imageMime(real, source);

    if (options.baseDir !== undefined) {
        const base = await realpath(options.baseDir).catch((error: unknown) => {
            throw new Error(`PuppeteerGen option imageSources.baseDir is not a readable directory: ${options.baseDir}`, { cause: error });
        });
        const inside = relative(base, real);

        if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
            throw new Error(`Image path is outside imageSources.baseDir: ${source} (symlinks followed); move the image into the directory or use a data URI`);
        }
    }

    let file: FileHandle;

    try {
        file = await open(real);
    } catch (error) {
        throw new Error(`Unable to read image file: ${source}`, { cause: error });
    }

    try {
        // The size is checked on the opened file, so it cannot be swapped for a larger one before the read.
        const info = await file.stat();

        if (!info.isFile()) {
            throw new Error(`Image path is not a file: ${source}`);
        }

        const maxBytes = options.maxBytes ?? IMAGE_SOURCE_LIMITS.maxBytes;

        if (info.size > maxBytes) {
            throw imageTooLargeError(source, info.size, maxBytes);
        }

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
// fc-list's family names, one font per line, separated by commas (a comma inside a name is escaped).
const FC_LIST_SEPARATOR = /(?<!\\),/;
const FC_LIST_ESCAPE = /\\(.)/g;

/**
 * The lower-case family names of the installed fonts, listed once per process with fc-list (empty without
 * fontconfig): a face that is not installed then costs a set lookup, not an fc-match spawn, so a deck naming many
 * made-up faces neither blocks the event loop per name nor grows the caches below. Global for the reasons
 * installedFontMetrics is; set on the first lookup, never released. A font installed later is seen by a new process.
 */
let installedFamilies: ReadonlySet<string> | undefined;

function isInstalledFamily(fontFace: string): boolean {
    if (installedFamilies === undefined) {
        try {
            // A line per font file: the default 1 MiB output buffer is too small for large font collections.
            const output = execFileSync("fc-list", ["--format", "%{family}\\n"], { encoding: "utf8", timeout: FC_MATCH_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
            const families = new Set<string>();

            for (const line of output.split("\n")) {
                for (const family of line.split(FC_LIST_SEPARATOR)) {
                    families.add(family.replace(FC_LIST_ESCAPE, "$1").trim().toLowerCase());
                }
            }

            installedFamilies = families;
        } catch {
            // No fontconfig (macOS and Windows without it) or it failed: FONT_WIN_METRICS applies.
            installedFamilies = new Set();
        }
    }

    return installedFamilies.has(fontFace.toLowerCase());
}

/**
 * Installed fonts' metrics by lower-case face name, undefined when the face is not installed. Global because the
 * installed fonts are the process's environment, not a deck's, and each lookup spawns fc-match and reads a font file:
 * every presentation in the process shares it. Owned by resolveInstalledFontMetrics(); never released, and bounded by
 * the installed families: only a face fc-list names gets an entry. A font installed later is seen by a new process.
 */
const installedFontMetrics = new Map<string, FontWinMetrics | undefined>();

/**
 * Installed fonts' advances by weight, style and lower-case face name, undefined when the face is not installed. Global
 * for the reasons installedFontMetrics is, owned by resolveInstalledGlyphAdvances(); never released (one entry of a few
 * thousand advances per installed face, weight and style the process has used).
 */
const installedGlyphAdvances = new Map<string, GlyphAdvances | undefined>();

/**
 * The font fontconfig resolves `fontFace` to, in the weight and style `properties` asks for (`:bold:italic`), when its
 * family is `fontFace` itself (not a substitute); "missing" otherwise.
 */
function installedFontFile(fontFace: string, properties = ""): { kind: "installed"; file: string; index: number } | { kind: "missing" } {
    if (!isInstalledFamily(fontFace)) {
        return { kind: "missing" };
    }

    let output: string;

    try {
        output = execFileSync("fc-match", ["-f", FC_MATCH_FORMAT, `${fontFace.replace(FC_PATTERN_SPECIAL, "\\$&")}${properties}`], { encoding: "utf8", timeout: FC_MATCH_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        // No fontconfig (macOS and Windows without it) or it failed: FONT_WIN_METRICS applies.
        return { kind: "missing" };
    }

    const [file, index, families = ""] = output.split("\n");
    const face = fontFace.toLowerCase();

    // fc-match always answers with some font; only a font of the face's own family is the face.
    if (!file || !families.split(",").some(family => family.toLowerCase() === face)) {
        return { kind: "missing" };
    }

    return { kind: "installed", file, index: Number(index) & FC_FACE_INDEX_MASK };
}

/**
 * The default `resolveFontMetrics` of the Node entry: head.unitsPerEm and OS/2 usWinAscent and usWinDescent of the
 * regular font fontconfig resolves `fontFace` to, as Chromium does on Linux. Undefined when fontconfig is missing or has
 * no font of that family (a substitute does not count), or the font file cannot be read (with a warning). Cached per process.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function resolveInstalledFontMetrics(fontFace: string): FontWinMetrics | undefined {
    const key = fontFace.toLowerCase();

    if (!isInstalledFamily(fontFace)) {
        return undefined;
    }

    if (installedFontMetrics.has(key)) {
        return installedFontMetrics.get(key);
    }

    const font = installedFontFile(fontFace);
    let metrics: FontWinMetrics | undefined;

    if (font.kind === "installed") {
        try {
            metrics = readFontWinMetrics(readFileSync(font.file), font.index);
        } catch (error) {
            console.warn(`PdfLapas: cannot read the metrics of ${JSON.stringify(fontFace)} from ${font.file} (${error instanceof Error ? error.message : String(error)}); the PowerPoint target uses FONT_WIN_METRICS or the font-independent baseline for it.`);
        }
    }

    installedFontMetrics.set(key, metrics);

    return metrics;
}

/**
 * The default `resolveGlyphAdvances` of the Node entry: the advances of the font fontconfig resolves `fontFace` to in
 * that weight and style, the font Chromium draws it with on Linux. Undefined when fontconfig is missing or has no font
 * of that family, or the font file cannot be read (with a warning). Cached per process.
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function resolveInstalledGlyphAdvances(fontFace: string, bold: boolean, italic: boolean): GlyphAdvances | undefined {
    const properties = `${bold ? ":bold" : ""}${italic ? ":italic" : ""}`;
    const key = `${properties}:${fontFace.toLowerCase()}`;

    if (!isInstalledFamily(fontFace)) {
        return undefined;
    }

    if (installedGlyphAdvances.has(key)) {
        return installedGlyphAdvances.get(key);
    }

    const font = installedFontFile(fontFace, properties);
    let advances: GlyphAdvances | undefined;

    if (font.kind === "installed") {
        try {
            advances = readGlyphAdvances(readFileSync(font.file), font.index);
        } catch (error) {
            console.warn(`PdfLapas: cannot read the advances of ${JSON.stringify(fontFace)}${properties} from ${font.file} (${error instanceof Error ? error.message : String(error)}); the PowerPoint target keeps its natural advances.`);
        }
    }

    installedGlyphAdvances.set(key, advances);

    return advances;
}

/** Which faces checkPowerPointFonts() found installed, as named in POWERPOINT_FACES or `faces`. */
export interface PowerPointFontCheck {
    readonly present: readonly string[];
    readonly missing: readonly string[];
}

/**
 * Which of the faces the PowerPoint target needs (POWERPOINT_FACES), then of the deck's own `faces`, fontconfig has
 * installed: the families fc-list names, compared without case, as the font resolvers above see them. A missing face is
 * drawn in a substitute fontconfig picks without a warning. Never throws: without fontconfig every face is missing,
 * and the caller decides whether to warn or stop. `installedFamilies` replaces fc-list's listing.
 */
export function checkPowerPointFonts(options: { readonly faces?: readonly string[]; readonly installedFamilies?: Iterable<string> } = {}): PowerPointFontCheck {
    const installed = options.installedFamilies === undefined ? undefined : new Set([...options.installedFamilies].map(family => family.toLowerCase()));
    const faces = [...POWERPOINT_FACES.map(({ name }) => name), ...(options.faces ?? [])].filter((face, index, all) => all.findIndex(other => other.toLowerCase() === face.toLowerCase()) === index);
    const isPresent = (face: string) => (installed ? installed.has(face.toLowerCase()) : isInstalledFamily(face));

    return { present: faces.filter(isPresent), missing: faces.filter(face => !isPresent(face)) };
}

export class PuppeteerGen extends CorePuppeteerGen {
    constructor(pageSize?: PageSizeInput, options: PuppeteerGenOptions = {}) {
        const { imageSources: _applied, ...rest } = options;

        super(pageSize, {
            ...rest,
            renderer: options.renderer ?? new PuppeteerPdfRenderer(),
            resolveImage: imageResolver(options, resolveImageSource),
            createDocument: options.createDocument ?? createNodeDocument,
            resolveFontMetrics: options.resolveFontMetrics === undefined ? resolveInstalledFontMetrics : options.resolveFontMetrics,
            resolveGlyphAdvances: options.resolveGlyphAdvances === undefined ? resolveInstalledGlyphAdvances : options.resolveGlyphAdvances,
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
    constructor(pageSize?: PageSizeInput, options: Omit<PuppeteerGenOptions, "target"> = {}) {
        super(pageSize, { ...options, target: "libreoffice" });
    }
}

/** PuppeteerGen with the PowerPoint rendering target: the PDF matches PowerPoint's rendering of the .pptx (text under 12pt is not kerned). */
export class PuppeteerGenPowerPoint extends PuppeteerGen {
    constructor(pageSize?: PageSizeInput, options: Omit<PuppeteerGenOptions, "target"> = {}) {
        super(pageSize, { ...options, target: "powerpoint" });
    }
}
