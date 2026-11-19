// Browser-safe WASM text renderer ("@pdflapas/wasm" under the browser/default conditions).
// Must not load node:* modules, puppeteer or jsdom (enforced by tests/wasm.test.ts and scripts/build.ts).
import { type HtmlPresentationDocument, type MissingFont, type MissingFontPolicy, missingFontPolicy, type PresentationRenderer, reportMissingFonts } from "@pdflapas/model";
import init, { Renderer } from "./pdf_wasm.js";

export { type MissingFont, MissingFontError, type MissingFontPolicy } from "@pdflapas/model";

/** One entry of the binding's `missingFonts()`: a wasm-owned object, released with `free()`. */
export interface MissingFontBinding {
    readonly face: string;
    readonly used?: string | undefined;
    readonly objects: string[];
    free(): void;
}

/** The wasm-bindgen surface the loader relies on; tests/wasm.test.ts checks the generated class against it. */
export interface TextPdfBinding {
    addFont(data: Uint8Array): number;
    renderHtml(html: string): Uint8Array;
    warnings(): string[];
    missingFonts(): MissingFontBinding[];
}

/** Where to load `pdf_wasm_bg.wasm` from; a subset of wasm-bindgen's `InitInput` without DOM-only types. */
export type WasmSource = URL | string | Response | ArrayBuffer | ArrayBufferView | WebAssembly.Module;

export interface WasmRendererOptions {
    /** TTF/OTF/TTC font files. WASM cannot see system fonts; at least one is required. */
    fonts: readonly Uint8Array[];
    /** The `pdf_wasm_bg.wasm` module: a URL, bytes, a Response or a compiled module. Defaults to the file next to this module. */
    wasm?: WasmSource | Promise<WasmSource>;
    /**
     * What to do when the renderer skips something it cannot draw; each skip is one line of
     * `warnings()`. `"error"` (default) throws and lists them; `"warn"` returns the PDF and leaves
     * the list in `warnings()`.
     */
    onUnsupported?: "error" | "warn";
    /**
     * What to do when a text run asks for a face none of `fonts` provides, neither the face nor its metric-compatible
     * alias (Calibri -> Carlito, Arial -> Liberation Sans, ...): `"warn"` (default), `"throw"` (`MissingFontError`),
     * `"ignore"`, or a function receiving the list. Not part of `onUnsupported`: the text is drawn, in a fallback face.
     */
    onMissingFont?: MissingFontPolicy;
}

export interface SystemFontOptions {
    /** Directories searched recursively. Defaults to the platform's system and user font directories. */
    dirs?: readonly string[];
    /** Font file basenames to load. Defaults to the metric-compatible fallback set and the Office faces they stand in for. */
    match?: RegExp;
}

/**
 * PDF backend in WebAssembly instead of Chromium: renders the PdfLapas HTML profile document
 * `toHtml()` returns (docs/HTML_PROFILE.md).
 */
export class WasmRenderer implements PresentationRenderer {
    readonly #binding: TextPdfBinding;
    readonly #onUnsupported: "error" | "warn";
    readonly #onMissingFont: MissingFontPolicy;

    constructor(binding: TextPdfBinding, onUnsupported: "error" | "warn" = "error", onMissingFont?: MissingFontPolicy) {
        this.#binding = binding;
        this.#onUnsupported = onUnsupported;
        this.#onMissingFont = missingFontPolicy(onMissingFont);
    }

    /** Parses the profile HTML in WebAssembly; out-of-profile or malformed HTML throws, naming slide, object and property. Images must be data URIs. */
    async render(document: HtmlPresentationDocument): Promise<Uint8Array> {
        return this.#checked(this.#binding.renderHtml(document.html));
    }

    #checked(pdf: Uint8Array): Uint8Array {
        const skipped = this.#binding.warnings();
        if (skipped.length && this.#onUnsupported !== "warn") {
            throw new Error(`The WASM renderer cannot draw everything in this presentation (pass { onUnsupported: "warn" } to render anyway):\n- ${skipped.join("\n- ")}`);
        }
        reportMissingFonts(this.missingFonts(), this.#onMissingFont);
        return pdf;
    }

    /** What the last render could not draw. */
    warnings(): string[] {
        return this.#binding.warnings();
    }

    /** The font faces the last render asked for that none of the renderer's fonts provides. */
    missingFonts(): MissingFont[] {
        return this.#binding.missingFonts().map(entry => {
            const { face, used, objects } = entry;
            entry.free();
            return { face, objects, ...(used ? { usedFace: used } : {}) };
        });
    }
}

export async function createWasmRenderer(options: WasmRendererOptions): Promise<WasmRenderer> {
    if (!options.fonts?.length) throw new Error("createWasmRenderer() requires at least one font: pass { fonts: [Uint8Array, ...] } (Node/Bun: await loadSystemFonts())");
    await init({ module_or_path: options.wasm ?? new URL("./pdf_wasm_bg.wasm", import.meta.url) });
    const binding: TextPdfBinding = new Renderer();
    options.fonts.forEach((font, index) => {
        if (binding.addFont(font) === 0) throw new Error(`Font #${index} contains no usable font faces`);
    });
    return new WasmRenderer(binding, options.onUnsupported, options.onMissingFont);
}

export async function loadSystemFonts(_options?: SystemFontOptions): Promise<Uint8Array[]> {
    throw new Error("loadSystemFonts() reads the filesystem and is only available under Node/Bun; in a browser pass font bytes to createWasmRenderer({ fonts })");
}
