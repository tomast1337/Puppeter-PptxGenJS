// Node/Bun WASM text renderer ("@pdfdeck/wasm" under the node/bun conditions):
// reads the .wasm next to this module and can load fonts from the system font directories.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmRenderer as createBrowserWasmRenderer, type SystemFontOptions, type WasmRenderer, type WasmRendererOptions } from "./browser";

export type { SystemFontOptions, TextPdfBinding, WasmRendererOptions, WasmSource } from "./browser";
export { WasmRenderer } from "./browser";

export async function createWasmRenderer(options: WasmRendererOptions): Promise<WasmRenderer> {
    // Without fonts, let the shared loader report that before touching the filesystem.
    if (options.wasm !== undefined || !options.fonts?.length) return createBrowserWasmRenderer(options);
    const path = fileURLToPath(new URL("./pdf_wasm_bg.wasm", import.meta.url));
    const wasm = await readFile(path).catch((error: unknown) => {
        throw new Error(`WASM renderer binary not found at ${path}; build it with \`bun run build:wasm\` or pass { wasm }`, { cause: error });
    });
    return createBrowserWasmRenderer({ ...options, wasm });
}

// The metric-compatible faces the renderer's fallback chain maps Office fonts to (Calibri->Carlito,
// Cambria->Caladea, Arial->Liberation Sans, ... then DejaVu Sans), emoji/CJK fallbacks, plus the Office faces themselves.
const DEFAULT_FONT_FILES = /^(?:(?:Carlito|Caladea|LiberationSans|LiberationSerif|LiberationMono)-.*|DejaVuSans(?:-Bold|-Oblique|-BoldOblique)?|NotoColorEmoji|NotoSansCJK-(?:Regular|Bold)|calibri.*|cambria.*|arial.*|times.*|cour.*)\.(?:ttf|otf|ttc)$/i;

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

/** Reads font files from the system font directories, for `createWasmRenderer({ fonts })`. Throws when none match. */
export async function loadSystemFonts({ dirs = systemFontDirs(), match = DEFAULT_FONT_FILES }: SystemFontOptions = {}): Promise<Uint8Array[]> {
    const files = (await Promise.all(dirs.map(dir => fontFiles(dir, match)))).flat().sort();
    if (!files.length) throw new Error(`No font files matching ${match} in ${dirs.join(", ")}; install Carlito, Caladea, Liberation and DejaVu fonts or pass { dirs, match }`);
    return Promise.all(files.map(async file => new Uint8Array(await readFile(file))));
}
