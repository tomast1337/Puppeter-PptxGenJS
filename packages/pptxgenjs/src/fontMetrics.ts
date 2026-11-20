// Font win metrics: the caller's `fontMetrics` option and `resolveFontMetrics` resolver over FONT_WIN_METRICS, and
// reading them from font bytes; glyph advances for the PowerPoint target's advance grid (`resolveGlyphAdvances`) the same
// way. Browser-safe: bytes in, no node:* module.
import { z } from "zod";
import { FONT_WIN_METRICS, type FontMetricsLookup, type FontMetricsTable, type FontWinMetrics, type GlyphAdvanceLookup, type GlyphAdvances } from "./defaults";

const integer = (min: 0 | 1, what: string) => z.int({ error: `must be ${what}` }).min(min, { error: `must be ${what}` });

const FONT_WIN_METRICS_SCHEMA = z
    .strictObject({
        unitsPerEm: integer(1, "a positive integer (head.unitsPerEm)"),
        winAscent: integer(0, "a non-negative integer (OS/2 usWinAscent)"),
        winDescent: integer(0, "a non-negative integer (OS/2 usWinDescent)"),
        pairKerning: z.boolean({ error: "must be a boolean (whether PowerPoint pair-kerns the font)" }).optional(),
    })
    .refine(metrics => metrics.winAscent + metrics.winDescent > 0, { error: "winAscent + winDescent must be greater than 0" });

const FONT_METRICS_OPTION_SCHEMA = z.record(z.string(), FONT_WIN_METRICS_SCHEMA, { error: "must be an object keyed by font face name" });

const HOW_TO_FIX = 'Pass font units from the font\'s head and OS/2 tables, e.g. fontMetrics: { "My Brand Sans": readFontWinMetrics(fontBytes) }.';

/** The PuppeteerGen `fontMetrics` option checked and keyed by lower-case face name, frozen. */
function callerFontMetrics(option: unknown): FontMetricsTable {
    if (option === undefined) return Object.freeze({});
    const parsed = FONT_METRICS_OPTION_SCHEMA.safeParse(option);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const [face, field] = issue?.path ?? [];
        const where = face === undefined ? "" : `[${JSON.stringify(String(face))}]${field === undefined ? "" : `.${String(field)}`}`;
        throw new TypeError(`PuppeteerGen option \`fontMetrics${where}\` ${issue?.message ?? "is invalid"}. ${HOW_TO_FIX}`);
    }
    const faces = new Map<string, string>();
    for (const face of Object.keys(parsed.data)) {
        const other = faces.get(face.toLowerCase());
        if (other !== undefined) throw new TypeError(`PuppeteerGen option \`fontMetrics\` lists ${JSON.stringify(other)} and ${JSON.stringify(face)}, the same face (names are case-insensitive); keep one.`);
        faces.set(face.toLowerCase(), face);
    }
    // fromEntries defines own properties, so a face named "__proto__" stays an entry.
    return Object.freeze(Object.fromEntries(Object.entries(parsed.data).map(([face, metrics]) => [face.toLowerCase(), Object.freeze({ ...metrics })])));
}

/** `resolve(fontFace)` checked: undefined (not found) or valid metrics. Anything else is the resolver's bug, so it throws. */
function resolvedFontMetrics(resolve: FontMetricsLookup, fontFace: string): FontWinMetrics | undefined {
    const resolved: unknown = resolve(fontFace);
    if (resolved === undefined) return undefined;
    const parsed = FONT_WIN_METRICS_SCHEMA.safeParse(resolved);
    if (parsed.success) return Object.freeze(parsed.data);
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === undefined ? "" : `${String(issue.path[0])} `;
    throw new TypeError(`PuppeteerGen option \`resolveFontMetrics\` returned invalid metrics for ${JSON.stringify(fontFace)}: ${field}${issue?.message ?? "is invalid"}. Return undefined for a face it cannot find, or readFontWinMetrics(fontBytes).`);
}

/**
 * The metrics the PowerPoint target reads for a face, case-insensitively: the caller's `fontMetrics` option, else
 * `resolve` (the Node entry reads the installed font), else FONT_WIN_METRICS; undefined keeps the font-independent
 * baseline. `resolve` runs only when a face is looked up, at most once per face for the presentation that owns the lookup.
 * Its `glyphAdvances` looks a face's advances up through `resolveAdvances` the same way, per weight and style; without
 * one, no face has advances.
 */
