// Node-only renderer: prints the HTML document in Chromium through puppeteer.
import { closeBrowser as closeSharedBrowser } from "./browser";

// Explicit type keeps puppeteer types (and their Node typings) out of the public declarations.
const closeBrowser: () => Promise<void> = closeSharedBrowser;

export { closeBrowser };
export type { PuppeteerLaunchOptions } from "./launchOptions";
export { printHtml } from "./printWorkarounds";
export { PuppeteerPdfRenderer, type PuppeteerPdfRendererOptions } from "./puppeteerPdf";
