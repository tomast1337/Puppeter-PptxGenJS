// GIF and WebP decks: one slide per format with the image deck's samples (images/) re-encoded by
// ImageMagick 7.1: every sizing mode, a transparent picture over a patterned background, and a
// rotated, transparent, shadowed picture. animated.gif has two full 400x200 frames, the second
// flopped and negated; Chromium, LibreOffice and WASM all draw the first. The WebPs are lossless
// except lossy.webp (quality 75).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";

export const FORMAT_PAGES = 1;

/** One format's pictures: a 400x200 sample, a 200x200 one with transparency, and a third sample variant. */
interface FormatPictures {
    title: string;
    sample: string;
    badge: string;
    variant: { file: string; label: string };
}

const image = (name: string) => join(import.meta.dir, "images", name);
const dataUri = (name: string, mime: string) => `data:${mime};base64,${readFileSync(image(name)).toString("base64")}`;

// Spread per call: PptxGenJS mutates the options object it is given.
const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;
const label = { fontFace: "Arial", fontSize: 14, color: "363636", align: "center", margin: 0 } as const;

function populateFormatSlide<T extends PptxGenJS | PuppeteerGen>(presentation: T, pictures: FormatPictures, mime: string): T {
    const slide = presentation.addSlide() as PptxGenJS.Slide;

    slide.addText(pictures.title, { ...title });
    for (const [x, text] of [
        [0.5, "Stretch"],
        [2.9, "Contain"],
        [5.3, "Cover"],
        [7.7, "Crop"],
    ] as const) {
        slide.addShape("rect", { x, y: 0.95, w: 1.9, h: 1.8, fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 1 } });
        slide.addText(text, { ...label, x, y: 2.85, w: 1.9, h: 0.35 });
    }

    const sample = dataUri(pictures.sample, mime);

    // Paths go through toHtml()'s data-URI resolution, data URIs straight in.
    slide.addImage({ path: image(pictures.sample), x: 0.5, y: 0.95, w: 1.9, h: 1.8, altText: "Stretched" });
    slide.addImage({ data: sample, x: 2.9, y: 0.95, w: 4, h: 2, sizing: { type: "contain", w: 1.9, h: 1.8 }, altText: "Contained" });
    slide.addImage({ path: image(pictures.sample), x: 5.3, y: 0.95, w: 4, h: 2, sizing: { type: "cover", w: 1.9, h: 1.8 }, altText: "Covered" });
    slide.addImage({ data: sample, x: 7.7, y: 0.95, w: 4, h: 2, sizing: { type: "crop", x: 1, y: 0.25, w: 1.9, h: 1.8 }, altText: "Cropped" });
    // Transparent pixels must show the shapes behind.
    slide.addShape("rect", { x: 0.5, y: 3.5, w: 2.4, h: 1.2, fill: { color: "5B9BD5" } });
    slide.addShape("rect", { x: 0.5, y: 4.1, w: 2.4, h: 0.6, fill: { color: "FFC000" } });
    slide.addImage({ data: dataUri(pictures.badge, mime), x: 1.1, y: 3.5, w: 1.2, h: 1.2, altText: "Transparent" });
    slide.addImage({ path: image(pictures.variant.file), x: 3.6, y: 3.5, w: 2.4, h: 1.2, altText: pictures.variant.label });
    // LibreOffice draws the WebP one without its shadow, so the WASM crop scores 0.0851 there against
    // 0.0344 for the same GIF, whose reference has the shadow; the WASM drawing is the same for both.
    slide.addImage({ data: sample, x: 6.8, y: 3.55, w: 2.4, h: 1.1, rotate: -10, flipH: true, transparency: 40, shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 4, offset: 4, angle: 45 }, altText: "Rotated" });
    slide.addText("Transparency", { ...label, x: 0.5, y: 4.85, w: 2.4, h: 0.35 });
    slide.addText(pictures.variant.label, { ...label, x: 3.6, y: 4.85, w: 2.4, h: 0.35 });
    slide.addText("Rotate + flip + shadow", { ...label, x: 6.5, y: 4.85, w: 3, h: 0.35 });

    return presentation;
}

export function populateGifDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    return populateFormatSlide(presentation, { title: "GIF images", sample: "sample.gif", badge: "badge.gif", variant: { file: "animated.gif", label: "Animated" } }, "image/gif");
}

export function populateWebpDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    return populateFormatSlide(presentation, { title: "WebP images", sample: "sample.webp", badge: "badge.webp", variant: { file: "lossy.webp", label: "Lossy" } }, "image/webp");
}
