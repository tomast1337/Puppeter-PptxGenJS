// bun spike/wasm-text/harness/render.ts <out.pdf>
import { writeFileSync } from "node:fs";
import { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../../../packages/pptxgenjs/src/pageLayouts";
import { createRenderer } from "../../../tests/visual/wasm/backend";
import { populateTextDeck } from "../../../tests/visual/wasm/deck";

const [out = "text-deck.pdf"] = process.argv.slice(2);
const renderer = await createRenderer();
writeFileSync(out, await populateTextDeck(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer })).toPdf());
console.log(`warnings:\n  ${renderer.warnings().join("\n  ")}`);
