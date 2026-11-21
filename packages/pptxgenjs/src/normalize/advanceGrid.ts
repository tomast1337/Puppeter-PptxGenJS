// The PowerPoint target's advance grid (RENDERING_TARGETS.advanceGridPt) as letter-spacing on each word of a run.
import { LAYOUT_UNITS_PER_PX, pointsToPixels } from "@pdflapas/model";
import type { GlyphAdvances } from "#src/defaults";

/**
 * A run's letter-spacing in px: `space` on its spaces and tabs, `words[i]` on its i-th word (`runPieces`), and, when
 * one of them is kerned or ends off the grid, `spaces[i]` on its i-th stretch of spaces between words (tabs left out).
 */
export interface WordSpacing {
    readonly space: number;
    readonly words: readonly number[];
    readonly spaces?: readonly number[];
}

/**
 * Where a paragraph's runs have ended so far, px: `rounded` is PowerPoint's width of them, `laidOut` the profile's, on
 * whole LayoutUnits. The paragraph creates one at 0 and each run (`advanceGridWordSpacing`) starts from it and moves it
 * to its own end, so the rounding carries across run boundaries instead of starting again at each. `word` is the
 * letter-spacing of a word that goes on into the next run, which its first piece takes; the sums already end with it.
 */
export interface GridCursor {
    rounded: number;
    laidOut: number;
    word?: number | undefined;
}

/** Whether `piece` (`runPieces`) is a stretch of spaces, which `WordSpacing.spaces` spaces: no word, no tab. */
export function isSpaces(piece: string): boolean {
    return piece.startsWith(" ") && !piece.includes("\t");
}

/** A word of a run's text (`NormalizedTextRun.wordCharacterSpacing`), or the spaces and tabs between two words. */
const PIECE = /[^ \t]+|[ \t]+/g;
/** The first space or tab of a text, where a word that crosses into it ends. */
const WORD_END = /[ \t]/;
/** A LayoutUnit, the grid the profile's line breaker rounds each piece's width up to (docs/HTML_PROFILE.md). */
const LAYOUT_UNIT = 1 / LAYOUT_UNITS_PER_PX;
/**
 * How far below its LayoutUnit width each piece is laid out, so the round-up lands on it through Chromium's float
 * advances and at the print zoom's 1/8 LayoutUnit: 1/16 LayoutUnit.
 */
const UNDER_LAYOUT_UNIT = LAYOUT_UNIT / 16;
/** Float noise in a width that is a whole number of LayoutUnits, kept from flooring a whole one away. */
const FLOAT_NOISE = 1e-9;
/**
 * How far past a grid step, px, a width is off the grid: under any kern pair (one font unit at 1pt is 6.5e-4 px) or
 * charSpacing (1/100 pt), over the float noise of a sum of steps.
 */
const OFF_GRID = 1e-6;
/**
 * How far past its floored grid step, on whole LayoutUnits, a word ends whose rounded end is past the step: the fit
 * tests floor the width to a LayoutUnit and keep one more (`break_lines`, `CanFitOnLine`), so two put it past both.
 */
const PAST_STEP = 2 * LAYOUT_UNIT;
/** How far past its floored grid step a line starts after spaces that end past the step: a LayoutUnit past PAST_STEP. */
const START_PAST_STEP = PAST_STEP + LAYOUT_UNIT;
/** A character the East Asian faces a run falls back to draw 1em wide: Han, kana, Hangul, CJK and full-width punctuation. */
const FULL_WIDTH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\ufe30-\ufe4f\uff00-\uff60]/u;
/** The letter-spacing's precision, px: 1e-6 px over a word's characters stays far below UNDER_LAYOUT_UNIT and keeps the HTML short. */
const SPACING_DIGITS = 1e6;

/** The break markers the PowerPoint target writes (normalize/eastAsianLineBreak.ts): no advance, no side of their own. */
const BREAK_MARKER = /[​⁠]/u;

/** Whether `character` is FULL_WIDTH and `font` does not map it, so a fallback face draws it 1em wide. */
function fallsBackFullWidth(character: string, font: GlyphAdvances): boolean {
    return FULL_WIDTH.test(character) && !font.advances.has(character.codePointAt(0) ?? 0);
}

/** Whether the last character of `left` that is not a break marker and the first of `right` both fall back full-width, or neither does. */
function sameWidthEdge(left: readonly string[], right: readonly string[], font: GlyphAdvances): boolean {
    const visible = (characters: readonly string[]) => characters.filter(character => !BREAK_MARKER.test(character));

    return fallsBackFullWidth(visible(left).at(-1) ?? "", font) === fallsBackFullWidth(visible(right)[0] ?? "", font);
}

