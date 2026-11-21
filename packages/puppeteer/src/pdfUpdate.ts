/**
 * Incremental updates (ISO 32000-1, 7.5.6) to the PDF Chromium prints: the original bytes stay as they are and the
 * changed objects are appended with a cross-reference section for them. Chromium writes a cross-reference table, not
 * a stream; a PDF in another shape throws rather than being written wrong.
 */

/** The newest cross-reference section and its trailer. */
export type PdfTrailer = {
    /** Byte offset of the section, the next update's /Prev. */
    readonly xrefOffset: number;
    /** In-use object offsets of the section. */
    readonly offsets: ReadonlyMap<number, number>;
    readonly size: number;
    /** The `/Root n g R` entry as written. */
    readonly root: string;
    readonly info: PdfReference | undefined;
    /** The `/ID [...]` entry as written, or "". */
    readonly id: string;
};

export type PdfReference = {
    readonly number: number;
    readonly generation: number;
};

/** An object written by an update: `body` is what goes between `obj` and `endobj`, one character per byte. */
export type PdfObject = {
    readonly body: string;
} & PdfReference;

const STARTXREF = /startxref\s+(\d+)\s+%%EOF\s*$/;
const XREF_SUBSECTION = /^(\d+) (\d+)\r?\n/;
const XREF_ENTRY_BYTES = 20; // ISO 32000-1 7.5.4: "nnnnnnnnnn ggggg n" and a two-byte end of line
const TRAILER = /^trailer\s*<<([\s\S]*?)>>\s*startxref/;
const INFO_REF = /\/Info\s+(\d+)\s+(\d+)\s+R/;
const SIZE = /\/Size\s+(\d+)/;
const PREV = /\/Prev\s+(\d+)/;
const ROOT_REF = /\/Root\s+\d+\s+\d+\s+R/;
const ID = /\/ID\s*\[[^\]]*\]/;
const WHITESPACE = /\s/;
// Bounds the search for startxref: ISO 32000-1 7.5.5 puts it in the file's last lines.
const TAIL_BYTES = 1024;

/** `pdf` as text whose string offsets are byte offsets: latin1 maps each byte to one character. */
export function pdfText(pdf: Uint8Array): string {
    return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString("latin1");
}

/** The newest cross-reference section of `text` (from `pdfText`); `fail` makes the error for a PDF in another shape. */
export function readTrailer(text: string, fail: (problem: string) => Error): PdfTrailer {
    const xrefOffset = Number(STARTXREF.exec(text.slice(-TAIL_BYTES))?.[1] ?? Number.NaN);

    if (!(xrefOffset < text.length) || !text.startsWith("xref", xrefOffset)) {
        throw fail("its startxref does not point at a cross-reference table");
    }

    const { offsets, end } = crossReference(text, xrefOffset + "xref".length, fail);
    const trailer = TRAILER.exec(text.slice(end))?.[1];

    if (trailer === undefined) {
        throw fail("it has no trailer after its cross-reference table");
    }

    const size = Number(SIZE.exec(trailer)?.[1] ?? Number.NaN);
    const root = ROOT_REF.exec(trailer)?.[0];

    if (!Number.isInteger(size) || root === undefined) {
        throw fail("its trailer has no /Size or /Root");
    }

    const info = INFO_REF.exec(trailer);

    return { xrefOffset, offsets, size, root, info: info ? { number: Number(info[1]), generation: Number(info[2]) } : undefined, id: ID.exec(trailer)?.[0] ?? "" };
}

/** The offset of every in-use object of `text`, following the sections' /Prev chain: a newer section's entry wins. */
export function objectOffsets(text: string, fail: (problem: string) => Error): Map<number, number> {
    const offsets = new Map<number, number>();
    const visited = new Set<number>();

    for (let xrefOffset: number | undefined = readTrailer(text, fail).xrefOffset; xrefOffset !== undefined;) {
        if (visited.has(xrefOffset) || !text.startsWith("xref", xrefOffset)) {
            throw fail(`its /Prev ${xrefOffset} does not point at a new cross-reference table`);
        }

        visited.add(xrefOffset);
        const section = crossReference(text, xrefOffset + "xref".length, fail);

        for (const [number, offset] of section.offsets) {
            if (!offsets.has(number)) {
                offsets.set(number, offset);
            }
        }

        const prev = PREV.exec(TRAILER.exec(text.slice(section.end))?.[1] ?? "");

        xrefOffset = prev ? Number(prev[1]) : undefined;
    }

    return offsets;
}

/** `pdf` with `objects` appended as an update after `trailer` (read from `pdf`), its Info dictionary set to `info`. */
export function appendObjects(pdf: Uint8Array, trailer: PdfTrailer, objects: readonly PdfObject[], info = trailer.info): Uint8Array {
    let body = "";
    let xref = "";
    let size = trailer.size;

    for (const { number, generation, body: content } of [...objects].sort((a, b) => a.number - b.number)) {
        const offset = pdf.byteLength + body.length + 1;

        body += `\n${number} ${generation} obj\n${content}\nendobj\n`;
        xref += `${number} 1\n${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`;
        size = Math.max(size, number + 1);
    }

    const infoRef = info ? ` /Info ${info.number} ${info.generation} R` : "";
    const update = `${body}xref\n${xref}trailer\n<</Size ${size} ${trailer.root}${infoRef} /Prev ${trailer.xrefOffset}${trailer.id ? ` ${trailer.id}` : ""}>>\nstartxref\n${pdf.byteLength + body.length}\n%%EOF\n`;
    const out = new Uint8Array(pdf.byteLength + update.length);

    out.set(pdf);
    out.set(Buffer.from(update, "latin1"), pdf.byteLength);

    return out;
}

/** The in-use object offsets of the cross-reference table starting at `start`, and where the table ends. */
function crossReference(text: string, start: number, fail: (problem: string) => Error): { offsets: Map<number, number>; end: number } {
    const offsets = new Map<number, number>();
    let position = start;

    for (;;) {
        while (WHITESPACE.test(text.charAt(position))) {
            position++;
        }

        const subsection = XREF_SUBSECTION.exec(text.slice(position, position + 32));

        if (!subsection) {
            return { offsets, end: position };
        }

        position += subsection[0].length;
        const first = Number(subsection[1]);
        const count = Number(subsection[2]);

        if (position + count * XREF_ENTRY_BYTES > text.length) {
            throw fail("its cross-reference table is cut short");
        }

        for (let index = 0; index < count; index++) {
            const entry = text.slice(position, position + XREF_ENTRY_BYTES);

            if (entry.charAt(17) === "n") {
                offsets.set(first + index, Number(entry.slice(0, 10)));
            }

            position += XREF_ENTRY_BYTES;
        }
    }
}
