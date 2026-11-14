// Render stored, edited or hand-written HTML (docs/HTML_PROFILE.md) on both backends.
// Run: bun run examples/html-input.ts (the WASM half needs `bun run build:wasm` first).
import { writeFile } from "node:fs/promises";
import PuppeteerGen, { closeBrowser, pptxHtmlDocument, PuppeteerPdfRenderer, printPreviewHtml } from "../packages/pptxgenjs/src/index";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";

// 1. Edit a toHtml() result: it is plain HTML, so a string replace (or any HTML tool) changes the deck.
const pres = new PuppeteerGen();
pres.addSlide().addText("Quarterly draft", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true });
const stored = (await pres.toHtml()).html;
const edited = stored.replace(">Quarterly draft</span>", ">Quarterly report</span>");

// 2. A hand-written profile document: only the content; completion fills the PptxGenJS defaults
//    (stylesheet, insets, line box, fonts, colors) before rendering.
const handWritten = `<html>
<head>
  <meta name="pdfdeck-profile" content="1">
  <meta name="pdfdeck-page-size" content="Screen 16:9 Landscape">
</head>
<body>
  <div class="slide-container">
    <div class="slide-element slide-text" data-object-name="Title" style="left: 48px; top: 48px; width: 864px; height: 96px;">
      <div class="text-content" style="width: 100%;">
        <div class="text-paragraph"><span class="text-run" style="font-size: 40px; font-weight: bold;">Written by hand</span></div>
      </div>
    </div>
    <div class="slide-element slide-shape" data-object-name="Bar" data-shape="rect" style="left: 48px; top: 192px; width: 576px; height: 48px;">
      <svg class="shape-svg" viewBox="0 0 576 48" width="100%" height="100%" preserveAspectRatio="none">
        <defs></defs>
        <rect class="shape-geometry" x="0" y="0" width="576" height="48" rx="0" ry="0" fill="#0088CC" stroke="none" stroke-width="0"></rect>
      </svg>
    </div>
  </div>
</body>
</html>`;

// pptxHtmlDocument() validates, completes and reads the page size: the input of any renderer.
const puppeteer = new PuppeteerPdfRenderer();
await writeFile("html-edited-puppeteer.pdf", await puppeteer.render(pptxHtmlDocument(edited)));
await writeFile("html-hand-written-puppeteer.pdf", await puppeteer.render(pptxHtmlDocument(handWritten)));

const wasm = await createWasmRenderer({ fonts: await loadSystemFonts() });
await writeFile("html-edited-wasm.pdf", await wasm.render(pptxHtmlDocument(edited)));
await writeFile("html-hand-written-wasm.pdf", await wasm.render(pptxHtmlDocument(handWritten)));

// Puppeteer prints any HTML, profile or not: the escape hatch for fully custom HTML and CSS.
const custom = `<!DOCTYPE html><html><head><style>@page { size: 10in 5.625in; margin: 0 } body { font: 48px Georgia, serif; display: grid; place-items: center; height: 5.625in; margin: 0 }</style></head><body>Any HTML</body></html>`;
await writeFile("html-custom-puppeteer.pdf", await puppeteer.render({ html: custom, pageSize: { width: 10, height: 5.625, name: "Custom" } }));

// Open this file in a browser to see the HTML as Puppeteer prints it.
await writeFile("html-edited-preview.html", printPreviewHtml(pptxHtmlDocument(edited).html));
await closeBrowser();