export function fontMetricsLookup(option: unknown, resolve: FontMetricsLookup | null | undefined, resolveAdvances?: unknown): FontMetricsLookup {
    if (resolve !== undefined && resolve !== null && typeof resolve !== "function") throw new TypeError(`PuppeteerGen option \`resolveFontMetrics\` must be a function, or null to turn the lookup off; got ${typeof resolve}.`);
    const caller = callerFontMetrics(option);
    const resolved = new Map<string, FontWinMetrics | undefined>();
    const glyphAdvances = glyphAdvanceLookup(resolveAdvances);
    const lookup = (fontFace: string): FontWinMetrics | undefined => {
        const key = fontFace.toLowerCase();
        if (Object.hasOwn(caller, key)) return caller[key];
        if (resolve) {
            if (!resolved.has(key)) resolved.set(key, resolvedFontMetrics(resolve, fontFace));
            const metrics = resolved.get(key);
            if (metrics) return metrics;
        }
        return builtInFontMetrics(fontFace);
    };
    return glyphAdvances ? Object.assign(lookup, { glyphAdvances }) : lookup;
}

/** `fontFace`'s FONT_WIN_METRICS, case-insensitively; an own property only, so a face named "constructor" finds nothing. */
export function builtInFontMetrics(fontFace: string): FontWinMetrics | undefined {
    const key = fontFace.toLowerCase();
    return Object.hasOwn(FONT_WIN_METRICS, key) ? FONT_WIN_METRICS[key] : undefined;
}

/** Font bytes readFontWinMetrics() or readGlyphAdvances() cannot read: not an sfnt (TrueType/OpenType) font, or truncated or inconsistent. */
export class FontFileError extends Error {
    constructor(message: string, reader: FontReader = "readFontWinMetrics") {
        super(`${reader}: ${message}`);
        this.name = "FontFileError";
    }
}

// sfnt offsets (OpenType spec): table directory, then 16-byte table records (tag, checksum, offset, length).
const SFNT_VERSIONS: ReadonlySet<number> = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);
const TTC_TAG = 0x74746366; // ttcf
// TTC header: tag, version, numFonts at 8, then one uint32 font offset per face from 12.
const TTC_FONT_COUNT = 8;
const TTC_FONT_OFFSETS = 12;
const TABLE_DIRECTORY_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const HEAD_UNITS_PER_EM = 18;
const HHEA_NUMBER_OF_H_METRICS = 34;
const MAXP_NUM_GLYPHS = 4;
// hmtx: a uint16 advanceWidth and an int16 lsb per long metric; glyphs past numberOfHMetrics take the last advance.
const HMTX_RECORD_SIZE = 4;
// cmap: uint16 version and numTables, then 8-byte encoding records (uint16 platformID, encodingID, uint32 offset) from 4.
const CMAP_TABLES = 2;
const CMAP_RECORDS = 4;
const CMAP_RECORD_SIZE = 8;
// Format 4 (BMP segments): uint16 segCountX2 at 6, then the endCode, startCode (after a uint16 pad), idDelta and
// idRangeOffset arrays from 14.
const CMAP4_SEG_COUNT_X2 = 6;
const CMAP4_END_CODES = 14;
// Format 12 (32-bit groups): uint32 numGroups at 12, then 12-byte groups (startCharCode, endCharCode, startGlyphID) from 16.
const CMAP12_GROUP_COUNT = 12;
const CMAP12_GROUPS = 16;
const CMAP12_GROUP_SIZE = 12;
// Unicode has 0x110000 code points; a cmap mapping more (overlapping or bogus ranges) is not read further.
const UNICODE_CODE_POINTS = 0x110000;
// platformID << 16 | encodingID of the Unicode subtables: Windows full repertoire, Unicode full, then the BMP ones.
const UNICODE_CMAPS: readonly number[] = [(3 << 16) | 10, (0 << 16) | 6, (0 << 16) | 4, (3 << 16) | 1, (0 << 16) | 3, (0 << 16) | 2, (0 << 16) | 1, (0 << 16) | 0];
const OS2_WIN_ASCENT = 74;
const OS2_WIN_DESCENT = 76;
// kern table (OpenType spec): Microsoft format uint16 version 0 then uint16 nTables; each subtable has uint16 version,
// length and coverage (format in the high byte, horizontal in bit 0), then format 0's uint16 nPairs. Apple's format starts
// with a 32-bit version 0x00010000, so its first uint16 is 1.
const KERN_TABLES = 2;
const KERN_SUBTABLES = 4;
const KERN_SUBTABLE_LENGTH = 2;
const KERN_SUBTABLE_COVERAGE = 4;
const KERN_SUBTABLE_PAIRS = 6;
const KERN_HORIZONTAL = 0x0001;
// Format 0: nPairs, then uint16 searchRange, entrySelector and rangeShift, then 6-byte pairs (uint16 left and right glyph, FWORD value).
const KERN_FORMAT_0_PAIRS = 14;
const KERN_PAIR_SIZE = 6;

