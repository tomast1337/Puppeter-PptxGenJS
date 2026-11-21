import { closeBrowser, PuppeteerPdfRenderer, printHtml } from "@pdflapas/puppeteer";
import { checkPowerPointFonts, PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "./node";

// The Node entry is the browser-safe core plus Node defaults; the local PuppeteerGen shadows the core one.
export * from "./html";
export { checkPowerPointFonts, closeBrowser, PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, PuppeteerPdfRenderer, printHtml };
export type { PowerPointFontCheck } from "./node";
// The default stays the LibreOffice target, so existing decks render as before.
export default PuppeteerGen;
