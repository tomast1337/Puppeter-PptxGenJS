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
    fixture: "ec5ae61bb269d3eb4081ce101aac9c1a63494bab6fb555a019f4f89ce7741b34",
    "cross-runtime": "392ad655605f76e175294a1f61f25f0278068f2b72f55b6e9f12d42f1f100e39",
    "wasm-text": "8464dcbd775f9c75aa0ae74293f41b227ff80c64ecf6d6719f5e42cb1923cbf1",
    "wasm-emoji": "9cf0a1882c3bb300221c3811607377c62672583d7fe2a01b8cc324c1744e645c",
    "wasm-layout": "c8ef59ae91b674106e06dff3197be19d236ebefe13f4d59891f6020c6388e55b",
    "wasm-shapes": "aac7c668a6a7feda38fa0a08d4f0289fe49f45cf2107255ace5eccf2f99f0e90",
    "wasm-tables": "f48019da6fc973ede03f55a89419187c04a67d782e522ba99a5a8eb78cf45c32",
    "wasm-images": "221ae1fe72080e93c0da2ca65ca27d0a442fed7c7278670ab06167a7ccd1f127",
    "wasm-effects": "bff5d0bcd3bfc3c8fb32bee214179cb54f57c07c50020c634a0fb953c249198a",
    "wasm-charts": "d6afa306a5368994343307adf2f690d8fe4cd96287287b3d827b27212a45f353",
    "wasm-svg": "cf3c3f6da0782f681d9547186e95c746275ed8f6a4362b6b33c8e94c135dbc93",
    "wasm-gif": "fccea666640250b7655c8821400ea06c024ce46321a2c811dc53f3664fe93013",
    "wasm-webp": "6de122e41a4daefac045024a0dcdc60356742cf5a0e44fb6e12e6592380c91e6",
    "wasm-slides": "88a082d19c6f5aed60d8895350835fb30dff0d59aa2f65a1a45dbb3e85e8dbda",
    "wasm-components": "bc7c6221636a9507260fa6fdccb499e998a41510576ddb839ae05545cc6ea519",
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