/**
 * A font's head.unitsPerEm and OS/2 usWinAscent and usWinDescent, from TrueType or OpenType (CFF) bytes, for the
 * `fontMetrics` option, and `pairKerning`: whether PowerPoint pair-kerns it. A font with a `kern` table is kerned from
 * that table alone, so true only when it is version 0 with a horizontal format 0 subtable holding pairs (an Apple-format
 * one gives false, whatever GPOS holds); a font without one is kerned from GPOS, so true when it has a GPOS table. A TrueType
 * collection (.ttc) gives the face at `faceIndex`, the first by default; a single font has only face 0. WOFF and WOFF2
 * are not read: decompress first.
 */
export function readFontWinMetrics(bytes: Uint8Array, faceIndex = 0): FontWinMetrics {
    const { tables, field } = sfntTables(bytes, faceIndex, "readFontWinMetrics");
    const metrics = {
        unitsPerEm: field("head", HEAD_UNITS_PER_EM, "unitsPerEm"),
        winAscent: field("OS/2", OS2_WIN_ASCENT, "usWinAscent"),
        winDescent: field("OS/2", OS2_WIN_DESCENT, "usWinDescent"),
        pairKerning: tables.has("kern") ? hasMicrosoftPairKerning(field) : tables.has("GPOS"),
    };
    if (metrics.unitsPerEm === 0) throw new FontFileError("head.unitsPerEm is 0");
    if (metrics.winAscent + metrics.winDescent === 0) throw new FontFileError("OS/2 usWinAscent and usWinDescent are both 0");
    return Object.freeze(metrics);
}

/** Whether the `kern` table `field` reads is version 0 with a horizontal format 0 subtable holding pairs; stops at the first. */
function hasMicrosoftPairKerning(field: (table: string, offset: number, what: string) => number): boolean {
    if (field("kern", 0, "its version") !== 0) return false; // Apple's version 1.0 format, which PowerPoint does not kern from.
    const count = field("kern", KERN_TABLES, "nTables");
    let subtable = KERN_SUBTABLES;
    for (let index = 0; index < count; index++) {
        const coverage = field("kern", subtable + KERN_SUBTABLE_COVERAGE, `subtable ${index} coverage`);
        if (coverage >> 8 === 0 && (coverage & KERN_HORIZONTAL) !== 0 && field("kern", subtable + KERN_SUBTABLE_PAIRS, `subtable ${index} nPairs`) > 0) return true;
        const length = field("kern", subtable + KERN_SUBTABLE_LENGTH, `subtable ${index} length`);
        if (length < KERN_SUBTABLE_PAIRS) throw new FontFileError(`kern subtable ${index} is ${length} bytes long, shorter than its header`);
        subtable += length;
    }
    return false;
}

/** Reads a big-endian unsigned integer at an offset into a named sfnt table, bounds-checked. */
type TableField = (table: string, offset: number, what: string) => number;
type FontReader = "readFontWinMetrics" | "readGlyphAdvances";

