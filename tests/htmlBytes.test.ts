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
    fixture: "c70548262a825f9d5b9db3a666511d232483884ccb100bc9434d939ca9dab9f8",
    "cross-runtime": "156d7378395f31a652ab2cf5988305ac05514ba757d929348c770749f25399af",
    "wasm-text": "dc867db1a6b2eb4c2486edf1ad5fa513e3ce1040f158f9e514af5f246d87608f",
    "wasm-emoji": "e785bde6647286ccb50676df61bf5c6bd6ded179b465befd7b3eb31b4566b2c6",
    "wasm-layout": "d8f753dd933fd448246e30c379a9e3db5a3d1aead9ca90b64f4200dbaea32a57",
    "wasm-shapes": "665682350dc899a0a5dd3fe42211a7943584a349a28ccb6f608cf41f12063f0e",
    "wasm-tables": "456b03ea843a5e80b85c75eac0d39d9c05487e60a86c5d2e4503033db1d1fe14",
    "wasm-images": "cde9334eb8e349019862cace0a918fdf46361de7158d5d915ff18bf893598253",
    "wasm-effects": "0a5239beba7ac262721708705c82272d5e35beef52d63c312b967cb1c419c95b",
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
