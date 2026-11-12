// Browser-safe WASM text renderer ("puppeteer-pptxgenjs/wasm" under the browser/default conditions).
// Must not load node:* modules, puppeteer or jsdom (enforced by tests/wasm.test.ts and scripts/build.ts).
import type { NormalizedPresentation } from "../model/types";
import type { ModelRenderer } from "../render/document";
import init, { Renderer } from "./text_pdf_wasm.js";

/** The wasm-bindgen surface the loader relies on; tests/wasm.test.ts checks the generated class against it. */
export interface TextPdfBinding {
    addFont(data: Uint8Array): number;
    render(modelJson: string): Uint8Array;
    warnings(): string[];
}

/** Where to load `text_pdf_wasm_bg.wasm` from; a subset of wasm-bindgen's `InitInput` without DOM-only types. */
export type WasmSource = URL | string | Response | ArrayBuffer | ArrayBufferView | WebAssembly.Module;

export interface WasmRendererOptions {
    /** TTF/OTF/TTC font files. WASM cannot see system fonts; at least one is required. */
    fonts: readonly Uint8Array[];
    /** The `text_pdf_wasm_bg.wasm` module: a URL, bytes, a Response or a compiled module. Defaults to the file next to this module. */
    wasm?: WasmSource | Promise<WasmSource>;
    /**
     * What to do when the model holds something this backend cannot draw (non-text objects,
     * preset shapes other than rect/roundRect, shadows, tab stops...). `"error"` (default) throws
     * and lists them; `"warn"` returns the PDF and leaves the list in `warnings()`.
     */
    onUnsupported?: "error" | "warn";
}

export interface SystemFontOptions {
    /** Directories searched recursively. Defaults to the platform's system and user font directories. */
    dirs?: readonly string[];
    /** Font file basenames to load. Defaults to the metric-compatible fallback set and the Office faces they stand in for. */
    match?: RegExp;
}

/** Text-only PDF backend: renders `getModel()` in WebAssembly instead of printing HTML in Chromium. */
export class WasmRenderer implements ModelRenderer {
    readonly #binding: TextPdfBinding;
    readonly #onUnsupported: "error" | "warn";

    constructor(binding: TextPdfBinding, onUnsupported: "error" | "warn" = "error") {
        this.#binding = binding;
        this.#onUnsupported = onUnsupported;
    }

    async renderModel(model: NormalizedPresentation): Promise<Uint8Array> {
        const pdf = this.#binding.render(JSON.stringify(model));
        const skipped = this.#binding.warnings();
        if (skipped.length && this.#onUnsupported !== "warn") {
            throw new Error(`The WASM renderer cannot draw everything in this presentation (pass { onUnsupported: "warn" } to render anyway):\n- ${skipped.join("\n- ")}`);
        }
        return pdf;
    }

    /** What the last render could not draw. */
    warnings(): string[] {
        return this.#binding.warnings();
    }
}

export async function createWasmRenderer(options: WasmRendererOptions): Promise<WasmRenderer> {
    if (!options.fonts?.length) throw new Error("createWasmRenderer() requires at least one font: pass { fonts: [Uint8Array, ...] } (Node/Bun: await loadSystemFonts())");
    await init({ module_or_path: options.wasm ?? new URL("./text_pdf_wasm_bg.wasm", import.meta.url) });
    const binding: TextPdfBinding = new Renderer();
    options.fonts.forEach((font, index) => {
        if (binding.addFont(font) === 0) throw new Error(`Font #${index} contains no usable font faces`);
    });
    return new WasmRenderer(binding, options.onUnsupported);
}

export async function loadSystemFonts(_options?: SystemFontOptions): Promise<Uint8Array[]> {
    throw new Error('loadSystemFonts() reads the filesystem and is only available under Node/Bun; in a browser pass font bytes to createWasmRenderer({ fonts })');
}
