import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { modelToHtml } from "../packages/pptxgenjs/src/render/document";
import type { ComponentLookup } from "../packages/pptxgenjs/src/render/slide";
import { element, escapeAttribute, escapeText, rawTextElement, voidElement } from "../packages/pptxgenjs/src/render/markup";
import { populateParityFixture } from "./visual/fixture";

// `as`: the registry is private; toHtml() hands the same object to modelToHtml().
const registry = (pres: PuppeteerGen) => (pres as unknown as { components: ComponentLookup }).components;

// Strings whose serialization differs from the input: markup characters, quotes, U+00A0, and text that
// must pass through unchanged (emoji, RTL, CJK, U+200B, newlines, tabs).
const TRICKY = ["a < b > c", "Tom & Jerry &amp;", `"double" 'single'`, "no\u00A0break", "emoji 👩‍💻🎉", "עברית ومرحبا", "漢字かなカナ", "zero\u200Bwidth", "line\nbreak\r\n", "tab\there", "]]> <!-- --> </style>"];

describe("string-built HTML", () => {
    test("escapes text and attribute values as jsdom's serializer does", () => {
        const { document } = new JSDOM("<!DOCTYPE html><html><body></body></html>").window;

        for (const value of TRICKY) {
            const span = document.createElement("span");

            span.textContent = value;
            span.setAttribute("title", value);
            expect<string>(element("span", [["title", value]], escapeText(value))).toBe(span.outerHTML);
            expect(escapeAttribute(value)).toBe(span.outerHTML.slice('<span title="'.length, span.outerHTML.indexOf('">')));
        }

        const image = document.createElement("img");

        image.setAttribute("alt", TRICKY.join(""));
        expect<string>(voidElement("img", [["alt", TRICKY.join("")]])).toBe(image.outerHTML);
    });

    test("markup takes only escaped or serialized content, never a plain string", () => {
        const text = "<b>";
        // @ts-expect-error a plain string is not Html: it must go through escapeText() or element()
        const unescaped = element("p", [], text);

        expect<string>(unescaped).toBe("<p><b></p>");
        expect<string>(element("p", [], escapeText(text))).toBe("<p>&lt;b&gt;</p>");
    });

    test("a <style> refuses text that would end it early", () => {
        expect(() => rawTextElement("style", [], "a{}</STYLE><script>")).toThrow('<style> text must not contain "</style"');
    });

    test("decks without components never create a document", async () => {
        const pres = new PuppeteerGen();

        populateParityFixture(pres);
        const model = pres.getModel();
        const withoutComponents = { ...model, slides: model.slides.map(slide => ({ ...slide, objects: slide.objects.filter(object => object.kind !== "component") })) };
        const createDocument = () => {
            throw new Error("createDocument was called");
        };
        const { html } = await modelToHtml(withoutComponents, { createDocument });

        expect(html).toContain('class="slide-element slide-chart"');
        // Components that return HTML text do not need one either; only reading context.document creates it.
        const components = registry(pres);

        expect((await modelToHtml(model, { components, createDocument })).html).toBe((await pres.toHtml()).html);
    });

    test("a deck creates no document until a component it checks in addComponent() reads one, then reuses it", () => {
        let created = 0;
        const pres = new PuppeteerGen(undefined, { createDocument: () => (created++, createNodeDocument()) });

        pres.registerComponent("test/text", 1, { render: props => String(props.label) });
        pres.registerComponent("test/strong", 1, { render: (props, { document }) => Object.assign(document.createElement("strong"), { textContent: String(props.label) }) });
        pres.addSlide().addText("plain", { x: 1, y: 1, w: 2, h: 1 });
        pres.addSlide().addComponent({ type: "test/text", version: 1, props: { label: "A" } }, { x: 1, y: 1, w: 2, h: 1 });
        expect(created).toBe(0);
        pres.addSlide().addComponent({ type: "test/strong", version: 1, props: { label: "B" } }, { x: 1, y: 1, w: 2, h: 1 });
        pres.addSlide().addComponent({ type: "test/strong", version: 1, props: { label: "C" } }, { x: 1, y: 1, w: 2, h: 1 });
        expect(created).toBe(1);
    });

    test("a component that builds an element gets one document per call", async () => {
        let created = 0;
        const createDocument = () => (created++, createNodeDocument());
        const pres = new PuppeteerGen();

        pres.registerComponent("test/strong", 1, {
            render: (props, { document }) => Object.assign(document.createElement("strong"), { textContent: String(props.label) }),
        });
        pres.addSlide().addComponent({ type: "test/strong", version: 1, props: { label: "A & B" } }, { x: 1, y: 1, w: 2, h: 1 });
        pres.addSlide().addComponent({ type: "test/strong", version: 1, props: { label: "C" } }, { x: 1, y: 1, w: 2, h: 1 });
        const components = registry(pres);
        const { html } = await modelToHtml(pres.getModel(), { components, createDocument });

        expect(created).toBe(1);
        expect(html).toContain("<strong>A &amp; B</strong>");
    });
});
