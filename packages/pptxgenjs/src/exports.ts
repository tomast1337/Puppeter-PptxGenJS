import { closeBrowser, PuppeteerPdfRenderer } from "@pdfdeck/puppeteer";
import { PuppeteerGen } from "./node";

// The Node entry is the browser-safe core plus Node defaults; the local PuppeteerGen shadows the core one.
export * from "./html";
export { closeBrowser, PuppeteerGen, PuppeteerPdfRenderer };
export default PuppeteerGen;
