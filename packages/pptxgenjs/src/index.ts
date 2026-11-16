import { closeBrowser, PuppeteerPdfRenderer, printHtml } from "@pdflapas/puppeteer";
import { PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "./node";

// The Node entry is the browser-safe core plus Node defaults; the local PuppeteerGen shadows the core one.
export * from "./html";
export { closeBrowser, PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, PuppeteerPdfRenderer, printHtml };
// The default stays the LibreOffice target, so existing decks render as before.
export default PuppeteerGen;
