import { afterAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { htmlDocument } from "../packages/pptxgenjs/src/html";
import { PuppeteerGen, PuppeteerPdfRenderer, printPreviewHtml } from "../packages/pptxgenjs/src/index";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { HAND_WRITTEN_OBJECTS, handWrittenDocument } from "./handWrittenHtml";

afterAll(() => closeBrowser());

const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("htmlDocument()", () => {
    test("returns a toHtml() document as it is, with its page size", async () => {
        const pres = new PuppeteerGen(PAGE_SIZES.LETTER.portrait);
        pres.addSlide().addText("Stored", { x: 1, y: 1, w: 3, h: 1 });
        const stored = await pres.toHtml();
        expect(htmlDocument(stored.html)).toEqual({ html: stored.html, pageSize: { ...PAGE_SIZES.LETTER.portrait } });
    });

    test("reads the page size of a hand-written document from its name, its @page rule or PptxGenJS's default", () => {
        const named = htmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><meta name="pdfdeck-page-size" content="A4 Landscape">`));
        expect(named.pageSize).toEqual({ ...PAGE_SIZES.A4.landscape });
        expect(htmlDocument(handWrittenDocument("")).pageSize).toEqual({ ...PAGE_SIZES.SCREEN_16X9.landscape });
        const own = htmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><style>@page { size: 4in 3in; margin: 0; }</style>`));
        expect(own.pageSize).toEqual({ width: 4, height: 3, name: "Custom" });
        expect(() => htmlDocument(handWrittenDocument("", `<meta name="pdfdeck-profile" content="1"><style>@page { size: A4; }</style>`))).toThrow("the stylesheet's @page rule has no 'size: <width>in <height>in'");
    });
});

describe("printPreviewHtml()", () => {
    test("runs the Puppeteer print step when the document is opened in a browser", async () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("Preview", { x: 1, y: 1, w: 3, h: 1 });
        const preview = printPreviewHtml((await pres.toHtml()).html);
        expect(preview).toEndWith("</script></body></html>");
        const page = new JSDOM(preview, { runScripts: "dangerously" }).window.document;
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

    test("prints an edited toHtml() document and a hand-written one through htmlDocument()", async () => {
        const pres = new PuppeteerGen();
        pres.addSlide().addText("Draft", { x: 1, y: 1, w: 3, h: 1 });
        const edited = (await pres.toHtml()).html.replace(">Draft</span>", ">Final</span>");
        const renderer = new PuppeteerPdfRenderer();
        for (const html of [edited, handWrittenDocument(Object.values(HAND_WRITTEN_OBJECTS).join(""))]) {
            expect(ascii((await renderer.render(htmlDocument(html))).subarray(0, 5))).toBe("%PDF-");
        }
    }, 60_000);
});
