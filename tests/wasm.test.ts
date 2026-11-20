import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { z } from "zod";
import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen as HtmlPuppeteerGen, type HtmlPresentationDocument, type PresentationRenderer } from "../packages/pptxgenjs/src/html";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { PRINT_ZOOM, printHtml } from "../packages/puppeteer/src/printWorkarounds";
import { PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { CORE_SVG_SHAPES } from "../packages/pptxgenjs/src/normalize/shape";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { completeProfileHtml, pptxHtmlDocument } from "../packages/pptxgenjs/src/render/completion";
import { loadSystemFonts as browserLoadSystemFonts, type MissingFontBinding, type TextPdfBinding, WasmRenderer, type WasmSource } from "../packages/wasm/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import type { InitInput, Renderer } from "../packages/wasm/src/pdf_wasm.js";
import { inchesToPoints, pointsToPixels } from "@pdflapas/model";
import { HAND_WRITTEN_OBJECTS, handWrittenDocument } from "./handWrittenHtml";
import { pdfContentStreams } from "./pdfContentStreams";
import { wrapLimitCases, wrapLimitDeck } from "./wrapLimitCases";
import { EXTRA_CELL_ROW_TOPS_IN, extraCellTable } from "./extraCellTable";

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
/** The deck's HTML with its first shape's shadow marked inset: hand-written HTML, since addShape rejects an inner shadow. */
async function innerShadowHtml(pres: PuppeteerGen): Promise<HtmlPresentationDocument> {
    const { html, pageSize } = await pres.toHtml();
    const inner = html.replace('<svg class="shape-svg"', '<svg class="shape-svg" data-shadow-inset=""');
    expect(inner).not.toBe(html);
    return { html: inner, pageSize };
}
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
    missingFonts(): MissingFontBinding[] {
        return [];
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

    // PowerPoint draws only the cells inside the grid and keeps each row at its rowH (#286).
    test("keeps the rows of a table with cells beyond its grid at their rowH", async () => {
        const pres = new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) });
        const { rows, options } = extraCellTable({ colW: [1, 1, 1] });
        pres.addSlide().addTable(rows, options);
        const pdf = Buffer.from(await pres.toPdf());
        // The page's content stream, the object its /Contents names.
        const contents = ascii(pdf).match(/\/Contents (\d+) 0 R/)?.[1];
        expect(contents).toBeDefined();
        const start = pdf.indexOf("stream\n", pdf.indexOf(`\n${contents} 0 obj`)) + "stream\n".length;
        const content = inflateSync(pdf.subarray(start, pdf.indexOf("endstream", start))).toString("latin1");
        // The horizontal grid lines, in CSS px from the slide top: each row's top, then the table's bottom.
        const lines = [...content.matchAll(/ ([\d.]+) m [\d.]+ ([\d.]+) l\n/g)].filter(([, from, to]) => from === to).map(([, y]) => Number(y) / 96);
        expect(lines.slice(0, -1)).toEqual(EXTRA_CELL_ROW_TOPS_IN.map(inches => expect.closeTo(inches, 3)));
    });

    // A hand-written td without padding took the stylesheet's table margin in Chromium on top of the cell text's
    // padding: 32px rows against WASM's 22.4px (#291). Completion writes padding: 0px, so both lay out the same rows.
    test("gives a completed hand-written table the row heights Chromium gives it", async () => {
        const cell = (text: string) => `<td style="border-top: 1px solid #000000; border-bottom: 1px solid #000000;"><div class="table-cell-text"><div class="text-content"><div class="text-paragraph"><span class="text-run">${text}</span></div></div></div></td>`;
        const table = `<div class="slide-element slide-table-container" data-object-name="Grid" style="left: 96px; top: 96px; width: 288px;">
          <table class="slide-table" style="width: 288px; table-layout: fixed; border-collapse: collapse;">
            <colgroup><col style="width: 144px;"><col style="width: 144px;"></colgroup>
            <tr>${cell("A")}${cell("B")}</tr><tr>${cell("C")}${cell("D")}</tr>
          </table></div>`;
        const html = completeProfileHtml(handWrittenDocument(table));
        const chromium = await withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                // As the Puppeteer renderer prints it: zoomed, with the collapsed borders kept out of the row heights.
                await page.setContent(printHtml(html));
                return await page.evaluate(zoom => [...document.querySelectorAll("tr")].map(row => row.getBoundingClientRect().height / zoom), PRINT_ZOOM);
            } finally {
                await page.close();
            }
        });
        const pdf = Buffer.from(await (await createWasmRenderer({ fonts: systemFonts })).render({ html, pageSize: PAGE }));
        const contents = ascii(pdf).match(/\/Contents (\d+) 0 R/)?.[1];
        const start = pdf.indexOf("stream\n", pdf.indexOf(`\n${contents} 0 obj`)) + "stream\n".length;
        const content = inflateSync(pdf.subarray(start, pdf.indexOf("endstream", start))).toString("latin1");
        // The horizontal grid lines, in CSS px: each row's top, then the table's bottom.
        const lines = [...content.matchAll(/ ([\d.]+) m [\d.]+ ([\d.]+) l\n/g)].filter(([, from, to]) => from === to).map(([, y]) => Number(y));
        const wasm = lines.slice(1).map((y, i) => y - (lines[i] ?? 0));
        // The cell text's 4.8px margins around a 19.2px line; the stylesheet's td padding made Chromium's 38.4px.
        expect(chromium).toEqual([expect.closeTo(28.8, 1), expect.closeTo(28.8, 1)]);
        expect(wasm).toEqual(chromium.map(height => expect.closeTo(height, 1)));
    });

    // Arial 32px "mmmm mmmm" is 222.140625px from its advances. In a box exactly that wide, with or without
    // letter spacing or insets whose px carry float noise, Chromium keeps one line and WASM wrapped "mmmm" (#288).
    test("breaks a line as wide as its box where Chromium does", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const cases: [string, PptxGenJS.TextPropsOptions][] = [
            ["exact", { w: 222.140625 / 96, margin: 0 }],
            ["0.1in insets", { w: (222.140625 + 19.2) / 96, margin: 7.2 }],
            ["letter spacing", { w: (222.140625 + 9 * 0.4) / 96, margin: 0, charSpacing: 0.3 }],
            ["a hair narrower", { w: (222.140625 - 0.04) / 96, margin: 0 }],
        ];
        for (const [name, options] of cases) {
            const pres = new PuppeteerGen(PAGE, { renderer });
            pres.addSlide().addText("mmmm mmmm", { x: 1, y: 1, h: 1, fontFace: "Arial", fontSize: 24, ...options });
            const deck = await pres.toHtml();
            const chromium = await withBrowser(async browser => {
                const page = await browser.newPage();
                try {
                    await page.setContent(printHtml(deck.html));
                    // The run's lines: its client rects' distinct tops (a hanging space can take a rect of its own).
                    return await page.evaluate(() => new Set([...(document.querySelector(".text-run")?.getClientRects() ?? [])].map(rect => Math.round(rect.top))).size);
                } finally {
                    await page.close();
                }
            });
            const pdf = Buffer.from(await renderer.render(deck));
            const contents = ascii(pdf).match(/\/Contents (\d+) 0 R/)?.[1];
            const start = pdf.indexOf("stream\n", pdf.indexOf(`\n${contents} 0 obj`)) + "stream\n".length;
            const content = inflateSync(pdf.subarray(start, pdf.indexOf("endstream", start))).toString("latin1");
            // One text object per drawn line.
            expect({ name, lines: content.match(/\bBT\b/g)?.length }).toEqual({ name, lines: chromium });
        }
    });

    // The PowerPoint target lays each word out at its advances rounded to 0.125pt: a last line exactly as wide as its
    // box or 0.125pt narrower fits, 0.125pt wider wraps, as in PowerPoint and Chromium (tests/advanceGrid.test.ts).
    const arial = (bold: boolean) => resolveInstalledGlyphAdvances("Arial", bold, false);
    test.skipIf(!arial(false) || !arial(true))("breaks the PowerPoint target's lines at the box's width by the rounded advances, as PowerPoint does", async () => {
        const cases = wrapLimitCases(bold => arial(bold) ?? { unitsPerEm: 1, advances: new Map() });
        const deck = await wrapLimitDeck(new PuppeteerGenPowerPoint(), cases).toHtml();
        const pdf = Buffer.from(await (await createWasmRenderer({ fonts: systemFonts })).render(deck));
        // A page's lines: the distinct baselines of its text objects, `1 0 0 -1 x y Tm`.
        const drawn = [...ascii(pdf).matchAll(/\/Contents (\d+) 0 R/g)].map(([, id]) => {
            const start = pdf.indexOf("stream\n", pdf.indexOf(`\n${id} 0 obj`)) + "stream\n".length;
            const content = inflateSync(pdf.subarray(start, pdf.indexOf("endstream", start))).toString("latin1");
            return new Set([...content.matchAll(/(-?[\d.]+) Tm/g)].map(([, y]) => y)).size;
        });
        expect(cases.map(({ fontSize, bold, lines, steps }, index) => ({ fontSize, bold, lines, steps, drawn: drawn[index] }))).toEqual(cases.map(({ fontSize, bold, lines, steps, expectedLines }) => ({ fontSize, bold, lines, steps, drawn: expectedLines })));
    });

    // Chromium takes the fallback face for a character the run's face lacks from fontconfig, by the run's lang:
    // Noto Sans CJK SC for zh-CN, TC for zh-TW, KR for ko, JP for ja and any lang without a rule (#289). Liberation Sans,
    // Arial's alias, has the issue's modifier letters, so neither backend falls back for them. U+2011 is left out: see
    // the shortcut at family_stack (crates/pdf-core/src/text/font.rs).
    test("falls back to the CJK face Chromium picks for the run's lang", async () => {
        const pdffonts = Bun.which("pdffonts");
        if (!pdffonts) return console.warn("pdffonts (poppler-utils) not installed: CJK fallback faces not compared");
        const runs = [
            ["zh-CN", "简体中文的文本"],
            ["zh-TW", "繁體中文的文本"],
            ["ja", "日本語のテキスト"],
            ["ko", "한국어 텍스트"],
            ["en-US", "中文"],
            ["en-US", "lorem 1ᵉʳ dolor"],
        ] as const;
        const pdf = async (pres: PuppeteerGen) => {
            for (const [lang, text] of runs) pres.addSlide().addText(text, { x: 1, y: 1, w: 6, h: 1, fontFace: "Arial", fontSize: 24, lang });
            return pres.toPdf();
        };
        const dir = await mkdtemp(join(tmpdir(), "cjk-fallback-"));
        try {
            // The distinct faces pdffonts lists for each page, without the subset tag (Chromium embeds a face once per run)
            // or the CMap a Type 0 font name may end in (PDF 32000-1 9.7.6.1: krilla writes "-Identity-H").
            const faces = async (name: string, bytes: Uint8Array) => {
                const file = join(dir, `${name}.pdf`);
                await writeFile(file, bytes);
                return runs.map((_, page) => {
                    const listing = Bun.spawnSync([pdffonts, "-f", String(page + 1), "-l", String(page + 1), file]).stdout.toString();
                    return [
                        ...new Set(
                            listing
                                .split("\n")
                                .slice(2)
                                .filter(Boolean)
                                .map(line =>
                                    line
                                        .split(/\s+/)[0]
                                        ?.replace(/^[A-Z]{6}\+/, "")
                                        .replace(/-Identity-H$/, ""),
                                ),
                        ),
                    ].sort();
                });
            };
            const chromium = await faces("chromium", await pdf(new PuppeteerGen(PAGE)));
            // Elsewhere fontconfig can pick faces loadSystemFonts does not load (Arch: Droid Sans Fallback, Arial); the
            // pinned visual image (tests/visual/Dockerfile) has Liberation, fonts-noto-cjk and its lang rules.
            if (chromium.flat().some(face => !/^(?:NotoSansCJK|LiberationSans)/.test(face ?? ""))) {
                return console.warn(`Chromium used ${JSON.stringify(chromium)}, not only Liberation Sans and Noto Sans CJK: fallback faces not compared`);
            }
            const cjk = ["NotoSansCJKsc-Regular", "NotoSansCJKtc-Regular", "NotoSansCJKjp-Regular", "NotoSansCJKkr-Regular", "NotoSansCJKjp-Regular"].map(face => [face]);
            expect(chromium.map(page => page.filter(face => face?.startsWith("NotoSansCJK")))).toEqual([...cjk, []]);
            expect(await faces("wasm", await pdf(new PuppeteerGen(PAGE, { renderer: await createWasmRenderer({ fonts: systemFonts }) })))).toEqual(chromium);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
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

    // A regular-only face: bold and italic are synthesized, LibreOffice's way from the run's data-synthetic-* and
    // Chromium's (a 1/32 em stroke, a 0.25 shear) on the PowerPoint target, which writes none.
    test("strokes and shears a face without bold or italic as the target says", async () => {
        const renderer = await createWasmRenderer({ fonts: await loadSystemFonts({ match: /^LiberationSans-Regular\.ttf$/ }) });
        const content = async (pres: PuppeteerGen, options: PptxGenJS.TextPropsOptions) => {
            pres.addSlide().addText("Synthetic", { x: 1, y: 1, w: 6, h: 1, fontFace: "Liberation Sans", fontSize: 36, ...options });
            const pdf = Buffer.from(await pres.toPdf());
            const contents = ascii(pdf).match(/\/Contents (\d+) 0 R/)?.[1];
            const start = pdf.indexOf("stream\n", pdf.indexOf(`\n${contents} 0 obj`)) + "stream\n".length;
            return inflateSync(pdf.subarray(start, pdf.indexOf("endstream", start))).toString("latin1");
        };
        const stroke = async (pres: PuppeteerGen) => Number((await content(pres, { bold: true })).match(/ ([\d.]+) w\n/)?.[1]);
        // The page's y flip and the shear in one matrix: shear = -c / a.
        const shear = async (pres: PuppeteerGen) => {
            const [, a, c] = (await content(pres, { italic: true })).match(/q ([\d.]+) 0 (-[\d.]+) -[\d.]+ [\d.]+ [\d.]+ cm\b/) ?? [];
            return -Number(c) / Number(a);
        };
        // 36pt is 48px: LibreOffice's stroke 48/30, Chromium's 48/32.
        expect(await stroke(new PuppeteerGenLibreOffice(PAGE, { renderer }))).toBeCloseTo(48 / 30, 5);
        expect(await stroke(new PuppeteerGenPowerPoint(PAGE, { renderer }))).toBeCloseTo(48 / 32, 5);
        expect(await shear(new PuppeteerGenLibreOffice(PAGE, { renderer }))).toBeCloseTo(0.3462535606, 5);
        expect(await shear(new PuppeteerGenPowerPoint(PAGE, { renderer }))).toBeCloseTo(0.25, 5);
    });

    // #298: PowerPoint keeps the line where a lowered run sticks out of it, LibreOffice grows it. Middle-anchored 20pt
    // Arial "Hxg" then "Hxg" at baseline -1000 (10pt down, drawn at the target's escapement size), beside a plain box.
    test("puts the base line of a line with a lowered run where the target does, in Chromium and in WASM", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pageTopPt = inchesToPoints(PAGE.height);
        /** Each text object's baseline in CSS px from the page top, in drawing order, from both renderers' PDFs. */
        const baselines = async (pres: PuppeteerGen) => {
            const options = { y: 0.4, w: 4, h: 2.2, fontFace: "Arial", fontSize: 20, valign: "middle" } as const;
            pres.addSlide()
                .addText([{ text: "Hxg" }, { text: "Hxg" }], { ...options, x: 0.5 })
                .addText([{ text: "Hxg" }, { text: "Hxg", options: { baseline: -1000 } }], { ...options, x: 5 });
            // The presentation's own renderer is Puppeteer's.
            const chromium = pdfContentStreams(await pres.toPdf());
            // Chromium draws in 1/PRINT_ZOOM CSS px from the page top; WASM in CSS px from a `cm` origin in pt from the bottom.
            const fromChromium = chromium.flatMap(content => [...content.matchAll(/\n1 0 0 -1 [\d.]+ ([\d.]+) Tm\n/g)].map(([, y]) => Number(y) / PRINT_ZOOM));
            const fromWasm = pdfContentStreams(await renderer.render(await pres.toHtml())).flatMap(content => [...content.matchAll(/ -0\.75 [\d.]+ ([\d.]+) cm[^\n]*\nBT [^\n]*? 1 0 0 -1 [\d.]+ ([\d.]+) Tm/g)].map(([, origin, y]) => pointsToPixels(pageTopPt - Number(origin)) + Number(y)));
            return { chromium: fromChromium, wasm: fromWasm };
        };
        for (const [pres, growth] of [
            [new PuppeteerGenPowerPoint(PAGE), 0],
            // LibreOffice: the 11.6pt run reaches 0.2 x 11.6 + 10pt below its line's baseline, 8.32pt past the 20pt
            // line's 4pt; the middle-anchored line moves up by half of that.
            [new PuppeteerGenLibreOffice(PAGE), pointsToPixels((0.2 * 11.6 + 10 - 4) / 2)],
        ] as const) {
            const { chromium, wasm } = await baselines(pres);
            // Plain box, then the box with the lowered run: each draws its two runs.
            expect(chromium).toHaveLength(4);
            expect(wasm).toHaveLength(4);
            const [plain = 0, , escaped = 0] = chromium;
            expect(plain - escaped).toBeCloseTo(growth, 1);
            // WASM draws what Chromium does: within Chromium's 1/8 px text grid.
            wasm.forEach((y, index) => expect(Math.abs(y - (chromium[index] ?? 0))).toBeLessThan(1 / PRINT_ZOOM + 0.05));
        }
    });

    test("throws on unsupported objects by default and lists them", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE);
        pres.addSlide()
            .addText("Text", { x: 1, y: 1, w: 3, h: 1 })
            .addShape("ellipse", { x: 4, y: 1, w: 1, h: 1, shadow: { type: "outer", blur: 3, offset: 3, angle: 45 } });
        await expect(renderer.render(await innerShadowHtml(pres))).rejects.toThrow(/inner shadow not rendered/);
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
            .addShape("ellipse", { x: 5, y: 2, w: 1, h: 1, shadow: { type: "outer", blur: 3, offset: 3, angle: 45 } });
        expect(ascii(await renderer.render(await innerShadowHtml(pres))).startsWith("%PDF-")).toBe(true);
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

    test("writes title, author, subject, creator and producer to the PDF Info dictionary; a version 1 document gets no title", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pres = new PuppeteerGen(PAGE, { renderer });
        pres.title = "Q3 plan";
        pres.author = "Ana";
        pres.subject = "Sales";
        pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
        const text = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");
        expect(text(await pres.toPdf())).toContain("<</Title(Q3 plan)/Subject(Sales)/Author(Ana)/Creator(PdfLapas)/Producer(PdfLapas)>>");
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
