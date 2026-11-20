// Browser-safe PDFKit renderer ("@pdflapas/pdfkit" under the browser/default conditions): pure JavaScript, no
// Chromium and no wasm. Must not load node:* modules, puppeteer or jsdom (enforced by scripts/build.ts).
import { type HtmlPresentationDocument, type MissingFont, type MissingFontPolicy, missingFontPolicy, type PresentationRenderer, reportMissingFonts } from "@pdflapas/model";
import { renderHtml } from "./document";
import { type Face, parseFonts } from "./fonts";

export { type MissingFont, MissingFontError, type MissingFontPolicy } from "@pdflapas/model";

export type UnsupportedPolicy = "error" | "warn";

export interface PdfkitRendererOptions {
    /** TTF/OTF/TTC font files, parsed once here. The renderer sees no system fonts; at least one is required. */
    fonts: readonly Uint8Array[];
    /**
     * What to do when the renderer skips something it cannot draw; each skip is one line of `warnings()`.
     * `"error"` (default) throws and lists them; `"warn"` returns the PDF and leaves the list in `warnings()`.
     */
    onUnsupported?: UnsupportedPolicy;
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

/** PDF backend on PDFKit: renders the PdfLapas HTML profile document `toHtml()` returns (docs/HTML_PROFILE.md). */
export class PdfkitRenderer implements PresentationRenderer {
    readonly #faces: readonly Face[];
    readonly #onUnsupported: UnsupportedPolicy;
    readonly #onMissingFont: MissingFontPolicy;
    #warnings: readonly string[] = [];
    #missingFonts: readonly MissingFont[] = [];

    // Takes the options, not parsed faces: a face holds a fontkit font, and naming it here would put fontkit's types in
    // the published declarations, which a strict consumer cannot resolve (#354).
    constructor({ fonts, onUnsupported = "error", onMissingFont }: PdfkitRendererOptions) {
        if (!fonts?.length) throw new Error("createPdfkitRenderer() requires at least one font: pass { fonts: [Uint8Array, ...] } (Node/Bun: await loadSystemFonts())");
        if (onUnsupported !== "error" && onUnsupported !== "warn") throw new Error(`onUnsupported must be "error" or "warn", got ${JSON.stringify(onUnsupported)}`);
        this.#faces = parseFonts(fonts);
        this.#onUnsupported = onUnsupported;
        this.#onMissingFont = missingFontPolicy(onMissingFont);
    }

    /** Parses the profile HTML once; out-of-profile or malformed HTML throws. Images must be data URIs. */
    async render(document: HtmlPresentationDocument): Promise<Uint8Array> {
        const result = await renderHtml(document.html, this.#faces);
        this.#warnings = result.warnings;
        this.#missingFonts = result.missingFonts;
        if (result.warnings.length && this.#onUnsupported !== "warn") {
            throw new Error(`The PDFKit renderer cannot draw everything in this presentation (pass { onUnsupported: "warn" } to render anyway):\n- ${result.warnings.join("\n- ")}`);
        }
        reportMissingFonts(result.missingFonts, this.#onMissingFont);
        return result.pdf;
    }

    /** What the last render could not draw. */
    warnings(): string[] {
        return [...this.#warnings];
    }

    /** The font faces the last render asked for that none of the renderer's fonts provides. */
    missingFonts(): MissingFont[] {
        return [...this.#missingFonts];
    }
}

export async function createPdfkitRenderer(options: PdfkitRendererOptions): Promise<PdfkitRenderer> {
    return new PdfkitRenderer(options);
}

export async function loadSystemFonts(_options?: SystemFontOptions): Promise<Uint8Array[]> {
    throw new Error("loadSystemFonts() reads the filesystem and is only available under Node/Bun; in a browser pass font bytes to createPdfkitRenderer({ fonts })");
}