/** The tables of the font at `faceIndex` in `bytes` (a single font or a TrueType collection), errors naming `reader`. */
function sfntTables(bytes: Uint8Array, faceIndex: number, reader: FontReader): { tables: ReadonlyMap<string, unknown>; field: TableField; field32: TableField } {
    if (!(bytes instanceof Uint8Array)) throw new FontFileError("expected the font file's bytes as a Uint8Array", reader);
    if (!Number.isInteger(faceIndex) || faceIndex < 0) throw new FontFileError(`faceIndex must be a non-negative integer, got ${faceIndex}`, reader);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (offset: number, size: 2 | 4, what: string): number => {
        if (offset + size > view.byteLength) throw new FontFileError(`${what} at byte ${offset} is past the end of the ${view.byteLength}-byte file; the font is truncated`, reader);
        return size === 2 ? view.getUint16(offset) : view.getUint32(offset);
    };
    let directory = 0;
    const tag = read(0, 4, "the sfnt version");
    if (tag === TTC_TAG) {
        const faces = read(TTC_FONT_COUNT, 4, "the collection's font count");
        if (faceIndex >= faces) throw new FontFileError(`the collection has ${faces} faces, so no face ${faceIndex}`, reader);
        directory = read(TTC_FONT_OFFSETS + 4 * faceIndex, 4, `the collection's font ${faceIndex} offset`);
    } else if (!SFNT_VERSIONS.has(tag)) throw new FontFileError("not a TrueType or OpenType font (WOFF and WOFF2 must be decompressed first)", reader);
    else if (faceIndex !== 0) throw new FontFileError(`a single font has only face 0, not face ${faceIndex}`, reader);
    const tableCount = read(directory + 4, 2, "the table count");
    const tables = new Map<string, { offset: number; length: number }>();
    for (let index = 0; index < tableCount; index++) {
        const record = directory + TABLE_DIRECTORY_SIZE + index * TABLE_RECORD_SIZE;
        const name = String.fromCharCode(...bytes.subarray(record, record + 4));
        tables.set(name, { offset: read(record + 8, 4, `table record ${index}`), length: read(record + 12, 4, `table record ${index}`) });
    }
    const field =
        (size: 2 | 4): TableField =>
        (table, offset, what) => {
            const entry = tables.get(table);
            if (!entry) throw new FontFileError(`the font has no ${table} table`, reader);
            if (offset + size > entry.length) throw new FontFileError(`the ${table} table is ${entry.length} bytes, too short for ${what}`, reader);
            return read(entry.offset + offset, size, `${table} ${what}`);
        };
    return { tables, field: field(2), field32: field(4) };
}

const KERNING_ERROR = "must be a Map from the left character's code point to a Map from the right one's to the pair's kerning in font units";
const CODE_POINT = z
    .int()
    .min(0)
    .max(UNICODE_CODE_POINTS - 1);
const GLYPH_ADVANCES_SCHEMA = z.strictObject({
    unitsPerEm: integer(1, "a positive integer (head.unitsPerEm)"),
    advances: z.map(CODE_POINT, z.number().min(0).max(Number.MAX_SAFE_INTEGER), { error: "must be a Map from code point to advance width in font units" }),
    kerning: z.map(CODE_POINT, z.map(CODE_POINT, z.number().finite(), { error: KERNING_ERROR }), { error: KERNING_ERROR }).optional(),
});

/**
 * Each character's advance width (hmtx) in font units, keyed by Unicode code point through the font's Unicode cmap
 * (format 12, else format 4), and head.unitsPerEm: what the PowerPoint target lays text out on its advance grid with
 * (RENDERING_TARGETS.advanceGridPt). A character the font does not map is left out, and so is every one of a font
 * without a Unicode cmap (a symbol font). `kerning` holds the pair kerning of a version 0 `kern` table (`kernPairs`), what
 * PowerPoint kerns a run from 12pt with; it is left out without one. A TrueType collection (.ttc) gives the face at
 * `faceIndex`; WOFF and WOFF2 are not read. Browser-safe: bytes in.
 */
