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
    fixture: "60e3852944a1b90c7bfaff1faf44e7cbdb41b5c4fe7611c948fe648193682193",
    "cross-runtime": "2273cffde6927c61671ea901aacd90a46eddeb7010d3e808be677df5c78e57e9",
    "wasm-text": "53db16aa8a4024e71565376c1abbcf677fe4e66d8660349844f55454a478349f",
    "wasm-emoji": "470187f2c7e1e202d1a8998ed06f1fd9cc4773488514c86ee0ab4562d4b45b4a",
    "wasm-layout": "2802830d75c5b7001c9e0e9818043558bdbfead813818e9cd3227b0781fe95b9",
    "wasm-shapes": "d60c8da33d63e1d25b4b26732d147705fcf103193eabcd8fa878ed7a6851ca1e",
    "wasm-tables": "982f810d502040ff9d58b76fbe0a3c9e95bebe593327eab053ecca278058c9cc",
    "wasm-images": "1c4af9d739704ac55786ea3019989d70acb9f9b3267bb8e0ca042ea2fb8894c4",
    "wasm-effects": "16e089db1a36814df73aaa27308468e911f2dabc30ff6e3580aed076c1033059",
    "wasm-charts": "0155c933c9f4b469842a349986f0cd506a4ec68cedd91e16b12b05d3d2e9118e",
    "wasm-svg": "81bbf9252d074775ad2c31f2a8ea6dd1406e97244f415138599ef46d6bb36673",
    "wasm-gif": "5c8a436bb6a95f21546f9482ea6cc0d76e64cf4b7b0faf6e7e092c477cf7dd4a",
    "wasm-webp": "3a3cc7d94ccd60f949e18578419b3e9df554e7c0826520d10a8da680ebbfacbd",
    "wasm-slides": "8bfc55b82eb54eb7dfb11dab2a13ef6eea8b3543aee587906578d7e3d7043e75",
    "wasm-components": "5ea2b47988df1ce517af5416dc411e62dd09a2899c43ebca18d0f310efeac939",
    "wasm-options": "c61876289d4e873f87f5e0aa0953121c76b15faf8ce6aa444e9213efc0557e3c",
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
