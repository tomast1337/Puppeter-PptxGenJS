// Lines at the wrap limit in boxes whose width inside the insets is off the 1/576 in grid, with the line breaks
// PowerPoint's PDF export of the same synthetic deck gave: "<text> xo" in Arial, left aligned, the box (in EMU, as
// PptxGenJS writes it) between 0.1pt under W and 0.14pt over it, W the line as the PowerPoint target counts it
// (advances rounded to 0.125pt plus its kern pairs, "A " at the break included). PowerPoint keeps the line's last word
// when W is no wider than the box less its insets floored to 0.125pt (target/powerpoint.ts, `wrapWidthGridPt`).
import { type GlyphAdvances, PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import type { PuppeteerGen } from "../packages/pptxgenjs/src/node";

export interface BoxFloorCase {
    readonly fontSize: number;
    readonly text: string;
    /** All four insets, in pt. */
    readonly insetPt: number;
    readonly widthEmu: number;
    readonly label: string;
    /** How far the line is wider than the box less its insets floored to 0.125pt, in pt (negative when it fits). */
    readonly overflowPt: number;
    /** Whether PowerPoint kept the line's last word on the first line ("xo" always wraps). */
    readonly fits: boolean;
}

// The measured deck's boxes in order: size, text, inset (pt), box width (EMU), W (pt), PowerPoint's break.
const BOXES: readonly (readonly [number, string, number, number, number, boolean])[] = [
    [12, "Lorem ipsum AVAVA", 0, 1365419, 107.6133, false],
    [12, "Lorem ipsum AVAVA", 0, 1367214, 107.6133, true],
    [12, "Lorem ipsum AVAVA", 0, 1368035, 107.6133, true],
    [12, "Lorem AVAVA", 0, 919444, 72.3633, true],
    [12, "Lorem AVAVA", 0, 920110, 72.3633, true],
    [12, "Dolor sit AVA", 0, 865889, 68.1445, false],
    [12, "Dolor sit AVA", 0, 866461, 68.1445, false],
    [12, "Lorem ipsum xoxo", 0, 1241743, 97.75, true],
    [12, "Dolor sit amet", 0, 938498, 73.875, true],
    [14, "Lorem ipsum AVAVA", 0, 1594788, 125.6738, false],
    [14, "Lorem ipsum AVAVA", 0, 1596413, 125.6738, false],
    [14, "Lorem ipsum AVAVA", 0, 1597787, 125.6738, true],
    [14, "Lorem AVAVA", 0, 1074095, 84.5488, false],
    [14, "Dolor sit AVA", 0, 1011599, 79.627, false],
    [14, "Dolor sit AVA", 0, 1012399, 79.627, false],
    [14, "Lorem ipsum xoxo", 0, 1448156, 114.0, true],
    [14, "Dolor sit amet", 0, 1094010, 86.125, true],
    [18, "Lorem ipsum AVAVA", 0, 2051938, 161.6699, false],
    [18, "Lorem ipsum AVAVA", 0, 2053564, 161.6699, false],
    [18, "Lorem ipsum AVAVA", 0, 2054072, 161.6699, false],
    [18, "Lorem ipsum AVAVA", 0, 2054987, 161.6699, true],
    [18, "Lorem AVAVA", 0, 1380426, 108.6699, false],
    [18, "Lorem AVAVA", 0, 1380972, 108.6699, false],
    [18, "Lorem ipsum xoxo", 0, 1867256, 147.0, true],
    [18, "Dolor sit amet", 0, 1410056, 111.0, true],
    [24, "Lorem ipsum AVAVA", 0, 2738457, 215.7266, false],
    [24, "Lorem ipsum AVAVA", 0, 2741074, 215.7266, true],
    [24, "Lorem AVAVA", 0, 1841707, 144.9766, true],
    [24, "Lorem AVAVA", 0, 1842215, 144.9766, true],
    [24, "Dolor sit AVA", 0, 1734535, 136.5391, false],
    [24, "Dolor sit AVA", 0, 1734947, 136.5391, false],
    [24, "Lorem ipsum xoxo", 0, 2492731, 196.25, true],
    [24, "Dolor sit amet", 0, 1881543, 148.125, true],
    [12, "Lorem ipsum AVAVA", 7.2, 1550094, 107.6133, true],
    [12, "Lorem ipsum AVAVA", 7.2, 1550634, 107.6133, true],
    [12, "Lorem ipsum xoxo", 7.2, 1424623, 97.75, true],
    [12, "Lorem ipsum xoxo", 7.2, 1425296, 97.75, true],
    [12, "Lorem ipsum xoxo", 1.3, 1274604, 97.75, true],
    [12, "Lorem ipsum xoxo", 1.3, 1274921, 97.75, true],
    [12, "Lorem ipsum xoxo", 1.3, 1275372, 97.75, true],
    [18, "Lorem ipsum AVAVA", 7.2, 2236438, 161.6699, false],
    [18, "Lorem ipsum AVAVA", 7.2, 2236952, 161.6699, false],
    [18, "Lorem ipsum xoxo", 7.2, 2050136, 147.0, true],
    [18, "Lorem ipsum xoxo", 7.2, 2050771, 147.0, true],
    [18, "Lorem ipsum AVAVA", 1.3, 2086648, 161.6699, false],
    [18, "Lorem ipsum AVAVA", 1.3, 2087092, 161.6699, false],
    [18, "Lorem ipsum xoxo", 1.3, 1900079, 147.0, true],
];

/** The measured boxes, or none when `font` (Arial or its twin) does not give the measured deck's line widths. */
export function boxFloorCases(font: GlyphAdvances): BoxFloorCase[] {
    const grid = RENDERING_TARGETS.powerpoint.advanceGridPt ?? Number.NaN;
    const code = (character: string) => character.codePointAt(0) ?? 0;
    const width = (text: string, size: number) =>
        [...text].reduce((sum, character, index) => {
            const next = text[index + 1] ?? " ";
            const kern = ((font.kerning?.get(code(character))?.get(code(next)) ?? 0) * size) / font.unitsPerEm;
            return sum + Math.round(((font.advances.get(code(character)) ?? 0) * size) / font.unitsPerEm / grid) * grid + kern;
        }, 0);
    if (BOXES.some(([size, text, , , linePt]) => Math.abs(width(text, size) - linePt) > 1e-3)) return [];
    return BOXES.map(([fontSize, text, insetPt, widthEmu, linePt, fits]) => {
        const inner = (widthEmu * PPTX_DEFAULTS.units.pointsPerInch) / PPTX_DEFAULTS.units.emuPerInch - 2 * insetPt;
        const slack = inner - linePt;
        const overflowPt = linePt - Math.floor(inner / grid) * grid;
        return { fontSize, text, insetPt, widthEmu, label: `${fontSize}pt "${text}", inset ${insetPt}pt, ${slack >= 0 ? "+" : "-"}${Math.abs(slack).toFixed(4)}pt`, overflowPt, fits };
    });
}

/** Each case in a box of its own slide, Arial, top anchored, as in the measured deck. */
export function boxFloorDeck(presentation: PuppeteerGen, cases: readonly BoxFloorCase[]): PuppeteerGen {
    for (const { fontSize, text, insetPt, widthEmu } of cases) {
        presentation.addSlide().addText(`${text} xo`, { x: 0.25, y: 0.2, w: widthEmu / PPTX_DEFAULTS.units.emuPerInch, h: 1.2, margin: insetPt, valign: "top", fontFace: "Arial", fontSize });
    }
    return presentation;
}
