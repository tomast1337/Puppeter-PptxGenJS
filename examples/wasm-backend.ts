// The WASM backend: the same deck drawn by the Rust renderer compiled to WebAssembly instead of Chromium.
// Run: bun run examples/wasm-backend.ts after `bun run build:wasm` and `bun run build`
// (writes wasm-backend-puppeteer.pdf and wasm-backend-wasm.pdf to the working directory).
import pptxgen, { closeBrowser } from "@pdflapas/pptxgenjs";
import { createWasmRenderer, loadSystemFonts } from "@pdflapas/wasm";

// The slide code does not depend on the backend: only the constructor's `renderer` changes.
function buildDeck(pres: pptxgen): pptxgen {
    const slide = pres.addSlide();
    slide.addText("One deck, two backends", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 30, bold: true, fontFace: "Calibri", color: "333333" });
    slide.addShape("roundRect", { x: 0.5, y: 1.5, w: 4, h: 1.5, fill: { color: "CCCCCC" }, rectRadius: 0.2 });
    slide.addTable(
        [
            [{ text: "Backend", options: { bold: true } }, { text: "Needs" }],
            [{ text: "Puppeteer" }, { text: "Chromium" }],
            [{ text: "WASM" }, { text: "Font files" }],
        ],
        { x: 5, y: 1.5, w: 4.5, border: { type: "solid", pt: 1, color: "999999" } },
    );
    return pres;
}

// Set up once and reuse: one WASM renderer (module and fonts loaded once) can render many decks.
// WASM cannot see system fonts; loadSystemFonts() reads the Office faces or their metric-compatible
// equivalents (Carlito for Calibri, ...) from the system font directories under Node and Bun.
const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
// By default anything the renderer cannot draw throws; pass `onUnsupported: "warn"` to get the PDF and
// read the skipped items from renderer.warnings() instead.

await buildDeck(new pptxgen()).writeFile({ fileName: "wasm-backend-puppeteer.pdf" });
await buildDeck(new pptxgen(undefined, { renderer })).writeFile({ fileName: "wasm-backend-wasm.pdf" });
console.log("Wrote wasm-backend-puppeteer.pdf and wasm-backend-wasm.pdf");
await closeBrowser();
