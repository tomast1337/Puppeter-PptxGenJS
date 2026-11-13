// Effects deck: drop shadows of shapes, lines, text boxes and pictures, and text glow, the
// blurred effects the WASM backend draws as rasters (crates/pdf-core/src/effect/). The shared
// fixture has one shadowed shape, text box and picture each and one glowing run; this deck covers
// what decides the silhouette: fill, stroke only, dashes, glyphs of a box without fill, rounding,
// rotation (PptxGenJS writes rotWithShape="0"), the defaults, and glow over a fill and in colour.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../../packages/pptxgenjs/src/node";

export const EFFECT_PAGES = 2;

const SAMPLE_PNG = `data:image/png;base64,${readFileSync(join(import.meta.dir, "images", "sample.png")).toString("base64")}`;

// Spread per call: PptxGenJS mutates the options objects it is given (shadows included).
const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;
const soft = { type: "outer", color: "000000", opacity: 0.4, blur: 4, offset: 4, angle: 45 } as const;

export function populateEffectDeck<T extends PptxGenJS | PuppeteerGen>(presentation: T): T {
    const shadows = presentation.addSlide() as PptxGenJS.Slide;
    shadows.addText("Drop shadows", { ...title });
    // Unset blur, offset, angle and opacity: PptxGenJS writes 8pt, 4pt, 270 degrees (up), 75%.
    shadows.addShape("rect", { x: 0.6, y: 1.1, w: 2, h: 1.2, fill: { color: "E2F0D9" }, line: { color: "70AD47", width: 1 }, shadow: { type: "outer" } });
    // No fill: only the stroke casts a shadow.
    shadows.addShape("ellipse", { x: 3.2, y: 1, w: 1.6, h: 1.4, line: { color: "4472C4", width: 4 }, shadow: { ...soft, color: "C00000", opacity: 0.6 } });
    // The offset stays in slide space when the shape turns.
    shadows.addShape("rect", { x: 5.6, y: 1.1, w: 1.6, h: 1.1, rotate: 30, fill: { color: "FFC000" }, shadow: { ...soft, angle: 90, offset: 6 } });
    shadows.addShape("line", { x: 7.8, y: 1.2, w: 1.6, h: 1, line: { color: "7030A0", width: 3, dashType: "dash" }, shadow: { ...soft } });
    // A text box without fill casts the shadow of its glyphs.
    shadows.addText("Glyph shadow", { x: 0.6, y: 3, w: 3.4, h: 0.9, fontFace: "Arial", fontSize: 30, bold: true, color: "2F5597", align: "center", margin: 0, shadow: { ...soft, blur: 3, offset: 3 } });
    shadows.addImage({ data: SAMPLE_PNG, x: 4.6, y: 2.9, w: 2, h: 1.5, rounding: true, shadow: { ...soft, blur: 6 } });
    shadows.addImage({ data: SAMPLE_PNG, x: 7.2, y: 3, w: 2.2, h: 1.1, transparency: 50, shadow: { ...soft, opacity: 0.8 } });

    const glow = presentation.addSlide() as PptxGenJS.Slide;
    glow.addText("Text glow", { ...title });
    glow.addText([{ text: "Golden glow", options: { glow: { size: 8, opacity: 0.6, color: "FFC000" } } }], { x: 0.6, y: 1.1, w: 4.2, h: 1, fontFace: "Arial", fontSize: 36, bold: true, color: "17365D", align: "center", margin: 0 });
    glow.addText([{ text: "Over a fill", options: { glow: { size: 5, opacity: 0.9, color: "FFFFFF" } } }], {
        x: 5.2,
        y: 1.1,
        w: 4.2,
        h: 1,
        fontFace: "Arial",
        fontSize: 30,
        color: "C00000",
        align: "center",
        fill: { color: "5B9BD5" },
        margin: 0,
    });
    glow.addText([{ text: "Rotated", options: { glow: { size: 12, opacity: 0.5, color: "00B050" } } }], { x: 0.8, y: 2.9, w: 3.6, h: 1.2, rotate: -10, fontFace: "Arial", fontSize: 40, color: "000000", align: "center", margin: 0 });
    glow.addText([{ text: "Small glow", options: { glow: { size: 3, opacity: 0.75, color: "7030A0" } } }], { x: 5.2, y: 3.1, w: 4.2, h: 0.8, fontFace: "Arial", fontSize: 24, color: "FFFFFF", align: "center", margin: 0 });
    return presentation;
}
