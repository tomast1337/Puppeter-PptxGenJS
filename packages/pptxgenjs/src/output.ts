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
