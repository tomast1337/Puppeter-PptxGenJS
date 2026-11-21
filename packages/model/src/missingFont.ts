/** A font face the deck asks for that the renderer could not use: its text was drawn in another face, so it can wrap differently. */
export interface MissingFont {
    /** The face as the deck names it (`fontFace`). */
    readonly face: string;
    /** The objects asking for it, as `slide <n> '<object name>'` (`#<index>` for an unnamed one), sorted. */
    readonly objects: readonly string[];
    /** The face the text was drawn in instead, when the renderer knows it. */
    readonly usedFace?: string;
}

/**
 * What a renderer does when the deck asks for a font face it cannot use: `"warn"` writes the list with `console.warn`,
 * `"throw"` rejects with a `MissingFontError`, `"ignore"` renders silently, and a function receives the list.
 */
export type MissingFontPolicy = "warn" | "throw" | "ignore" | ((missing: readonly MissingFont[]) => void);

/** Warn, not throw: a deck keeps rendering where its fonts are not installed, as it did before the check. */
export const DEFAULT_MISSING_FONT_POLICY = "warn" satisfies MissingFontPolicy;

/** Thrown under `onMissingFont: "throw"`; `missing` lists every face the renderer could not use. */
export class MissingFontError extends Error {
    readonly missing: readonly MissingFont[];

    constructor(missing: readonly MissingFont[]) {
        super(`${missingFontsMessage(missing)}\nInstall the fonts (Puppeteer) or pass their files to createWasmRenderer({ fonts }) (WASM), or set onMissingFont: "warn" or "ignore" on the renderer.`);
        this.name = "MissingFontError";
        this.missing = missing;
    }
}

function missingFontsMessage(missing: readonly MissingFont[]): string {
    const lines = missing.map(({ face, objects, usedFace }) => `- ${JSON.stringify(face)}${usedFace ? `, drawn in ${JSON.stringify(usedFace)}` : ""}: ${objects.join(", ")}`);

    return `PdfLapas: font faces not available to the renderer, their text uses a fallback face and can wrap differently:\n${lines.join("\n")}`;
}

/** The renderer option `onMissingFont`, checked where the renderer is created: the default when absent. */
export function missingFontPolicy(option: unknown): MissingFontPolicy {
    if (option === undefined) {
        return DEFAULT_MISSING_FONT_POLICY;
    }

    if (option === "warn" || option === "throw" || option === "ignore" || typeof option === "function") {
        return option as MissingFontPolicy;
    } // `as`: a caller's function is assumed to take the list

    throw new Error(`onMissingFont must be "warn", "throw", "ignore" or a function receiving the missing fonts, got ${JSON.stringify(option)}`);
}

/** Applies `policy` to the faces a render could not use; does nothing when there are none. */
export function reportMissingFonts(missing: readonly MissingFont[], policy: MissingFontPolicy): void {
    if (!missing.length || policy === "ignore") {
        return;
    }

    if (typeof policy === "function") {
        policy(missing);
    } else if (policy === "throw") {
        throw new MissingFontError(missing);
    } else {
        console.warn(missingFontsMessage(missing));
    }
}
