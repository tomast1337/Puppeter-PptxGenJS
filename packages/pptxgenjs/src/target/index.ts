import { LIBREOFFICE } from "./libreoffice";
import { POWERPOINT } from "./powerpoint";

/**
 * A rendering target: the application whose drawing of the PptxGenJS file the PDF matches, where applications differ.
 * Each quirk is a flag here; normalization reads the flags and never a target's name. Each target's values, and the
 * measurements behind them, live in its own file beside this one.
 */
export interface RenderingTargetProfile {
    /** Whether it honours `<a:rPr kern>` (PPTX_DEFAULTS.text.kernMinSizePt) or kerns every run. */
    readonly readsKern: boolean;
    /** What a row sized to its content (`<a:tr h="0">`) adds to its tallest cell's text and margins. */
    readonly contentRowSlackMm: number;
    /**
     * Whether a paragraph's space after and the next one's space before add up, or only the larger one counts (CSS
     * margins collapse).
     */
    readonly addsParagraphSpacing: boolean;
    /** Whether a text box's first paragraph keeps its space before. */
    readonly spacesFirstParagraph: boolean;
    /**
     * With explicit line spacing (`lineSpacing`, or a `lineSpacingMultiple` other than 1), each line's baseline below its
     * top as a fraction of the line height; undefined keeps `text.lineDescentEm` above its bottom.
     */
    readonly spacedLineBaseline: number | undefined;
    /**
     * Whether a single-spaced line's baseline comes from its fonts' FONT_WIN_METRICS, or sits `text.lineDescentEm` above
     * its bottom whatever the font.
     */
    readonly fontLineBaseline: boolean;
    /**
     * What a numbered paragraph PptxGenJS writes without a run (from a run starting with "\n") does to the numbering:
     * "restarts" it, or "skipped" keeps the current number without advancing it.
     */
    readonly emptyNumberedParagraph: "restarts" | "skipped";
    /**
     * Where each line feed PptxGenJS keeps inside `<a:t>` takes its paragraph properties from: "run", the run that starts
     * its line, or "paragraph", the `<a:p>`'s first `<a:pPr>`.
     */
    readonly lineFeedParagraph: "run" | "paragraph";
    /**
     * Whether `paraSpaceBefore`, `paraSpaceAfter` and point `lineSpacing` (`<a:spcPts>`) are rounded half-up to whole
     * points, each value on its own.
     */
    readonly spacingWholePoints: boolean;
    /**
     * The fraction of its font size a superscript or subscript run is drawn at; its baseline still moves by
     * `text.superscriptBaseline` or `text.subscriptBaseline` of the full size.
     */
    readonly escapementSizeRatio: number;
    /**
     * Whether a run raised or lowered off the baseline (super/subscript, custom `baseline`) grows its line where it
     * sticks out of it, or only its glyphs move and the line box stays where it would be without it.
     */
    readonly escapementGrowsLine: boolean;
    /**
     * Whether the paragraph mark takes its last run's size before that reduction and counts in its line's height, so a
     * paragraph ending in a large superscript, or the empty one after its last line feed, has a full line.
     */
    readonly fullSizeMark: boolean;
    /**
     * The grid each glyph's advance width (hmtx advance x size / unitsPerEm) is rounded to, to the nearest step, before
     * it lays text out; undefined lays it out with the natural advances.
     */
    readonly advanceGridPt: number | undefined;
    /**
     * The steps per inch of the grid each line's baseline is rounded to, to the nearest step; undefined keeps it where
     * the line box puts it.
     */
    readonly baselineGridPerInch: number | undefined;
    /**
     * The grid a text box's width inside its left and right insets is floored to before a line is tested against it;
     * undefined wraps at the width itself.
     */
    readonly wrapWidthGridPt: number | undefined;
    /**
     * Whether there is no line break before an opening bracket that follows a closing one or "%" (a U+2060 WORD JOINER
     * in the run text), where UAX #14 has one.
     */
    readonly joinsOpeningBracket: boolean;
    /**
     * How a bold run is drawn in a face that has no bold style: the glyphs filled and stroked with a line this fraction
     * of the font size wide. Undefined leaves the browser's own synthesis (Chromium, measured in its PDF output of a
     * regular-only Liberation Sans at 9 to 72pt: a 1/32 em stroke, its glyph outlines 1/64 em wider on each side, and a
     * 0.25 shear), which the HTML does not write.
     */
    readonly syntheticBoldStrokeEm: number | undefined;
    /**
     * How an italic run is drawn in a face that has no italic style: the glyphs sheared to the right by this much per
     * unit of height above the baseline. Undefined leaves the browser's own synthesis (see `syntheticBoldStrokeEm`).
     */
    readonly syntheticItalicShear: number | undefined;
    /**
     * The faces a character the run's face lacks is drawn in, the first that has it, before the renderer's own
     * fallback (`NormalizedTextRun.fallbackFaces`); empty leaves it to the renderer.
     */
    readonly fallbackFaces: readonly string[];
    /**
     * How U+2011 NON-BREAKING HYPHEN is drawn: "hyphen-minus", with the run's face's U+002D glyph, still unbreakable
     * (`NormalizedTextRun.nonBreakingHyphen`); undefined, as any other character.
     */
    readonly nonBreakingHyphen: "hyphen-minus" | undefined;
    /**
     * Whether it draws a picture's inner shadow (`<a:innerShdw>` in its `<p:spPr>`, which PptxGenJS writes for
     * `addImage` with `shadow: { type: "inner" }`), or leaves the picture without it.
     */
    readonly drawsPictureInnerShadow: boolean;
}

/** Every rendering target by the name the `target` option takes. A new target is one file here and one entry below. */
export const RENDERING_TARGETS = Object.freeze({
    libreoffice: LIBREOFFICE,
    powerpoint: POWERPOINT,
});
export type RenderingTarget = keyof typeof RENDERING_TARGETS;

/** `PuppeteerGen` without a `target`: the LibreOffice rendering that existing decks and the visual reference use. */
export const DEFAULT_RENDERING_TARGET: RenderingTarget = "libreoffice";
