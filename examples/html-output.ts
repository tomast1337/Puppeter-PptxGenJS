// HTML and model output: read, check and diff a deck without opening a PDF. Neither call launches Chromium.
// Run: bun run examples/html-output.ts (writes html-output.html and html-output.model.json to the working directory).
import { writeFile } from "node:fs/promises";
import pptxgen from "@pdflapas/pptxgenjs";

function buildDeck(title: string): pptxgen {
    const pres = new pptxgen();
    const slide = pres.addSlide();
    slide.addText(title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true, objectName: "Title" });
    slide.addText("Body text stays text in the HTML, in reading order.", { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 18 });
    return pres;
}

// toHtml(): the self-contained HTML document every renderer draws (CSS included, images inlined).
const { html, pageSize } = await buildDeck("Draft title").toHtml();
await writeFile("html-output.html", html);
console.log(`html-output.html: ${html.length} characters, page ${pageSize.width} x ${pageSize.height} in`);

// The HTML is deterministic: the same deck gives the same bytes, so a text diff shows only real changes.
const again = (await buildDeck("Draft title").toHtml()).html;
if (again !== html) throw new Error("expected identical HTML for identical decks");
const changed = (await buildDeck("Final title").toHtml()).html;
const differing = changed.split("\n").filter(line => !html.includes(line));
console.log(`Changing the title changes ${differing.length} line(s) of HTML`);

// getModel(): the normalized slide model, plain JSON (positions in inches, defaults resolved).
const model = buildDeck("Draft title").getModel();
await writeFile("html-output.model.json", `${JSON.stringify(model, null, 2)}\n`);
console.log(`html-output.model.json: ${model.slides.length} slide(s)`);
