// The PowerPoint target's advance grid (RENDERING_TARGETS.advanceGridPt) as letter-spacing on each word of a run.
import { LAYOUT_UNITS_PER_PX, pointsToPixels } from "@pdflapas/model";
import type { GlyphAdvances } from "#src/defaults";

/**
 * A run's letter-spacing in px: `space` on its spaces and tabs, `words[i]` on its i-th word (`runPieces`), and, when
 * a kern pair starts in one of them, `spaces[i]` on its i-th stretch of spaces between words (tabs left out).
 */
export interface WordSpacing {
    readonly space: number;
    readonly words: readonly number[];
    readonly spaces?: readonly number[];
}

/**
 * Where a paragraph's runs have ended so far, px: `rounded` is PowerPoint's width of them, `laidOut` the profile's, on
 * whole LayoutUnits. The paragraph creates one at 0 and each run (`advanceGridWordSpacing`) starts from it and moves it
 * to its own end, so the rounding carries across run boundaries instead of starting again at each.
 */
export interface GridCursor {
    rounded: number;
    laidOut: number;
}

/** Whether `piece` (`runPieces`) is a stretch of spaces, which `WordSpacing.spaces` spaces: no word, no tab. */
export function isSpaces(piece: string): boolean {
    return piece.startsWith(" ") && !piece.includes("\t");
}

/** A word of a run's text (`NormalizedTextRun.wordCharacterSpacing`), or the spaces and tabs between two words. */
const PIECE = /[^ \t]+|[ \t]+/g;
/** A LayoutUnit, the grid the profile's line breaker rounds each piece's width up to (docs/HTML_PROFILE.md). */
const LAYOUT_UNIT = 1 / LAYOUT_UNITS_PER_PX;
/**
 * How far below its LayoutUnit width each piece is laid out, so the round-up lands on it through Chromium's float
 * advances and at the print zoom's 1/8 LayoutUnit: 1/16 LayoutUnit.
 */
const UNDER_LAYOUT_UNIT = LAYOUT_UNIT / 16;
/** Float noise in a width that is a whole number of LayoutUnits, kept from flooring a whole one away. */
const FLOAT_NOISE = 1e-9;
/** The letter-spacing's precision, px: 1e-6 px over a word's characters stays far below UNDER_LAYOUT_UNIT and keeps the HTML short. */
const SPACING_DIGITS = 1e6;

/** `text` as its words and the spaces and tabs between them, in order. */
export function runPieces(text: string): string[] {
    return text.match(PIECE) ?? [];
}

export function isWord(piece: string): boolean {
    return !piece.startsWith(" ") && !piece.startsWith("\t");
}

const floorLayoutUnit = (width: number) => Math.floor(width * LAYOUT_UNITS_PER_PX + FLOAT_NOISE) / LAYOUT_UNITS_PER_PX;
const ceilLayoutUnit = (width: number) => Math.ceil(width * LAYOUT_UNITS_PER_PX - FLOAT_NOISE) / LAYOUT_UNITS_PER_PX;
const spacing = (value: number) => Math.round(value * SPACING_DIGITS) / SPACING_DIGITS;

/**
 * The letter-spacing that lays each word of `text` out as wide as PowerPoint does, `charSpacingPt` included: each
 * advance at `sizePt` rounded to the nearest `gridPt`, plus, when `kerned`, the font's pair kerning, unrounded. Undefined
 * without a grid or a font, or for a font without a space, which keeps the natural advances.
 *
 * A line fits in PowerPoint while the sum of its rounded advances, without its trailing spaces, is no wider than the
 * box (zero tolerance). The profile's line breaker rounds each piece of a line (a word span, or the spaces between)
 * up to a LayoutUnit, 1/64 px, and keeps it on the line while the sum is within the box plus one LayoutUnit
 * (crates/pdf-core/src/text/layout.rs `break_lines`, Blink's `LineBreaker::CanFitOnLine`). So each word ends where
 * the run's rounded advances do, floored to a LayoutUnit: the word takes whatever its predecessors' rounding left
 * over, and no error builds up along the run. Every space takes one LayoutUnit more than its rounded advance, rounded
 * up, which the next word gives back: a line then starts at most two LayoutUnits past its rounded start and ends at
 * most one before its rounded end, so it is never wider than PowerPoint's, and at most 3/64 px narrower against
 * PowerPoint's 0.125pt (1/6 px) step. A tab starts the sums again, from its tab stop.
 * Kerned, PowerPoint kerns each pair on its left glyph's advance, so a pair whose left glyph is the space before a
 * break leaves the line's width with that space, and one whose left glyph ends the line stays in it (target/
 * powerpoint.ts). The renderers kern each pair inside a word span themselves, so a word's inner pairs count in its
 * natural width as in PowerPoint's; a pair across a span's edge, such as Arial's "A " and " T", they leave out (the
 * span ends a shaping run, and Blink shapes each space on its own), so it goes to the piece of its left character: the
 * word's letter-spacing takes "A ", and the spaces before " T" take it in a span of their own (`spaces`).
 * Kerning is the `kern` table's (GlyphAdvances.kerning), the only one PowerPoint reads; a face without `kern` pairs is
 * drawn unkerned (`font-kerning: none`, normalize/text.ts `kerned`), so GPOS adds nothing to it.
 * shortcut: in a face with both tables the renderers kern a word's inner pairs from GPOS, so a pair GPOS kerns otherwise
 * than the `kern` table, or that only GPOS kerns, moves the word's end by the difference (none does in Latin text in
 * Liberation Sans or Serif); turn the renderer's kerning off and spread the `kern` pairs as letter-spacing when a deck
 * shows one.
 * The sums run on across the runs of a paragraph through `cursor`: started again at each run, they added up to a
 * LayoutUnit per run boundary on a line, enough for pdf-core to break a line of SimSun and Arial runs that fills its
 * box to 0.01pt one character early (#370). A run without a grid or font sets `cursor` back to 0, as a tab and a
 * soft break do.
 * shortcut: a break inside a word (after a hyphen, or between Han characters, also at a run boundary) sees the word's
 * spacing spread evenly, its start up to a LayoutUnit before PowerPoint's; spread it by character when a deck shows
 * the difference.
 * shortcut: FreeType sets Chromium's font size in 1/64 device px, truncated, so at the print zoom (8) its advances are
 * up to 1/(512 x size px) narrower than the font's (8pt: 0.044 px over a 720 px line, against the 1/6 px step); the
 * WASM renderer uses the exact size. Size the words for that truncation if a tie between steps flips in Chromium.
 */
