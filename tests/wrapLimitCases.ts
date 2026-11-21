// Synthetic paragraphs whose last line is exactly as wide as its box on the PowerPoint target, 0.125pt narrower or
// 0.125pt wider, by the sum of the glyph advances rounded to 0.125pt (RENDERING_TARGETS.powerpoint.advanceGridPt):
// PowerPoint keeps the line in the first two and wraps its last word in the third, measured against its PDF export.
import { type GlyphAdvances, PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import type { PuppeteerGen } from "../packages/pptxgenjs/src/node";

const GRID = powerPointGrid();

function powerPointGrid(): number {
    const grid = RENDERING_TARGETS.powerpoint.advanceGridPt;

    if (grid === undefined) {
        throw new Error("The PowerPoint target has no advance grid (advanceGridPt in target/powerpoint.ts).");
    }

    return grid;
}
/** The text area's width, 7.5 in: a whole number of grid steps and of EMU, so "exactly as wide" is exact in the PPTX too. */
export const WRAP_LIMIT_WIDTH_PT = 540;
const VOCABULARY = "lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod tempor incididunt labore dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat".split(" ");
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** Lines before the last end this many steps (5pt) inside the box: wider than no word, so their breaks are certain. */
const SLACK_STEPS = 40;
/** The last word fills the line from this many steps (20 to 40pt) left, so a filler word of that width exists. */
const FILLER_STEPS = { min: 160, max: 320 };

export interface WrapLimitCase {
    readonly fontSize: number;
    readonly bold: boolean;
    /** Lines when the last one fits. */
    readonly lines: number;
    /** The last line's rounded width minus the box's, in grid steps: -1, 0 (both fit) or 1 (wraps). */
    readonly steps: -1 | 0 | 1;
    readonly text: string;
    /** Lines PowerPoint draws: one more when the last line is wider than the box. */
    readonly expectedLines: number;
}

/** The width of `text` in grid steps, each advance rounded to the grid. */
function steps(text: string, fontSize: number, font: GlyphAdvances): number {
    return [...text].reduce((sum, character) => sum + Math.round(((font.advances.get(character.codePointAt(0) ?? 0) ?? 0) * fontSize) / font.unitsPerEm / GRID), 0);
}

/** The shortest word of LETTERS exactly `target` steps wide. */
function filler(target: number, width: (text: string) => number): string {
    const shortest: (string | undefined)[] = [""];

    for (let total = 1; total <= target; total++) {
        for (const letter of LETTERS) {
            const before = shortest[total - width(letter)];
            const current = shortest[total];

            if (before !== undefined && (current === undefined || before.length + 1 < current.length)) {
                shortest[total] = `${before}${letter}`;
            }
        }
    }

    const word = shortest[target];

    if (!word) {
        throw new Error(`no word of ${LETTERS} is ${target} grid steps wide`);
    }

    return word;
}

/** Words from VOCABULARY[first] on, then a filler word, whose rounded width with the spaces between is `target` steps. */
function line(target: number, first: number, width: (text: string) => number): string[] {
    const space = width(" ");
    const words: string[] = [];
    let used = -space;

    for (let index = first; ; index++) {
        const left = target - used - space;

        if (left <= FILLER_STEPS.max) {
            return [...words, filler(left, width)];
        }

        const word = VOCABULARY[index % VOCABULARY.length] ?? "";

        if (left - width(word) - space < FILLER_STEPS.min) {
            continue;
        }

        words.push(word);
        used += space + width(word);
    }
}

/** One paragraph per font size, weight, line count and step: one long run, its last line at the box's width. */
export function wrapLimitCases(advances: (bold: boolean) => GlyphAdvances): WrapLimitCase[] {
    const full = WRAP_LIMIT_WIDTH_PT / GRID;

    return [7, 8, 8.5, 10].flatMap(fontSize =>
        [false, true].flatMap(bold => {
            const width = (text: string) => steps(text, fontSize, advances(bold));

            return [1, 2, 3].flatMap(lines =>
                ([-1, 0, 1] as const).map(step => {
                    const text = Array.from({ length: lines }, (_, index) => line(index === lines - 1 ? full + step : full - SLACK_STEPS, 7 * index, width))
                        .flat()
                        .join(" ");

                    return { fontSize, bold, lines, steps: step, text, expectedLines: lines + (step > 0 ? 1 : 0) };
                }),
            );
        }),
    );
}

/** Each case on a slide of its own, in Arial, margin 0, in a text area WRAP_LIMIT_WIDTH_PT wide. */
export function wrapLimitDeck(presentation: PuppeteerGen, cases: readonly WrapLimitCase[]): PuppeteerGen {
    presentation.defineLayout({ name: "WRAP_LIMIT", width: 8, height: 2 });
    presentation.layout = "WRAP_LIMIT";
    for (const { text, fontSize, bold } of cases) {
        presentation.addSlide().addText(text, { x: 0.25, y: 0.1, w: WRAP_LIMIT_WIDTH_PT / PPTX_DEFAULTS.units.pointsPerInch, h: 1.8, fontFace: "Arial", fontSize, bold, margin: 0, valign: "top" });
    }

    return presentation;
}
