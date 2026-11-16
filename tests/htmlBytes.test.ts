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
    fixture: "cf11c27f83fbf653428903b0b18cfca52b6d0510c9c230acf12a54350808b355",
    "cross-runtime": "c626610335eec73ef13477339f65ba4bfbcf8f17f113dff053074f9dadb5feb8",
    "wasm-text": "c9cd29f53412932fbd583c1a0a15023fb2e87d40dad8525dc95d588356201899",
    "wasm-emoji": "bb6f9f84aac7ebb1109e5acd2fef0572027bd152d1e36fb2b31c07634d99759a",
    "wasm-layout": "c24415e8398364cb9644bdcadd763208486fd40afe859a0060572f560763f623",
    "wasm-shapes": "8585e79da366a1c6afd80b1d576c93a5a6f883d0f275df7f1e6ce61ce2e37e94",
    "wasm-tables": "821b2567009dec32cd3f6ebcf5ba49cd6e924f7085e4ed7101a2c4b4f1ad2010",
    "wasm-images": "423cf6e0ee4b3b6a9647ce3e2d550c22b2882c12da7d173c779253fb66ca49c6",
    "wasm-effects": "ed5a3614aa39909f2c109005d1fbbb78b29c2e34a9d22a83232f28e53803e8dc",
    "wasm-charts": "a60861eb44bfe2f165fc9b1460ee83e06de7da7878d7627f9f76558260cee9db",
    "wasm-svg": "a05616332e35672388892d6d98a7a63809bef173052c745899628891f61a6482",
    "wasm-gif": "4ab2dadb9f12a376fe0cbeecf41b5c1cca58238719adf8f56df9728d4abbbff9",
    "wasm-webp": "3644537b018f582549fe877e275e0dfa72805930edee268365aa3ce0078f48b3",
    "wasm-slides": "aaeb5403ad210513c73a06046feebb41feaad665619b18caae3b64d5d0000c74",
    "wasm-components": "0919e67813d3fbb5d5c18ed08a58424e37f6c54c1f16568a8180de1f3b1abfaf",
    "wasm-options": "308667d0fa2ccd88e8c99b4b0e9da2d3d558f33cf08f1cb1657a25ce954cde21",
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
