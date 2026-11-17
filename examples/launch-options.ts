// Puppeteer launch options: configure the Chromium the default backend starts.
// Run: bun run examples/launch-options.ts (writes launch-options.pdf to the working directory).
import pptxgen, { closeBrowser, PuppeteerPdfRenderer } from "@pdflapas/pptxgenjs";

// The options are merged over the defaults, `{ headless: "shell", args: ["--no-sandbox", "--disable-setuid-sandbox"] }`;
// `args` replaces the default list. Renderers with the same options share one browser.
const renderer = new PuppeteerPdfRenderer({
    launchOptions: {
        // Keeps the default args, which run Chromium without its sandbox: the sandbox refuses to start as root,
        // the usual user in a container (and in this repository's CI). To keep the sandbox where your user and
        // system allow it, pass `args: []` instead.
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        timeout: 60_000, // ms to wait for the browser to start
        protocolTimeout: 120_000, // ms per DevTools call, e.g. printing a long deck
        // executablePath: "/usr/bin/chromium", // use an installed Chromium instead of Puppeteer's download
    },
});

const pres = new pptxgen(undefined, { renderer });
pres.addSlide().addText("Rendered with custom launch options", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 28 });
console.log(`Wrote ${await pres.writeFile({ fileName: "launch-options.pdf" })}`);

// The browser closes itself after a second idle; closeBrowser() shuts it down now.
await closeBrowser();
