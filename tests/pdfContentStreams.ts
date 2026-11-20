import { inflateSync } from "node:zlib";

/** The decoded Flate streams of a PDF, in file order. */
export function pdfContentStreams(pdf: Uint8Array): string[] {
    const bytes = Buffer.from(pdf);
    const streams: string[] = [];
    for (let at = bytes.indexOf("stream\n"); at >= 0; at = bytes.indexOf("stream\n", at + 1)) {
        try {
            streams.push(inflateSync(bytes.subarray(at + "stream\n".length, bytes.indexOf("endstream", at))).toString("latin1"));
        } catch {
            // Not a Flate stream (fonts are, but images may not be); content streams always are.
        }
    }
    return streams;
}
