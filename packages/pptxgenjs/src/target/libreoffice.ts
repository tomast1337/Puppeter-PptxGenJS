import type { RenderingTargetProfile } from "./index";

/**
 * LibreOffice Impress, the visual reference (tests/visual): it kerns every run whatever its `kern`. A cell's
 * minimum height is its text height plus one unit of its 1/100 mm model, then the margins (svx table
 * Cell::getMinimumHeight, `GetTextHeight()+1`). A numbered paragraph PptxGenJS writes without a run (from a
 * run starting with "\n") restarts the numbering: three such items after an intro are all "I." in its PDF export.
 * Each line feed PptxGenJS keeps inside `<a:t>` (a run ending with "\n") starts a line that takes its paragraph
 * properties from the run that starts it (`lineFeedParagraph`). Its PPTX import draws a run with a baseline
 * attribute at DFLT_ESC_PROP, 58% of its size (oox TextCharacterProperties): measured on the visual runs slide,
 * 13pt "super" is 24 px wide against 42 px unscaled, "sub" 15 against 26 px (`escapementSizeRatio`).
 * Its synthetic styles, read from its PDF export of a regular-only face (Droid Sans Mono, 72pt): bold fills and
 * strokes the glyphs (`2 Tr`) with a line 1/30 of the size wide (`2.39996 w`); italic shears them
 * (`1 0 0.3462535606 1 x y Tm`).
 * It grows a line by what a raised or lowered run sticks out of it (`escapementGrowsLine`, #298): measured in its
 * PDF export (Arial 40pt, top-anchored, "H" + an escaped "x" + "H", then "H"), each run reaches the font-independent
 * line box at its drawn size `s`, `1.0 s` above and `0.2 s` below its baseline, shifted by its escapement `e`: the
 * line's ascent is the largest `1.0 s + e`, its descent the largest `0.2 s - e`. `baseline: 1000` (+20pt) puts the
 * first baseline 3.17pt lower (20 + 23.2 - 40 = 3.2), `baseline: -600` (-12pt) makes the line 8.62pt taller
 * (12 + 4.64 - 8 = 8.64), `subscript` 12.61pt, `baseline: 600` and `superscript` (+12pt) nothing.
 * It justifies Han text by widening every character too (`justifiesAtSpaces` off): in its PDF export of a synthetic
 * deck (SimSun 10pt, 3.33in boxes), a justified Han line with one space has 10.2pt Han steps and a 5.49pt space.
 * It draws no inner shadow on a picture (`drawsPictureInnerShadow`): in its PDF export a 2in picture with
 * `<a:innerShdw blurRad="101600" dist="76200" dir="2700000">` (75% black) is the bare picture, while the same
 * picture beside it with the outer shadow has one.
 */
export const LIBREOFFICE: RenderingTargetProfile = Object.freeze({
    readsKern: false,
    contentRowSlackMm: 0.01,
    addsParagraphSpacing: false,
    spacesFirstParagraph: true,
    spacedLineBaseline: undefined,
    fontLineBaseline: false,
    emptyNumberedParagraph: "restarts",
    lineFeedParagraph: "run",
    spacingWholePoints: false,
    escapementSizeRatio: 0.58,
    escapementGrowsLine: true,
    fullSizeMark: false,
    advanceGridPt: undefined,
    baselineGridPerInch: undefined,
    wrapWidthGridPt: undefined,
    joinsOpeningBracket: false,
    hangingMarks: {},
    breaksAroundHanPunctuation: false,
    justifiesAtSpaces: false,
    syntheticBoldStrokeEm: 1 / 30,
    syntheticItalicShear: 0.3462535606,
    fallbackFaces: [],
    nonBreakingHyphen: undefined,
    drawsPictureInnerShadow: false,
});