/**
 * `text` cut where it goes from characters a fallback face draws 1em wide (FULL_WIDTH, not in `font`) to others and
 * back, each stretch for a run of its own; a break marker stays with the stretch before it. A word spreads its
 * letter-spacing evenly (`advanceGridWordSpacing`), so a line that breaks inside a word, as between Han and Latin
 * text, ended past PowerPoint's end by the rounding of the Latin characters after the break.
 */
export function fullWidthStretches(text: string, font: GlyphAdvances): string[] {
    const stretches: string[] = [];
    let wide: boolean | undefined;

    for (const character of text) {
        const kind = BREAK_MARKER.test(character) ? wide : fallsBackFullWidth(character, font);

        if (stretches.length === 0 || (wide !== undefined && kind !== wide)) {
            stretches.push(character);
        } else {
            stretches[stretches.length - 1] += character;
        }

        wide = kind ?? wide;
    }

    // An empty run stays one run: it is an empty paragraph's line, whose height the paragraph keeps.
    return stretches.length ? stretches : [text];
}

/** `text` as its words and the spaces and tabs between them, in order. */
export function runPieces(text: string): string[] {
    return text.match(PIECE) ?? [];
}

export function isWord(piece: string): boolean {
    return !piece.startsWith(" ") && !piece.startsWith("\t");
}

