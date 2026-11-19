import { appendObjects, type PdfObject, pdfText, readTrailer } from "./pdfUpdate";

/**
 * Chromium canonicalizes a link's URL before it writes the PDF `/URI` (`https://example.com` gets a "/", hosts are
 * lowercased, default ports and dot segments dropped, IDN hosts punycoded, spaces and non-ASCII percent-encoded),
 * while PowerPoint's export and the WASM renderer write the URL as given. So the page prints external link `index`
 * as `${LINK_PLACEHOLDER}${index}`, which canonicalization leaves alone, and `withLinkUris` writes the URLs back.
 * `.invalid` is reserved (RFC 2606): no real link looks like one.
 */
export const LINK_PLACEHOLDER = "https://pdflapas.invalid/";

const PLACEHOLDER_URI = /\/URI\s*\(https:\/\/pdflapas\.invalid\/(\d+)\)/g;
const PLACEHOLDER_HOST = "pdflapas.invalid";
const OBJECT_HEADER = /(\d+) (\d+) obj$/;
const LITERAL_ESCAPES = /[\\()\r\n]/g;
const ESCAPED: Readonly<Record<string, string>> = { "\\": "\\\\", "(": "\\(", ")": "\\)", "\r": "\\r", "\n": "\\n" };

/**
 * `pdf` with an incremental update that sets each placeholder link annotation's `/URI` to `uris[index]`, the URL as
 * the deck gives it. Chromium writes each link annotation as its own object with the action inline and no object
 * streams; a PDF in another shape throws, so no placeholder reaches a reader. Without links, returns `pdf` itself.
 */
export function withLinkUris(pdf: Uint8Array, uris: readonly string[]): Uint8Array {
    if (uris.length === 0) return pdf;
    const text = pdfText(pdf);
    if (text.includes("/ObjStm")) throw linkError("it has object streams, where its link annotations cannot be found");
    // The offset of " obj" in each object holding a placeholder.
    const starts = new Set<number>();
    let placeholders = 0;
    for (const match of text.matchAll(PLACEHOLDER_URI)) {
        const start = text.lastIndexOf(" obj", match.index);
        if (start < 0 || text.indexOf("endobj", start) < match.index) throw linkError(`the link annotation at byte ${match.index} is not inside an object`);
        starts.add(start);
        placeholders++;
    }
    // A link clipped off its page has no annotation, so fewer placeholders than links is fine; one elsewhere is not.
    if (text.split(PLACEHOLDER_HOST).length - 1 !== placeholders) throw linkError("it has a link placeholder outside a /URI action");
    const objects = Array.from(starts, (start): PdfObject => {
        const header = OBJECT_HEADER.exec(text.slice(text.lastIndexOf("\n", start) + 1, start + " obj".length));
        if (!header) throw linkError(`the object at byte ${start} has no "n g obj" header line`);
        const body = text.slice(start + " obj".length, text.indexOf("endobj", start)).trim();
        return { number: Number(header[1]), generation: Number(header[2]), body: body.replace(PLACEHOLDER_URI, (_, index: string) => `/URI ${literalString(uri(uris, index))}`) };
    });
    return objects.length ? appendObjects(pdf, readTrailer(text, linkError), objects) : pdf;
}

function uri(uris: readonly string[], index: string): string {
    const value = uris[Number(index)];
    if (value === undefined) throw linkError(`its link placeholder ${index} names no link of the document`);
    return value;
}

/** `uri` as a PDF literal string of its UTF-8 bytes, as the WASM renderer writes it (ISO 32000-1 7.3.4.2). */
function literalString(uri: string): string {
    return `(${Buffer.from(uri, "utf8")
        .toString("latin1")
        .replace(LITERAL_ESCAPES, char => ESCAPED[char] ?? char)})`;
}

function linkError(problem: string): Error {
    return new Error(`Cannot write the PDF link URLs: Chromium's PDF is not in the shape expected (${problem}). Report it with the Chromium version.`);
}
