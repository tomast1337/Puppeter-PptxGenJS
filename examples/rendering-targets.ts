// Rendering targets: PowerPoint and LibreOffice draw the same .pptx differently; pick the one to match.
// Run: bun run examples/rendering-targets.ts
// (writes rendering-targets-libreoffice.pdf and rendering-targets-powerpoint.pdf to the working directory).
import pptxgen, { PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "@pdflapas/pptxgenjs";

// The difference shows in kerning: PowerPoint does not kern text under 12pt or text with `charSpacing`.
function buildDeck(pres: pptxgen): pptxgen {
    const slide = pres.addSlide();

    slide.addText("AVATAR WAVE Type 10pt", { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 10, fontFace: "Arial" });
    slide.addText("AVATAR WAVE Type 24pt", { x: 0.5, y: 1.2, w: 9, h: 0.8, fontSize: 24, fontFace: "Arial" });
    slide.addText("AVATAR WAVE Type 24pt, charSpacing 1", { x: 0.5, y: 2.2, w: 9, h: 0.8, fontSize: 24, fontFace: "Arial", charSpacing: 1 });

    return pres;
}

// Match LibreOffice rendering: the default (also the default export and `PuppeteerGen`).
await buildDeck(new PuppeteerGenLibreOffice()).writeFile({ fileName: "rendering-targets-libreoffice.pdf" });
// Match PowerPoint rendering. Same as `new pptxgen(undefined, { target: "powerpoint" })`.
await buildDeck(new PuppeteerGenPowerPoint()).writeFile({ fileName: "rendering-targets-powerpoint.pdf" });

// The target is written into the HTML (`font-kerning: none` on unkerned runs), so every backend follows it.
const { html } = await buildDeck(new pptxgen(undefined, { target: "powerpoint" })).toHtml();

console.log(`PowerPoint target: ${html.split("font-kerning: none").length - 1} unkerned run(s)`);
