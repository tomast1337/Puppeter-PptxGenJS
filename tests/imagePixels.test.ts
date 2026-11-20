import { afterAll, describe, expect, test } from "bun:test";
import { checkImagePixels, IMAGE_PIXEL_LIMITS, imagePixelLimits, rasterImageSize } from "../packages/model/src/index";
import { createPdfkitRenderer, loadSystemFonts } from "../packages/pdfkit/src/node";
import { PuppeteerGen } from "../packages/pptxgenjs/src/html";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";

afterAll(closeBrowser);

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const base64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const be32 = (value: number) => [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/** A PNG that is only its signature and an RGBA IHDR declaring `width` x `height`: no pixel data at all. */
function headerOnlyPng(width: number, height: number): number[] {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0];
}
const png = (width: number, height: number) => `data:image/png;base64,${base64(headerOnlyPng(width, height))}`;

describe("decoded-pixel limits (#360)", () => {
    test("reads the size from PNG, JPEG, GIF and WebP headers", () => {
        expect(rasterImageSize(new Uint8Array(headerOnlyPng(20000, 300)))).toEqual([20000, 300]);
        // SOI, an APP0 segment to skip, then SOF0: length, precision, height, width.
        const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x4e, 0x20];
        expect(rasterImageSize(new Uint8Array(jpeg))).toEqual([20000, 300]);
        expect(rasterImageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x4e, 0x2c, 0x01]))).toEqual([20000, 300]);
        const vp8x = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x4e, 0x00, 0x2b, 0x01, 0x00];
        expect(rasterImageSize(new Uint8Array(vp8x))).toEqual([20000, 300]);
        expect(rasterImageSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
        expect(rasterImageSize(new Uint8Array(headerOnlyPng(1, 1).slice(0, 20)))).toBeUndefined();
    });

    test("refuses an image over the per-image limit and a deck over the total, counting each distinct image once", () => {
        const limits = imagePixelLimits();
        expect(limits).toEqual(IMAGE_PIXEL_LIMITS);
        expect(() => checkImagePixels(`<img src="${png(8192, 8192)}">`, limits)).not.toThrow();
        expect(() => checkImagePixels(`<img src="${png(8193, 8192)}">`, limits)).toThrow("An image of 8193x8192 pixels is over the limit of 67108864 pixels per image; downscale it, or raise the renderer option imageLimits.maxImagePixels");
        const same = `<img src="${png(8192, 8192)}">`.repeat(5);
        expect(() => checkImagePixels(same, limits)).not.toThrow();
        const distinct = [8192, 8191, 8190, 8189, 8188].map(height => `<img src="${png(8192, height)}">`).join("");
        expect(() => checkImagePixels(distinct, limits)).toThrow("takes the presentation's images over the limit of 268435456 pixels in total");
        expect(() => checkImagePixels(`<div style="background: url(${png(9000, 9000)})"></div>`, limits)).toThrow("is over the limit");
    });

    test("the limits can be raised or lowered, and are checked", () => {
        expect(() => checkImagePixels(`<img src="${png(9000, 9000)}">`, imagePixelLimits({ maxImagePixels: 9000 * 9000 }))).not.toThrow();
        expect(() => checkImagePixels(`<img src="${png(20, 20)}">`, imagePixelLimits({ maxImagePixels: 100 }))).toThrow("over the limit of 100 pixels per image");
        expect(() => imagePixelLimits({ maxDeckImagePixels: -1 })).toThrow("imageLimits.maxDeckImagePixels must be a positive integer, got -1");
    });

    /** A deck with a 33-byte PNG that declares 20000 x 20000 RGBA pixels (1.49 GiB decoded). */
    async function hugeImageDeck() {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addImage({ data: png(20000, 20000), x: 1, y: 1, w: 2, h: 2 });
        return presentation.toHtml();
    }

    test("Puppeteer refuses the image before printing", async () => {
        await expect(new PuppeteerPdfRenderer().render(await hugeImageDeck())).rejects.toThrow("An image of 20000x20000 pixels is over the limit of 67108864 pixels per image");
        expect(() => new PuppeteerPdfRenderer({ imageLimits: { maxImagePixels: 0 } })).toThrow("imageLimits.maxImagePixels must be a positive integer");
    });

    test("PDFKit refuses the image before decoding it", async () => {
        const renderer = await createPdfkitRenderer({ fonts: await loadSystemFonts() });
        await expect(renderer.render(await hugeImageDeck())).rejects.toThrow("An image of 20000x20000 pixels is over the limit of 67108864 pixels per image");
    });
});
