// The renderer's fonts: parsed once with fontkit when the renderer is created, matched to each run's face, and
// searched per character for a face that has its glyph (Chromium's and pdf-core's per-character fallback).
import { create, type Font } from "fontkit";

/** One face of the caller's font files. `key` names it in the PDFKit document. */
export interface Face {
    readonly key: string;
    readonly font: Font;
    readonly families: readonly string[];
    readonly bold: boolean;
    readonly italic: boolean;
}

/** What a run asks for: `font-family` (its face, then the target's fallback faces), `lang`, `font-weight: bold`, `font-style: italic`. */
export interface FaceRequest {
    readonly family: string;
    readonly fallbacks: readonly string[];
    readonly lang?: string;
    readonly bold: boolean;
    readonly italic: boolean;
}

/** The faces a run's characters are looked up in, in order, and whether its own face (or alias) was among them. */
export interface FaceChain {
    readonly faces: readonly Face[];
    readonly found: boolean;
}

// The metric-compatible face the visual image's fontconfig (30-metric-aliases.conf) picks for an Office face, and the
// faces tried after it: the same table as crates/pdf-core/src/text/font.rs, so both renderers draw a deck in one face.
const METRIC_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    calibri: "carlito",
    "calibri light": "carlito",
    cambria: "caladea",
    arial: "liberation sans",
    helvetica: "liberation sans",
    "segoe ui": "liberation sans",
    "arial narrow": "liberation sans narrow",
    "times new roman": "liberation serif",
    times: "liberation serif",
    "courier new": "liberation mono",
    courier: "liberation mono",
});
const FALLBACK_FAMILIES: readonly string[] = Object.freeze(["dejavu sans", "liberation sans", "noto sans cjk jp"]);
/** The CJK face tried for a run's `lang` before FALLBACK_FAMILIES: pdf-core's CJK_FALLBACK_BY_LANG, after Chromium. */
const CJK_FALLBACK_BY_LANG: Readonly<Record<string, string>> = Object.freeze({
    ja: "noto sans cjk jp",
    ko: "noto sans cjk kr",
    "zh-cn": "noto sans cjk sc",
    "zh-tw": "noto sans cjk tc",
    "zh-hk": "noto sans cjk hk",
});
/** Tables that hold glyph outlines; a face without them (a bitmap color emoji font) cannot be drawn by PDFKit. */
const OUTLINE_TABLES: readonly string[] = Object.freeze(["glyf", "CFF ", "CFF2"]);
const BOLD_WEIGHT = 600;
/** Name table ids: the family (1) and the typographic family (16), which groups weights beyond regular and bold. */
const FAMILY_NAMES: readonly string[] = Object.freeze(["fontFamily", "preferredFamily"]);

/** Parses the caller's font files (TTF, OTF or TTC). Throws naming the file that holds no usable face. */
export function parseFonts(files: readonly Uint8Array[]): Face[] {
    const faces: Face[] = [];

    for (const [index, bytes] of files.entries()) {
        let parsed: ReturnType<typeof create>;

        try {
            parsed = create(bytes as Buffer); // `as`: fontkit reads any Uint8Array; its types name Node's Buffer
        } catch (error) {
            throw new Error(`Font #${index} is not a TTF, OTF or TTC font file`, { cause: error });
        }

        const fonts = "fonts" in parsed ? parsed.fonts : [parsed];
        const drawable: Font[] = [];

        for (const font of fonts) {
            // `as`: fontkit keeps the table directory on the font; @types/fontkit does not declare it.
            const tables = (font as unknown as { directory?: { tables?: Record<string, unknown> } }).directory?.tables ?? {};

            if (OUTLINE_TABLES.some(tag => tag in tables)) {
                drawable.push(font);
            }
        }

        if (!drawable.length) {
            throw new Error(`Font #${index} contains no usable font faces (PDFKit draws outline glyphs only, not bitmap color fonts)`);
        }

        for (const font of drawable) {
            const families: string[] = [];

            for (const name of FAMILY_NAMES) {
                const family = font.getName(name, "en")?.toLowerCase();

                if (family) {
                    families.push(family);
                }
            }

            const os2 = font["OS/2"] as { usWeightClass?: number; fsSelection?: { italic?: boolean; bold?: boolean } } | undefined; // `as`: the declared Os2Table omits these fields
            const bold = (os2?.fsSelection?.bold ?? false) || (os2?.usWeightClass ?? 0) >= BOLD_WEIGHT;
            const italic = (os2?.fsSelection?.italic ?? false) || font.italicAngle !== 0;

            faces.push({ key: `F${faces.length}`, font, families: [...new Set(families.length ? families : [font.familyName.toLowerCase()])], bold, italic });
        }
    }

    return faces;
}

/** The face of `family` that best matches the requested style: exact, then the same weight, then any. */
function bestFace(faces: readonly Face[], family: string, bold: boolean, italic: boolean): { kind: "face"; face: Face } | { kind: "none" } {
    const candidates = faces.filter(face => face.families.includes(family));
    const face = candidates.find(candidate => candidate.bold === bold && candidate.italic === italic) ?? candidates.find(candidate => candidate.bold === bold) ?? candidates[0];

    return face === undefined ? { kind: "none" } : { kind: "face", face };
}

/** A family's face, or its metric alias's when the family has none: fontconfig aliases only a face it has no font for. */
function familyFace(faces: readonly Face[], family: string, bold: boolean, italic: boolean): { kind: "face"; face: Face } | { kind: "none" } {
    const name = family.toLowerCase();
    const alias = METRIC_ALIASES[name];
    const own = bestFace(faces, name, bold, italic);

    if (own.kind === "face" || !alias) {
        return own;
    }

    return bestFace(faces, alias, bold, italic);
}

/**
 * The lookup chain for a request, as pdf-core's `family_stack`: its face (or metric alias), its fallback faces (each
 * or its alias), the CJK face of its `lang`, then the fallback families.
 */
export function faceChain(faces: readonly Face[], { family, fallbacks, lang, bold, italic }: FaceRequest): FaceChain {
    const own = familyFace(faces, family, bold, italic);
    const byLang = lang === undefined ? undefined : CJK_FALLBACK_BY_LANG[lang.toLowerCase()];
    const chain: Face[] = own.kind === "face" ? [own.face] : [];

    for (const name of [...fallbacks, ...(byLang ? [byLang] : []), ...FALLBACK_FAMILIES]) {
        const fallback = familyFace(faces, name, bold, italic);

        if (fallback.kind === "face") {
            chain.push(fallback.face);
        }
    }

    if (faces[0] !== undefined) {
        chain.push(faces[0]);
    }

    return { faces: [...new Set(chain)], found: own.kind === "face" };
}

/** The first face of `chain` with a glyph for `codePoint`. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function faceFor(chain: FaceChain, codePoint: number): Face | undefined {
    return chain.faces.find(face => face.font.hasGlyphForCodePoint(codePoint));
}

/** The family a missing face's text was drawn in: the first fallback family the caller supplied. */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function fallbackFamily(chain: FaceChain): string | undefined {
    return chain.faces[0]?.font.familyName;
}
