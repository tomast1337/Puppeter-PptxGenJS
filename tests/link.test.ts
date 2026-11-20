import { describe, expect, test } from "bun:test";
import { assertLinkUrl, type HtmlPresentationDocument } from "../packages/model/src/index";
import { createPdfkitRenderer, loadSystemFonts } from "../packages/pdfkit/src/node";
import { PuppeteerGen } from "../packages/pptxgenjs/src/html";
import { normalizeImage } from "../packages/pptxgenjs/src/normalize/image";
import { normalizeHyperlink } from "../packages/pptxgenjs/src/normalize/link";
import { normalizeShape } from "../packages/pptxgenjs/src/normalize/shape";
import { normalizeTextRun } from "../packages/pptxgenjs/src/normalize/text";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG_DATA = "data:image/png;base64,iVBORw0KGgo=";

describe("hyperlink normalization", () => {
    test("keeps http, https and mailto URLs and prefers url over slide, as PptxGenJS does", () => {
        expect(normalizeHyperlink({ url: "https://example.com", tooltip: "Tip" })).toEqual({ href: "https://example.com", tooltip: "Tip" });
        expect(normalizeHyperlink({ url: "HTTP://example.com" })?.href).toBe("HTTP://example.com");
        expect(normalizeHyperlink({ url: "mailto:a@example.com", slide: 2 })).toEqual({ href: "mailto:a@example.com", tooltip: undefined });
        expect(normalizeHyperlink({ slide: 2 })).toEqual({ href: "#slide-2", tooltip: undefined, slide: 2 });
        expect(normalizeHyperlink(undefined)).toBeUndefined();
    });

    test("rejects other schemes and non-integer slides loudly", () => {
        for (const url of ["javascript:alert(1)", " javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "example.com"]) {
            expect(() => normalizeHyperlink({ url })).toThrow(`hyperlink url '${url}' is not supported: use an http:, https: or mailto: URL`);
        }
        for (const slide of [0, -1, 1.5, Number.NaN]) {
            expect(() => normalizeHyperlink({ slide })).toThrow(`hyperlink slide '${slide}' is not a slide number`);
        }
        expect(() => normalizeHyperlink({})).toThrow("hyperlink requires either url or slide");
    });

    test("text runs, shapes and images share the validation", () => {
        const hyperlink = { url: "javascript:alert(1)" };
        expect(() => normalizeTextRun("x", { hyperlink })).toThrow("is not supported");
        expect(() => normalizeShape("rect", { hyperlink }, 100, 100, PAGE)).toThrow("is not supported");
        expect(() => normalizeImage({ data: PNG_DATA, hyperlink }, PAGE)).toThrow("is not supported");
    });
});

describe("link schemes in the renderers", () => {
    test("assertLinkUrl accepts http, https and mailto and names the object otherwise", () => {
        for (const href of ["https://example.com", "HTTP://example.com", "mailto:a@example.com"]) expect(() => assertLinkUrl(href, "'Box'")).not.toThrow();
        for (const href of ["file:///etc/hosts", "javascript:void(0)", " https://example.com", "#slide-2"]) {
            expect(() => assertLinkUrl(href, "'Box'")).toThrow(`Cannot link 'Box' to '${href}': a link must be an http:, https: or mailto: URL`);
        }
    });

    /** A one-slide deck with a linked run and a linked shape, its HTML hrefs replaced by `href` (out-of-profile HTML). */
    async function deckWithLinks(href: string): Promise<HtmlPresentationDocument> {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addText([{ text: "Run", options: { hyperlink: { url: "https://example.com/run" } } }], { x: 1, y: 1, w: 3, h: 0.5, objectName: "Text" });
        slide.addShape("rect", { x: 1, y: 2, w: 2, h: 1, fill: { color: "0088CC" }, hyperlink: { url: "https://example.com/shape" }, objectName: "Box" });
        const document = await presentation.toHtml();
        return { ...document, html: document.html.replaceAll(/href="https:\/\/example\.com\/[a-z]+"/g, `href="${href}"`) };
    }

    test("Puppeteer refuses a link with another scheme", async () => {
        const renderer = new PuppeteerPdfRenderer();
        try {
            await expect(renderer.render(await deckWithLinks("file:///etc/hosts"))).rejects.toThrow("Cannot link 'Text' on slide 1 to 'file:///etc/hosts'");
            await expect(renderer.render(await deckWithLinks("javascript:void(0)"))).rejects.toThrow("a link must be an http:, https: or mailto: URL");
            expect(new TextDecoder("latin1").decode(await renderer.render(await deckWithLinks("https://example.com/ok")))).toContain("/URI (https://example.com/ok)");
        } finally {
            await closeBrowser();
        }
    });

    test("PDFKit refuses a link with another scheme, and draws a slide link as a jump", async () => {
        const renderer = await createPdfkitRenderer({ fonts: await loadSystemFonts() });
        await expect(renderer.render(await deckWithLinks("file:///etc/hosts"))).rejects.toThrow("to 'file:///etc/hosts': a link must be an http:, https: or mailto: URL");
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addShape("rect", { x: 1, y: 2, w: 2, h: 1, fill: { color: "0088CC" }, hyperlink: { slide: 2 } });
        presentation.addSlide();
        const pdf = new TextDecoder("latin1").decode(await renderer.render(await presentation.toHtml()));
        expect(pdf).not.toContain("#slide-2");
        expect(pdf).toMatch(/\/S \/GoTo\s*\/D \(slide-2\)/);
    });
});
