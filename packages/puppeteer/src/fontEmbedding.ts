// Whether a font's licence lets the PDF embed it: OpenType OS/2 fsType (bit 1, restricted licence embedding). Skia
// draws such a face as a Type 3 font of glyph procedures and does not embed its program; PowerPoint's export does not
// embed it either. withType1CFonts would otherwise turn those procedures back into an embedded font program.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

// OS/2 fsType bit 1: the face may not be embedded (Skia's kNotEmbeddable_FontFlag, FT_FSTYPE_RESTRICTED_LICENSE_EMBEDDING).
const FS_TYPE_RESTRICTED = 0x0002;
// fc-match's output for a PostScript name: the matched file, its face index and its PostScript name, one per line.
const FC_MATCH_FORMAT = "%{file}\\n%{index}\\n%{postscriptname}";
// fc-match builds fontconfig's cache on a cold start, which can take seconds.
const FC_MATCH_TIMEOUT_MS = 10_000;
// fontconfig's face index keeps a variable font's named instance in its upper 16 bits; the face is the lower 16.
const FC_FACE_INDEX_MASK = 0xffff;
// A PDF subset font name: six capital letters and "+" before the face's PostScript name (ISO 32000-1 9.6.4).
const SUBSET_TAG = /^[A-Z]{6}\+/;
// sfnt offsets (OpenType "Font file", "TTC header" and "OS/2" tables).
const SFNT_TABLE_COUNT = 4;
const SFNT_TABLE_RECORDS = 12;
const SFNT_TABLE_RECORD_SIZE = 16;
const TTC_FONT_OFFSETS = 12;
const OS2_FS_TYPE = 8;
const TAG_TTCF = 0x74746366; // "ttcf"
const TAG_OS2 = 0x4f532f32; // "OS/2"

/**
 * Whether the face of an sfnt file (`index` in a collection) forbids embedding by its OS/2 fsType; undefined when the
 * file has no OS/2 table or is not an sfnt (bounds-checked: the bytes come from a font file on disk).
 */
// eslint-disable-next-line pdflapas/no-nullable-return -- phase 2 (#425)
export function restrictedByFsType(bytes: Uint8Array, index = 0): boolean | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => (at + 2 <= view.byteLength ? view.getUint16(at) : undefined);
    const u32 = (at: number) => (at + 4 <= view.byteLength ? view.getUint32(at) : undefined);
    const font = u32(0) === TAG_TTCF ? u32(TTC_FONT_OFFSETS + 4 * index) : 0;

    if (font === undefined) {
        return undefined;
    }

    const tables = u16(font + SFNT_TABLE_COUNT) ?? 0;

    for (let table = 0; table < tables; table++) {
        const record = font + SFNT_TABLE_RECORDS + table * SFNT_TABLE_RECORD_SIZE;

        if (u32(record) !== TAG_OS2) {
            continue;
        }

        const offset = u32(record + 8);
        const fsType = offset === undefined ? undefined : u16(offset + OS2_FS_TYPE);

        return fsType === undefined ? undefined : (fsType & FS_TYPE_RESTRICTED) !== 0;
    }

    return undefined;
}

/**
 * Whether the installed face with PostScript name `fontName` forbids embedding, found through fontconfig as the
 * PowerPoint target's metrics lookup finds fonts; false when fontconfig is missing or has no face of that name, so the
 * rewrite goes on as before. A function, not inlined into restrictedFonts, because its pending answer is cached.
 */
async function isRestricted(fontName: string): Promise<boolean> {
    const name = fontName.replace(SUBSET_TAG, "");
    let output: string;

    try {
        ({ stdout: output } = await run("fc-match", ["-f", FC_MATCH_FORMAT, `:postscriptname=${name.replace(/[\\\-:,]/g, "\\$&")}`], { encoding: "utf8", timeout: FC_MATCH_TIMEOUT_MS }));
    } catch {
        return false; // No fontconfig: the face cannot be identified.
    }

    const [file, index, postscriptName] = output.split("\n");

    if (!file || postscriptName !== name) {
        return false;
    }

    try {
        return restrictedByFsType(await readFile(file), Number(index) & FC_FACE_INDEX_MASK) ?? false;
    } catch {
        return false;
    }
}

/**
 * Each installed face's answer by PostScript name. Global because the installed fonts are the process's environment
 * and every render shares them; bounded by the installed faces, since only faces Chromium drew reach it; never released.
 */
const restricted = new Map<string, Promise<boolean>>();

/** The names among `fontNames` (PDF /FontName values) whose face forbids embedding. */
export async function restrictedFonts(fontNames: readonly string[]): Promise<ReadonlySet<string>> {
    const pending: Promise<boolean>[] = [];

    for (const name of fontNames) {
        const key = name.replace(SUBSET_TAG, "");
        let answer = restricted.get(key);

        if (!answer) {
            answer = isRestricted(key);
            restricted.set(key, answer);
        }

        pending.push(answer);
    }

    const answers = await Promise.all(pending);
    const names = new Set<string>();

    for (const [index, name] of fontNames.entries()) {
        if (answers[index]) {
            names.add(name);
        }
    }

    return names;
}
