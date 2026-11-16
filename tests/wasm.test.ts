import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { z } from "zod";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen as HtmlPuppeteerGen, type HtmlPresentationDocument, type PresentationRenderer } from "../packages/pptxgenjs/src/html";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "../packages/pptxgenjs/src/node";
import { CORE_SVG_SHAPES } from "../packages/pptxgenjs/src/normalize/shape";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { completeProfileHtml, pptxHtmlDocument } from "../packages/pptxgenjs/src/render/completion";
import { loadSystemFonts as browserLoadSystemFonts, type TextPdfBinding, WasmRenderer, type WasmSource } from "../packages/wasm/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import type { InitInput, Renderer } from "../packages/wasm/src/pdf_wasm.js";
import { HAND_WRITTEN_OBJECTS, handWrittenDocument } from "./handWrittenHtml";

// Type-level checks against the committed wasm-bindgen declarations: regenerating them with an
// incompatible binding fails `bun run typecheck`.
type Assert<T extends true> = T;
type _Binding = Assert<Renderer extends TextPdfBinding ? true : false>;
type _Source = Assert<WasmSource extends InitInput ? true : false>;
type _Renderer = Assert<WasmRenderer extends PresentationRenderer ? true : false>;

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const createDocument = () => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const EMPTY = { html: "<html></html>", pageSize: PAGE };

afterAll(() => closeBrowser());

class FakeBinding implements TextPdfBinding {
    rendered: string[] = [];
    constructor(private readonly skipped: string[] = []) {}
    addFont(): number {
        return 1;
    }
    renderHtml(html: string): Uint8Array {
        this.rendered.push(html);
        return new TextEncoder().encode("%PDF-fake");
    }
    warnings(): string[] {
        return this.skipped;
    }
}

