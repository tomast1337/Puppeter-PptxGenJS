import { describe, expect, spyOn, test } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeImage, resolveImageSource } from "../src/normalize/image";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG_DATA = "data:image/png;base64,iVBORw0KGgo=";

describe("image normalization", () => {
    test("requires and validates image sources", () => {
        expect(() => normalizeImage({} as never, PAGE)).toThrow("requires either 'data' or 'path'");
        expect(() => normalizeImage({ data: "not-a-data-uri" }, PAGE)).toThrow("base64-encoded image data URI");
        expect(() => normalizeImage({ data: "data:text/plain;base64,YQ==" }, PAGE)).toThrow("base64-encoded image data URI");
        expect(() => normalizeImage({ data: PNG_DATA, hyperlink: {} }, PAGE)).toThrow("hyperlink requires either url or slide");
    });

    test("normalizes crop offsets, transparency, and internal links", () => {
        expect(
            normalizeImage(
                {
                    data: PNG_DATA,
                    sizing: { type: "crop", x: "10%", y: "20%", w: 2, h: 1 },
                    transparency: 25,
                    hyperlink: { slide: 3, tooltip: "Details" },
                },
                PAGE,
            ),
        ).toMatchObject({
            sourceKind: "data",
            sizing: { type: "crop", offsetX: 96, offsetY: 108, width: 96, height: 96 },
            opacity: 0.75,
            link: { href: "#slide-3", slide: 3, tooltip: "Details" },
        });
    });

    test("matches PptxGenJS declared-size contain and cover formulas", () => {
        expect(
            normalizeImage(
                {
                    data: PNG_DATA,
                    w: 4,
                    h: 2,
                    sizing: { type: "contain", w: 2, h: 2 },
                },
                PAGE,
            ).sizing,
        ).toEqual({ type: "contain", x: 0, y: 48, width: 192, height: 96 });
        expect(
            normalizeImage(
                {
                    data: PNG_DATA,
                    w: 4,
                    h: 2,
                    sizing: { type: "cover", w: 2, h: 2 },
                },
                PAGE,
            ).sizing,
        ).toEqual({ type: "cover", x: -96, y: 0, width: 384, height: 192 });
    });

    test("supports file URLs", async () => {
        const path = join(tmpdir(), `puppeteer-gen-${crypto.randomUUID()}.svg`);
        await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
        try {
            expect(await resolveImageSource(pathToFileURL(path).href)).toStartWith("data:image/svg+xml;base64,");
        } finally {
            await unlink(path);
        }
    });

    test("reports remote HTTP and content-type failures", async () => {
        const fetchMock = spyOn(globalThis, "fetch");
        try {
            fetchMock.mockResolvedValueOnce(new Response("missing", { status: 404 }));
            expect(resolveImageSource("https://example.com/missing.png")).rejects.toThrow("(404)");
            fetchMock.mockResolvedValueOnce(
                new Response("hello", {
                    status: 200,
                    headers: { "content-type": "text/plain" },
                }),
            );
            expect(resolveImageSource("https://example.com/not-image")).rejects.toThrow("not an image");
        } finally {
            fetchMock.mockRestore();
        }
    });
});

describe("image DOM rendering", () => {
    test("uses sizing dimensions and clips crop offsets", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addImage({
            data: PNG_DATA,
            x: 1,
            y: 1,
            w: 9,
            h: 5,
            sizing: { type: "crop", x: 0.5, y: 0.25, w: 2, h: 1 },
            rounding: true,
            transparency: 30,
        });

        const outer = presentation.page.querySelector<HTMLElement>(".slide-image");
        const frame = outer?.querySelector<HTMLElement>(".slide-image-frame");
        const image = outer?.querySelector<HTMLImageElement>("img");
        expect(outer?.style.width).toBe("192px");
        expect(outer?.style.height).toBe("96px");
        expect(outer?.style.borderRadius).toBe("50%");
        expect(frame?.style.overflow).toBe("hidden");
        expect(image?.style.left).toBe("-48px");
        expect(image?.style.top).toBe("-24px");
        expect(image?.style.opacity).toBe("0.7");
    });

    test("renders contain, cover, and clickable accessible images", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addImage({
            data: PNG_DATA,
            x: 1,
            y: 1,
            sizing: { type: "cover", w: 2, h: 2 },
            altText: "Quartered sample",
            hyperlink: { url: "https://example.com", tooltip: "Open sample" },
        });
        slide.addImage({ data: PNG_DATA, x: 4, y: 1, sizing: { type: "contain", w: 2, h: 2 } });

        const objects = presentation.page.querySelectorAll<HTMLElement>(".slide-image");
        const link = objects[0] as HTMLAnchorElement;
        expect(link.tagName).toBe("A");
        expect(link.href).toBe("https://example.com/");
        expect(link.title).toBe("Open sample");
        expect(link.getAttribute("role")).toBe("img");
        expect(link.getAttribute("aria-label")).toBe("Quartered sample");
        expect(objects[0]?.querySelector<HTMLImageElement>("img")?.style.objectFit).toBe("fill");
        expect(objects[0]?.querySelector<HTMLImageElement>("img")?.style.left).toBe("0px");
        expect(objects[1]?.querySelector<HTMLImageElement>("img")?.style.objectFit).toBe("fill");
    });
});
