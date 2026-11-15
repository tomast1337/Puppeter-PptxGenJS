import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "./defaults";
import { binaryString } from "./normalize/image";

export type WriteOutput = string | ArrayBuffer | Blob | Uint8Array;

const OUTPUT_TYPES: readonly string[] = ["arraybuffer", "base64", "binarystring", "blob", "nodebuffer", "uint8array", "STREAM"];

/**
 * PptxGenJS 4.0.1 `write()` outputType resolution: `{ outputType }`, a bare outputType string, or nothing (null).
 * `compression` is accepted and ignored: it only picks zip DEFLATE vs STORE, which has no PDF equivalent.
 * Unknown types throw here so `write()` fails before rendering.
 */
export function resolveOutputType(props?: PptxGenJS.WriteProps | PptxGenJS.WRITE_OUTPUT_TYPE): PptxGenJS.WRITE_OUTPUT_TYPE | null {
    const outputType = props && typeof props === "object" ? props.outputType : props;
    if (!outputType) return null;
    if (!OUTPUT_TYPES.includes(outputType)) throw new Error(`Unsupported outputType '${outputType}': expected one of ${OUTPUT_TYPES.join(", ")}`);
    return outputType;
}

/**
 * PptxGenJS 4.0.1 `writeFile()` file name: `{ fileName }`, or a bare string (deprecated, with PptxGenJS's warning).
 * No name gives "Presentation.pdf", and ".pdf" is appended unless the name ends in it (any case): "deck.pptx"
 * becomes "deck.pptx.pdf", as PptxGenJS turns "deck.pdf" into "deck.pdf.pptx". `compression` is ignored (zip-only).
 */
export function resolveFileName(props?: PptxGenJS.WriteFileProps | string): string {
    if (typeof props === "string") console.warn("[WARNING] writeFile(string) is deprecated - pass { fileName } instead.");
    const name: unknown = (typeof props === "string" ? props : props?.fileName) ?? PPTX_DEFAULTS.write.pdfFileName;
    if (typeof name !== "string") throw new TypeError(`writeFile() fileName must be a string, got ${typeof name}; for example { fileName: "deck.pdf" }`);
    const { pdfExtension } = PPTX_DEFAULTS.write;
    return name.toLowerCase().endsWith(pdfExtension) ? name : `${name}${pdfExtension}`;
}

/** PptxGenJS 4.0.1 `writeFileToBrowser()`: a hidden download link clicked once, released 100 ms later (Firefox needs the delay). */
export function downloadPdf(document: Document, fileName: string, bytes: Uint8Array): void {
    const link = document.createElement("a");
    link.setAttribute("style", "display:none;");
    link.dataset.interception = "off"; // SharePoint would intercept the click otherwise
    document.body.appendChild(link);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
    }, 100);
}

/** Converts PDF bytes the way PptxGenJS converts its zip: STREAM -> nodebuffer, no type -> blob. */
export function convertPdfOutput(bytes: Uint8Array, outputType: PptxGenJS.WRITE_OUTPUT_TYPE | null): WriteOutput {
    switch (outputType ?? PPTX_DEFAULTS.write.outputType) {
        case "uint8array":
            return bytes;
        case "arraybuffer":
            // Exact-length copy: `bytes` may be a view into a larger backing buffer.
            return bytes.slice().buffer as ArrayBuffer;
        case "base64":
            return btoa(binaryString(bytes));
        case "binarystring":
            return binaryString(bytes);
        case "blob":
            return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
        case "STREAM":
        case "nodebuffer": {
            const NodeBuffer = (globalThis as { Buffer?: { from(bytes: Uint8Array): Uint8Array } }).Buffer;
            if (!NodeBuffer) throw new Error(`outputType '${outputType}' needs Node's Buffer, which this runtime lacks; use 'uint8array', 'arraybuffer', 'base64', 'binarystring' or 'blob'`);
            return NodeBuffer.from(bytes);
        }
        default:
            throw new Error(`Unsupported outputType '${outputType}': expected one of ${OUTPUT_TYPES.join(", ")}`);
    }
}