describe("renderer contract", () => {
    test("toPdf, write and stream hand toHtml() to the WASM renderer", async () => {
        const binding = new FakeBinding();
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer: new WasmRenderer(binding) });
        pres.addSlide().addText("Html", { x: 1, y: 1, w: 3, h: 1 });
        expect(ascii(await pres.toPdf())).toBe("%PDF-fake");
        expect(await pres.write({ outputType: "base64" })).toBe(btoa("%PDF-fake"));
        expect(ascii((await pres.stream()) as Uint8Array)).toBe("%PDF-fake");
        const { html } = await pres.toHtml();
        expect(binding.rendered).toEqual([html, html, html]);
    });

    test("resolves path and URL images to data URIs once per source before the renderer sees them", async () => {
        const documents: HtmlPresentationDocument[] = [];
        const renderer: PresentationRenderer = { render: async document => (documents.push(document), new TextEncoder().encode("%PDF-html")) };
        const requested: string[] = [];
        const resolveImage = async (source: string) => (requested.push(source), PNG);
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer, resolveImage });
        pres.addSlide().addImage({ path: "logo.png", x: 1, y: 1, w: 1, h: 1 }).addImage({ path: "logo.png", x: 3, y: 1, w: 1, h: 1 });
        pres.addSlide().addImage({ path: "https://example.com/a.png", x: 1, y: 1, w: 1, h: 1 }).addImage({ data: PNG, x: 3, y: 1, w: 1, h: 1 });
        await pres.toPdf();
        expect(requested).toEqual(["logo.png", "https://example.com/a.png"]);
        expect(documents[0]?.html.match(/<img [^>]*src="([^"]*)"/g)?.map(img => img.includes(`src="${PNG}"`))).toEqual([true, true, true, true]);
        // getModel() itself keeps the sources the caller passed.
        expect(pres.getModel().slides[0]?.objects[0]).toMatchObject({ image: { source: "logo.png", sourceKind: "path" } });
    });

    test("a renderer without render() fails with an error that says what toPdf() calls", async () => {
        const renderer = { renderModel: async () => new Uint8Array() } as unknown as PresentationRenderer; // a model-only renderer from plain JS
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer });
        await expect(pres.toPdf()).rejects.toThrow("toPdf() renderer must implement render(document: HtmlPresentationDocument)");
    });

    test("the Node entry renders writeFile() through the WASM renderer", async () => {
        const directory = await mkdtemp(join(tmpdir(), "wasm-file-"));
        try {
            const renderer = new WasmRenderer(new FakeBinding());
            const pres = new PuppeteerGen(PAGE, { renderer });
            pres.addSlide().addText("File", { x: 1, y: 1, w: 3, h: 1 });
            const fileName = join(directory, "deck.pdf");
            await pres.writeFile({ fileName });
            expect(await Bun.file(fileName).text()).toBe("%PDF-fake");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe("WasmRenderer failure behavior", () => {
    test("throws and lists what the backend skipped by default", async () => {
        const binding = new FakeBinding(["object kind 'image' not rendered", "tab stops ignored"]);
        const error = await new WasmRenderer(binding).render(EMPTY).catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("- object kind 'image' not rendered\n- tab stops ignored");
        expect((error as Error).message).toContain('onUnsupported: "warn"');
    });

    test('onUnsupported: "warn" returns the PDF and surfaces warnings()', async () => {
        const renderer = new WasmRenderer(new FakeBinding(["inner shadow not rendered"]), "warn");
        expect(ascii(await renderer.render(EMPTY))).toBe("%PDF-fake");
        expect(renderer.warnings()).toEqual(["inner shadow not rendered"]);
    });

    test("render() passes the HTML to the binding", async () => {
        const binding = new FakeBinding();
        await new WasmRenderer(binding).render(EMPTY);
        expect(binding.rendered).toEqual([EMPTY.html]);
    });

    test("createWasmRenderer requires fonts before loading the binary", async () => {
        await expect(createWasmRenderer({ fonts: [] })).rejects.toThrow("requires at least one font");
    });
});

describe("font loading", () => {
    test("loadSystemFonts reads matching files recursively and rejects empty results", async () => {
        const directory = await mkdtemp(join(tmpdir(), "wasm-fonts-"));
        try {
            await Bun.write(join(directory, "nested/Carlito-Regular.ttf"), new Uint8Array([1, 2]));
            await writeFile(join(directory, "Unrelated.ttf"), new Uint8Array([3]));
            await writeFile(join(directory, "DejaVuSans.ttf"), new Uint8Array([4]));
            await writeFile(join(directory, "NotoColorEmoji.ttf"), new Uint8Array([5]));
            expect(await loadSystemFonts({ dirs: [directory] })).toEqual([new Uint8Array([4]), new Uint8Array([5]), new Uint8Array([1, 2])]);
            expect(await loadSystemFonts({ dirs: [directory], match: /^Unrelated\.ttf$/ })).toEqual([new Uint8Array([3])]);
            await expect(loadSystemFonts({ dirs: [join(directory, "missing")] })).rejects.toThrow("No font files matching");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test("the browser entry's loadSystemFonts is an explicit error", async () => {
        await expect(browserLoadSystemFonts()).rejects.toThrow("only available under Node/Bun");
    });
});

test("the browser WASM entry bundles without puppeteer, jsdom or node:* modules", async () => {
    const config = { entrypoints: [resolve(import.meta.dir, "../packages/wasm/src/browser.ts")], target: "browser", format: "esm", metafile: true } as Parameters<typeof Bun.build>[0];
    const build = (await Bun.build(config)) as Awaited<ReturnType<typeof Bun.build>> & { metafile: { inputs: Record<string, { imports: { path: string }[] }> } };
    expect(build.success).toBe(true);
    const forbidden = /(^|\/)node_modules\/(puppeteer(-core)?|@puppeteer\/[^/]+|jsdom)\/|^node:/;
    const inputs = build.metafile.inputs;
    expect(Object.keys(inputs).filter(path => forbidden.test(path))).toEqual([]);
    expect(Object.values(inputs).flatMap(input => input.imports.map(entry => entry.path).filter(path => forbidden.test(path)))).toEqual([]);
});

// These need the binary from `bun run build:wasm` and real fonts. CI downloads the binary from its
// "WASM build" job, so there a missing binary or font set fails instead of skipping.
const wasmBuilt = await Bun.file(resolve(import.meta.dir, "../packages/wasm/src/pdf_wasm_bg.wasm")).exists();
const systemFonts = wasmBuilt ? await loadSystemFonts().catch(() => []) : [];
const canRender = wasmBuilt && systemFonts.length > 0;
if (!canRender) {
    const reason = wasmBuilt ? "no system fonts found" : "packages/wasm/src/pdf_wasm_bg.wasm is not built (bun run build:wasm)";
    if (process.env.CI === "true") throw new Error(`WASM render tests cannot run in CI: ${reason}`);
    console.warn(`Skipping WASM render tests: ${reason}`);
}

describe.skipIf(!canRender)("WASM backend render", () => {
    test("renders text slides to a PDF with one page per slide", async () => {
        const pres = new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) });
        pres.addSlide().addText("Hello", { x: 1, y: 1, w: 3, h: 1, fontFace: "Calibri", bold: true });
        // Arial -> Liberation Sans has a real italic; on a host without Carlito/DejaVu, Calibri italic
        // would land on Noto Sans CJK and need synthetic italic, which (correctly) throws.
        pres.addSlide().addText([{ text: "Rich " }, { text: "text", options: { italic: true, color: "FF0000" } }], { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial", fill: { color: "EEEEEE" } });
        pres.addSlide().addShape("roundRect", { x: 1, y: 1, w: 2, h: 1, fill: { color: "0088CC" }, rectRadius: 0.2 });
        const pdf = await pres.toPdf();
        const source = ascii(pdf);
        expect(source.startsWith("%PDF-")).toBe(true);
        expect(source.match(/\/Type\s*\/Page\b(?!s)/g)).toHaveLength(3);
    });

    test("follows the PowerPoint target's font-kerning: none, so the unkerned runs move", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pdf = async (pres: PuppeteerGen) => {
            pres.addSlide().addText("AVATAR WAVY Tower Toy Yay", { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial", fontSize: 10 });
            return ascii(await pres.toPdf());
        };
        const powerPoint = await pdf(new PuppeteerGenPowerPoint(PAGE, { renderer }));
        expect(powerPoint).toBe(await pdf(new PuppeteerGenPowerPoint(PAGE, { renderer })));
        expect(powerPoint).not.toBe(await pdf(new PuppeteerGenLibreOffice(PAGE, { renderer })));
    });

    test("throws on unsupported objects by default and lists them", async () => {
        const pres = new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) });
        pres.addSlide()
            .addText("Text", { x: 1, y: 1, w: 3, h: 1 })
            .addShape("ellipse", { x: 4, y: 1, w: 1, h: 1, shadow: { type: "inner", blur: 3, offset: 3, angle: 45 } });
        await expect(pres.toPdf()).rejects.toThrow(/inner shadow not rendered/);
    });

    test("draws components made of sized boxes and names the slide, object and element of one that needs layout", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        const drawn = new PuppeteerGen(PAGE, { renderer });
        drawn.registerComponent("test/bar", 1, { schema: z.object({}), render: () => '<div style="width:50%;height:100%;background:#4472C4"></div>' });
        drawn.addSlide().addComponent({ type: "test/bar", version: 1, props: {} }, { x: 1, y: 2, w: 2, h: 1 });
        expect(ascii(await drawn.toPdf()).startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual([]);
        // Not skipped even with onUnsupported: "warn": the markup is outside the profile.
        const text = new PuppeteerGen(PAGE, { renderer });
        text.registerComponent("test/badge", 1, { schema: z.object({}), render: () => "<b>Badge</b>" });
        text.addSlide().addComponent({ type: "test/badge", version: 1, props: {} }, { x: 1, y: 2, w: 2, h: 1, objectName: "Badge" });
        await expect(text.toPdf()).rejects.toThrow("invalid PdfLapas HTML: slide 1: object 'Badge': component 'test/badge' v1: <b> is not in profile v2: component markup is nested <div> boxes");
    });

    test("draws every chart type and chart extensions as SVG, with nothing skipped", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        const series = [
            { name: "North", labels: ["Q1", "Q2", "Q3"], values: [3, 5, 4] },
            { name: "South", labels: ["Q1", "Q2", "Q3"], values: [5, 2, 6] },
        ];
        const xy = [
            { name: "X", values: [1, 2, 3] },
            { name: "Y", values: [3, 5, 4], sizes: [1, 4, 2] },
        ];
        const box = { x: 1, y: 1, w: 5, h: 3.5, showLegend: true, showTitle: true, title: "Sales <&>" };
        for (const type of ["bar", "line", "area", "radar", "bar3D"] as const) pres.addSlide().addChart(type, series, box);
        for (const type of ["pie", "doughnut"] as const) pres.addSlide().addChart(type, series.slice(0, 1), box);
        for (const type of ["scatter", "bubble"] as const) pres.addSlide().addChart(type, xy, box);
        pres.addSlide().addChart("bar3D", series, { ...box, bar3DShape: "cylinder", chartColorsOpacity: 50 });
        pres.addSlide()
            .addChartEx({ renderer: "echarts", option: { series: [{ type: "pie", data: [1, 2, 3] }] } }, { x: 1, y: 1, w: 3, h: 3 })
            .addChartEx({ renderer: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="5" fill="#C00000"/></svg>' }, { x: 5, y: 1, w: 3, h: 3 });
        const source = ascii(await pres.toPdf());
        expect(renderer.warnings()).toEqual([]);
        expect(source.match(/\/Type\s*\/Page\b(?!s)/g)).toHaveLength(11);

        // A caller's SVG outside the subset the reader knows is an error naming the place, not a blank box.
        const odd = new PuppeteerGen(PAGE, { renderer });
        odd.addSlide().addChartEx({ renderer: "svg", svg: '<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>' }, { x: 1, y: 1, w: 3, h: 3 });
        await expect(odd.toPdf()).rejects.toThrow("slide 1: object 'Chart 0': <use> is not in the SVG subset");
    });

    test("makes linked runs, shapes, images and table cells clickable", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.addSlide()
            .addText([{ text: "Docs", options: { hyperlink: { url: "https://example.com/docs", tooltip: "Open the docs" } } }], { x: 1, y: 1, w: 3, h: 0.5 })
            .addShape("rect", { x: 1, y: 2, w: 2, h: 1, rotate: 30, fill: { color: "0088CC" }, hyperlink: { slide: 2 } })
            .addImage({ data: PNG, x: 4, y: 2, w: 1, h: 1, hyperlink: { url: "mailto:team@example.com" } })
            // A linked cell and a linked run in a cell, as PptxGenJS writes a hlinkClick for both.
            .addTable([[{ text: "Cell", options: { hyperlink: { url: "https://example.com/cell" } } }, { text: [{ text: "Run", options: { hyperlink: { slide: 2 } } }] }]], { x: 1, y: 4, w: 4 });
        pres.addSlide().addText("Second", { x: 1, y: 1, w: 3, h: 0.5 });
        const source = ascii(await pres.toPdf());
        expect(renderer.warnings()).toEqual([]);
        const links = source.match(/\/Type\/Annot\/Subtype\/Link[^\n]*/g) ?? [];
        expect(links).toHaveLength(5);
        expect(links.filter(link => link.includes("/URI(https://example.com/docs)") && link.includes("/Contents(Open the docs)"))).toHaveLength(1);
        expect(links.filter(link => link.includes("/URI(mailto:team@example.com)"))).toHaveLength(1);
        expect(links.filter(link => link.includes("/URI(https://example.com/cell)"))).toHaveLength(1);
        // The rotated shape and the cell run jump to page 2; the shape carries its turned outline.
        expect(links.filter(link => /\/QuadPoints\[[^\]]+\]\/Dest \d+ 0 R/.test(link))).toHaveLength(2);
    });

    test("draws every preset shape the model emits, with dashed lines and arrowheads, without warnings", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        const line = { color: "17365D", width: 1.5, dashType: "dash", beginArrowType: "oval", endArrowType: "stealth" } as const;
        let slide = pres.addSlide();
        for (const [index, shape] of CORE_SVG_SHAPES.entries()) {
            if (index > 0 && index % 30 === 0) slide = pres.addSlide();
            const options = { x: (index % 6) * 1.6, y: Math.floor((index % 30) / 6), w: 1.4, h: 0.9, fill: { color: "5B9BD5", transparency: 20 }, line, rotate: 15, flipH: index % 2 === 0 };
            const points = [{ x: 0, y: 0 }, { x: 1.4, y: 0.9, curve: { type: "arc", wR: 0.7, hR: 0.45, stAng: 0, swAng: 90 } }, { close: true }] as const;
            slide.addShape(shape as PptxGenJS.SHAPE_NAME, shape === "custGeom" ? { ...options, points: [...points] } : options);
        }
        expect(ascii(await pres.toPdf()).startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual([]);
    });

    test('onUnsupported: "warn" renders and reports skipped objects', async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts, onUnsupported: "warn" });
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.addSlide()
            .addText("Text", { x: 1, y: 1, w: 3, h: 1 })
            .addImage({ data: PNG, x: 1, y: 2, w: 1, h: 1 })
            .addImage({ data: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", x: 3, y: 2, w: 1, h: 1 })
            .addShape("ellipse", { x: 5, y: 2, w: 1, h: 1, shadow: { type: "inner", blur: 3, offset: 3, angle: 45 } });
        expect(ascii(await pres.toPdf()).startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual(["inner shadow not rendered"]);
    });

    test("draws SVG images and names the slide, picture and element of one outside the subset", async () => {
        const svg = (body: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2">${body}</svg>`)}`;
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const drawn = new PuppeteerGen(PAGE, { renderer });
        drawn.addSlide().addImage({ data: svg('<circle cx="1" cy="1" r="1" fill="tomato"/>'), x: 1, y: 1, w: 2, h: 1 });
        expect(ascii(await drawn.toPdf()).startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual([]);
        const broken = new PuppeteerGen(PAGE, { renderer });
        broken.addSlide();
        broken.addSlide().addImage({ data: svg('<image href="https://example.com/a.png"/>'), x: 1, y: 1, w: 2, h: 1, altText: "Logo" });
        await expect(broken.toPdf()).rejects.toThrow(/^slide 2: image '[^']+': SVG image: <image> is not in the SVG subset/);
    });

    test("rejects an image over the pixel limit by its header and the same renderer keeps rendering (#160)", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        // The 1x1 PNG with an IHDR claiming 100000 x 100000 pixels (40 GB as RGBA).
        const bomb = Uint8Array.from(atob(PNG.split(",")[1] ?? ""), c => c.charCodeAt(0));
        new DataView(bomb.buffer).setUint32(16, 100_000);
        new DataView(bomb.buffer).setUint32(20, 100_000);
        const broken = new PuppeteerGen(PAGE, { renderer });
        broken.addSlide().addImage({ data: `data:image/png;base64,${btoa(String.fromCharCode(...bomb))}`, x: 1, y: 1, w: 1, h: 1 });
        await expect(broken.toPdf()).rejects.toThrow(/^slide 1: image '[^']+': 100000x100000 pixels is over the limit of 67108864 pixels per image/);
        const drawn = new PuppeteerGen(PAGE, { renderer });
        drawn.addSlide().addImage({ data: PNG, x: 1, y: 1, w: 1, h: 1 });
        expect(ascii(await drawn.toPdf()).startsWith("%PDF-")).toBe(true);
    });

    test("draws data, path and repeated images in every sizing mode without warnings", async () => {
        const directory = await mkdtemp(join(tmpdir(), "wasm-image-"));
        try {
            const path = join(directory, "pixel.png");
            await writeFile(path, Buffer.from(PNG.split(",")[1] ?? "", "base64"));
            const renderer = await createWasmRenderer({ fonts: systemFonts });
            const pres = new PuppeteerGen(PAGE, { renderer });
            pres.addSlide()
                .addImage({ path, x: 0.5, y: 0.5, w: 1, h: 1, rotate: 20, flipV: true, transparency: 40 })
                .addImage({ data: PNG, x: 2, y: 0.5, w: 2, h: 1, sizing: { type: "contain", w: 1, h: 1 }, rounding: true })
                .addImage({ data: PNG, x: 4, y: 0.5, w: 2, h: 1, sizing: { type: "cover", w: 1, h: 1 } })
                .addImage({ path, x: 6, y: 0.5, w: 2, h: 1, sizing: { type: "crop", x: 0.5, y: 0.25, w: 1, h: 0.5 } });
            expect(ascii(await pres.toPdf()).startsWith("%PDF-")).toBe(true);
            expect(renderer.warnings()).toEqual([]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test("names the image whose data cannot be decoded", async () => {
        const pres = new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) });
        pres.addSlide().addImage({ data: "data:image/png;base64,iVBORw0KGgoAAAA=", x: 1, y: 1, w: 1, h: 1, objectName: "Logo" });
        await expect(pres.toPdf()).rejects.toThrow("image 'Logo': cannot decode image/png data");
    });

    test("rejects bytes that are not a font", async () => {
        await expect(createWasmRenderer({ fonts: [new Uint8Array([1, 2, 3])] })).rejects.toThrow("Font #0 contains no usable font faces");
    });

    test("the html and browser WASM entries produce a PDF in Chromium, loading the .wasm by URL", async () => {
        const bundle = async (entry: string) => {
            const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, `../packages/${entry}.ts`)], target: "browser", format: "esm" });
            expect(build.success).toBe(true);
            return build.outputs[0]!.text();
        };
        const [html, wasm] = await Promise.all([bundle("pptxgenjs/src/html"), bundle("wasm/src/browser")]);
        const files: Record<string, { body: Uint8Array; contentType: string }> = {
            "https://assets.test/pdf_wasm_bg.wasm": { body: await Bun.file(resolve(import.meta.dir, "../packages/wasm/src/pdf_wasm_bg.wasm")).bytes(), contentType: "application/wasm" },
            "https://assets.test/font.ttf": { body: systemFonts[0]!, contentType: "font/ttf" },
        };
        const result = await withBrowser(async browser => {
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on("pageerror", error => errors.push(`pageerror: ${error}`));
            await page.setRequestInterception(true);
            page.on("request", request => {
                const file = files[request.url()];
                if (file) return void request.respond({ status: 200, contentType: file.contentType, headers: { "access-control-allow-origin": "*" }, body: Buffer.from(file.body) });
                if (request.url().startsWith("data:") || request.url().startsWith("blob:")) return void request.continue();
                errors.push(`request: ${request.url()}`);
                void request.abort();
            });
            try {
                await page.setContent("<!DOCTYPE html><html><head></head><body></body></html>");
                const output = await page.evaluate(
                    async (htmlSource: string, wasmSource: string) => {
                        const load = (source: string) => import(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
                        const [{ default: PuppeteerGen }, { createWasmRenderer }] = await Promise.all([load(htmlSource), load(wasmSource)]);
                        const font = new Uint8Array(await (await fetch("https://assets.test/font.ttf")).arrayBuffer());
                        const renderer = await createWasmRenderer({ fonts: [font], wasm: "https://assets.test/pdf_wasm_bg.wasm" });
                        const pres = new PuppeteerGen(undefined, { renderer });
                        pres.addSlide().addText("Browser WASM", { x: 1, y: 1, w: 4, h: 1 });
                        pres.addSlide().addText("Second", { x: 1, y: 1, w: 4, h: 1 });
                        const pdf = new TextDecoder("latin1").decode(await pres.toPdf());
                        return { header: pdf.slice(0, 5), pages: pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length };
                    },
                    html,
                    wasm,
                );
                return { ...output, errors };
            } finally {
                await page.close();
            }
        });
        expect(result).toEqual({ header: "%PDF-", pages: 2, errors: [] });
    }, 60_000);
});

// Byte-for-byte PDF checks of every WASM deck run in the pinned visual image (tests/visual/wasm/compare.ts,
// pdf-sha256.json), where the fonts are fixed.
describe.skipIf(!canRender)("WASM HTML profile input", () => {
    test("out-of-profile HTML throws naming the slide, object and property", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE);
        pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1, objectName: "Title" });
        const { html, pageSize } = await pres.toHtml();
        const tampered = html.replace('style="left: 96px;', 'style="filter: blur(2px); left: 96px;');
        await expect(renderer.render({ html: tampered, pageSize })).rejects.toThrow("slide 1: object 'Title': CSS property 'filter'");
        await expect(renderer.render({ html: html.replace('<meta name="pdflapas-profile" content="2">', '<meta name="pdflapas-profile" content="3">'), pageSize })).rejects.toThrow(
            `profile version '3' in <meta name="pdflapas-profile"> is not supported (this renderer reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)`,
        );
    });

    test("writes title, author and subject to the PDF Info dictionary; a version 1 document gets none", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.title = "Q3 plan";
        pres.author = "Ana";
        pres.subject = "Sales";
        pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
        const text = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");
        expect(text(await pres.toPdf())).toContain("<</Title(Q3 plan)/Subject(Sales)/Author(Ana)>>");
        const { html, pageSize } = await pres.toHtml();
        const v1 = await renderer.render({ html: html.replace('<meta name="pdflapas-profile" content="2">', '<meta name="pdfdeck-profile" content="1">'), pageSize });
        expect(text(v1)).not.toContain("/Title");
    });

    test("hand-written minimal documents render after the completion step", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        for (const [kind, object] of Object.entries(HAND_WRITTEN_OBJECTS)) {
            const pdf = await renderer.render({ html: completeProfileHtml(handWrittenDocument(object)), pageSize: PAGE });
            expect({ kind, pdf: ascii(pdf.subarray(0, 5)) }).toEqual({ kind, pdf: "%PDF-" });
        }
        // Without completion the reader names the first value the profile requires.
        await expect(renderer.render({ html: handWrittenDocument(HAND_WRITTEN_OBJECTS.text), pageSize: PAGE })).rejects.toThrow("invalid PdfLapas HTML: the stylesheet has no '@page");
    });

    test("an edited toHtml() document renders through pptxHtmlDocument() and draws the edit", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE);
        pres.addSlide().addText("Draft", { x: 1, y: 1, w: 3, h: 1 });
        const { html } = await pres.toHtml();
        const draft = await renderer.render(pptxHtmlDocument(html));
        const final = await renderer.render(pptxHtmlDocument(html.replace(">Draft</span>", ">Final</span>")));
        expect(ascii(final.subarray(0, 5))).toBe("%PDF-");
        expect(ascii(final)).not.toBe(ascii(draft));
    });

    test("an out-of-profile hand-written document fails naming the slide, the object and the property", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const render = (object: string) => renderer.render({ html: completeProfileHtml(handWrittenDocument(object)), pageSize: PAGE });
        await expect(render(HAND_WRITTEN_OBJECTS.text.replace("font-weight: bold;", "font-variant: small-caps;"))).rejects.toThrow("invalid PdfLapas HTML: slide 1: object 'Title': paragraph 1: run 1: CSS property 'font-variant' on <span> is not in profile v2");
        await expect(render(HAND_WRITTEN_OBJECTS.text.replace("font-weight: bold;", "font-family: &quot;Calibri&quot;, Arial;"))).rejects.toThrow("font-family '\"Calibri\", Arial' is not one quoted family");
    });
});