export function readGlyphAdvances(bytes: Uint8Array, faceIndex = 0): GlyphAdvances {
    const { tables, field, field32 } = sfntTables(bytes, faceIndex, "readGlyphAdvances");
    const unitsPerEm = field("head", HEAD_UNITS_PER_EM, "unitsPerEm");
    if (unitsPerEm === 0) throw new FontFileError("head.unitsPerEm is 0", "readGlyphAdvances");
    const longMetrics = field("hhea", HHEA_NUMBER_OF_H_METRICS, "numberOfHMetrics");
    if (longMetrics === 0) throw new FontFileError("hhea.numberOfHMetrics is 0", "readGlyphAdvances");
    const glyphCount = field("maxp", MAXP_NUM_GLYPHS, "numGlyphs");
    const advances = new Map<number, number>();
    const characters = new Map<number, number[]>();
    for (const [codePoint, glyph] of unicodeGlyphs(field, field32)) {
        // Glyph 0 is .notdef: the character is missing, as is one mapped past the font's glyphs.
        if (glyph === 0 || glyph >= glyphCount) continue;
        advances.set(codePoint, field("hmtx", HMTX_RECORD_SIZE * Math.min(glyph, longMetrics - 1), `glyph ${glyph}'s advanceWidth`));
        characters.set(glyph, [...(characters.get(glyph) ?? []), codePoint]);
    }
    const kerning = tables.has("kern") ? kernPairs(field, characters) : undefined;
    return Object.freeze({ unitsPerEm, advances, ...(kerning?.size ? { kerning } : {}) });
}

/**
 * The pair kerning of a version 0 `kern` table's horizontal format 0 subtables, the ones PowerPoint kerns from
 * (`hasMicrosoftPairKerning`), summed, keyed by the left then the right character of each glyph pair through
 * `characters` (glyph id to code points); empty for an Apple-format table. A subtable is stepped over by its pairs, not
 * its uint16 length, which a large one overflows (Arial's 160,250 bytes say 29,178).
 */
function kernPairs(field: TableField, characters: ReadonlyMap<number, readonly number[]>): Map<number, Map<number, number>> {
    const pairs = new Map<number, Map<number, number>>();
    if (field("kern", 0, "its version") !== 0) return pairs;
    const subtables = field("kern", KERN_TABLES, "nTables");
    let subtable = KERN_SUBTABLES;
    for (let index = 0; index < subtables; index++) {
        const coverage = field("kern", subtable + KERN_SUBTABLE_COVERAGE, `subtable ${index} coverage`);
        if (coverage >> 8 !== 0) {
            const length = field("kern", subtable + KERN_SUBTABLE_LENGTH, `subtable ${index} length`);
            if (length < KERN_SUBTABLE_PAIRS) throw new FontFileError(`kern subtable ${index} is ${length} bytes long, shorter than its header`, "readGlyphAdvances");
            subtable += length;
            continue;
        }
        const count = field("kern", subtable + KERN_SUBTABLE_PAIRS, `subtable ${index} nPairs`);
        const first = subtable + KERN_FORMAT_0_PAIRS;
        subtable = first + count * KERN_PAIR_SIZE;
        if ((coverage & KERN_HORIZONTAL) === 0) continue;
        for (let pair = 0; pair < count; pair++) {
            const record = first + pair * KERN_PAIR_SIZE;
            const lefts = characters.get(field("kern", record, `subtable ${index} pair ${pair} left glyph`)) ?? [];
            const rights = characters.get(field("kern", record + 2, `subtable ${index} pair ${pair} right glyph`)) ?? [];
            // An FWORD: signed 16-bit.
            const value = (field("kern", record + 4, `subtable ${index} pair ${pair} value`) << 16) >> 16;
            for (const left of lefts) {
                const row = pairs.get(left) ?? new Map<number, number>();
                pairs.set(left, row);
                for (const right of rights) row.set(right, (row.get(right) ?? 0) + value);
            }
        }
    }
    return pairs;
}

