import { PDF_PRODUCER } from "@pdflapas/model";
import { appendObjects, pdfText, readTrailer } from "./pdfUpdate";

/**
 * Document information entries (ISO 32000-1, 14.3.3) set from the HTML's `<title>` and its `author`, `description`,
 * `pdflapas-company`, `pdflapas-revision`, `keywords`, `pdflapas-creator`, `pdflapas-producer`,
 * `pdflapas-creation-date` and `pdflapas-modification-date` meta tags. Company and Revision are not standard keys: 14.3.3
 * allows other keys (pdfinfo -custom lists them); the WASM renderer writes the same ones. The dates are the profile's
 * UTC ISO strings.
 */
export interface DocumentInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Company?: string;
    Revision?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
}

/** The profile's date: UTC to the second or millisecond, as `Date.prototype.toISOString()` writes it. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

/**
 * `pdf` with an incremental update (ISO 32000-1, 7.5.6) whose Info dictionary holds the non-empty entries of `info`,
 * Creator and Producer defaulting to `PDF_PRODUCER`: the dictionary the WASM renderer writes. It replaces Chromium's,
 * whose Creator, Producer and per-run CreationDate and ModDate would make the two backends' Info differ. A date alone
 * is written as both CreationDate and ModDate, as krilla, which has a single date, does in the WASM renderer.
 */
export function withDocumentInfo(pdf: Uint8Array, info: DocumentInfo): Uint8Array {
    const { CreationDate, ModDate, ...text } = info;
    const created = CreationDate || ModDate;
    const modified = ModDate || CreationDate;
    const strings = Object.entries({ ...text, Creator: text.Creator || PDF_PRODUCER, Producer: text.Producer || PDF_PRODUCER }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    const dates = created && modified ? `/CreationDate ${pdfDate(created)}/ModDate ${pdfDate(modified)}` : "";
    const trailer = readTrailer(pdfText(pdf), pdfError);
    const reference = trailer.info ?? { number: trailer.size, generation: 0 };
    const body = `<<${strings.map(([key, value]) => `/${key} ${textString(value)}`).join("")}${dates}>>`;
    return appendObjects(pdf, trailer, [{ ...reference, body }], reference);
}

/** A profile date as a PDF date string (7.9.4) in UTC, to the second: `(D:YYYYMMDDHHmmSSZ)`. */
export function pdfDate(iso: string): string {
    const match = ISO_DATE.exec(iso);
    if (!match) throw new Error(`Cannot write the PDF dates: ${JSON.stringify(iso)} is not a UTC date such as 2026-11-19T12:34:56.000Z (Date.prototype.toISOString()).`);
    return `(D:${match.slice(1).join("")}Z)`;
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
