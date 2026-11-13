import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen as HtmlPuppeteerGen, type ModelRenderer, type NormalizedPresentation } from "../packages/pptxgenjs/src/html";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { CORE_SVG_SHAPES } from "../packages/pptxgenjs/src/normalize/shape";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { loadSystemFonts as browserLoadSystemFonts, type TextPdfBinding, WasmRenderer, type WasmSource } from "../packages/wasm/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import type { InitInput, Renderer } from "../packages/wasm/src/pdf_wasm.js";

// Type-level checks against the committed wasm-bindgen declarations: regenerating them with an
// incompatible binding, or changing the model the loader serializes, fails `bun run typecheck`.
type Assert<T extends true> = T;
type _Binding = Assert<Renderer extends TextPdfBinding ? true : false>;
type _Source = Assert<WasmSource extends InitInput ? true : false>;
type _Model = Assert<Parameters<WasmRenderer["renderModel"]>[0] extends NormalizedPresentation ? true : false>;
type _Renderer = Assert<WasmRenderer extends ModelRenderer ? true : false>;

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const createDocument = () => new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>").window.document;
const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

afterAll(() => closeBrowser());

class FakeBinding implements TextPdfBinding {
    rendered: string[] = [];
    constructor(private readonly skipped: string[] = []) {}
    addFont(): number {
        return 1;
    }
    render(modelJson: string): Uint8Array {
        this.rendered.push(modelJson);
        return new TextEncoder().encode("%PDF-fake");
    }
    warnings(): string[] {
        return this.skipped;
    }
}

describe("model renderer contract", () => {
    test("toPdf, write and stream hand getModel() to a ModelRenderer instead of HTML", async () => {
        const models: NormalizedPresentation[] = [];
        const renderer: ModelRenderer = { renderModel: async model => (models.push(model), new TextEncoder().encode("%PDF-model")) };
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer });
        pres.addSlide().addText("Model", { x: 1, y: 1, w: 3, h: 1 });
        expect(ascii(await pres.toPdf())).toBe("%PDF-model");
        expect(await pres.write({ outputType: "base64" })).toBe(btoa("%PDF-model"));
        expect(ascii((await pres.stream()) as Uint8Array)).toBe("%PDF-model");
        expect(models).toHaveLength(3);
        expect(models[0]).toEqual(pres.getModel());
    });

    test("resolves path and URL images to data URIs once per source before a ModelRenderer sees them", async () => {
        const models: NormalizedPresentation[] = [];
        const renderer: ModelRenderer = { renderModel: async model => (models.push(model), new TextEncoder().encode("%PDF-model")) };
        const requested: string[] = [];
        const resolveImage = async (source: string) => (requested.push(source), PNG);
        const pres = new HtmlPuppeteerGen(PAGE, { createDocument, renderer, resolveImage });
        pres.addSlide().addImage({ path: "logo.png", x: 1, y: 1, w: 1, h: 1 }).addImage({ path: "logo.png", x: 3, y: 1, w: 1, h: 1 });
        pres.addSlide().addImage({ path: "https://example.com/a.png", x: 1, y: 1, w: 1, h: 1 }).addImage({ data: PNG, x: 3, y: 1, w: 1, h: 1 });
        await pres.toPdf();
        expect(requested).toEqual(["logo.png", "https://example.com/a.png"]);
        const images = models[0]?.slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "image" ? [object.image] : []))) ?? [];
        expect(images.map(image => [image.sourceKind, image.source])).toEqual(Array.from({ length: 4 }, () => ["data", PNG]));
        // getModel() itself keeps the sources the caller passed.
        expect(pres.getModel().slides[0]?.objects[0]).toMatchObject({ image: { source: "logo.png", sourceKind: "path" } });
    });

    test("the Node entry accepts a ModelRenderer for writeFile()", async () => {
        const directory = await mkdtemp(join(tmpdir(), "wasm-model-"));
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
        const error = await new WasmRenderer(binding).renderModel({ pageSize: PAGE, slides: [] }).catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("- object kind 'image' not rendered\n- tab stops ignored");
        expect((error as Error).message).toContain('onUnsupported: "warn"');
    });

    test('onUnsupported: "warn" returns the PDF and surfaces warnings()', async () => {
        const renderer = new WasmRenderer(new FakeBinding(["object kind 'chart' not rendered"]), "warn");
        expect(ascii(await renderer.renderModel({ pageSize: PAGE, slides: [] }))).toBe("%PDF-fake");
        expect(renderer.warnings()).toEqual(["object kind 'chart' not rendered"]);
    });

    test("the binding receives the model as JSON", async () => {
        const binding = new FakeBinding();
        const model: NormalizedPresentation = { pageSize: PAGE, slides: [] };
        await new WasmRenderer(binding).renderModel(model);
        expect(JSON.parse(binding.rendered[0]!)).toEqual(model);
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

    test("throws on unsupported objects by default and lists them", async () => {
        const pres = new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) });
        pres.addSlide()
            .addText("Text", { x: 1, y: 1, w: 3, h: 1 })
            .addChart("bar", [{ name: "Series", labels: ["A"], values: [1] }], { x: 1, y: 2, w: 2, h: 1 })
            .addShape("ellipse", { x: 4, y: 1, w: 1, h: 1, shadow: { type: "outer", blur: 3, offset: 3, angle: 45 } });
        await expect(pres.toPdf()).rejects.toThrow(/object kind 'chart' not rendered[\s\S]*object shadow not rendered/);
    });

    test("makes linked runs, shapes and images clickable", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.addSlide()
            .addText([{ text: "Docs", options: { hyperlink: { url: "https://example.com/docs", tooltip: "Open the docs" } } }], { x: 1, y: 1, w: 3, h: 0.5 })
            .addShape("rect", { x: 1, y: 2, w: 2, h: 1, rotate: 30, fill: { color: "0088CC" }, hyperlink: { slide: 2 } })
            .addImage({ data: PNG, x: 4, y: 2, w: 1, h: 1, hyperlink: { url: "mailto:team@example.com" } });
        pres.addSlide().addText("Second", { x: 1, y: 1, w: 3, h: 0.5 });
        const source = ascii(await pres.toPdf());
        expect(renderer.warnings()).toEqual([]);
        const links = source.match(/\/Type\/Annot\/Subtype\/Link[^\n]*/g) ?? [];
        expect(links).toHaveLength(3);
        expect(links.filter(link => link.includes("/URI(https://example.com/docs)") && link.includes("/Contents(Open the docs)"))).toHaveLength(1);
        expect(links.filter(link => link.includes("/URI(mailto:team@example.com)"))).toHaveLength(1);
        // The rotated shape jumps to page 2 and carries its turned outline.
        expect(links.filter(link => /\/QuadPoints\[[^\]]+\]\/Dest \d+ 0 R/.test(link))).toHaveLength(1);
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
            .addImage({ data: `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'/>")}`, x: 3, y: 2, w: 1, h: 1 });
        expect(ascii(await pres.toPdf()).startsWith("%PDF-")).toBe(true);
        expect(renderer.warnings()).toEqual(["SVG images not rendered"]);
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
