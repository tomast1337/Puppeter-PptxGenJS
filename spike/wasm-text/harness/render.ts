// bun spike/wasm-text/harness/render.ts <wasm|native> <out.pdf>
import { writeFileSync } from "node:fs";
import { PuppeteerGen } from "../../../src/node";
import { PAGE_SIZES } from "../../../src/pageLayouts";
import { type BackendKind, createRenderer, loadFonts } from "./backend";
import { populateTextDeck } from "./deck";

const [kind = "wasm", out = "text-deck.pdf"] = process.argv.slice(2) as [BackendKind, string];
const renderer = await createRenderer(kind);
console.log(`faces: ${loadFonts(renderer)}`);
const model = populateTextDeck(new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape)).getModel();
writeFileSync(out, renderer.render(JSON.stringify(model)));
console.log(`warnings:\n  ${renderer.warnings().join("\n  ")}`);
