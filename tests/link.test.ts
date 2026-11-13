import { describe, expect, test } from "bun:test";
import { normalizeImage } from "../packages/pptxgenjs/src/normalize/image";
import { normalizeHyperlink } from "../packages/pptxgenjs/src/normalize/link";
import { normalizeShape } from "../packages/pptxgenjs/src/normalize/shape";
import { normalizeTextRun } from "../packages/pptxgenjs/src/normalize/text";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG_DATA = "data:image/png;base64,iVBORw0KGgo=";

describe("hyperlink normalization", () => {
    test("keeps http, https and mailto URLs and prefers url over slide, as PptxGenJS does", () => {
        expect(normalizeHyperlink({ url: "https://example.com", tooltip: "Tip" })).toEqual({ href: "https://example.com", tooltip: "Tip" });
        expect(normalizeHyperlink({ url: "HTTP://example.com" })?.href).toBe("HTTP://example.com");
        expect(normalizeHyperlink({ url: "mailto:a@example.com", slide: 2 })).toEqual({ href: "mailto:a@example.com", tooltip: undefined });
        expect(normalizeHyperlink({ slide: 2 })).toEqual({ href: "#slide-2", tooltip: undefined, slide: 2 });
        expect(normalizeHyperlink(undefined)).toBeUndefined();
    });

    test("rejects other schemes and non-integer slides loudly", () => {
        for (const url of ["javascript:alert(1)", " javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "example.com"]) {
            expect(() => normalizeHyperlink({ url })).toThrow(`hyperlink url '${url}' is not supported: use an http:, https: or mailto: URL`);
        }
        for (const slide of [0, -1, 1.5, Number.NaN]) {
            expect(() => normalizeHyperlink({ slide })).toThrow(`hyperlink slide '${slide}' is not a slide number`);
        }
        expect(() => normalizeHyperlink({})).toThrow("hyperlink requires either url or slide");
    });

    test("text runs, shapes and images share the validation", () => {
        const hyperlink = { url: "javascript:alert(1)" };
        expect(() => normalizeTextRun("x", { hyperlink })).toThrow("is not supported");
        expect(() => normalizeShape("rect", { hyperlink }, 100, 100, PAGE)).toThrow("is not supported");
        expect(() => normalizeImage({ data: PNG_DATA, hyperlink }, PAGE)).toThrow("is not supported");
    });
});
