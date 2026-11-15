import { afterAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { htmlDocument } from "../packages/model/src/index";
import { pptxHtmlDocument } from "../packages/pptxgenjs/src/html";
import { PuppeteerGen, PuppeteerPdfRenderer, printHtml } from "../packages/pptxgenjs/src/index";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { HAND_WRITTEN_OBJECTS, handWrittenDocument } from "./handWrittenHtml";

afterAll(() => closeBrowser());

const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("htmlDocument() from @pdflapas/model", () => {
    const head = (extra: string) => `<!DOCTYPE html><html><head><meta name="pdfdeck-profile" content="1">${extra}</head><body></body></html>`;

    test("returns the document unchanged with the page size of its @page rule and its pdfdeck-page-size name (version 1)", () => {
        const named = head(`<meta content='Wide' name=pdfdeck-page-size><style>@page { size: 13.333in 7.5in; margin: 0 }</style>`);
        expect(htmlDocument(named)).toEqual({ html: named, pageSize: { width: 13.333, height: 7.5, name: "Wide" } });
        expect(htmlDocument(head(`<style>@page{size:4in 3in}</style>`)).pageSize).toEqual({ width: 4, height: 3, name: "Custom" });
        const v2 = `<meta name="pdflapas-profile" content="2"><meta name="pdflapas-page-size" content="Wide"><meta name="pdfdeck-page-size" content="Old"><style>@page { size: 4in 3in }</style>`;
        expect(htmlDocument(v2).pageSize).toEqual({ width: 4, height: 3, name: "Wide" });
    });

    test("reads each version under its own meta name: pdfdeck- in version 1, pdflapas- in version 2", () => {
        const reads = `(this library reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)`;
        expect(() => htmlDocument(`<meta name="pdfdeck-profile" content="2">`)).toThrow(`profile version '2' in <meta name="pdfdeck-profile"> is not supported ${reads}`);
        expect(() => htmlDocument(`<meta name="pdflapas-profile" content="1">`)).toThrow(`profile version '1' in <meta name="pdflapas-profile"> is not supported ${reads}`);
    });

    test("fills nothing: a missing page size is an error, as is anything that is not a profile document", () => {
        expect(() => htmlDocument(head(""))).toThrow("the stylesheet's @page rule has no 'size: <width>in <height>in'");
        expect(() => htmlDocument(head(`<style>@page { size: A4 }</style>`))).toThrow("write the page size in inches");
        expect(() => htmlDocument("  ")).toThrow("expected a non-empty HTML string, got an empty string");
        expect(() => htmlDocument("<p>Hi</p>")).toThrow('not a PdfLapas profile document: add <meta name="pdflapas-profile" content="2"> to <head>');
        expect(() => htmlDocument(`<meta name="pdflapas-profile" content="3">`)).toThrow(`profile version '3' in <meta name="pdflapas-profile"> is not supported (this library reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)`);
    });
});

describe("pptxHtmlDocument()", () => {
    test("returns a toHtml() document as it is, with its page size", async () => {
        const pres = new PuppeteerGen(PAGE_SIZES.LETTER.portrait);
        pres.addSlide().addText("Stored", { x: 1, y: 1, w: 3, h: 1 });
        const stored = await pres.toHtml();
        expect(pptxHtmlDocument(stored.html)).toEqual({ html: stored.html, pageSize: { ...PAGE_SIZES.LETTER.portrait } });
    });

    test("reads the page size of a hand-written document from its name, its @page rule or PptxGenJS's default", () => {
        const named = pptxHtmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><meta name="pdfdeck-page-size" content="A4 Landscape">`));
        expect(named.pageSize).toEqual({ ...PAGE_SIZES.A4.landscape });
        expect(pptxHtmlDocument(handWrittenDocument("")).pageSize).toEqual({ ...PAGE_SIZES.SCREEN_16X9.landscape });
        const own = pptxHtmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><style>@page { size: 4in 3in; margin: 0; }</style>`));
        expect(own.pageSize).toEqual({ width: 4, height: 3, name: "Custom" });
        expect(() => pptxHtmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><style>@page { size: A4; }</style>`))).toThrow("the stylesheet's @page rule has no 'size: <width>in <height>in'");
    });
});

describe("printHtml()", () => {
    test("writes the Puppeteer print step into the document, without a script", async () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("Preview", { x: 1, y: 1, w: 3, h: 1 });
        const preview = printHtml((await pres.toHtml()).html);
        expect(preview).not.toContain("<script");
        const page = new JSDOM(preview).window.document;
        // 18pt (24px) default: the paragraph moves 24 - 28.8 / 2 down, as in the PDF.
        expect(parseFloat(page.querySelector<HTMLElement>(".text-paragraph")?.style.top ?? "")).toBeCloseTo(9.6, 9);
        expect(page.querySelector<HTMLElement>(".text-run")?.getAttribute("style")).toContain('font-family: "Calibri", "Noto Sans", Arial');
    });
});

describe("Puppeteer renderer", () => {
    test("prints any HTML, including documents outside the profile", async () => {
        const html = `<!DOCTYPE html><html><head><style>@page { size: 4in 3in; margin: 0 } h1 { font: bold 40px serif; color: rebeccapurple }</style></head><body><h1>Custom HTML</h1><p style="display: grid">Anything Chromium prints.</p></body></html>`;
        const pdf = await new PuppeteerPdfRenderer().render({ html, pageSize: { width: 4, height: 3, name: "Custom" } });
        expect(ascii(pdf.subarray(0, 5))).toBe("%PDF-");
        expect(ascii(pdf)).toContain("/MediaBox [0 0 288 216]");
    }, 60_000);

    test("prints an edited toHtml() document and a hand-written one through pptxHtmlDocument()", async () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("Draft", { x: 1, y: 1, w: 3, h: 1 });
        const edited = (await pres.toHtml()).html.replace(">Draft</span>", ">Final</span>");
        const renderer = new PuppeteerPdfRenderer();
        for (const html of [edited, handWrittenDocument(Object.values(HAND_WRITTEN_OBJECTS).join(""))]) {
            expect(ascii((await renderer.render(pptxHtmlDocument(html))).subarray(0, 5))).toBe("%PDF-");
        }
    }, 60_000);
});
