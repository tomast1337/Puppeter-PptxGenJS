import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen } from "../src/html";
import { convertPdfOutput, resolveOutputType } from "../src/output";
import type { HtmlPresentationDocument, PresentationRenderer } from "../src/render/document";

// Every byte value, so latin1/base64 conversions are checked across the full range.
const BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);

class FakeRenderer implements PresentationRenderer {
    calls = 0;
    async render(_document: HtmlPresentationDocument): Promise<Uint8Array> {
        this.calls++;
        return BYTES;
    }
}

function deck(renderer = new FakeRenderer()) {
    const pres = new PuppeteerGen(undefined, { renderer, createDocument: () => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document });
    pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });
    return { pres, renderer };
}

function withoutBuffer<T>(run: () => T): T {
    const original = globalThis.Buffer;
    // @ts-expect-error simulate a browser runtime
    delete globalThis.Buffer;
    try {
        return run();
    } finally {
        globalThis.Buffer = original;
    }
}

describe("convertPdfOutput", () => {
    test("converts to every PptxGenJS output type", async () => {
        expect(convertPdfOutput(BYTES, "uint8array")).toBe(BYTES);
        expect(convertPdfOutput(BYTES, "base64")).toBe(Buffer.from(BYTES).toString("base64"));
        expect(convertPdfOutput(BYTES, "binarystring")).toBe(Buffer.from(BYTES).toString("latin1"));
        const node = convertPdfOutput(BYTES, "nodebuffer");
        expect(Buffer.isBuffer(node)).toBe(true);
        expect([...(node as Buffer)]).toEqual([...BYTES]);
        expect(Buffer.isBuffer(convertPdfOutput(BYTES, "STREAM"))).toBe(true);
        const blob = convertPdfOutput(BYTES, "blob") as Blob;
        expect(blob.type).toBe("application/pdf");
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(BYTES);
        expect(convertPdfOutput(BYTES, null)).toBeInstanceOf(Blob);
    });

    test("arraybuffer is exact-length even for a view into a larger buffer", () => {
        const view = new Uint8Array(new ArrayBuffer(16), 4, 3).fill(7);
        const buffer = convertPdfOutput(view, "arraybuffer") as ArrayBuffer;
        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect([...new Uint8Array(buffer)]).toEqual([7, 7, 7]);
    });

    test("binarystring and base64 handle PDFs larger than the argument limit", () => {
        const large = new Uint8Array(300_000).fill(65);
        expect((convertPdfOutput(large, "binarystring") as string).length).toBe(300_000);
        expect(convertPdfOutput(large, "base64")).toBe(Buffer.from(large).toString("base64"));
    });

    test("nodebuffer and STREAM throw an explicit error without Buffer", () => {
        withoutBuffer(() => {
            expect(() => convertPdfOutput(BYTES, "nodebuffer")).toThrow("use 'uint8array', 'arraybuffer', 'base64', 'binarystring' or 'blob'");
            expect(() => convertPdfOutput(BYTES, "STREAM")).toThrow("needs Node's Buffer");
            expect(convertPdfOutput(BYTES, "base64")).toBe(btoa(String.fromCharCode(...BYTES)));
        });
    });
});

describe("resolveOutputType", () => {
    test("follows PptxGenJS 4.0.1: object, bare string, or nothing", () => {
        expect(resolveOutputType({ outputType: "base64" })).toBe("base64");
        expect(resolveOutputType("base64" as PptxGenJS.WRITE_OUTPUT_TYPE)).toBe("base64");
        expect(resolveOutputType({ compression: true })).toBeNull();
        expect(resolveOutputType()).toBeNull();
    });

    test("rejects unknown output types with the valid list", () => {
        expect(() => resolveOutputType({ outputType: "pdf" as PptxGenJS.WRITE_OUTPUT_TYPE })).toThrow("expected one of arraybuffer, base64, binarystring, blob, nodebuffer, uint8array, STREAM");
    });
});

describe("write() and stream()", () => {
    test("write() returns the rendered PDF in the requested type", async () => {
        const { pres } = deck();
        expect(await pres.write({ outputType: "uint8array" })).toBe(BYTES);
        expect(await pres.write({ outputType: "base64", compression: true })).toBe(Buffer.from(BYTES).toString("base64"));
        // PptxGenJS also accepts a bare outputType string at runtime.
        expect(await pres.write("binarystring" as unknown as PptxGenJS.WriteProps)).toBe(Buffer.from(BYTES).toString("latin1"));
        expect(Buffer.isBuffer(await pres.write({ outputType: "STREAM" }))).toBe(true);
        expect(await pres.write()).toBeInstanceOf(Blob);
        expect(await pres.write({ compression: true })).toBeInstanceOf(Blob);
    });

    test("stream() returns a Node Buffer and ignores compression", async () => {
        const { pres } = deck();
        const result = await pres.stream({ compression: true });
        expect(Buffer.isBuffer(result)).toBe(true);
        expect([...(result as Buffer)]).toEqual([...BYTES]);
    });

    test("write() rejects an unknown type before rendering", async () => {
        const { pres, renderer } = deck();
        await expect(pres.write({ outputType: "pdf" as PptxGenJS.WRITE_OUTPUT_TYPE })).rejects.toThrow("Unsupported outputType 'pdf'");
        expect(renderer.calls).toBe(0);
    });
});
