// Kerned Arial lines at the wrap limit, with the line breaks PowerPoint's PDF export of the same synthetic deck gave:
// "Lorem ipsum AVAVA" then " xo" or " To", in a box sized from W, the line's advances rounded to 0.125pt plus its
// pairs unrounded (" A" included), and the pairs at the break, "A " (on the line's last glyph) and " T" (on the space).
// PowerPoint counts "A " in the line and leaves " T" out with the space, against the box floored to 0.125pt
// (target/powerpoint.ts): 18pt "xo", W + "A " + 0.05pt, wraps in a box 161.7199pt wide, which is 161.625pt floored.
import { type GlyphAdvances, PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import type { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const FIRST_LINE = "Lorem ipsum AVAVA";
/** W at 12 and 18pt in the measured deck (Arial's advances and kern table): a font giving others is not Arial's twin. */
const MEASURED_WIDTH_PT: Readonly<Record<number, number>> = { 12: 108.2754, 18: 162.6631 };

export interface KernWrapCase {
    readonly fontSize: 12 | 18;
    readonly next: "xo" | "To";
    /** The box, as the measured deck wrote it: W, plus "A " and " T" when named, plus `offsetPt`. */
    readonly label: string;
    readonly widthPt: number;
    /** Whether PowerPoint kept "AVAVA" on the first line. */
    readonly fits: boolean;
}

// The measured deck's boxes in order, each with PowerPoint's break.
const BOXES: readonly { fontSize: 12 | 18; next: "xo" | "To"; pairs: readonly string[]; offsetPt: number; fits: boolean }[] = [
    { fontSize: 12, next: "xo", pairs: [], offsetPt: 0.05, fits: true },
    { fontSize: 12, next: "xo", pairs: [], offsetPt: -0.05, fits: true },
    { fontSize: 12, next: "xo", pairs: [], offsetPt: -0.6, fits: true },
    { fontSize: 12, next: "xo", pairs: [], offsetPt: -0.7, fits: false },
    { fontSize: 12, next: "To", pairs: ["A "], offsetPt: -0.1, fits: false },
    { fontSize: 12, next: "To", pairs: ["A ", " T"], offsetPt: -0.05, fits: false },
    { fontSize: 18, next: "xo", pairs: [], offsetPt: 0.05, fits: true },
    { fontSize: 18, next: "xo", pairs: [], offsetPt: -0.05, fits: true },
    { fontSize: 18, next: "xo", pairs: ["A "], offsetPt: 0.05, fits: false },
    { fontSize: 18, next: "xo", pairs: ["A "], offsetPt: -0.1, fits: false },
    { fontSize: 18, next: "To", pairs: ["A "], offsetPt: -0.1, fits: false },
    { fontSize: 18, next: "To", pairs: ["A ", " T"], offsetPt: -0.05, fits: false },
];

/** The measured boxes, or none when `font` (Arial or its twin) does not give the measured deck's widths. */
export function kernWrapCases(font: GlyphAdvances): KernWrapCase[] {
    const grid = RENDERING_TARGETS.powerpoint.advanceGridPt ?? Number.NaN;
    const code = (character: string) => character.codePointAt(0) ?? 0;
    const kern = (pair: string, size: number) => ((font.kerning?.get(code(pair[0] ?? ""))?.get(code(pair[1] ?? "")) ?? 0) * size) / font.unitsPerEm;
    const width = (size: number) => [...FIRST_LINE].reduce((sum, character, index) => sum + Math.round(((font.advances.get(code(character)) ?? 0) * size) / font.unitsPerEm / grid) * grid + kern(FIRST_LINE.slice(index, index + 2), size), 0);
    if ([12, 18].some(size => Math.abs(width(size) - (MEASURED_WIDTH_PT[size] ?? 0)) > 1e-3)) return [];
    return BOXES.map(({ fontSize, next, pairs, offsetPt, fits }) => {
        const pairWidth = pairs.reduce((sum, pair) => sum + kern(pair, fontSize), 0);
        const label = `${fontSize}pt ${next}: W${pairs.map(pair => ` + "${pair}"`).join("")} ${offsetPt >= 0 ? "+" : "-"} ${Math.abs(offsetPt)}pt`;
        return { fontSize, next, label, widthPt: width(fontSize) + pairWidth + offsetPt, fits };
    });
}

/** Each case in a box of its own on one slide, Arial, margin 0, top anchored, as in the measured deck. */
export function kernWrapDeck(presentation: PuppeteerGen, cases: readonly KernWrapCase[]): PuppeteerGen {
    const slide = presentation.addSlide();
    cases.forEach(({ fontSize, next, widthPt }, index) => {
        slide.addText(`${FIRST_LINE} ${next}`, { x: 0.2 + (index % 2) * 4.8, y: 0.2 + Math.floor(index / 2) * 0.85, w: widthPt / PPTX_DEFAULTS.units.pointsPerInch, h: 0.8, margin: 0, valign: "top", fontFace: "Arial", fontSize });
    });
    return presentation;
}
