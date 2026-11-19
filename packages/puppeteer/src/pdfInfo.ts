import { PDF_PRODUCER } from "@pdflapas/model";
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

/**
 * `pdf` with an incremental update (ISO 32000-1, 7.5.6) whose Info dictionary holds the non-empty entries of `info`
 * and `PDF_PRODUCER` as /Creator and /Producer: the dictionary the WASM renderer writes. It replaces Chromium's, whose
 * Creator, Producer and per-run CreationDate and ModDate would make the two backends' Info differ.
 */
export function withDocumentInfo(pdf: Uint8Array, info: DocumentInfo): Uint8Array {
    const entries = Object.entries({ ...info, Creator: PDF_PRODUCER, Producer: PDF_PRODUCER }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
    const trailer = readTrailer(pdfText(pdf), pdfError);
    const reference = trailer.info ?? { number: trailer.size, generation: 0 };
    const body = `<<${entries.map(([key, value]) => `/${key} ${textString(value)}`).join("")}>>`;
    return appendObjects(pdf, trailer, [{ ...reference, body }], reference);
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
