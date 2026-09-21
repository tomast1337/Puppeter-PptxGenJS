import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { PAGE_SIZES } from "../src/pageLayouts";
import { serializeHtmlPresentation } from "../src/render/document";

describe("HTML presentation serialization", () => {
    test("serializes the document and carries page dimensions for renderers", () => {
        const dom = new JSDOM('<!DOCTYPE html><html><head><title>Deck</title></head><body><div class="slide-container">Slide</div></body></html>');
        const pageSize = PAGE_SIZES.SCREEN_16X9.landscape;

        const result = serializeHtmlPresentation(dom.window.document, pageSize);

        expect(result).toEqual({
            html: dom.window.document.documentElement.outerHTML,
            pageSize,
        });
    });
});
