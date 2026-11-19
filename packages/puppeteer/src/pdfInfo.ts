import { appendObjects, pdfText, readTrailer } from "./pdfUpdate";

/**
 * Document information entries (ISO 32000-1, 14.3.3) set from the HTML's `<title>` and its `author`, `description`,
 * `pdflapas-company` and `pdflapas-revision` meta tags. Company and Revision are not standard keys: 14.3.3 allows other
 * keys (pdfinfo -custom lists them); the WASM renderer writes the same ones.
 */
export interface DocumentInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Company?: string;
    Revision?: string;
}

const OBJECT_HEADER = /^(\d+)\s+(\d+)\s+obj\s*<</;
const NAME = /^\/[^\s/<>()[\]{}%]+/;
const WHITESPACE = /\s/;

/**
 * `pdf` with an incremental update (ISO 32000-1, 7.5.6) that rewrites the Info dictionary with `info`, keeping the
 * entries Chromium wrote (Creator, Producer, dates). Chromium writes an Info dictionary of strings; a PDF in another
 * shape throws rather than being written wrong. Without entries, returns `pdf` itself.
 */
export function withDocumentInfo(pdf: Uint8Array, info: DocumentInfo): Uint8Array {
    const entries = Object.entries(info).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    if (entries.length === 0) return pdf;
    const text = pdfText(pdf);
    const trailer = readTrailer(text, pdfError);
    const { number, generation } = trailer.info ?? { number: trailer.size, generation: 0 };
    const kept = trailer.info ? keptEntries(text, trailer.offsets.get(number), number, new Set(entries.map(([key]) => key))) : "";
    const body = `<<${kept}${entries.map(([key, value]) => `/${key} ${textString(value)}`).join("")}>>`;
    return appendObjects(pdf, trailer, [{ number, generation, body }], { number, generation });
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
