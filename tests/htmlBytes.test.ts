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
    fixture: "58d438408f9cc16de9cd50b867dffc4010835a85248f4da0b9f450e527687bc8",
    "cross-runtime": "b2eb29c8003293ebafaa0ef6945d3ca5e8b9cd5fc80bb07f34999c08598351c9",
    "wasm-text": "7d496a796deea4ee70b6e919577e42f7c9606ce120233373744166daa7770e65",
    "wasm-emoji": "0d91270ed1938c8bc676a44071fb8832323c2d04d12c1664d52630bf5f20ef04",
    "wasm-layout": "cd50aff472af8ac0d3be73d2c9e291b3bc567652fba3dc762a63868d657779fa",
    "wasm-shapes": "598fa7b95429c891b2e89fec7876ab42be7cc87d811879c738cfdcf961b03d4a",
    "wasm-tables": "63b6ab1d7e0e033dd1c556369e9317261236e86f3de166e766d40451540b2390",
    "wasm-images": "ac0ac73e1c789a8e1439e163bc7337e88f6287e92d9a5e5a7681fd970e848d2a",
    "wasm-effects": "3c0bea06570c04bbb5a14fbf019abe4316f78bd3de67eff05bfc459711324cd2",
    "wasm-charts": "4e35e0c2aac978ca499d107cad4d29ae1f2297ac2f0ddff76d780dc8a67e7dc1",
    "wasm-svg": "f041e6a03481e2ac817780060c47efbcd9c0593d23e2351386105dab11f9cf27",
    "wasm-gif": "175bd647c392b54ff75d34e0108d9fc1a0026e6dc904d1cecb810ac62f0cc0d6",
    "wasm-webp": "45a19a4141c2de7176f1988480509e67cddf2a4cfe1abc78e96466fbf306c640",
    "wasm-components": "58b6fbf1c2ac77fc407827640eeaab2a8774cb02b2ab9401fe23d0801743f7a8",
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