/** The [code point, glyph id] pairs of the first Unicode cmap subtable in UNICODE_CMAPS order that is format 12 or 4; none without one. */
function* unicodeGlyphs(field: TableField, field32: TableField): Generator<[number, number]> {
    const subtables = new Map<number, number>();
    const count = field("cmap", CMAP_TABLES, "numTables");
    for (let index = 0; index < count; index++) {
        const record = CMAP_RECORDS + index * CMAP_RECORD_SIZE;
        const encoding = (field("cmap", record, `record ${index} platformID`) << 16) | field("cmap", record + 2, `record ${index} encodingID`);
        if (!subtables.has(encoding)) subtables.set(encoding, field32("cmap", record + 4, `record ${index} offset`));
    }
    let mapped = 0;
    const counted = (codePoint: number, glyph: number): [number, number] => {
        if (++mapped > UNICODE_CODE_POINTS) throw new FontFileError(`the cmap maps more than ${UNICODE_CODE_POINTS} code points`, "readGlyphAdvances");
        return [codePoint, glyph];
    };
    for (const encoding of UNICODE_CMAPS) {
        const offset = subtables.get(encoding);
        if (offset === undefined) continue;
        const format = field("cmap", offset, "subtable format");
        if (format === 12) {
            const groups = field32("cmap", offset + CMAP12_GROUP_COUNT, "format 12 numGroups");
            for (let index = 0; index < groups; index++) {
                const group = offset + CMAP12_GROUPS + index * CMAP12_GROUP_SIZE;
                const start = field32("cmap", group, `format 12 group ${index} startCharCode`);
                const end = Math.min(field32("cmap", group + 4, `format 12 group ${index} endCharCode`), UNICODE_CODE_POINTS - 1);
                const glyph = field32("cmap", group + 8, `format 12 group ${index} startGlyphID`);
                for (let codePoint = start; codePoint <= end; codePoint++) yield counted(codePoint, glyph + codePoint - start);
            }
            return;
        }
        if (format === 4) {
            const segments = field("cmap", offset + CMAP4_SEG_COUNT_X2, "format 4 segCountX2") / 2;
            const ends = offset + CMAP4_END_CODES;
            const starts = ends + 2 * segments + 2; // past the uint16 reservedPad
            const deltas = starts + 2 * segments;
            const rangeOffsets = deltas + 2 * segments;
            for (let index = 0; index < segments; index++) {
                const start = field("cmap", starts + 2 * index, `format 4 segment ${index} startCode`);
                const end = field("cmap", ends + 2 * index, `format 4 segment ${index} endCode`);
                const delta = field("cmap", deltas + 2 * index, `format 4 segment ${index} idDelta`);
                const rangeOffset = field("cmap", rangeOffsets + 2 * index, `format 4 segment ${index} idRangeOffset`);
                for (let codePoint = start; codePoint <= end; codePoint++) {
                    // idRangeOffset counts bytes from its own position into glyphIdArray, where 0 is .notdef; idDelta adds modulo 65536.
                    const indexed = rangeOffset === 0 ? codePoint : field("cmap", rangeOffsets + 2 * index + rangeOffset + 2 * (codePoint - start), `format 4 segment ${index} glyphIdArray entry`);
                    yield counted(codePoint, rangeOffset !== 0 && indexed === 0 ? 0 : (indexed + delta) & 0xffff);
                }
            }
            return;
        }
    }
}

/** `resolve(fontFace, bold, italic)` checked: undefined (not found) or valid advances. Anything else is the resolver's bug, so it throws. */
function resolvedGlyphAdvances(resolve: GlyphAdvanceLookup, fontFace: string, bold: boolean, italic: boolean): GlyphAdvances | undefined {
    const resolved: unknown = resolve(fontFace, bold, italic);
    if (resolved === undefined) return undefined;
    const parsed = GLYPH_ADVANCES_SCHEMA.safeParse(resolved);
    if (parsed.success) return Object.freeze(parsed.data);
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === undefined ? "" : `${String(issue.path[0])} `;
    throw new TypeError(`PuppeteerGen option \`resolveGlyphAdvances\` returned invalid advances for ${JSON.stringify(fontFace)}: ${field}${issue?.message ?? "is invalid"}. Return undefined for a face it cannot find, or readGlyphAdvances(fontBytes).`);
}

/** `resolve` checked, and its results cached per face (case-insensitive), weight and style; undefined without a resolver. */
function glyphAdvanceLookup(resolve: unknown): GlyphAdvanceLookup | undefined {
    if (resolve === undefined || resolve === null) return undefined;
    if (typeof resolve !== "function") throw new TypeError(`PuppeteerGen option \`resolveGlyphAdvances\` must be a function, or null to turn the lookup off; got ${typeof resolve}.`);
    const resolved = new Map<string, GlyphAdvances | undefined>();
    return (fontFace, bold, italic) => {
        const key = `${bold ? "b" : ""}${italic ? "i" : ""}:${fontFace.toLowerCase()}`;
        // `as`: typeof checked it is a function, and resolvedGlyphAdvances checks what it returns.
        if (!resolved.has(key)) resolved.set(key, resolvedGlyphAdvances(resolve as GlyphAdvanceLookup, fontFace, bold, italic));
        return resolved.get(key);
    };
}
