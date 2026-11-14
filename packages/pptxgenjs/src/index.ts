import { closeBrowser, PuppeteerPdfRenderer, printHtml } from "@pdfdeck/puppeteer";
import { PuppeteerGen } from "./node";

// The Node entry is the browser-safe core plus Node defaults; the local PuppeteerGen shadows the core one.
export * from "./html";
export { closeBrowser, PuppeteerGen, PuppeteerPdfRenderer, printHtml };
export default PuppeteerGen;
