// Loads the same `Renderer` surface from either binding, as the /html (WASM)
// and node (native addon) entry points would.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TextPdfRenderer {
    addFont(bytes: Uint8Array): number;
    render(modelJson: string): Uint8Array;
    warnings(): string[];
}

export type BackendKind = "wasm" | "native";

const root = new URL("..", import.meta.url).pathname;

export async function createRenderer(kind: BackendKind): Promise<TextPdfRenderer> {
    if (kind === "native") {
        const { Renderer } = require(join(root, "text_pdf_node.node"));
        return new Renderer();
    }
    const wasm = await import(join(root, "pkg/text_pdf_wasm.js"));
    await wasm.default({ module_or_path: readFileSync(join(root, "pkg/text_pdf_wasm_bg.wasm")) });
    return new wasm.Renderer();
}

// The faces the visual image installs (tests/visual/Dockerfile). WASM cannot
// see system fonts, so the harness reads them and passes the bytes in.
// The spike image (spike/wasm-text/Dockerfile) adds Noto Color Emoji and Noto Sans CJK.
const FONT_FILE = /^(?:(?:(?:Carlito|Caladea|LiberationSans|LiberationSerif|LiberationMono)-.*|DejaVuSans(?:-Bold|-Oblique|-BoldOblique)?|NotoColorEmoji)\.ttf|NotoSansCJK-(?:Regular|Bold)\.ttc)$/;

export function fontFiles(dirs = (process.env.FONT_DIRS ?? "/usr/share/fonts").split(":")): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (FONT_FILE.test(entry.name)) found.push(path);
        }
    };
    dirs.forEach(walk);
    return found.sort();
}

export function loadFonts(renderer: TextPdfRenderer, files = fontFiles()): number {
    return files.reduce((faces, file) => faces + renderer.addFont(readFileSync(file)), 0);
}
