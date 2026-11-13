import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { modelToHtml } from "../packages/pptxgenjs/src/render/document";
import type { ComponentLookup } from "../packages/pptxgenjs/src/render/slide";
import { element, escapeAttribute, escapeText, voidElement } from "../packages/pptxgenjs/src/render/markup";
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
            expect(element("span", [["title", value]], escapeText(value))).toBe(span.outerHTML);
            expect(escapeAttribute(value)).toBe(span.outerHTML.slice('<span title="'.length, span.outerHTML.indexOf('">')));
        }
        const image = document.createElement("img");
        image.setAttribute("alt", TRICKY.join(""));
        expect(voidElement("img", [["alt", TRICKY.join("")]])).toBe(image.outerHTML);
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
