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
    fixture: "fa11dff7728c9f92e188c09b917ba09f923256d5aaf798b2ef50f79c81ab5f5d",
    "cross-runtime": "609bf2598def97b9f3d6481492e5efa94abae5bb485fa811830f38cab5cbc04e",
    "wasm-text": "d1dbb8dbd5fd16f568d3014a17400799bd3da13aba9e392a7e90d77517483762",
    "wasm-emoji": "db89512f005166d2955193d4635c3cbecc6cec0e2283c26b59b4af422aaba68d",
    "wasm-layout": "1a866c565c2aefbe0befd5a09d56edf9b5f9faf4e8fdeb57218ba0247704adbd",
    "wasm-shapes": "74ad079c7bdf417daf5b4f8e368ea35b487c607565958ef68bd38ba862d5027c",
    "wasm-tables": "e5efd4c4fac72850c86ff1e4ef8d6a52291e27224e774f4c2208df23d8ce665e",
    "wasm-images": "acedb8d02711e608c7933252c27af2c6b534fecb709e45d621ca170a3ef0d6ce",
    "wasm-effects": "c66bddedfa6557470ca3ff722723e60f28892ce2815af183d8afdc680a427207",
    "wasm-charts": "94ecdc4fa6934fb3feaa6e80afbca1545be6954215b7a3ebc4ae8aae900a78ad",
    "wasm-svg": "0e0a6c1f5c75d0fe2d32f34fde64f2e000d78eec77a84310c06101cb52c498af",
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
            for (const [name, deck] of Object.entries(DECKS)) html[`wasm-${name}`] = (await deck.populate(new PuppeteerGen()).toHtml()).html;
        } finally {
            if (!hadDocument) Reflect.deleteProperty(globalThis, "document");
        }
        expect(Object.fromEntries(Object.entries(html).map(([name, document]) => [name, sha256(document)]))).toEqual(EXPECTED_SHA256);
        // toHtml() states every value, so the completion step returns it byte for byte.
        for (const [name, document] of Object.entries(html)) expect({ name, same: completeProfileHtml(document) === document }).toEqual({ name, same: true });
    }, 60_000);
});
