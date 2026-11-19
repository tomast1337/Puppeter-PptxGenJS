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

/** What a run asks for: `font-family`, `font-weight: bold`, `font-style: italic`. */
export interface FaceRequest {
    readonly family: string;
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
/** Tables that hold glyph outlines; a face without them (a bitmap color emoji font) cannot be drawn by PDFKit. */
const OUTLINE_TABLES: readonly string[] = Object.freeze(["glyf", "CFF ", "CFF2"]);
const BOLD_WEIGHT = 600;
/** Name table ids: the family (1) and the typographic family (16), which groups weights beyond regular and bold. */
const FAMILY_NAMES: readonly string[] = Object.freeze(["fontFamily", "preferredFamily"]);

function hasOutlines(font: Font): boolean {
    // `as`: fontkit keeps the table directory on the font; @types/fontkit does not declare it.
    const tables = (font as unknown as { directory?: { tables?: Record<string, unknown> } }).directory?.tables ?? {};
    return OUTLINE_TABLES.some(tag => tag in tables);
}

function faceOf(font: Font, key: string): Face {
    const families = FAMILY_NAMES.map(name => font.getName(name, "en")?.toLowerCase()).filter((name): name is string => !!name);
    const os2 = font["OS/2"] as { usWeightClass?: number; fsSelection?: { italic?: boolean; bold?: boolean } } | undefined; // `as`: the declared Os2Table omits these fields
    const bold = (os2?.fsSelection?.bold ?? false) || (os2?.usWeightClass ?? 0) >= BOLD_WEIGHT;
    const italic = (os2?.fsSelection?.italic ?? false) || font.italicAngle !== 0;
    return { key, font, families: [...new Set(families.length ? families : [font.familyName.toLowerCase()])], bold, italic };
}

/** Parses the caller's font files (TTF, OTF or TTC). Throws naming the file that holds no usable face. */
export function parseFonts(files: readonly Uint8Array[]): Face[] {
    const faces: Face[] = [];
    files.forEach((bytes, index) => {
        let parsed: ReturnType<typeof create>;
        try {
            parsed = create(bytes as Buffer); // `as`: fontkit reads any Uint8Array; its types name Node's Buffer
        } catch (error) {
            throw new Error(`Font #${index} is not a TTF, OTF or TTC font file`, { cause: error });
        }
        const fonts = "fonts" in parsed ? parsed.fonts : [parsed];
        const drawable = fonts.filter(hasOutlines);
        if (!drawable.length) throw new Error(`Font #${index} contains no usable font faces (PDFKit draws outline glyphs only, not bitmap color fonts)`);
        for (const font of drawable) faces.push(faceOf(font, `F${faces.length}`));
    });
    return faces;
}

/** The face of `family` that best matches the requested style: exact, then the same weight, then any. */
function bestFace(faces: readonly Face[], family: string, bold: boolean, italic: boolean): Face | undefined {
    const candidates = faces.filter(face => face.families.includes(family));
    return candidates.find(face => face.bold === bold && face.italic === italic) ?? candidates.find(face => face.bold === bold) ?? candidates[0];
}

/** The lookup chain for a request: its face, its metric alias, then the fallback families. */
export function faceChain(faces: readonly Face[], { family, bold, italic }: FaceRequest): FaceChain {
    const requested = family.toLowerCase();
    const alias = METRIC_ALIASES[requested];
    const own = [requested, ...(alias ? [alias] : [])].map(name => bestFace(faces, name, bold, italic));
    const fallbacks = FALLBACK_FAMILIES.map(name => bestFace(faces, name, bold, italic));
    const chain = [...new Set([...own, ...fallbacks, faces[0]].filter((face): face is Face => face !== undefined))];
    return { faces: chain, found: own.some(face => face !== undefined) };
}

/** The first face of `chain` with a glyph for `codePoint`. */
export function faceFor(chain: FaceChain, codePoint: number): Face | undefined {
    return chain.faces.find(face => face.font.hasGlyphForCodePoint(codePoint));
}

/** The family a missing face's text was drawn in: the first fallback family the caller supplied. */
export function fallbackFamily(chain: FaceChain): string | undefined {
    return chain.faces[0]?.font.familyName;
}
