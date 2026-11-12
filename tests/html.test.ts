import { describe, expect, spyOn, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { PuppeteerGen as HtmlPuppeteerGen, type HtmlPresentationDocument, type PresentationRenderer } from "../src/html";
import { PuppeteerGen } from "../src/node";
import { dataUri } from "../src/normalize/image";
import { PAGE_SIZES } from "../src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
// The test owns jsdom; the html entry itself never imports it.
const createDocument = () => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;

class FakeRenderer implements PresentationRenderer {
    received: HtmlPresentationDocument[] = [];
    async render(document: HtmlPresentationDocument): Promise<Uint8Array> {
        this.received.push(document);
        return new TextEncoder().encode("%PDF-fake");
    }
}

function deck(pres: HtmlPuppeteerGen): HtmlPuppeteerGen {
    pres.addSlide().addText("First slide", { x: 1, y: 1, w: 4, h: 1 }).addImage({ data: PNG_DATA, x: 1, y: 2, w: 1, h: 1 });
    pres.addSlide().addImage({ path: "https://example.com/remote.png", x: 1, y: 1, w: 1, h: 1 });
    return pres;
}

describe("browser-safe html entry", () => {
    test("bundles for the browser without puppeteer, jsdom or node:* modules", async () => {
        // The installed bun-types predate Bun.build's metafile option, which the runtime supports.
        const config = { entrypoints: [resolve(import.meta.dir, "../src/html.ts")], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0];
        const build = (await Bun.build(config)) as Awaited<ReturnType<typeof Bun.build>> & { metafile: { inputs: Record<string, { imports: { path: string }[] }> } };
        expect(build.success).toBe(true);
        const inputs = build.metafile.inputs;
        const forbidden = /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/;
        expect(Object.keys(inputs).filter(path => forbidden.test(path))).toEqual([]);
        expect(Object.values(inputs).flatMap(input => input.imports.map(entry => entry.path).filter(path => forbidden.test(path)))).toEqual([]);
        expect(Object.keys(inputs)).not.toContain("src/node.ts");
    });

    test("toHtml returns a self-contained document without launching Chromium or reading files", async () => {
        const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
        try {
            const pres = deck(new HtmlPuppeteerGen(PAGE, { createDocument }));
            const document = await pres.toHtml();
            expect(document.pageSize).toEqual(PAGE);
            expect(document.html).toContain(`size: ${PAGE.width}in ${PAGE.height}in`);
            const parsed = new JSDOM(document.html).window.document;
            expect(parsed.querySelectorAll(".slide-container")).toHaveLength(2);
            expect(parsed.querySelector(".slide-text")?.textContent).toContain("First slide");
            const sources = Array.from(parsed.images, image => image.getAttribute("src"));
            expect(sources).toEqual([PNG_DATA, "data:image/png;base64,AQID"]);
            expect(parsed.querySelectorAll("[data-source-path], [data-source-url]")).toHaveLength(0);
            expect(fetchMock).toHaveBeenCalledWith("https://example.com/remote.png");
        } finally {
            fetchMock.mockRestore();
        }
    });

    test("toPdf delegates the serialized document to the injected renderer", async () => {
        const renderer = new FakeRenderer();
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer });
        pres.addSlide().addText("Rendered", { x: 1, y: 1, w: 4, h: 1 });
        const pdf = await pres.toPdf();
        expect(new TextDecoder().decode(pdf)).toBe("%PDF-fake");
        expect(renderer.received).toEqual([await pres.toHtml()]);
    });

    test("uses an injected image resolver for paths", async () => {
        const resolveImage = async (source: string) => (source === "logo.png" ? PNG_DATA : Promise.reject(new Error(source)));
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, resolveImage });
        pres.addSlide().addImage({ path: "logo.png", x: 1, y: 1, w: 1, h: 1 });
        expect((await pres.toHtml()).html).toContain(`src="${PNG_DATA}"`);
    });

    test("fails explicitly for missing runtime capabilities", async () => {
        expect((globalThis as { document?: Document }).document).toBeUndefined();
        expect(() => new HtmlPuppeteerGen(PAGE)).toThrow("No DOM is available");

        const pres = new HtmlPuppeteerGen(PAGE, { createDocument });
        pres.addSlide().addImage({ path: "images/logo.png", x: 1, y: 1, w: 1, h: 1 });
        expect(pres.toHtml()).rejects.toThrow("Cannot resolve image path 'images/logo.png' without filesystem access");
        expect(pres.toPdf()).rejects.toThrow("toPdf() requires a renderer");
        expect(pres.writeFile({ fileName: "deck.pdf" })).rejects.toThrow("only available from the Node entry");
    });

    test("encodes base64 without Buffer, including inputs larger than one chunk", () => {
        const bytes = Uint8Array.from({ length: 0x8000 * 2 + 17 }, (_, index) => (index * 31) % 256);
        expect(dataUri(bytes, "image/png")).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
        expect(dataUri(bytes.buffer, "image/png")).toBe(dataUri(bytes, "image/png"));
    });
});

describe("Node entry", () => {
    test("writeFile writes the bytes produced by an injected renderer", async () => {
        const renderer = new FakeRenderer();
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.addSlide().addText("Node", { x: 1, y: 1, w: 4, h: 1 });
        const fileName = join(tmpdir(), `puppeteer-gen-${crypto.randomUUID()}.pdf`);
        try {
            expect(await pres.writeFile({ fileName })).toBe(fileName);
            expect(await readFile(fileName, "utf8")).toBe("%PDF-fake");
            expect(renderer.received).toHaveLength(1);
            expect(renderer.received[0]!.html).toContain("Node");
        } finally {
            await rm(fileName, { force: true });
        }
    });

    test("toHtml resolves filesystem image paths by default", async () => {
        const path = join(tmpdir(), `puppeteer-gen-${crypto.randomUUID()}.svg`);
        await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
        try {
            const pres = new PuppeteerGen(PAGE);
            pres.addSlide().addImage({ path, x: 1, y: 1, w: 1, h: 1 });
            expect((await pres.toHtml()).html).toContain('src="data:image/svg+xml;base64,');
        } finally {
            await rm(path, { force: true });
        }
    });
});
