import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { completeProfileHtml } from "../packages/pptxgenjs/src/render/completion";
import { buildCrossRuntimeDeck } from "./crossRuntimeDeck";
import { populateParityFixture } from "./visual/fixture";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const sha256 = (html: string) => createHash("sha256").update(html).digest("hex");

/**
 * sha256 of toHtml() for the shared decks, taken from the DOM-built HTML before #69 phase 4a
 * (ee97e5d). A refactor keeps them; a deliberate HTML change updates these in the
 * same PR, so the output change is visible in review; to see what changed, diff toHtml() against main.
 */
const EXPECTED_SHA256: Record<string, string> = {
    fixture: "9bd956127c9459cd071704a090abc24dccc8cc4bb72036c3a9dcc828aed16cd2",
    "cross-runtime": "d0a2f54fff59467a360ca6153c1920666a2414d5aa60169de8a518a46516f8e2",
    "wasm-text": "2c6a4c4e3274ab8e9148b01234e01f3b95a0fb42d04228f5596e8732b205c2d8",
    "wasm-emoji": "0d34c77d7d9a144406d446467b2f0d8751619645b154cfb609389abf84ac3251",
    "wasm-layout": "472168f0e6ef7cb01e2d98eaecb77908db23b1c22cbf7b372aaa50ec46b2a8aa",
    "wasm-shapes": "af34b650944bfe0a0ee2ff1b6aa73e92ca2a099498a7ce778f3946215067798a",
    "wasm-tables": "12af81a2ef656c085a0abb714e5e5ab3f14c0564efc90da100235314b2ca7726",
    "wasm-images": "808261581abbbbe3873a43761c79bbbc558865abc4568013b622e6cb7e80fc50",
    "wasm-effects": "a23cfdf3a4ec65d13b83d3379beda44600e41756bc7c4201177e9ebd9c673e3a",
    "wasm-charts": "0c7cac252ec15314876f23f9ac25b1eaca2a3c2561cdcda7681b094b606911c1",
    "wasm-svg": "2f030eaa8092201053a708a6c94254185b454894954229cc6f1df3f9f2475791",
    "wasm-gif": "e4a3b2785edc8dcdca69d83d3b53ae25d6fccbbcdb2dae04966eaa523636e657",
    "wasm-webp": "83f495388b3e27d8c778d7580c0b9164ebd26289b6651011a08931a66c79c39e",
    "wasm-slides": "4a4c2635e1b439f17529769af044e9e27edac209277e79051fbb2b1c2d928dfc",
    "wasm-components": "ca47a4b0b7d3733a14aa1c56d971f7e0a965ee25da790bdca82990a0d4ce212c",
    "wasm-options": "0733e3677e8b60f902aebfe677da7b4eb01d08be6e0597884c19c92c428a12d8",
    "wasm-tableOptions": "70503359fc21668e500260ca9daf6a4be79f616c3a7f0a6dca35203315b65925",
};

describe("toHtml() bytes", () => {
    test("match the recorded hashes for the fixture, the cross-runtime deck and every WASM deck, and need no completion", async () => {
        const html: Record<string, string> = {};
        const fixture = new PuppeteerGen();
        populateParityFixture(fixture);
        html.fixture = (await fixture.toHtml()).html;
        html["cross-runtime"] = (await buildCrossRuntimeDeck(PuppeteerGen, PNG).toHtml()).html;
        // Imported here: tests/visual/wasm/deck.ts installs a global jsdom `document` when loaded, which
        // tests/html.test.ts must not see; it is removed again below.
        const hadDocument = "document" in globalThis;
        try {
            const { DECKS } = await import("./visual/wasm/decks");
            for (const [name, deck] of Object.entries(DECKS)) html[`wasm-${name}`] = (await deck.populate(new PuppeteerGen()).toHtml()).html;
        } finally {
            if (!hadDocument) Reflect.deleteProperty(globalThis, "document");
        }
        expect(Object.fromEntries(Object.entries(html).map(([name, document]) => [name, sha256(document)]))).toEqual(EXPECTED_SHA256);
        // toHtml() states every value, so the completion step returns it byte for byte.
        for (const [name, document] of Object.entries(html)) expect({ name, same: completeProfileHtml(document) === document }).toEqual({ name, same: true });
    }, 60_000);
});
