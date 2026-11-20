import { describe, expect, test } from "bun:test";
import { InvalidModelError, parseModel } from "../packages/pptxgenjs/src/modelSchema";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { modelToHtml } from "../packages/pptxgenjs/src/render/document";
import type { ComponentLookup } from "../packages/pptxgenjs/src/render/slide";
import { buildCrossRuntimeDeck } from "./crossRuntimeDeck";
import { populateParityFixture } from "./visual/fixture";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// `as`: the registry and resolver are private; toHtml() hands the same objects to modelToHtml().
const internals = (pres: PuppeteerGen) => pres as unknown as { components: ComponentLookup; resolveImage: (source: string) => Promise<string> };

function smallModel(): unknown {
    const pres = new PuppeteerGen();
    pres.addSlide().addText("Hi", { x: 0.5, y: 0.5, w: 2, h: 1, color: "FF0000", fill: { color: "00FF00" } });
    pres.addSlide().addImage({ data: PNG, x: 0, y: 0, w: 1, h: 1 });
    return JSON.parse(JSON.stringify(pres.getModel()));
}

type Json = Record<string | number, unknown>;

/** The InvalidModelError parseModel() throws for the small model with `value` written at `path` (its last key the field). */
function rejection(path: readonly (string | number)[], value: unknown): InvalidModelError {
    const model = smallModel();
    // `as`: smallModel() is getModel() JSON and every test path names objects and arrays it has.
    const parent = path.slice(0, -1).reduce<Json>((object, key) => object[key] as Json, model as Json);
    parent[path[path.length - 1] ?? ""] = value;
    try {
        parseModel(model);
    } catch (error) {
        if (error instanceof InvalidModelError) return error;
        throw error;
    }
    throw new Error("parseModel() accepted the model");
}

describe("parseModel()", () => {
    test("getModel() of every fixture deck round-trips through JSON and parseModel(), and modelToHtml() of it is toHtml()", async () => {
        const decks: Record<string, PuppeteerGen> = { fixture: new PuppeteerGen(), "cross-runtime": buildCrossRuntimeDeck(PuppeteerGen, PNG) };
        populateParityFixture(decks.fixture!);
        // Imported here: tests/visual/wasm/deck.ts installs a global jsdom `document` when loaded (see htmlBytes.test.ts).
        const hadDocument = "document" in globalThis;
        try {
            const { DECKS } = await import("./visual/wasm/decks");
            for (const [name, deck] of Object.entries(DECKS)) decks[`wasm-${name}`] = deck.populate(new PuppeteerGen());
            for (const [name, pres] of Object.entries(decks)) {
                const json = JSON.parse(JSON.stringify(pres.getModel()));
                expect({ name, model: parseModel(json) }).toEqual({ name, model: json });
                const { components, resolveImage } = internals(pres);
                const html = (await modelToHtml(json, { components, resolveImage, createDocument: createNodeDocument })).html;
                expect({ name, same: html === (await pres.toHtml()).html }).toEqual({ name, same: true });
            }
        } finally {
            if (!hadDocument) Reflect.deleteProperty(globalThis, "document");
        }
    }, 120_000);

    test("rejects a color that would add CSS declarations", () => {
        const error = rejection(["slides", 0, "objects", 0, "text", "paragraphs", 0, "runs", 0, "color"], "red;background:url(x)");
        expect(error.message).toContain("model.slides[0].objects[0].text.paragraphs[0].runs[0].color: is not a CssColor");
        expect(rejection(["slides", 0, "background"], "#FF0000; color: red").issues).toEqual([{ path: "model.slides[0].background", message: expect.stringContaining("colorToCSS") }]);
    });

    test("rejects a page size that is NaN, negative, zero or infinite", () => {
        expect(rejection(["pageSize", "width"], Number.NaN).message).toContain("model.pageSize.width: ");
        expect(rejection(["pageSize", "height"], -1).message).toContain("model.pageSize.height: must be a finite number of inches above 0");
        expect(rejection(["pageSize", "height"], 0).issues[0]?.path).toBe("model.pageSize.height");
        expect(rejection(["pageSize", "width"], Number.POSITIVE_INFINITY).issues[0]?.path).toBe("model.pageSize.width");
    });

    test("rejects a wrong type, an unknown key and an unknown object kind", () => {
        expect(rejection(["slides", 0, "hidden"], "no").message).toContain("model.slides[0].hidden: Invalid input: expected boolean");
        expect(rejection(["slides", 0, "objects", 0, "style", "geometry", "x"], "10px").issues[0]?.path).toBe("model.slides[0].objects[0].style.geometry.x");
        expect(rejection(["slides", 0, "fontSize"], 12).message).toContain("model.slides[0]: Unrecognized key");
        expect(rejection(["slides", 0, "objects", 0, "kind"], "video").message).toContain("model.slides[0].objects[0].kind: is not a slide object");
        expect(() => parseModel("deck")).toThrow(InvalidModelError);
    });

    test("rejects a data image whose source is not a data URI, a link that runs script and a font face that ends its declaration", () => {
        expect(rejection(["slides", 1, "objects", 0, "image", "source"], "https://example.com/a.png").message).toContain("model.slides[1].objects[0].image.source: is not a data URI");
        expect(rejection(["slides", 1, "objects", 0, "image", "source"], "data:text/html;base64,PHNjcmlwdD4=").issues[0]?.path).toBe("model.slides[1].objects[0].image.source");
        expect(rejection(["slides", 0, "objects", 0, "text", "paragraphs", 0, "runs", 0, "link"], { href: "javascript:alert(1)" }).message).toContain("runs[0].link.href: is not a supported link");
        expect(rejection(["slides", 0, "objects", 0, "text", "paragraphs", 0, "runs", 0, "fontFace"], 'Arial";}\nbody{color:red').message).toContain("runs[0].fontFace: ");
    });

    test("rejects word letter-spacing that is not one finite value per word of the run", () => {
        const spacing = ["slides", 0, "objects", 0, "text", "paragraphs", 0, "runs", 0, "wordCharacterSpacing"] as const;
        // "Hi" is one word.
        expect(rejection(spacing, [0.1, 0.2]).message).toContain("runs[0].wordCharacterSpacing: ");
        expect(rejection(spacing, []).issues[0]?.path).toBe("model.slides[0].objects[0].text.paragraphs[0].runs[0].wordCharacterSpacing");
        expect(rejection(spacing, [Number.NaN]).issues[0]?.path).toBe("model.slides[0].objects[0].text.paragraphs[0].runs[0].wordCharacterSpacing[0]");
    });

    test("modelToHtml() checks its input; the error names the path", async () => {
        const model = smallModel() as { slides: { color: string }[] };
        model.slides[0]!.color = "red;background:url(x)";
        await expect(modelToHtml(model)).rejects.toThrow("model.slides[0].color: is not a CssColor");
    });
});
