// Writes the toHtml() documents of the shared visual fixture and of every WASM visual deck, one
// document per slide, to crates/fuzz/corpus/render_html/: the seeds of the render_html fuzz target
// (docs/FUZZING.md). One slide per seed keeps inputs small, so the fuzzer runs more of them per second.
// `bun run scripts/export-fuzz-seeds.ts`; the corpus is not committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { populateParityFixture } from "../tests/visual/fixture";
import { DECKS } from "../tests/visual/wasm/decks";

const SLIDE = '<div class="slide-container"';
const END = "</body></html>";
const out = join(import.meta.dir, "..", "crates", "fuzz", "corpus", "render_html");

mkdirSync(out, { recursive: true });

const fixture = new PuppeteerGen();

populateParityFixture(fixture);
const decks: [string, PuppeteerGen][] = [["fixture", fixture], ...Object.entries(DECKS).map(([name, deck]): [string, PuppeteerGen] => [name, deck.populate(new PuppeteerGen())])];
let seeds = 0;

for (const [name, deck] of decks) {
    const { html } = await deck.toHtml();
    const [head = "", ...slides] = html.slice(0, html.length - END.length).split(SLIDE);

    if (!html.endsWith(END) || slides.length === 0) {
        throw new Error(`${name}: toHtml() no longer ends in ${END} or has no ${SLIDE}; update this script`);
    }

    for (const [index, slide] of slides.entries()) {
        writeFileSync(join(out, `${name}-${index + 1}.html`), `${head}${SLIDE}${slide}${END}`);
    }

    seeds += slides.length;
}

console.log(`${seeds} seeds in ${out}`);
