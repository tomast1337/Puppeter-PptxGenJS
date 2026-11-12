// Node-only renderer: prints the HTML document in Chromium through puppeteer.
import { closeBrowser as closeSharedBrowser } from "./browser";

// Explicit type keeps puppeteer types (and their Node typings) out of the public declarations.
const closeBrowser: () => Promise<void> = closeSharedBrowser;

export { closeBrowser };
export { PuppeteerPdfRenderer } from "./puppeteerPdf";
