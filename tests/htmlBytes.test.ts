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
    fixture: "923295b7cc604d0a84a9d03842b09df057b511968447229102ce2668af1cee87",
    "cross-runtime": "3b04f009803e447538a134dfabdcf02e81d53be5ae84d09d43b4af1c98d8d55f",
    "wasm-text": "e359d2c9798f991634a167ac73e3b96d619454a239cd571e860012b6e28f6b94",
    "wasm-emoji": "e927c828ab279b4985b4806f68ab63688e88fdb8da9779c4fb86196c5d3f5a8c",
    "wasm-layout": "9c295b9b335baa83ec8adaa6b0dcd9cfca26fec3b35f52fee1122d80f6a8ec8d",
    "wasm-shapes": "a797207c6d03739f4addcda7fca723a6e257cd324d87f71f510b00d7a4d9a862",
    "wasm-tables": "16b77d26474789ee91bfac83a9edbd6e9eddfaeba55911e83aa28e52d2c34c4d",
    "wasm-images": "fc73923a0dfc86f4451c8f14bf2ee821b8e042438641c98a403e09b696b7a8b6",
    "wasm-effects": "f62ec30522562d0a70d13414c3bcd963df21fb738f856b3cc0cac45024473d44",
    "wasm-charts": "a6a881bba440bbfef468b8f3f1fa3e67b8a7ccadbdf341896c18c59796893234",
    "wasm-svg": "413fe676f8030af2eb11929322179bbf057f0067be10c39bec46513452bde7f0",
    "wasm-gif": "e49f1212c7d6c9f3b2b9eb562b562b852cb72c76c836736af6544bde1c7f3546",
    "wasm-webp": "0649d1cbe19005339be0503e9692a981e94877e3c3d7dedc9aa85618346ab88a",
    "wasm-slides": "e18600a2b3143da9afc199949fcc286be55b3bc0e1e81ab27f44c98ab78e0475",
    "wasm-components": "0919e67813d3fbb5d5c18ed08a58424e37f6c54c1f16568a8180de1f3b1abfaf",
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
