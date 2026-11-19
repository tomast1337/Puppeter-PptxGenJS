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
    fixture: "a17e9d05855a826308dd9ab1b36e76bd0874e306e5220f9a90294d9a28f96913",
    "cross-runtime": "0e5a7d08cf537153940f4f5b32f5e7c4add19766b56cfa466f8045131e2854ac",
    "wasm-text": "6a656b4e066d9a3285f2953b826c059d736d67bce10c52acacede4a2c97b3083",
    "wasm-emoji": "7691cbcb68c4d2067ed6c8c5aee227876563cdfd819b187aac64140a69a091ea",
    "wasm-layout": "64dde9ee29f2626e8b0c8385b55839e779cb79a73bc14566bb7513e7dc18de33",
    "wasm-shapes": "0c67d02ba4e53f08fd3fb2d08c9d77d89fc2cab3f24feb5cb65b8ac87bebb2d0",
    "wasm-tables": "eb7d194c1c8f07ac92b1ca3ae1c7a38064dc239008d328c1070510ba5552d53f",
    "wasm-images": "7d5e8e01f368701e7c69b2c241a0e3459f2d00dfcd126e5bde9d23186b37a21f",
    "wasm-effects": "b74ebc4b81bc18c9ea36ae78212448b3e5db6dab3a28c25f907ec719be6d1ac5",
    "wasm-charts": "8e3e92c8de891a362d0378e496952c55dabf7a96c04b06bafa2e8a08ee1c0086",
    "wasm-svg": "88c96d557070deca681092145ba251ebc000c41e54f9b3e49500b72ca82cef02",
    "wasm-gif": "f2193d6050034b986bbbfcab8d10c13819a246e9cfb7c048e0cc0f6593859efb",
    "wasm-webp": "1b8418a6c07b93abb87de45590ed0c79939b0e4f18db3f53a90a05271674d56d",
    "wasm-slides": "66e6ee3ded5daffc72619396e597c5e51893cb455987d33b13185158b75a39ea",
    "wasm-components": "306e319217049fcad4206767ddeae2b4777b4986127957b685f076fcd603f576",
    "wasm-options": "435861769e86432467ca8834a350ecb0d2e4ca7ed766db3ce52ff7360b73336c",
    "wasm-tableOptions": "57ec701b3c1e01cc27366d3fcd42c0badabab5c813a1691a749e8bfdeec4d9ef",
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
