// Font win metrics: the caller's `fontMetrics` option, checked and merged over FONT_WIN_METRICS, and reading them from font bytes.
// Browser-safe: bytes in, no node:* module.
import { z } from "zod";
import { FONT_WIN_METRICS, type FontMetricsTable, type FontWinMetrics } from "./defaults";

const integer = (min: 0 | 1, what: string) => z.int({ error: `must be ${what}` }).min(min, { error: `must be ${what}` });

const FONT_WIN_METRICS_SCHEMA = z
    .strictObject({
        unitsPerEm: integer(1, "a positive integer (head.unitsPerEm)"),
        winAscent: integer(0, "a non-negative integer (OS/2 usWinAscent)"),
        winDescent: integer(0, "a non-negative integer (OS/2 usWinDescent)"),
    })
    .refine(metrics => metrics.winAscent + metrics.winDescent > 0, { error: "winAscent + winDescent must be greater than 0" });

const FONT_METRICS_OPTION_SCHEMA = z.record(z.string(), FONT_WIN_METRICS_SCHEMA, { error: "must be an object keyed by font face name" });

const HOW_TO_FIX = 'Pass font units from the font\'s head and OS/2 tables, e.g. fontMetrics: { "My Brand Sans": readFontWinMetrics(fontBytes) }.';

/**
 * The PuppeteerGen `fontMetrics` option checked, merged over FONT_WIN_METRICS and keyed by lower-case face name: the
 * caller's entries override the built-in ones. Frozen; look a face up with fontWinMetrics().
 */
export function fontMetricsTable(option: unknown): FontMetricsTable {
    if (option === undefined) return FONT_WIN_METRICS;
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
    // fromEntries and spread define own properties, so a face named "__proto__" stays an entry.
    const caller = Object.fromEntries(Object.entries(parsed.data).map(([face, metrics]) => [face.toLowerCase(), Object.freeze({ ...metrics })]));
    return Object.freeze({ ...FONT_WIN_METRICS, ...caller });
}

/** `fontFace`'s metrics in `table`, case-insensitively; an own property only, so a face named "constructor" finds nothing. */
export function fontWinMetrics(table: FontMetricsTable, fontFace: string): FontWinMetrics | undefined {
    const key = fontFace.toLowerCase();
    return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Font bytes readFontWinMetrics() cannot read: not an sfnt (TrueType/OpenType) font, or truncated or inconsistent. */
export class FontFileError extends Error {
    constructor(message: string) {
        super(`readFontWinMetrics: ${message}`);
        this.name = "FontFileError";
    }
}

// sfnt offsets (OpenType spec): table directory, then 16-byte table records (tag, checksum, offset, length).
const SFNT_VERSIONS: ReadonlySet<number> = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);
const TTC_TAG = 0x74746366; // ttcf
const TABLE_DIRECTORY_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const HEAD_UNITS_PER_EM = 18;
const OS2_WIN_ASCENT = 74;
const OS2_WIN_DESCENT = 76;

/**
 * A font's head.unitsPerEm and OS/2 usWinAscent and usWinDescent, from TrueType or OpenType (CFF) bytes, for the
 * `fontMetrics` option. A TrueType collection (.ttc) gives its first face's. WOFF and WOFF2 are not read: decompress first.
 */
export function readFontWinMetrics(bytes: Uint8Array): FontWinMetrics {
    if (!(bytes instanceof Uint8Array)) throw new FontFileError("expected the font file's bytes as a Uint8Array");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (offset: number, size: 2 | 4, what: string): number => {
        if (offset + size > view.byteLength) throw new FontFileError(`${what} at byte ${offset} is past the end of the ${view.byteLength}-byte file; the font is truncated`);
        return size === 2 ? view.getUint16(offset) : view.getUint32(offset);
    };
    let directory = 0;
    const tag = read(0, 4, "the sfnt version");
    if (tag === TTC_TAG) directory = read(12, 4, "the collection's first font offset");
    else if (!SFNT_VERSIONS.has(tag)) throw new FontFileError("not a TrueType or OpenType font (WOFF and WOFF2 must be decompressed first)");
    const tableCount = read(directory + 4, 2, "the table count");
    const tables = new Map<string, { offset: number; length: number }>();
    for (let index = 0; index < tableCount; index++) {
        const record = directory + TABLE_DIRECTORY_SIZE + index * TABLE_RECORD_SIZE;
        const name = String.fromCharCode(...bytes.subarray(record, record + 4));
        tables.set(name, { offset: read(record + 8, 4, `table record ${index}`), length: read(record + 12, 4, `table record ${index}`) });
    }
    const field = (table: string, offset: number, what: string): number => {
        const entry = tables.get(table);
        if (!entry) throw new FontFileError(`the font has no ${table} table`);
        if (offset + 2 > entry.length) throw new FontFileError(`the ${table} table is ${entry.length} bytes, too short for ${what}`);
        return read(entry.offset + offset, 2, `${table} ${what}`);
    };
    const metrics = { unitsPerEm: field("head", HEAD_UNITS_PER_EM, "unitsPerEm"), winAscent: field("OS/2", OS2_WIN_ASCENT, "usWinAscent"), winDescent: field("OS/2", OS2_WIN_DESCENT, "usWinDescent") };
    if (metrics.unitsPerEm === 0) throw new FontFileError("head.unitsPerEm is 0");
    if (metrics.winAscent + metrics.winDescent === 0) throw new FontFileError("OS/2 usWinAscent and usWinDescent are both 0");
    return Object.freeze(metrics);
}
