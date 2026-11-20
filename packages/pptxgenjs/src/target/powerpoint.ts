import { PPTX_DEFAULTS } from "#src/defaults";
import type { RenderingTargetProfile } from "./index";

// PowerPoint's grid for each glyph's advance width: 1/576 in, 0.125pt (`advanceGridPt`).
const ADVANCE_GRID_PER_INCH = 576;
// PowerPoint's grid for each line's baseline: 1/600 in, 0.12pt (`baselineGridPerInch`).
const BASELINE_GRID_PER_INCH = 600;

/**
 * PowerPoint kerns a run only from its `kern` size: from 12pt, and never with `charSpacing`, and only in a face whose
 * pair kerning it reads (FontWinMetrics `pairKerning`): a font whose only pair kerning is an Apple-format `kern`
 * table plus GPOS comes out of its PDF export unkerned at 12 and 18pt, lines 6-7% wider on kerning-heavy text, while
 * a font with no `kern` table is kerned from GPOS (an OpenType font whose only kerning is GPOS, at 14pt). It
 * adds a paragraph's space after and the next one's space before: measured against its own PDF export of 18pt Arial,
 * `paraSpaceBefore: 6, paraSpaceAfter: 18` gives a 45.6pt pitch (21.6 + 6 + 18), not 39.6. It leaves out the
 * first paragraph's space before: with `paraSpaceBefore: 12` the first baseline is 17.05pt below the top inset,
 * as without it. With explicit line spacing it puts each baseline at 0.75 of the line height H, whatever the font
 * and size: a least-squares fit of its PDF export (Arial and Calibri, 12 and 18pt, x0.8 to x2.0 and exact 12 to
 * 30pt) gives 0.7524 H, every baseline within 0.1pt. With single spacing the line is 1.2x its largest size and each
 * run reaches 1.2x its size split by its font's winAscent : winDescent (FONT_WIN_METRICS) above and below the
 * baseline; the baseline is the largest ascent, scaled down with the largest descent when the two overflow the line.
 * Measured: Arial 0.972-0.975em (predicted 0.9724), Calibri 0.936-0.939em (0.936), an Arial and a Calibri run of
 * 18pt on one line 17.04pt (16.99; the largest ascent alone gives 17.50). The paragraph mark counts on the
 * paragraph's last line and a soft break on the line it ends, both in the theme font at the size of the last run and
 * of the run before the break, whatever size PptxGenJS writes on `<a:endParaRPr>` (a paragraph without a run is one
 * line at that size instead, normalize/text.ts paragraphFromPieces): 18pt Arial with Calibri, the
 * default theme font, sits 17.05pt below the top on its last line (16.99) and 17.5 on a wrapped line, and a 32pt
 * Arial paragraph whose `<a:endParaRPr>` says 12pt has its last line 0.8pt above a wrapped line's place (0.91 for a
 * 32pt mark, 0 for a 12pt one). In a table cell PowerPoint reads the typeface PptxGenJS writes on `<a:endParaRPr>`,
 * the cell's fontFace: 18pt Arial cells keep their place (0.08pt above PowerPoint's, 0.55 with a Calibri mark),
 * while a soft break, written without one, stays in the theme font. An empty numbered paragraph keeps the current number and
 * does not advance it: three items each after a run-less paragraph are I., II., III.; "Item one\n" then
 * "Item two" are "1.", "2." (the empty line) and "2.".
 * Each line feed PptxGenJS keeps inside `<a:t>` starts a paragraph, and every paragraph of the `<a:p>` reads its
 * first `<a:pPr>`, the first run's, ignoring the `<a:pPr>` PptxGenJS repeats before each later run
 * (`lineFeedParagraph`): measured against its PDF export of synthetic decks, 12pt Arial lines whose first run has
 * `paraSpaceAfter: 12` are 26.4pt apart at every line feed, and the same space, `paraSpaceBefore` or `lineSpacing: 30`
 * on a later run leaves them 14.4pt apart; the bullet and the space after repeat on each such paragraph, empty ones
 * too. A line feed ends its line in the run's font, so only the `<a:p>`'s last line holds the paragraph mark.
 * It rounds each `<a:spcPts>` half-up to whole points (`spacingWholePoints`): measured against its PDF export of
 * synthetic decks (12pt Arial), `paraSpaceAfter` 0.25 and 0.49 add 0pt, 0.5 and 1.25 1pt, 1.5 and 2.4 2pt, 2.5 and
 * 2.6 3pt, 5.5 6pt, `paraSpaceBefore` the same; a space after of 0.5 then a space before of 0.5 add 2pt (1 + 1), and
 * `lineSpacing: 12.5` gives a 13pt pitch. `lineSpacingMultiple` (`<a:spcPct>`) is not rounded.
 * It draws a superscript or subscript run at 2/3 of its size (`escapementSizeRatio`): measured against its PDF
 * export of synthetic decks, 24pt is drawn at 15.96pt and 12pt at 8.04pt, a 24pt superscript's baseline 7.2pt (0.3
 * of 24) above the line's. The run counts in its line at that size: a 24pt superscript inside a 12pt Arial line puts
 * the line's baseline 4.3pt below a plain line's (2/3 gives 4.24, 0.58 gave 2.21). The paragraph mark keeps the
 * full size (`fullSizeMark`): a paragraph whose only run is a 24pt superscript is 28.8pt tall (12pt lines around it
 * 43.2pt apart), and the empty paragraph left after a 12pt superscript run ending in a line feed is 14.4pt tall.
 * It does not grow a line for a raised or lowered run (`escapementGrowsLine`, #298): measured against its PDF export
 * (Arial, middle-anchored 2.2in boxes, 20pt and 40pt "Hxg" then a shifted "Hxg"), the base line is at the same place,
 * 107.66pt and 301.90pt, for `baseline` 600, -600, 200 and -1000 (10pt and 20pt down), superscript and
 * subscript.
 * It lays text out with each glyph's advance width rounded to 1/576 in, 0.125pt (`advanceGridPt`), spaces included,
 * at the run's font size, then places word starts on a 1/600 in grid: measured against its PDF export of synthetic
 * decks (Arial and Calibri, 8, 9, 10 and 12pt, regular and bold, lines about 700pt long), word starts fit the rounded
 * advances with a residual sd of 0.07-0.25pt against 0.2-1.2pt for the natural ones (a 1/600, 1/1200, 1/1440, 1/96 or
 * 1/72 in grid, floor or ceiling, and hinted advances at 72-1200 dpi fit worse). Arial 8pt's space, 2.222pt, takes
 * 2.25pt. Pair kerning still applies from 12pt (`readsKern`); whether it rounds kerning values too was not measured,
 * so they stay unrounded. Inside a word it draws glyphs at hinted 600 dpi widths, which never moves a word start or a
 * line break, so the PDF does not copy them. Wrapping tests the line without its trailing space against the box, with
 * no tolerance: rounded advances exactly as wide as the box fit, 0.125pt wider wrap. Each word therefore takes its own
 * letter-spacing (`advanceGridWordSpacing`), so its end, not only the run's, is PowerPoint's.
 * It puts each baseline on a 1/600 in grid, 0.12pt (`baselineGridPerInch`): measured against its PDF export of
 * synthetic decks (one line "Hxg" in Arial at 6, 7, 8, 9, 9.5, 10, 12, 14, 16 and 18pt, in text boxes and one-cell
 * tables, margin 0 and default margins, top anchored), the first baseline below the top inset is the single-spaced
 * line box's above rounded to the nearest 0.12pt, all 40 within 0.012pt: 12pt in a box 11.325 -> 11.28, 18pt
 * 16.988 -> 17.04, in a cell 11.669 -> 11.64 and 17.503 -> 17.52. The grid is the page's (on real decks baselines
 * and word starts land on whole 600 dpi px of the page); those boxes sat at 0.2, 1.0, 1.8 and 2.8 in, on the grid,
 * so rounding the page y and rounding the offset below the line top agree there.
 * shortcut: the baseline is rounded below its line's top, on the page's grid only while that top is: box y and
 * insets in 1/600 in (any whole 0.01 in), sizes in whole 0.1pt (a 1.2 x size pitch) and paragraph spacing in
 * multiples of 0.72pt; round the page y when a renderer lays text out from the model's page positions.
 * It has no line break before an opening bracket that follows a closing one or "%" (`joinsOpeningBracket`, a
 * U+2060 WORD JOINER in the run text), where UAX #14 (Chromium, LibreOffice) has one: measured against its PDF
 * export of a synthetic deck (Arial 10pt, "lorem " then the token in text boxes 0.75-1.15 in wide, margin 0),
 * "word)(word" and "100%(word" go whole to the next line ("lorem | word)(word") where Chromium gave
 * "lorem word) | (word", and a token wider than the line (a 10-letter word, ")(" and a 4-letter word) breaks
 * where the line fills, as the joiner still lets overflow-wrap do. "word)word", "word(word", "word/word",
 * "word,word", "word;word", "word%word", "word+word" and "word&word" never break and "word-word" breaks after the
 * hyphen in both. Only "(" after ")" and "%" was measured; "[" and "{", and "]" and "}" before them, are the same
 * UAX #14 classes (OP, CP/CL).
 * shortcut: its synthetic bold and italic are left to the browser (Chromium's, see `syntheticBoldStrokeEm`), not
 * measured against PowerPoint's PDF export of a regular-only face; measure them when a deck needs one.
 */
export const POWERPOINT: RenderingTargetProfile = Object.freeze({
    readsKern: true,
    contentRowSlackMm: 0,
    addsParagraphSpacing: true,
    spacesFirstParagraph: false,
    spacedLineBaseline: 0.75,
    fontLineBaseline: true,
    emptyNumberedParagraph: "skipped",
    lineFeedParagraph: "paragraph",
    spacingWholePoints: true,
    escapementSizeRatio: 2 / 3,
    escapementGrowsLine: false,
    fullSizeMark: true,
    advanceGridPt: PPTX_DEFAULTS.units.pointsPerInch / ADVANCE_GRID_PER_INCH,
    baselineGridPerInch: BASELINE_GRID_PER_INCH,
    joinsOpeningBracket: true,
    syntheticBoldStrokeEm: undefined,
    syntheticItalicShear: undefined,
});
