import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
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
    fixture: "639b7e09f90fb51e3edfbeed6460efce6cd455ab9050435288a6d01379b3fb49",
    "cross-runtime": "8982980e3d90b8707af515285067d30a2b970461a1012f76bd4ca2d446e536ab",
    "wasm-text": "d8dcd3dab1b0b5ef893152dc5cd46a2ec73f195f9618b87103c7421c50e42299",
    "wasm-emoji": "dc3fd02436b3a36426e069569357dc66c4656acd686a53aa5556465f9f7ddf18",
    "wasm-layout": "dd19df372bb43debdc79e2d868b0a36c5eeee708d4d5a99d68a818be3aa13448",
    "wasm-shapes": "d63faecceba26ee79abcd2d1c9e0b97feacd3100cb4e6cd990af038addfa12ba",
    "wasm-tables": "0dcc84f44f025e9a0406caeb350abbe1d4bd6d55ab2afc62078ae2362cf421dc",
    "wasm-images": "3eb39f680d4503029a1c23c0e7c93556da534dcdbacc08e6eefc07bd2d8218aa",
    "wasm-effects": "e7fc0845379a328724fb7eda82e74b322bacb2914c4cd8ca8b434a7d5139da0a",
};

describe("toHtml() bytes", () => {
    test("match the recorded hashes for the fixture, the cross-runtime deck and every WASM deck", async () => {
        const actual: Record<string, string> = {};
        const fixture = new PuppeteerGen();
        populateParityFixture(fixture);
        actual.fixture = sha256((await fixture.toHtml()).html);
        actual["cross-runtime"] = sha256((await buildCrossRuntimeDeck(PuppeteerGen, PNG).toHtml()).html);
        // Imported here: tests/visual/wasm/deck.ts installs a global jsdom `document` when loaded, which
        // tests/html.test.ts must not see; it is removed again below.
        const hadDocument = "document" in globalThis;
        try {
            const { DECKS } = await import("./visual/wasm/decks");
            for (const [name, deck] of Object.entries(DECKS)) actual[`wasm-${name}`] = sha256((await deck.populate(new PuppeteerGen()).toHtml()).html);
        } finally {
            if (!hadDocument) Reflect.deleteProperty(globalThis, "document");
        }
        expect(actual).toEqual(EXPECTED_SHA256);
    }, 60_000);
});
