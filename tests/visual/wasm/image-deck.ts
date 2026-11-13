// Image deck: the shared fixture's two image slides (tests/visual/fixture.ts) with raster sources,
// since the fixture's sample pictures are SVG and the WASM backend draws PNG and JPEG only. The
// pictures in images/ are the fixture's SVG samples rasterized with ImageMagick, plus badge.png
// (semi-transparent pixels over a fully transparent background). JPEGs go in by path, PNGs as data URIs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";

export const IMAGE_PAGES = 2;

const image = (name: string) => join(import.meta.dir, "images", name);
const SAMPLE_PNG = `data:image/png;base64,${readFileSync(image("sample.png")).toString("base64")}`;
const BADGE_PNG = `data:image/png;base64,${readFileSync(image("badge.png")).toString("base64")}`;
const SAMPLE_JPG = image("sample.jpg");
const TALL_JPG = image("tall.jpg");

// Spread per call: PptxGenJS mutates the options object it is given.
const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;
const label = { fontFace: "Arial", fontSize: 14, color: "363636", align: "center", margin: 0 } as const;

export function populateImageDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    const sizing = presentation.addSlide() as PptxGenJS.Slide;
    sizing.addText("Image sizing and cropping", { ...title });
    for (const [x, text] of [
        [0.5, "Stretch"],
        [2.9, "Contain"],
        [5.3, "Cover"],
        [7.7, "Crop"],
    ] as const) {
        sizing.addShape("rect", { x, y: 1.05, w: 1.9, h: 2.2, fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 1 } });
        sizing.addText(text, { ...label, x, y: 3.4, w: 1.9, h: 0.4 });
    }
    sizing.addImage({ data: SAMPLE_PNG, x: 0.5, y: 1.05, w: 1.9, h: 2.2, altText: "Stretched PNG" });
    sizing.addImage({ path: SAMPLE_JPG, x: 2.9, y: 1.05, w: 4, h: 2, sizing: { type: "contain", w: 1.9, h: 2.2 }, altText: "Contained JPEG" });
    sizing.addImage({ data: SAMPLE_PNG, x: 5.3, y: 1.05, w: 4, h: 2, sizing: { type: "cover", w: 1.9, h: 2.2 }, altText: "Covered PNG" });
    sizing.addImage({ path: SAMPLE_JPG, x: 7.7, y: 1.05, w: 4, h: 2, sizing: { type: "crop", x: 1, y: 0.25, w: 1.9, h: 2.2 }, altText: "Cropped JPEG" });
    sizing.addImage({ path: TALL_JPG, x: 2.3, y: 4.05, w: 2, h: 4, sizing: { type: "contain", w: 2.2, h: 1.2 }, altText: "Contained tall JPEG" });
    sizing.addImage({ path: TALL_JPG, x: 5.5, y: 4.05, w: 2, h: 4, sizing: { type: "cover", w: 2.2, h: 1.2 }, altText: "Covered tall JPEG" });

    const effects = presentation.addSlide() as PptxGenJS.Slide;
    effects.addText("Image transforms and effects", { ...title });
    effects.addImage({ path: SAMPLE_JPG, x: 0.75, y: 1.25, w: 1.7, h: 1.7, rounding: true, altText: "Rounded JPEG" });
    effects.addImage({ data: SAMPLE_PNG, x: 3.1, y: 1.35, w: 2.5, h: 1.25, rotate: -12, flipH: true, altText: "Rotated and flipped PNG" });
    // No shadow here (the fixture has one): the WASM backend does not draw shadows yet, which would hide the opacity score.
    effects.addImage({ data: SAMPLE_PNG, x: 6.25, y: 1.35, w: 2.5, h: 1.25, transparency: 45, altText: "Transparent PNG" });
    effects.addText("Rounded", { ...label, x: 0.75, y: 3.35, w: 1.7, h: 0.4 });
    effects.addText("Rotate + flip", { ...label, x: 3.1, y: 3.35, w: 2.5, h: 0.4 });
    effects.addText("Transparency", { ...label, x: 6.1, y: 3.35, w: 2.8, h: 0.4 });
    effects.addImage({ path: SAMPLE_JPG, x: 4, y: 4.05, w: 4, h: 2, rotate: 8, rounding: true, sizing: { type: "crop", x: 0.75, y: 0.25, w: 2, h: 1.1 }, altText: "Cropped rounded rotated JPEG" });
    // Alpha channel over a patterned background: transparent pixels must show the shape behind.
    effects.addShape("rect", { x: 0.75, y: 4.05, w: 2.4, h: 1.2, fill: { color: "5B9BD5" } });
    effects.addShape("rect", { x: 0.75, y: 4.65, w: 2.4, h: 0.6, fill: { color: "FFC000" } });
    effects.addImage({ data: BADGE_PNG, x: 1.35, y: 4.05, w: 1.2, h: 1.2, altText: "Transparent-background PNG" });
    return presentation;
}
