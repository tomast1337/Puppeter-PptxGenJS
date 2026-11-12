import { closeBrowser as closeSharedBrowser } from "./browser";
import { PuppeteerGen } from "./node";
import { PuppeteerPdfRenderer } from "./render/puppeteerPdf";

// Explicit type keeps puppeteer types (and their Node typings) out of the public declarations.
const closeBrowser: () => Promise<void> = closeSharedBrowser;

// The Node entry is the browser-safe core plus Node defaults; the local PuppeteerGen shadows the core one.
export * from "./html";
export { closeBrowser, PuppeteerGen, PuppeteerPdfRenderer };
export default PuppeteerGen;
