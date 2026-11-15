/** Document information entries (ISO 32000-1, 14.3.3) set from the HTML's `<title>`, `author` and `description`. */
export interface DocumentInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
}

const STARTXREF = /startxref\s+(\d+)\s+%%EOF\s*$/;
const XREF_SUBSECTION = /^(\d+) (\d+)\r?\n/;
const XREF_ENTRY_BYTES = 20; // ISO 32000-1 7.5.4: "nnnnnnnnnn ggggg n" and a two-byte end of line
const TRAILER = /^trailer\s*<<([\s\S]*?)>>\s*startxref/;
const INFO_REF = /\/Info\s+(\d+)\s+(\d+)\s+R/;
const OBJECT_HEADER = /^(\d+)\s+(\d+)\s+obj\s*<</;
const SIZE = /\/Size\s+(\d+)/;
const ROOT_REF = /\/Root\s+\d+\s+\d+\s+R/;
const ID = /\/ID\s*\[[^\]]*\]/;
const NAME = /^\/[^\s/<>()[\]{}%]+/;
const WHITESPACE = /\s/;
// Bounds the search for startxref: ISO 32000-1 7.5.5 puts it in the file's last lines.
const TAIL_BYTES = 1024;

/**
 * `pdf` with an incremental update (ISO 32000-1, 7.5.6) that rewrites the Info dictionary with `info`, keeping the
 * entries Chromium wrote (Creator, Producer, dates). Chromium writes a cross-reference table and an Info dictionary
 * of strings; a PDF in another shape throws rather than being written wrong. Without entries, returns `pdf` itself.
 */
export function withDocumentInfo(pdf: Uint8Array, info: DocumentInfo): Uint8Array {
    const entries = Object.entries(info).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    if (entries.length === 0) return pdf;
    // latin1 maps each byte to one character, so string offsets are byte offsets.
    const text = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).toString("latin1");
    const xrefOffset = Number(STARTXREF.exec(text.slice(-TAIL_BYTES))?.[1] ?? Number.NaN);
    if (!(xrefOffset < text.length) || !text.startsWith("xref", xrefOffset)) throw pdfError("its startxref does not point at a cross-reference table");

    const { offsets, end } = crossReference(text, xrefOffset + "xref".length);
    const trailer = TRAILER.exec(text.slice(end))?.[1];
    if (trailer === undefined) throw pdfError("it has no trailer after its cross-reference table");
    const size = Number(SIZE.exec(trailer)?.[1] ?? Number.NaN);
    const root = ROOT_REF.exec(trailer)?.[0];
    if (!Number.isInteger(size) || root === undefined) throw pdfError("its trailer has no /Size or /Root");

    const infoRef = INFO_REF.exec(trailer);
    const number = infoRef ? Number(infoRef[1]) : size;
    const generation = infoRef ? Number(infoRef[2]) : 0;
    const kept = infoRef ? keptEntries(text, offsets.get(number), number, new Set(entries.map(([key]) => key))) : "";
    const objectOffset = pdf.byteLength + 1;
    const object = `\n${number} ${generation} obj\n<<${kept}${entries.map(([key, value]) => `/${key} ${textString(value)}`).join("")}>>\nendobj\n`;
    const updateXref = pdf.byteLength + object.length;
    const id = ID.exec(trailer)?.[0] ?? "";
    const update = `${object}xref\n${number} 1\n${String(objectOffset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \ntrailer\n<</Size ${Math.max(size, number + 1)} ${root} /Info ${number} ${generation} R /Prev ${xrefOffset}${id ? ` ${id}` : ""}>>\nstartxref\n${updateXref}\n%%EOF\n`;
    const out = new Uint8Array(pdf.byteLength + update.length);
    out.set(pdf);
    out.set(Buffer.from(update, "latin1"), pdf.byteLength);
    return out;
}

/** The in-use object offsets of the cross-reference table starting at `start`, and where the table ends. */
function crossReference(text: string, start: number): { offsets: Map<number, number>; end: number } {
    const offsets = new Map<number, number>();
    let position = start;
    for (;;) {
        while (WHITESPACE.test(text.charAt(position))) position++;
        const subsection = XREF_SUBSECTION.exec(text.slice(position, position + 32));
        if (!subsection) return { offsets, end: position };
        position += subsection[0].length;
        const first = Number(subsection[1]);
        const count = Number(subsection[2]);
        if (position + count * XREF_ENTRY_BYTES > text.length) throw pdfError("its cross-reference table is cut short");
        for (let index = 0; index < count; index++) {
            const entry = text.slice(position, position + XREF_ENTRY_BYTES);
            if (entry.charAt(17) === "n") offsets.set(first + index, Number(entry.slice(0, 10)));
            position += XREF_ENTRY_BYTES;
        }
    }
}

/** The old Info dictionary's entries other than `replaced`, as written: each value is a literal or hex string. */
function keptEntries(text: string, offset: number | undefined, number: number, replaced: ReadonlySet<string>): string {
    const header = offset === undefined ? null : OBJECT_HEADER.exec(text.slice(offset, offset + 64));
    if (offset === undefined || !header || Number(header[1]) !== number) throw pdfError(`its Info dictionary (object ${number}) is not where the cross-reference table says`);
    let position = offset + header[0].length;
    let kept = "";
    for (;;) {
        while (WHITESPACE.test(text.charAt(position))) position++;
        if (text.startsWith(">>", position)) return kept;
        const key = NAME.exec(text.slice(position, position + 128))?.[0];
        if (key === undefined) throw pdfError(`its Info dictionary has something other than a /Name key at byte ${position}`);
        position += key.length;
        while (WHITESPACE.test(text.charAt(position))) position++;
        const end = stringEnd(text, position);
        if (!replaced.has(key.slice(1))) kept += `${key} ${text.slice(position, end)}`;
        position = end;
    }
}

/** The offset after the literal `( … )` or hex `< … >` string at `start` (ISO 32000-1 7.3.4). */
function stringEnd(text: string, start: number): number {
    if (text.charAt(start) === "<") {
        const close = text.indexOf(">", start);
        if (close < 0) throw pdfError(`a hex string at byte ${start} is not closed`);
        return close + 1;
    }
    if (text.charAt(start) !== "(") throw pdfError(`its Info dictionary has a value other than a string at byte ${start}`);
    let depth = 0;
    for (let position = start; position < text.length; position++) {
        const char = text.charAt(position);
        if (char === "\\") position++;
        else if (char === "(") depth++;
        else if (char === ")" && --depth === 0) return position + 1;
    }
    throw pdfError(`a string at byte ${start} is not closed`);
}

/** A PDF text string as UTF-16BE with its byte order mark, in hex: any character, nothing to escape (7.9.2.2). */
function textString(value: string): string {
    let hex = "<FEFF";
    for (let index = 0; index < value.length; index++) hex += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
    return `${hex}>`;
}

function pdfError(problem: string): Error {
    return new Error(`Cannot write the PDF document properties: Chromium's PDF is not in the shape expected (${problem}). Report it with the Chromium version.`);
}
