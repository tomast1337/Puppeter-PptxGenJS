import { describe, expect, spyOn, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen } from "../packages/pptxgenjs/src/html";
import { PuppeteerGen as NodePuppeteerGen } from "../packages/pptxgenjs/src/node";
import { convertPdfOutput, resolveFileName, resolveOutputType } from "../packages/pptxgenjs/src/output";
import type { HtmlPresentationDocument, PresentationRenderer } from "../packages/pptxgenjs/src/render/document";

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

describe("writeFile()", () => {
    test("turns a .pptx name into .pdf, keeps .pdf and appends .pdf to any other name", () => {
        // PptxGenJS: "a.PPTX" -> "a.PPTX", "b.pdf" -> "b.pdf.pptx", "c" -> "c.pptx" (with a warning). A migrated
        // "report.pptx" must write "report.pdf", so the .pptx extension is replaced rather than kept.
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            expect(resolveFileName({ fileName: "report.pptx" })).toBe("report.pdf");
            expect(resolveFileName({ fileName: "a.PPTX" })).toBe("a.pdf");
            expect(resolveFileName({ fileName: "a.PDF", compression: true })).toBe("a.PDF");
            expect(resolveFileName({ fileName: "deck" })).toBe("deck.pdf");
            expect(resolveFileName({ fileName: "deck.pptx.bak" })).toBe("deck.pptx.bak.pdf");
            expect(warn).not.toHaveBeenCalled();
            expect(resolveFileName("c.pptx")).toBe("c.pdf");
            expect(warn).toHaveBeenCalledWith("[WARNING] writeFile(string) is deprecated - pass { fileName } instead.");
        } finally {
            warn.mockRestore();
        }
    });

    test("requires a file name, unlike PptxGenJS's Presentation.pptx default", () => {
        const fix = 'pass one, for example writeFile({ fileName: "deck.pdf" })';
        expect(() => resolveFileName()).toThrow(new TypeError(`writeFile() needs a file name, got undefined; ${fix}`));
        expect(() => resolveFileName({})).toThrow(`got undefined; ${fix}`);
        expect(() => resolveFileName({ fileName: "" })).toThrow(`got an empty string; ${fix}`);
        expect(() => resolveFileName({ fileName: 3 as unknown as string })).toThrow(`got number; ${fix}`);
        const warn = spyOn(console, "warn").mockImplementation(() => {});
        try {
            expect(() => resolveFileName("")).toThrow(`got an empty string; ${fix}`);
        } finally {
            warn.mockRestore();
        }
    });

    test("writeFile() with no argument rejects before rendering", async () => {
        const { pres, renderer } = deck();
        await expect(pres.writeFile()).rejects.toThrow(TypeError);
        await expect(new NodePuppeteerGen(undefined, { renderer }).writeFile()).rejects.toThrow("writeFile() needs a file name");
        expect(renderer.calls).toBe(0);
    });

    test("the Node entry writes the PDF under that name and returns it", async () => {
        const base = join(tmpdir(), `pdflapas-write-${crypto.randomUUID()}`);
        const pres = new NodePuppeteerGen(undefined, { renderer: new FakeRenderer() });
        pres.addSlide();
        try {
            expect(await pres.writeFile({ fileName: base })).toBe(`${base}.pdf`);
            expect([...(await readFile(`${base}.pdf`))]).toEqual([...BYTES]);
        } finally {
            await rm(`${base}.pdf`, { force: true });
        }
    });

    test("in a browser it downloads the PDF through a hidden link, as PptxGenJS downloads its .pptx", async () => {
        const { window } = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
        const clicked: { download: string; href: string; style: string | null }[] = [];
        const click = spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            clicked.push({ download: this.download, href: this.href, style: this.getAttribute("style") });
        });
        const blobs: Blob[] = [];
        const createObjectURL = spyOn(URL, "createObjectURL").mockImplementation(blob => {
            blobs.push(blob as Blob);
            return "blob:pdflapas-test";
        });
        const globals = globalThis as { document?: Document };
        globals.document = window.document;
        try {
            const { pres } = deck();
            expect(await pres.writeFile({ fileName: "deck" })).toBe("deck.pdf");
            expect(clicked).toEqual([{ download: "deck.pdf", href: "blob:pdflapas-test", style: "display:none;" }]);
            expect(blobs[0]?.type).toBe("application/pdf");
            expect([...new Uint8Array((await blobs[0]?.arrayBuffer()) ?? new ArrayBuffer(0))]).toEqual([...BYTES]);
        } finally {
            delete globals.document;
            click.mockRestore();
            createObjectURL.mockRestore();
        }
    });
});