export function advanceGridWordSpacing(text: string, sizePt: number, font: GlyphAdvances | undefined, gridPt: number | undefined, charSpacingPt: number, kerned: boolean, cursor: GridCursor = { rounded: 0, laidOut: 0 }): WordSpacing | undefined {
    const spaceAdvance = font?.advances.get(" ".codePointAt(0) ?? 0);
    if (gridPt === undefined || font === undefined || spaceAdvance === undefined) {
        cursor.rounded = 0;
        cursor.laidOut = 0;
        return undefined;
    }
    const sizePx = pointsToPixels(sizePt);
    const gridPx = pointsToPixels(gridPt);
    const charSpacing = pointsToPixels(charSpacingPt);
    // Natural and rounded advance of a character, px; one the font does not map is neither widened nor narrowed.
    const advance = (character: string) => {
        const units = font.advances.get(character.codePointAt(0) ?? 0) ?? 0;
        const natural = (units * sizePt) / font.unitsPerEm;
        return { natural: pointsToPixels(natural), rounded: Math.round(natural / gridPt) * gridPx };
    };
    // Pair kerning of `left` then `right` in px, unrounded; none unkerned, or without a character on either side.
    const kern = (left: string | undefined, right: string | undefined) => {
        if (!kerned || left === undefined || right === undefined) return 0;
        const units = font.kerning?.get(left.codePointAt(0) ?? 0)?.get(right.codePointAt(0) ?? 0) ?? 0;
        return pointsToPixels((units * sizePt) / font.unitsPerEm);
    };
    const space = advance(" ");
    // Each space is laid out one LayoutUnit wider than its rounded advance, rounded up, and a little under that.
    const spaceWidth = ceilLayoutUnit(space.rounded + charSpacing) + LAYOUT_UNIT;
    const spaceSpacing = spaceWidth - UNDER_LAYOUT_UNIT - space.natural;
    const words: number[] = [];
    // `rounded`: PowerPoint's width of the paragraph so far; `laidOut`: the profile's, on whole LayoutUnits.
    let { rounded, laidOut } = cursor;
    const spaces: number[] = [];
    let kernedSpace = false;
    const pieces = runPieces(text).map(piece => [...piece]);
    for (const [index, characters] of pieces.entries()) {
        if (characters.includes("\t")) {
            rounded = 0;
            laidOut = 0;
            continue;
        }
        // The pairs whose left character is in the piece: PowerPoint kerns a pair on its left glyph's advance.
        const inner = characters.reduce((sum, character, at) => sum + kern(characters[at - 1], character), 0);
        const next = pieces[index + 1];
        const edge = next === undefined || next.includes("\t") ? 0 : kern(characters.at(-1), next[0]);
        if (characters[0] === " ") {
            const width = characters.length * (space.rounded + charSpacing);
            rounded += width + inner + edge;
            if (inner + edge === 0) {
                spaces.push(spacing(spaceSpacing));
                laidOut += ceilLayoutUnit(characters.length * (spaceWidth - UNDER_LAYOUT_UNIT));
            } else {
                // Its own span: one LayoutUnit wider than its kerned width, rounded up, as an unkerned space is.
                const kernedWidth = ceilLayoutUnit(width + inner + edge) + LAYOUT_UNIT;
                spaces.push(spacing((kernedWidth - UNDER_LAYOUT_UNIT - characters.length * space.natural) / characters.length));
                laidOut += kernedWidth;
                kernedSpace = true;
            }
        } else {
            // The renderers kern the word's inner pairs themselves, and no pair across its span's edge.
            const advances = characters.map(advance);
            const natural = inner + advances.reduce((sum, { natural }) => sum + natural, 0);
            rounded += inner + edge + advances.reduce((sum, { rounded }) => sum + rounded + charSpacing, 0);
            const end = floorLayoutUnit(rounded);
            words.push(spacing((end - laidOut - UNDER_LAYOUT_UNIT - natural) / characters.length));
            laidOut = end;
        }
    }
    cursor.rounded = rounded;
    cursor.laidOut = laidOut;
    return { space: spacing(spaceSpacing), words, ...(kernedSpace ? { spaces } : {}) };
}
