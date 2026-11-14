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
    fixture: "3234277e50620674968aacb0e3c02b143d9e2f50535e0a15612958c9719d7091",
    "cross-runtime": "55145ecf033fda4c23b096502df6bbf7f4cf77fdf9586ce201d11597ba1a869f",
    "wasm-text": "b12a81bd52c34e0be8e1e43768da5e3ba9e039555f50359e488ab04f7685874f",
    "wasm-emoji": "2ace966551fb9b3d7065be10a2a00deb86ec0f363ae6f4b8c0683972b7117a7a",
    "wasm-layout": "e68186930a1a21f7b93d4e70e523eabe2f07b0aa2ac0d761a68d7252daf043a8",
    "wasm-shapes": "e35b4a38c8dcd344a64d9e4c5e11e6565c75672752e74a1b510dc3122659edc5",
    "wasm-tables": "f3e24dd705b00e236601041d24c429e97beaa727b3fbb03df695d422392ac2d0",
    "wasm-images": "ac22e45ad4d9e50da166fc38630491313c512aeff1cf7f12cf44fa186c41f0c4",
    "wasm-effects": "25cf54f88cba8984b1b442990ee26fee19f3803b4bd3debf2e02fe24955569e3",
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
