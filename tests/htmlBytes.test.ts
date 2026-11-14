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
    fixture: "6823545efcfb00f1ab78d307dda4ea929a7ce22ebffa0b0f59b68ad8768ad378",
    "cross-runtime": "e66213f7e9b66fd49d3486755584c8ef7efaebd5d0d6d7757ff4c97fe8a9f1cc",
    "wasm-text": "7046235e82ecc2fa34a2fddeb8b23985c15de31814819d84acece20862835ab6",
    "wasm-emoji": "74b4573eb94c16b718f7d770c6575fe2a3878fa317c87338dc206ea486fe1a1d",
    "wasm-layout": "3dd8a17a3e0052fdaf526fa1e4f00eeb42ee43723dd83ec07961298dd13e994b",
    "wasm-shapes": "91c66da8e7e972dd07e95dd9b3461d2de80ba0bd0ab1269f7ea63f5d5ee1610e",
    "wasm-tables": "18411e156ee0363d8282fdab004545a0c7f0ca8b2a9e18987dfa6afea9b4c446",
    "wasm-images": "43c5037fcec857bafe110c902db8753e496107147b96e6605a52e7fdeff292e3",
    "wasm-effects": "1c2990e795010ad0c8fe23545cc12357ee55d41a19545e40a2dee3c355334bae",
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
