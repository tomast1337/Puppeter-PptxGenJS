// Node/Bun PDFKit renderer ("@pdflapas/pdfkit" under the node/bun conditions): the browser-safe renderer plus
// loading fonts from the system font directories.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SystemFontOptions } from "./browser";

export { createPdfkitRenderer, type MissingFont, MissingFontError, type MissingFontPolicy, PdfkitRenderer, type PdfkitRendererOptions, type SystemFontOptions, type UnsupportedPolicy } from "./browser";

// The faces the renderer's fallback chain maps Office fonts to (Calibri->Carlito, Cambria->Caladea, Arial->Liberation
// Sans, ... then DejaVu Sans), CJK fallbacks, plus the Office faces themselves: @pdflapas/wasm's set without the
// bitmap emoji font, which has no outlines for PDFKit to embed.
const DEFAULT_FONT_FILES = /^(?:(?:Carlito|Caladea|LiberationSans|LiberationSerif|LiberationMono)-.*|DejaVuSans(?:-Bold|-Oblique|-BoldOblique)?|NotoSansCJK-(?:Regular|Bold)|calibri.*|cambria.*|arial.*|times.*|cour.*)\.(?:ttf|otf|ttc)$/i;

function systemFontDirs(): string[] {
    if (process.platform === "win32") return [join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), join(process.env.LOCALAPPDATA ?? "", "Microsoft/Windows/Fonts")];
    if (process.platform === "darwin") return ["/System/Library/Fonts", "/Library/Fonts", join(homedir(), "Library/Fonts")];
    return ["/usr/share/fonts", "/usr/local/share/fonts", join(homedir(), ".local/share/fonts"), join(homedir(), ".fonts")];
}

async function fontFiles(dir: string, match: RegExp): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? fontFiles(join(dir, entry.name), match) : match.test(entry.name) ? [join(dir, entry.name)] : [])));
    return nested.flat();
}

/** Reads font files from the system font directories, for `createPdfkitRenderer({ fonts })`. Throws when none match. */
export async function loadSystemFonts({ dirs = systemFontDirs(), match = DEFAULT_FONT_FILES }: SystemFontOptions = {}): Promise<Uint8Array[]> {
    const files = (await Promise.all(dirs.map(dir => fontFiles(dir, match)))).flat().sort();
    if (!files.length) throw new Error(`No font files matching ${match} in ${dirs.join(", ")}; install Carlito, Caladea, Liberation and DejaVu fonts or pass { dirs, match }`);
    return Promise.all(files.map(async file => new Uint8Array(await readFile(file))));
}
