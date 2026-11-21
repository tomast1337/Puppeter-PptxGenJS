import { createHash } from "node:crypto";
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
 *
 * The update also makes the file byte-deterministic (#321). Chromium dates its own Info dictionary with the wall clock
 * (printing/common/metafile_utils.cc, MakePdfDocument: `base::Time::Now()`), and Skia's trailer /ID, which it writes
 * only in PDF/A mode, hashes the time (SkPDFMetadata::CreateUUID). Both are blanked in place, at the same length so
 * no offset moves. The update's /ID is the MD5 of those bytes and the new Info dictionary: ISO 32000-1 14.4 says the
 * identifier should be computed from the file's content, and these bytes are what the HTML, fonts and Chromium
 * version produce, so the ID changes when the drawn content does, and only then.
 */
export function withDocumentInfo(pdf: Uint8Array, info: DocumentInfo): Uint8Array {
    const { CreationDate, ModDate, ...text } = info;
    const created = CreationDate || ModDate;
    const modified = ModDate || CreationDate;
    const strings = Object.entries({ ...text, Creator: text.Creator || PDF_PRODUCER, Producer: text.Producer || PDF_PRODUCER }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    const dates = created && modified ? `/CreationDate ${pdfDate(created)}/ModDate ${pdfDate(modified)}` : "";
    const source = pdfText(pdf);
    const trailer = readTrailer(source, pdfError);
    const reference = trailer.info ?? { number: trailer.size, generation: 0 };
    let entries = "";

    for (const [key, value] of strings) {
        // A PDF text string as UTF-16BE with its byte order mark, in hex: any character, nothing to escape (7.9.2.2).
        let hex = "<FEFF";

        for (let index = 0; index < value.length; index++) {
            hex += value.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
        }

        entries += `/${key} ${hex}>`;
    }

    const body = `<<${entries}${dates}>>`;
    // A copy of `pdf` whose Info object (superseded by the update) is `<<>>` and whose trailer /ID is gone, both padded with spaces.
    const original = pdf.slice();
    const start = trailer.info && trailer.offsets.get(trailer.info.number);

    if (start !== undefined) {
        // The next object, or the cross-reference table, bounds the search: the title may itself contain "endobj".
        let next = trailer.xrefOffset;

        for (const offset of trailer.offsets.values()) {
            if (offset > start && offset < next) {
                next = offset;
            }
        }

        const bodyStart = source.indexOf("obj", start) + "obj".length;
        const bodyEnd = source.lastIndexOf("endobj", next);

        if (bodyStart < start || bodyEnd - bodyStart < EMPTY_DICTIONARY.length) {
            throw pdfError("its Info object has no obj ... endobj");
        }

        original.fill(SPACE, bodyStart, bodyEnd);
        original.set(EMPTY_DICTIONARY, bodyStart);
    }

    // readTrailer read the newest trailer, which is the last one in the file.
    if (trailer.id) {
        original.fill(SPACE, source.lastIndexOf(trailer.id), source.lastIndexOf(trailer.id) + trailer.id.length);
    }

    const id = createHash("md5").update(original).update(body).digest("hex");

    return appendObjects(original, { ...trailer, id: `/ID [<${id}><${id}>]` }, [{ ...reference, body }], reference);
}

const SPACE = 0x20;
const EMPTY_DICTIONARY = Buffer.from("<<>>", "latin1");

/** A profile date as a PDF date string (7.9.4) in UTC, to the second: `(D:YYYYMMDDHHmmSSZ)`. */
export function pdfDate(iso: string): string {
    const match = ISO_DATE.exec(iso);

    if (!match) {
        throw new Error(`Cannot write the PDF dates: ${JSON.stringify(iso)} is not a UTC date such as 2026-11-19T12:34:56.000Z (Date.prototype.toISOString()).`);
    }

    return `(D:${match.slice(1).join("")}Z)`;
}

function pdfError(problem: string): Error {
    return new Error(`Cannot write the PDF document properties: Chromium's PDF is not in the shape expected (${problem}). Report it with the Chromium version.`);
}
