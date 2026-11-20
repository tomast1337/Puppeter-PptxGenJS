import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { type MissingFont, MissingFontError, missingFontPolicy, reportMissingFonts } from "../packages/model/src/missingFont";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import type { PresentationRenderer } from "../packages/model/src/renderer";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { type MissingFontBinding, type TextPdfBinding, WasmRenderer } from "../packages/wasm/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const NO_SUCH_FONT: MissingFont = { face: "NoSuchFont", objects: ["slide 1 'Text 0'"], usedFace: "Liberation Sans" };

afterAll(() => closeBrowser());

const warn = spyOn(console, "warn").mockImplementation(() => {});
afterEach(() => warn.mockClear());
// Bun's spies outlive the file: left in place, this one would swallow later files' warnings and hand its calls to
// their spyOn(console, "warn").
afterAll(() => warn.mockRestore());

describe("missing font policy", () => {
    test('"warn" (the default) names each face, the face drawn instead and the objects asking for it', () => {
        reportMissingFonts([NO_SUCH_FONT, { face: "Corporate Sans", objects: ["slide 2 #3"] }], missingFontPolicy(undefined));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain(`- "NoSuchFont", drawn in "Liberation Sans": slide 1 'Text 0'\n- "Corporate Sans": slide 2 #3`);
    });

    test('"throw" throws a MissingFontError carrying the list; "ignore" and an empty list do nothing', () => {
        let error: unknown;
        try {
            reportMissingFonts([NO_SUCH_FONT], "throw");
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(MissingFontError);
        expect(error).toMatchObject({ name: "MissingFontError", missing: [NO_SUCH_FONT] });
        reportMissingFonts([NO_SUCH_FONT], "ignore");
        reportMissingFonts([], "throw");
        expect(warn).not.toHaveBeenCalled();
    });

    test("a function receives the list", () => {
        const received: (readonly MissingFont[])[] = [];
        reportMissingFonts([NO_SUCH_FONT], missing => received.push(missing));
        expect(received).toEqual([[NO_SUCH_FONT]]);
    });

    test("an unknown policy is rejected where the renderer is created", () => {
        expect(() => missingFontPolicy("error")).toThrow('onMissingFont must be "warn", "throw", "ignore" or a function');
        expect(() => new PuppeteerPdfRenderer({ onMissingFont: "error" as "warn" })).toThrow("onMissingFont must be"); // `as`: plain JS callers can pass any string
    });
});

/** A binding that reports `missing` after each render. */
function fakeBinding(missing: { face: string; used?: string; objects: string[] }[]): TextPdfBinding {
    return {
        addFont: () => 1,
        renderHtml: () => new TextEncoder().encode("%PDF-fake"),
        warnings: () => [],
        missingFonts: (): MissingFontBinding[] => missing.map(entry => ({ ...entry, free: () => {} })),
    };
}

describe("WasmRenderer missing fonts", () => {
    const document = { html: "<html></html>", pageSize: PAGE };

    test("warns by default and keeps rendering, separately from onUnsupported", async () => {
        const renderer = new WasmRenderer(fakeBinding([{ face: "NoSuchFont", used: "Liberation Sans", objects: ["slide 1 'Text 0'"] }]));
        expect(new TextDecoder().decode(await renderer.render(document))).toBe("%PDF-fake");
        expect(warn.mock.calls[0]?.[0]).toContain('"NoSuchFont", drawn in "Liberation Sans"');
        expect(renderer.missingFonts()).toEqual([NO_SUCH_FONT]);
    });

    test('onMissingFont: "throw" rejects with MissingFontError', async () => {
        const renderer = new WasmRenderer(fakeBinding([{ face: "NoSuchFont", objects: ["slide 1 'Text 0'"] }]), "error", "throw");
        await expect(renderer.render(document)).rejects.toBeInstanceOf(MissingFontError);
    });
});

/** Two slides: a NoSuchFont run and table cell, then the installed Arial (Liberation Sans through its metric alias) and Liberation Sans. */
function deck(renderer: PresentationRenderer): PuppeteerGen {
    const pres = new PuppeteerGen(PAGE, { renderer });
    pres.addSlide()
        .addText("Missing", { x: 1, y: 1, w: 4, h: 1, fontFace: "NoSuchFont" })
        .addTable([[{ text: "Cell", options: { fontFace: "NoSuchFont" } }]], { x: 1, y: 3, w: 4 });
    pres.addSlide().addText("Installed", { x: 1, y: 1, w: 4, h: 1, fontFace: "Arial" }).addText("Installed", { x: 1, y: 2, w: 4, h: 1, fontFace: "Liberation Sans" });
    return pres;
}

/** The missing fonts `renderer` reports for `deck`, through the function policy. */
async function reported(renderer: (onMissingFont: (missing: readonly MissingFont[]) => void) => Promise<PresentationRenderer>): Promise<readonly MissingFont[]> {
    let found: readonly MissingFont[] = [];
    await deck(await renderer(missing => (found = missing))).toPdf();
    return found;
}

describe("renderer input", () => {
    // #347's repro passed render(pptx.toHtml()) without await; both renderers failed with a bare TypeError.
    test("rejects the toHtml() Promise and a document without html, naming the fix", async () => {
        const pptx = new PuppeteerGen();
        pptx.addSlide();
        const renderers: PresentationRenderer[] = [new WasmRenderer(fakeBinding([])), new PuppeteerPdfRenderer()];
        for (const renderer of renderers) {
            await expect(renderer.render(pptx.toHtml() as never)).rejects.toThrow("got a Promise: await toHtml() before passing its result");
            await expect(renderer.render({ pageSize: PAGE } as never)).rejects.toThrow("got object without an html string");
        }
    });
});

describe("Puppeteer backend", () => {
    test("reports a face Chromium has no font for, and not Arial or Liberation Sans", async () => {
        expect(await reported(async onMissingFont => new PuppeteerPdfRenderer({ onMissingFont }))).toEqual([{ face: "NoSuchFont", objects: ["slide 1 'Table 0'", "slide 1 'Text 0'"], usedFace: expect.any(String) }]);
    });

    test('onMissingFont: "throw" rejects before printing, naming the face', async () => {
        const error = await deck(new PuppeteerPdfRenderer({ onMissingFont: "throw" }))
            .toPdf()
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(MissingFontError);
        expect((error as Error).message).toContain('"NoSuchFont"');
    });
});

const wasmBuilt = await Bun.file(resolve(import.meta.dir, "../packages/wasm/src/pdf_wasm_bg.wasm")).exists();
const systemFonts = wasmBuilt ? await loadSystemFonts().catch(() => []) : [];

describe.skipIf(!systemFonts.length)("WASM backend", () => {
    test("reports a face no loaded font provides, and not Arial or Liberation Sans", async () => {
        expect(await reported(onMissingFont => createWasmRenderer({ fonts: systemFonts, onMissingFont }))).toEqual([{ face: "NoSuchFont", objects: ["slide 1 'Table 0'", "slide 1 'Text 0'"], usedFace: expect.any(String) }]);
    });

    test('onMissingFont: "throw" rejects naming the face', async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts, onMissingFont: "throw" });
        await expect(deck(renderer).toPdf()).rejects.toThrow('"NoSuchFont"');
    });
});
