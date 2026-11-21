// Type-level consumer test (#277): the public API takes the plain numbers and strings of the PptxGenJS docs, never an
// internal brand (Px, Pt, Inches, CssColor, Html, DataUri). `bun run typecheck` compiles it against the sources and
// scripts/test-package.ts against the built declarations of each public entry. It is never run.
import PuppeteerGen, { colorToCSS, convertToPixels, generatePageCSS, inchesToPixels, PAGE_SIZES, percentageToPixels, pointsToPixels, PuppeteerGenPowerPoint, PuppeteerPdfRenderer, printHtml, type PresentationRenderer, type PuppeteerSlide } from "@pdflapas/pptxgenjs";
import HtmlPuppeteerGen, { pptxHtmlDocument } from "@pdflapas/pptxgenjs/html";
import { createWasmRenderer } from "@pdflapas/wasm";

export async function publicApiTypes(): Promise<void> {
    // The page size as plain inches: the constructor, setPageSize, defineLayout and layout.
    const pres = new PuppeteerGen({ width: 10, height: 5.625, name: "Custom 16:9" });

    pres.setPageSize({ width: 13.33, height: 7.5, name: "Wide" });
    pres.defineLayout({ name: "A3", width: 16.5, height: 11.7 });
    pres.layout = "LAYOUT_WIDE";
    new HtmlPuppeteerGen({ width: 8.5, height: 11, name: "Letter" });
    new PuppeteerGenPowerPoint({ width: 7.5, height: 10, name: "Portrait" });
    // A built-in page size passed back in.
    pres.setPageSize(PAGE_SIZES.A4.landscape);

    const slide: PuppeteerSlide = pres.addSlide();

    slide.background = { color: "F1F1F1" };
    slide.addText("Hello World from PptxGenJS!", { x: 1.5, y: 1.5, w: 6, h: 2, fontSize: 36, color: "363636", fill: { color: "F1F1F1" }, align: "center", margin: 5 });
    slide.addText([{ text: "rich", options: { bold: true, color: "FF0000", highlight: "FFFF00" } }], { x: "10%", y: "50%", w: "80%", h: 1, line: { color: "0088CC", width: 1 } });
    slide.addImage({ path: "https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg", x: 1, y: 1, w: 8, h: 4, sizing: { type: "contain", w: 4, h: 3 } });
    slide.addImage({ data: "image/png;base64,iVBORw0KGgo=", x: 0.5, y: 0.5, w: 1, h: 1 });
    slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 0.8, w: 1.5, h: 3.0, fill: { color: "FF0000" }, line: { color: "000000", width: 2 } });
    slide.addShape("line", { x: 4.15, y: 4.4, w: 5, h: 0, line: { color: "FF0000", width: 1, dashType: "lgDash" } });
    slide.addTable(
        [
            [{ text: "Top Lft", options: { color: "363636", fill: { color: "F7F7F7" } } }, { text: "Top Ctr" }],
            [{ text: "Bot Lft" }, { text: "Bot Ctr", options: { border: { type: "solid", pt: 1, color: "666666" } } }],
        ],
        { x: 0.5, y: 1.1, w: 9, colW: [4.5, 4.5], rowH: 0.5, fontSize: 14, color: "363636", border: { pt: 1, color: "BBCCDD" }, fill: { color: "FFFFFF" }, margin: 0.1, autoPage: true },
    );

    // toHtml() reads as a string; its page size reads as numbers and goes back into the page size inputs.
    const document = await pres.toHtml();
    const html: string = document.html;
    const width: number = document.pageSize.width;

    pres.setPageSize(document.pageSize);
    new PuppeteerGen(pres.getModel().pageSize);

    // A renderer called with a document the caller built from plain values.
    const renderer: PresentationRenderer = new PuppeteerPdfRenderer();

    await renderer.render({ html, pageSize: { width: 10, height: 5.625, name: "Custom" } });
    await (await createWasmRenderer({ fonts: [] })).render({ html, pageSize: { width, height: 7.5, name: "Custom" } });
    await renderer.render(pptxHtmlDocument(printHtml(html)));

    // The exported helpers take plain numbers and strings, and their branded results read as plain ones.
    const css: string = generatePageCSS({ width: 10, height: 5.625, name: "Custom" }) + colorToCSS("FF0000") + colorToCSS({ color: "00FF00", transparency: 50 });
    const pixels: number = inchesToPixels(1) + pointsToPixels(12) + percentageToPixels(50, 960) + convertToPixels(1, 960);

    void css;
    void pixels;
}
