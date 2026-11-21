import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { completeProfileHtml } from "../packages/pptxgenjs/src/render/completion";
import { buildCrossRuntimeDeck } from "./crossRuntimeDeck";
import { populateParityFixture } from "./visual/fixture";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * sha256 of toHtml() for the shared decks, taken from the DOM-built HTML before #69 phase 4a
 * (ee97e5d). A refactor keeps them; a deliberate HTML change updates these in the
 * same PR, so the output change is visible in review; to see what changed, diff toHtml() against main.
 */
const EXPECTED_SHA256: Record<string, string> = {
    fixture: "79dbd4bfcf7eb7b0aff88d3932f9c810bcba6f8468d60ea09b33e895a78f2747",
    "cross-runtime": "1fbdb5018396ef36aa6268de665724032062110f3caada7638054e59477cf044",
    "wasm-text": "7e970ac08af8b3aa1479e11ba48f16aeebb10d6d79127943e3f488da6b946bd7",
    "wasm-emoji": "041e711c8a1912d6a0c73bd32aa2403839987c3929d4cbdfcb0a5115e27e8df1",
    "wasm-layout": "1a866c565c2aefbe0befd5a09d56edf9b5f9faf4e8fdeb57218ba0247704adbd",
    "wasm-shapes": "74ad079c7bdf417daf5b4f8e368ea35b487c607565958ef68bd38ba862d5027c",
    "wasm-tables": "9db006ff1efc30aadf23d6a778a023f8f365eff14875d520687566383e68a917",
    "wasm-images": "acedb8d02711e608c7933252c27af2c6b534fecb709e45d621ca170a3ef0d6ce",
    "wasm-effects": "c66bddedfa6557470ca3ff722723e60f28892ce2815af183d8afdc680a427207",
    "wasm-charts": "94ecdc4fa6934fb3feaa6e80afbca1545be6954215b7a3ebc4ae8aae900a78ad",
    "wasm-svg": "0ed2222573f3ffa6ec6b887907d3f26a2343fe30f2c4a44a4608df6e0b5fba31",
    "wasm-gif": "cc044a43bcdaa50876fc2da1fedc3d3ede74d271b7a8ce406191ddd96b4dc71e",
    "wasm-webp": "389927c7c8b1506b25d5dece837d9f0131d4af29ad94ee0b361719c07798f1b8",
    "wasm-slides": "7ceb86e4a5ef2d6629dc1766f6fd1bcaaa752d9b7fbd35b2d91fd4c915be61f2",
    "wasm-components": "306e319217049fcad4206767ddeae2b4777b4986127957b685f076fcd603f576",
    "wasm-options": "b2f13b2296f80ff6acafbaad92e2a61e2ff943600b5aa9c51afeebc9b36fd3f5",
    "wasm-tableOptions": "97ffa9ab07f395f5cc0c99085665bbdda51f361f20aa7f5a4e0d65ff810e168f",
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

            for (const [name, deck] of Object.entries(DECKS)) {
                html[`wasm-${name}`] = (await deck.populate(new PuppeteerGen()).toHtml()).html;
            }
        } finally {
            if (!hadDocument) {
                Reflect.deleteProperty(globalThis, "document");
            }
        }

        expect(Object.fromEntries(Object.entries(html).map(([name, document]) => [name, createHash("sha256").update(document).digest("hex")]))).toEqual(EXPECTED_SHA256);
        // toHtml() states every value, so the completion step returns it byte for byte.
        for (const [name, document] of Object.entries(html)) {
            expect({ name, same: completeProfileHtml(document) === document }).toEqual({ name, same: true });
        }
    }, 60_000);
});
