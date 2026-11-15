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
    fixture: "9d3038bacd6e93084c43ac6667e3c1cc01bae4c845d96d1f7862a699d023b01f",
    "cross-runtime": "a907df1f9c25f9815262d3d242d690cb6d7d29729a66369bf245a75c78bb5449",
    "wasm-text": "a9565a8297e9e025d595755bb838ebd12e9605aedbf38ce1c65a9ac8b7d10a9f",
    "wasm-emoji": "28f15c5212fcdc89b0dc741b36a8f7df79886330af51115bbe4a09a14b268653",
    "wasm-layout": "a1fc1ed3349b17661ccb14b26a833b690a7b90d384e916d9476e09422bafc0a5",
    "wasm-shapes": "b519279f8ae704ed498a6fabfec39deff33f09647d2fde4a40b78ef107ef71f9",
    "wasm-tables": "135bbeaee70e9ce9085c3f5f51539d5a9becd45c33dd8f79e1a397396fcfc12b",
    "wasm-images": "2753a2abe2d706407ff3280d073992e5620a32a79381b4dc45b99925ccfe24f3",
    "wasm-effects": "2eeeec4dad21c4db5df143bb6eccca93a2b633a7abd3e6efeb0f7246c6ac12e0",
    "wasm-charts": "a7c765ee7a9acc987ada4dbbba5173380d31218fb99bf7e2a836d45a39bc1ba7",
    "wasm-svg": "419bbae91e4954831bb8d957f33c6d8c0ba8e3d7a1acf70ee3d240ef834f49be",
    "wasm-gif": "a1d1a46103ff76ab3729d46391d8f011cfadb53dcdbe4fd3c5cb209280072de6",
    "wasm-webp": "aeec8bd7b1b17c54b7aaf566ab4ddcafeb9c683ccf89530291b0575fa60a3a4d",
    "wasm-components": "e8a8e76671fb60a5492216dedc843cc608c4aa802379329a8f44c0a81c4fc38a",
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
