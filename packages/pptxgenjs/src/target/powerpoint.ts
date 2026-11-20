import { PPTX_DEFAULTS } from "#src/defaults";
import type { RenderingTargetProfile } from "./index";

// PowerPoint's grid for each glyph's advance width and for a line's room, 1/576 in, 0.125pt (`advanceGridPt`,
// `wrapWidthGridPt`).
const ADVANCE_GRID_PER_INCH = 576;
// PowerPoint's grid for each line's baseline: 1/600 in, 0.12pt (`baselineGridPerInch`).
const BASELINE_GRID_PER_INCH = 600;
/** Its font fallback chain (`fallbackFaces`), first to last. */
const FALLBACK_FACES = Object.freeze(["Arial", "Cambria Math", "Segoe UI Symbol", "Yu Gothic", "PMingLiU", "SimSun"]);
/** The marks measured hanging past a line's end, by language (`hangingMarks`). */
const HANGING_MARKS = Object.freeze({ zh: "）》」”，、。：？！；』】〕),.;:!?]}", ja: "，。" });

/**
 * PowerPoint kerns a run only from its `kern` size: from 12pt, and never with `charSpacing`, and only from the face's
 * version 0 `kern` table, never from GPOS (FontWinMetrics `pairKerning`, GlyphAdvances `kerning`): a font whose only
 * pair kerning is an Apple-format `kern` table plus GPOS comes out of its PDF export unkerned at 12 and 18pt, lines
 * 6-7% wider on kerning-heavy text, and so does a font with no `kern` table, measured against PowerPoint's PDF export
 * of decks in GPOS-only faces: at 12pt and above, 0 of 8,861 GPOS pairs applied. Such a run is written with
 * `font-kerning: none`, as one under 12pt is, so neither renderer kerns it from GPOS. A face with both tables is
 * kerned by the renderers inside a word from GPOS (Chromium's HarfBuzz and pdf-core's harfrust read the `kern` table
 * only without a GPOS `kern` feature), and its word ends assume those pairs are the `kern` table's (`advanceGridWordSpacing`): they are
 * in Liberation Sans and Serif, whose every `kern` table pair has the same GPOS value and whose GPOS-only pairs are
 * all Hebrew. It
 * adds a paragraph's space after and the next one's space before: measured against its own PDF export of 18pt Arial,
 * `paraSpaceBefore: 6, paraSpaceAfter: 18` gives a 45.6pt pitch (21.6 + 6 + 18), not 39.6. It leaves out the
 * first paragraph's space before: with `paraSpaceBefore: 12` the first baseline is 17.05pt below the top inset,
 * as without it. With explicit line spacing it puts each baseline at 0.75 of the line height H, whatever the font
 * and size: a least-squares fit of its PDF export (Arial and Calibri, 12 and 18pt, x0.8 to x2.0 and exact 12 to
 * 30pt) gives 0.7524 H, every baseline within 0.1pt. The text then ends at the last baseline plus the fonts'
 * single-spaced descent, not at the bottom of the last line, which sizes a table row to its text (normalize/text.ts
 * spacedLineEndOffset); a line spacing exactly as tall as the single line is single spacing. With single spacing the line is 1.2x its largest size and each
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
 * 2.25pt. From 12pt (`readsKern`) it adds each pair's `kern` table value, unrounded, to the rounded advances, pairs
 * with a space included: measured against its PDF export of a synthetic deck (one line "AVAVA To Ty Wa Yo LT P. Te
 * Vo AV Fa", Arial and Calibri at 12, 14, 18, 24 and 36pt, margin 0), its word starts are that sum within 0.06-0.12pt
 * at each size (the 1/600 in word-start grid), against 0.11-0.58pt with each pair rounded to 1/576 in too. Arial kerns the space ("A " -113, " T" and " Y"
 * -37 units of 2048) where Calibri does not, and Chromium and the WASM renderer drop a pair across a word span's
 * edge, so Arial's words drifted right by those pairs (+2.4pt over the line at 12pt, +7.2pt at 36pt, Calibri within
 * 0.13pt); the piece of each pair's left character takes it now (`advanceGridWordSpacing`), and both renderers put
 * Arial's word starts within 0.13pt of PowerPoint's at every size. A pair belongs to its left glyph's advance when a
 * line breaks: measured against its PDF export of a synthetic deck ("Lorem ipsum AVAVA xo" and "... AVAVA To" in
 * Arial at 12 and 18pt, boxes from 0.7pt under the line's width to 0.05pt over it plus "A " and " T"), "A " at the
 * line's end counts in its width, and " T" leaves with the trailing space: the target breaks those 12 boxes as
 * PowerPoint does (tests/kernWrapCases.ts), and 34 lines of justified all-caps Arial and 28 of Calibri at 12pt all.
 * It floors a text box's width inside its left and right insets to 1/576 in (`wrapWidthGridPt`) before it tests a line
 * against it: measured against its PDF export of a synthetic deck (tests/boxFloorCases.ts: Arial at 12, 14, 18 and
 * 24pt, 47 boxes from 0.1pt under the line to 0.14pt over it, kerned and kern-free lines, insets 0, 1.3 and 7.2pt),
 * that floor predicts every break, where no floor misses 16 boxes, a 0.056pt tolerance 24, the box width floored to
 * 1/576 in 9 (its insets off the grid) and either width floored to 1/600 in 18 or more. A kern-free line is on the
 * grid already, so only a kerned one, or insets off the grid such as the default 0.1 in, wraps sooner. The target
 * moves the floor's remainder to the end inset (`floorTextWrapWidth`). shortcut: measured on left-aligned text
 * boxes; a centered or right-aligned line and a shape's text rectangle take the same floor and a table cell none until
 * a measurement says otherwise. A kerned line less than a LayoutUnit (0.0117pt) wider than the floored width still
 * fits in Chromium (2 of the 47 boxes, tests/advanceGrid.test.ts), finer than its line measure.
 * Inside a word it draws glyphs at hinted 600 dpi widths, which never moves a word start or a
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
 * It breaks Han text by the run's `lang`, not by its characters, with the `eaLnBrk="1" latinLnBrk="0"
 * hangingPunct="1"` PptxGenJS writes in `<p:defaultTextStyle>`. Measured against its PDF export of two synthetic
 * decks (tests/eastAsianBreakCases.ts: SimSun 10pt, margin 0, each string in boxes that end the line just before,
 * between and after the two characters of one boundary): 30 strings in zh-CN and in zh-TW, then six strings with no
 * `lang` (PptxGenJS writes en-US), en-US, ja-JP, ko-KR and zh-CN, and the marks, dashes and quotes below in zh-CN.
 * zh-CN and zh-TW break alike, no `lang` and en-US alike, and ja-JP as zh but for which marks hang.
 * In zh and ja, a closing mark that would start the next line stays on its line, past the right edge, unless another
 * one or a dash follows it (`hangingMarks`), drawn at its place outside the box ("这是示例文字内容，" in an 8em box,
 * "他刚才又说「这是示例」" ending "示例」" in a 5em one), where Chromium pulls the character before down with it. In
 * zh: ）》」”，、。：？！；』】〕 and ASCII ),.;:!?]}, before Han, a Latin letter, a digit, "（", a soft break, a run
 * in another size or the paragraph's end; "（第一）。" with "）" one past the edge breaks before "一", and "（甲）——"
 * with "）" one past the edge breaks before "（". In ja: ，。 (a ja "）" one past the edge breaks before "（"). It
 * breaks before "“" after Han ("他刚才又说" | "“这是示例”"), between Han and an ASCII quote on either side, also
 * next to Latin text ("我们使用" | "\"Alpha\"" and "大家都说\"" | "样本\"不错"), and between two dashes but never
 * before them ("示例结果如" | "下——全部完" in a 6em box, "示例结果如下—" | "—全部完成"), where UAX #14 (LB19,
 * LB17) has the reverse (`breaksAroundHanPunctuation`: U+200B ZERO WIDTH SPACE and U+2060 WORD JOINER in the run).
 * In en-US, with no `lang` and in ko-KR nothing hangs, and it breaks on either side of full-width punctuation next to
 * Han or more of it: "我们今天讨论示例" | "，然后继续", "参考附件材料（" | "甲）", "老师刚刚讲到“" | "样本问题”",
 * "示例结果如下" | "——全部完成"; between Han and an ASCII quote as in zh. A Han run in Arial with no `lang` breaks so
 * too. Otherwise the boxes break as Chromium does: "……" is not left at a line's start, a word of ASCII letters,
 * digits and brackets ("Excel", "123(4)", "100%") is kept whole and breaks from Han on either side, there is no extra
 * space between Han and Latin text, and Latin punctuation in en-US Latin text does not hang.
 * shortcut: ko-KR also breaks inside digits ("今年总共有1" | "28个"), which the target does not; ja is measured for
 * ，。 and "）" only, and the dash in zh only; "、", the ja dash and other marks keep these rules until a deck measures
 * them.
 * It justifies a line by widening its spaces only (`justifiesAtSpaces`): every other character keeps its advance, and a
 * line without a space stays at its start. Measured against its PDF export of a synthetic deck (10pt, no `lang`,
 * 3.33in boxes, justified and left; tests/eastAsianJustify.test.ts): a Han line with no space, with or without
 * full-width punctuation, ends where the left-aligned one does (229.85 against 229.41pt, the 0.12pt size grid's drift),
 * one space on a Han line takes the whole 9.76pt of slack, and on lines of Han, Latin words and spaces, in SimSun,
 * Arial or both, the Han and Latin steps are the left-aligned ones and the spaces share the rest.
 * It draws a character the run's face lacks in the first face of one chain that has it, whatever the run's face
 * (`fallbackFaces`): Arial, Cambria Math, Segoe UI Symbol, Yu Gothic, then PMingLiU and SimSun. Measured against its
 * PDF export of a synthetic deck (Arial, Calibri and Times New Roman at 14pt, one character class per line) and each
 * font's cmap, the chain predicts every character: in Arial, U+2010, U+2083, U+21D2, U+2460 and U+2461 are drawn in
 * Cambria Math, U+2713, U+2717, U+2605, U+2606 and U+24B6 in Segoe UI Symbol and U+2189 in Yu Gothic; in Calibri,
 * U+25A0 in Arial (ahead of Cambria Math, which has it too), U+21D2 in Cambria Math and U+2189 in Yu Gothic. Han
 * characters in a Latin run are drawn in Yu Gothic, in the run's weight, and those it lacks in PMingLiU or SimSun;
 * the order of those two was not measured. The run's face is left out of the chain where it is in it.
 * It draws U+2011 NON-BREAKING HYPHEN with the face's U+002D glyph (`nonBreakingHyphen`), even in Times New Roman,
 * which has a U+2011 glyph of its own: in the same export it is glyph 16 in Arial and Times New Roman, the one
 * U+002D maps to, and Calibri's hyphen.
 * shortcut: its synthetic bold and italic are left to the browser (Chromium's, see `syntheticBoldStrokeEm`), not
 * measured against PowerPoint's PDF export of a regular-only face; measure them when a deck needs one.
 * It draws a picture's inner shadow (`drawsPictureInnerShadow`), the Format Picture > Shadow > Inner effect, on the
 * side its angle points to with a Gaussian of sigma blurRad / 3 (`PPTX_DEFAULTS.shadow.innerSigmaPerBlur`).
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
    wrapWidthGridPt: PPTX_DEFAULTS.units.pointsPerInch / ADVANCE_GRID_PER_INCH,
    joinsOpeningBracket: true,
    hangingMarks: HANGING_MARKS,
    breaksAroundHanPunctuation: true,
    justifiesAtSpaces: true,
    syntheticBoldStrokeEm: undefined,
    syntheticItalicShear: undefined,
    fallbackFaces: FALLBACK_FACES,
    nonBreakingHyphen: "hyphen-minus",
    drawsPictureInnerShadow: true,
});
