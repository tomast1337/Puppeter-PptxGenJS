// The PowerPoint target's advance grid (RENDERING_TARGETS.advanceGridPt) as letter-spacing on a run.
import type { GlyphAdvances } from "#src/defaults";

/**
 * The letter-spacing, in points per character, that brings `text` drawn with its natural advances at `sizePt` to its
 * width with each advance rounded to the nearest `gridPt`: the sum of (rounded - natural) over its characters, spread
 * evenly. A character `font` does not map adds nothing to the sum. 0 without a grid, a font or a character.
 * shortcut: one value per run, so a word start inside a run is off the grid by the partial sums: in Chromium's PDF of
 * 700pt Arial and Calibri lines (8-12pt, regular and bold) up to 0.2-0.5pt, sd 0.1, against 0.05pt with a run per word,
 * which made the HTML 10x larger; the run's end is exact. Give the profile a per-word spacing if wraps inside long
 * runs still flip.
 */
export function advanceGridSpacing(text: string, sizePt: number, font: GlyphAdvances | undefined, gridPt: number | undefined): number {
    if (gridPt === undefined || font === undefined) return 0;
    let characters = 0;
    let rounding = 0;
    for (const character of text) {
        characters++;
        const advance = font.advances.get(character.codePointAt(0) ?? 0);
        if (advance === undefined) continue;
        const natural = (advance * sizePt) / font.unitsPerEm;
        rounding += Math.round(natural / gridPt) * gridPt - natural;
    }
    return characters === 0 ? 0 : rounding / characters;
}