/** `text` up to its first space or tab included: all `advanceGridWordSpacing` reads of the text after a run. */
export function wordAfter(text: string): string {
    const end = text.search(WORD_END);

    return end < 0 ? text : text.slice(0, end + 1);
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
 * most one before its rounded end, so it is never wider than PowerPoint's (save the step below), and at most 3/64 px
 * narrower against PowerPoint's 0.125pt (1/6 px) step. A tab starts the sums again, from its tab stop.
 * A kern pair or a charSpacing off the grid moves a line's rounded end off the grid too, and the box's width is on it
 * (`wrapWidthGridPt`), so PowerPoint wraps a line that ends past a step by 0.002pt where the floored end, a LayoutUnit
 * (0.0117pt) short of it, fits (#341). A word whose rounded end is off the grid so ends at least PAST_STEP past its
 * floored step, and the spaces before a word that starts off the grid end at least START_PAST_STEP past theirs: a line
 * that starts on the grid, as every paragraph's first line does, then wraps as PowerPoint's does, and a line is still
 * never laid out wider than the narrowest box on the grid PowerPoint keeps it in.
 * shortcut: a line that starts off the grid wraps as PowerPoint's only when its end is a LayoutUnit or more further
 * off the grid than its start (PowerPoint compares the two unrounded; 1/64 px orders no finer); measured lines start
 * on it. Lay lines out finer than a LayoutUnit if a deck shows one (#395).
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
 * `after` is the text of the next runs that PowerPoint kerns with this one (same face, size, weight and style, kerned),
 * up to `wordAfter`. A pair across the run edge is kerned like one inside the run, on its left character's piece (#398).
 * A word that goes on into `after` is laid out as one word: each of its characters, in this run and the next, takes one
 * letter-spacing (`cursor.word`), so Chromium, whose font includes the letter-spacing, shapes it across the spans and
 * kerns the pair at their edge. With the sums floored at each run's end instead, the spans' letter-spacings differed
 * by a LayoutUnit, and the pair, counted in neither sum, went unkerned. A word does not go on from Han or full-width
 * marks into other characters or back (`fullWidthStretches`), nor into a mark that hangs (normalize/text.ts).
 * shortcut: a break inside a word (after a hyphen, or between Han characters, also at a run boundary) sees the word's
 * spacing spread evenly, its start up to a LayoutUnit before PowerPoint's; spread it by character when a deck shows
 * the difference.
 * shortcut: FreeType sets Chromium's font size in 1/64 device px, truncated, so at the print zoom (8) its advances are
 * up to 1/(512 x size px) narrower than the font's (8pt: 0.044 px over a 720 px line, against the 1/6 px step); the
 * WASM renderer uses the exact size. Size the words for that truncation if a tie between steps flips in Chromium.
 */
export function advanceGridWordSpacing(text: string, sizePt: number, font: GlyphAdvances | undefined, gridPt: number | undefined, charSpacingPt: number, kerned: boolean, cursor: GridCursor = { rounded: 0, laidOut: 0 }, after = ""): WordSpacing | undefined {
    const spaceAdvance = font?.advances.get(" ".codePointAt(0) ?? 0);
    const continued = cursor.word;

    cursor.word = undefined;
    if (gridPt === undefined || font === undefined || spaceAdvance === undefined) {
        cursor.rounded = 0;
        cursor.laidOut = 0;

        return undefined;
    }

    const sizePx = pointsToPixels(sizePt);
    const gridPx = pointsToPixels(gridPt);
    const charSpacing = pointsToPixels(charSpacingPt);
    // The grid step at or below `width`, floored to a LayoutUnit, when `width` is off the grid; undefined on it.
    const offStep = (width: number) => {
        const step = Math.floor(width / gridPx + FLOAT_NOISE) * gridPx;

        return width - step > OFF_GRID ? floorLayoutUnit(step) : undefined;
    };
    // Natural and rounded advance of a character, px; one the font does not map is 1em when FULL_WIDTH (its fallback
    // face draws it so), else neither widened nor narrowed.
    const advance = (character: string) => {
        const units = font.advances.get(character.codePointAt(0) ?? 0);
        const natural = units === undefined ? (FULL_WIDTH.test(character) ? sizePt : 0) : (units * sizePt) / font.unitsPerEm;

        return { natural: pointsToPixels(natural), rounded: Math.round(natural / gridPt) * gridPx };
    };
    // Pair kerning of `left` then `right` in px, unrounded; none unkerned, or without a character on either side.
    const kern = (left: string | undefined, right: string | undefined) => {
        if (!kerned || left === undefined || right === undefined) {
            return 0;
        }

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
    let ownSpaces = false;
    const pieces = runPieces(text).map(piece => [...piece]);
    const following = runPieces(after).map(piece => [...piece]);
    // A word does not go on from characters a fallback face draws 1em wide to others or back: see fullWidthStretches.
    const goesOn = following[0] !== undefined && isWord(following[0].join("")) && sameWidthEdge(pieces.at(-1) ?? [], following[0], font);

    for (const [index, piece] of pieces.entries()) {
        const last = index === pieces.length - 1;

        if (piece.includes("\t")) {
            rounded = 0;
            laidOut = 0;
            continue;
        }

        if (index === 0 && continued !== undefined && isWord(piece.join(""))) {
            // The rest of a word an earlier run started: the sums already end with it.
            words.push(continued);
            if (last && goesOn) {
                cursor.word = continued;
            }

            continue;
        }

        const joins = last && goesOn && isWord(piece.join(""));
        const characters = joins ? [...piece, ...(following[0] ?? [])] : piece;
        // The pairs whose left character is in the piece: PowerPoint kerns a pair on its left glyph's advance.
        const inner = characters.reduce((sum, character, at) => sum + kern(characters[at - 1], character), 0);
        const next = last ? following[joins ? 1 : 0] : pieces[index + 1];
        const edge = next === undefined || next.includes("\t") ? 0 : kern(characters.at(-1), next[0]);

        if (characters[0] === " ") {
            const width = characters.length * (space.rounded + charSpacing);

            rounded += width + inner + edge;
            const pair = inner + edge !== 0;
            // Kerned, its own span: one LayoutUnit wider than its kerned width, rounded up, as an unkerned space is.
            const own = pair ? ceilLayoutUnit(width + inner + edge) + LAYOUT_UNIT : ceilLayoutUnit(characters.length * (spaceWidth - UNDER_LAYOUT_UNIT));
            const step = offStep(rounded);
            const stretch = step === undefined ? own : Math.max(own, step + START_PAST_STEP - laidOut);

            if (!pair && stretch === own) {
                spaces.push(spacing(spaceSpacing));
            } else {
                spaces.push(spacing((stretch - UNDER_LAYOUT_UNIT - characters.length * space.natural) / characters.length));
                ownSpaces = true;
            }

            laidOut += stretch;
        } else {
            // The renderers kern the word's inner pairs themselves, and no pair across its span's edge.
            const advances = characters.map(advance);
            const natural = inner + advances.reduce((sum, { natural }) => sum + natural, 0);

            rounded += inner + edge + advances.reduce((sum, { rounded }) => sum + rounded + charSpacing, 0);
            const step = offStep(rounded);
            const end = step === undefined ? floorLayoutUnit(rounded) : Math.max(floorLayoutUnit(rounded), step + PAST_STEP);
            const wordSpacing = spacing((end - laidOut - UNDER_LAYOUT_UNIT - natural) / characters.length);

            words.push(wordSpacing);
            if (joins) {
                cursor.word = wordSpacing;
            }

            laidOut = end;
        }
    }

    cursor.rounded = rounded;
    cursor.laidOut = laidOut;

    return { space: spacing(spaceSpacing), words, ...(ownSpaces ? { spaces } : {}) };
}
