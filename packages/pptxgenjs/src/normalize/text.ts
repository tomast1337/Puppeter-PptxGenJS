import type PptxGenJS from "pptxgenjs";
import { type FontMetricsLookup, PPTX_DEFAULTS } from "#src/defaults";
import { DEFAULT_RENDERING_TARGET, RENDERING_TARGETS, type RenderingTarget } from "#src/target/index";
import { builtInFontMetrics } from "#src/fontMetrics";
import type { NormalizedTextBox, NormalizedTextBullet, NormalizedTextParagraph, NormalizedTextRun } from "@pdflapas/model";
import { inchesToPixels, pointsToPixels } from "@pdflapas/model";
import { inch2EmuToPixels } from "#src/units";
import { advanceGridWordSpacing, fullWidthStretches, type GridCursor, runPieces, wordAfter } from "./advanceGrid";
import { breakAroundHanPunctuation, hangingMarkRuns, hangingSegments, languageHangingMarks } from "./eastAsianLineBreak";
import { fallbackChain, type FallbackSegment, fallbackSegments } from "./fallback";
import { paragraphAlign, verticalAlign } from "./alignment";
import { normalizeHyperlink } from "./link";
import { textMarginPixels } from "./margin";
import { recordSharedRun, type SharedRunOptions, sharedRunOptions } from "./sharedRunOptions";
import { checkedSize } from "./size";
import { normalizeColor, normalizeShadow } from "./style";
import { OOXML_PERCENT } from "./shape/path";

export type TextInput = string | number | PptxGenJS.TextProps[];

/** U+2060 WORD JOINER: no line break on either side, and drawn as nothing by Chromium and pdf-core. */
const WORD_JOINER = "⁠";
/** The point between a closing bracket or "%" and an opening bracket (RENDERING_TARGETS.joinsOpeningBracket). */
const BEFORE_OPENING_BRACKET = /(?<=[)\]}%])(?=[([{])/gu;
/** U+2011 NON-BREAKING HYPHEN (RENDERING_TARGETS.nonBreakingHyphen). */
const NON_BREAKING_HYPHEN = "‑";

interface TextPiece {
    text: string;
    /** The run's options record, shared and mutated as in PptxGenJS (normalizeText). */
    options: PptxGenJS.TextPropsOptions;
    /** PptxGenJS writes no `<a:r>` for this piece: an empty text of its own (genXmlTextRun skips it). */
    noRun?: boolean;
    /** The empty text after a run's last line feed: a paragraph of its own only when nothing else falls into it (normalizeText). */
    tail?: boolean;
}

/** One paragraph of the model: an `<a:p>`'s pieces up to a line feed kept inside `<a:t>`, or to the `<a:p>`'s end. */
interface PieceGroup {
    pieces: TextPiece[];
    /** The options of the `<a:p>`'s first run, whose `<a:pPr>` PowerPoint reads for each of its paragraphs. */
    paragraph: PptxGenJS.TextPropsOptions | undefined;
    /** The group ends its `<a:p>`, so its last line holds the paragraph mark, not a line feed. */
    endsParagraph: boolean;
    /** The size PptxGenJS writes on the `<a:p>`'s `<a:endParaRPr>`, in points (normalizeText); unset is no `sz`. */
    markFontSize: number | undefined;
}

// --- UTILITIES ---

/** `options` without the keys whose value is undefined or null, which PptxGenJS treats as unset. */
function setOptions(options: PptxGenJS.TextPropsOptions): PptxGenJS.TextPropsOptions {
    return Object.fromEntries(Object.entries(options).filter(([, value]) => value != null));
}

function inheritedOptions(parent: PptxGenJS.TextPropsOptions, child: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions {
    const { x: _x, y: _y, w: _w, h: _h, fill: _fill, line: _line, shadow: _shadow, rotate: _rotate, flipH: _flipH, flipV: _flipV, rectRadius: _rectRadius, objectName: _objectName, ...parentText } = parent;
    // PptxGenJS 4.0.1 genXmlTextBody (step 6 C) fills a run option the run leaves unset from its parent's, so a key
    // present with an undefined value (a table cell's `{ fontSize: undefined }`, copied onto its autoPage word runs)
    // inherits rather than resetting to the default. Null is unset too: addTextDefinition writes `lineSpacing: null` and
    // `lineSpacingMultiple: null` into the options it is given, step 6 B copies them onto each run, and PptxGenJS
    // reads them only by truthiness, so options that went through PptxGenJS once must give the same text again.
    const inherited = { ...setOptions(parentText), ...setOptions(child) };

    if (child.hyperlink && child.color == null) {
        delete inherited.color;
    }

    return inherited;
}

// --- TEXT STYLING ---

/**
 * Whether `target` kerns a run: PptxGenJS writes `kern="0"` with `charSpacing`, and inherits 12pt otherwise. PowerPoint
 * kerns only from a face's `kern` table, never from GPOS (target/powerpoint.ts): a face whose `pairKerning` is false, or
 * whose advances in the run's weight and style are read with no `kern` pairs, is drawn unkerned.
 * shortcut: a face whose advances are not read (its font is not readable) and whose `pairKerning` is not false is
 * kerned, so the renderers kern it from GPOS where PowerPoint may not; pass its advances or `pairKerning` when a deck
 * uses one.
 */
function kerned(options: PptxGenJS.TextPropsOptions, target: RenderingTarget, fontMetrics: FontMetricsLookup): boolean {
    if (!RENDERING_TARGETS[target].readsKern) {
        return true;
    }

    if (options.charSpacing || (options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt) < PPTX_DEFAULTS.text.kernMinSizePt) {
        return false;
    }

    const fontFace = options.fontFace ?? PPTX_DEFAULTS.text.fontFace;

    if (fontMetrics(fontFace)?.pairKerning === false) {
        return false;
    }

    const advances = fontMetrics.glyphAdvances?.(fontFace, options.bold ?? PPTX_DEFAULTS.text.bold, options.italic ?? PPTX_DEFAULTS.text.italic);

    return advances === undefined || Boolean(advances.kerning?.size);
}

/** A run's font size in px, before any superscript or subscript reduction. */
function runFontSize(options: PptxGenJS.TextPropsOptions): number {
    return pointsToPixels(checkedSize(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt, "fontSize", PPTX_DEFAULTS.limits.fontSizePt));
}

/**
 * `cursor`: where the paragraph's earlier runs end on the advance grid (GridCursor), moved to this run's end; `after`:
 * the text of the next runs PowerPoint kerns with this one (normalizeText).
 */
export function normalizeTextRun(text: string, options: PptxGenJS.TextPropsOptions, target: RenderingTarget = DEFAULT_RENDERING_TARGET, fontMetrics: FontMetricsLookup = builtInFontMetrics, cursor?: GridCursor, after = ""): NormalizedTextRun {
    // The `u` PptxGenJS 4.0.1 genXmlTextRunProperties writes for a run: `underline.style`, a string as given (deprecated
    // since 3.5.0, still written), or `sng` for a hyperlink. addTextDefinition turns `underline: true` on a text box or its
    // runs into `{ style: "sng" }`; a table cell's `true` stays a boolean (normalizeText) and writes no `u`.
    // `unknown`: PptxGenJS's types declare only the object form; the string and boolean forms work at runtime.
    const underlineOption: unknown = options.underline;
    let underline: string | undefined;

    if (typeof underlineOption === "string") {
        underline = underlineOption;
    } else if (underlineOption === true) {
        underline = "sng";
    } else {
        underline = options.underline?.style || (options.hyperlink ? "sng" : undefined);
    }

    const strike = options.strike === true || options.strike === "sngStrike" || options.strike === "dblStrike";
    const fontSize = runFontSize(options);
    // The fraction of the font size the baseline moves, from the <a:rPr baseline> PptxGenJS writes; a custom baseline
    // wins over super/subscript. LibreOffice draws a custom one as a superscript or subscript: measured in its PDF
    // export, baseline 600, -600, 200 and -1000 move the run 30%, -30%, 10% and -50% of its full size at 20pt and 40pt,
    // drawn at 58% of it (escapementSizeRatio); one that rounds to baseline="0" keeps the full size and the baseline.
    const escapement = options.baseline ? Math.round(options.baseline * PPTX_DEFAULTS.text.customBaselineScale) / OOXML_PERCENT || undefined : options.subscript ? PPTX_DEFAULTS.text.subscriptBaseline : options.superscript ? PPTX_DEFAULTS.text.superscriptBaseline : undefined;
    const link = normalizeHyperlink(options.hyperlink);
    const defaultColor = link && options.color === undefined ? PPTX_DEFAULTS.theme.colors.hyperlink : PPTX_DEFAULTS.text.color;
    const bold = options.bold ?? PPTX_DEFAULTS.text.bold;
    const italic = options.italic ?? PPTX_DEFAULTS.text.italic;
    const { syntheticBoldStrokeEm, syntheticItalicShear, nonBreakingHyphen, underlineFromFont } = RENDERING_TARGETS[target];
    const underlined = Boolean(underline) && underline !== "none";
    const fontFace = options.fontFace ?? PPTX_DEFAULTS.text.fontFace;
    const fallbacks = fallbackChain(fontFace, target);
    const color = normalizeColor({ color: options.color ?? defaultColor, transparency: options.transparency });
    let underlineStyle: NormalizedTextRun["decoration"]["underlineStyle"] = "solid";

    if (underline === "dbl" || underline === "wavyDbl") {
        underlineStyle = "double";
    } else if (underline?.includes("dash") || underline?.includes("Dash")) {
        underlineStyle = "dashed";
    } else if (underline?.includes("dot") || underline?.includes("Dot")) {
        underlineStyle = "dotted";
    } else if (underline?.includes("wavy")) {
        underlineStyle = "wavy";
    }

    const underlineColor = typeof options.underline === "object" && options.underline.color ? normalizeColor(options.underline.color) : undefined;
    // The caller's `fontMetrics` underline for the face (#391), in em: the band drawn in place of its `post` band.
    const faceMetrics = underlined && underlineFromFont ? fontMetrics(fontFace) : undefined;
    const band = faceMetrics?.underline;
    const decoration: NormalizedTextRun["decoration"] = {
        // `u=""`, which only the string form writes, is no underline type: it draws none.
        underline: underlined,
        underlineStyle,
        underlineColor,
        ...(underlined && underlineFromFont ? { underlineFromFont, ...(faceMetrics && band ? { underlineBand: { position: band.position / faceMetrics.unitsPerEm, thickness: band.thickness / faceMetrics.unitsPerEm } } : {}) } : {}),
        // shortcut: only `heavy` is measured; dashHeavy, dottedHeavy, wavyHeavy and the other heavy dashes draw at
        // their normal thickness (#397), measure them against PowerPoint's PDF export when a deck uses one.
        ...(underlined && underlineFromFont && underline === "heavy" ? { underlineHeavy: true } : {}),
        strike,
        doubleStrike: options.strike === "dblStrike",
    };
    let runVerticalAlign: "sub" | "super" | "baseline" = "baseline";

    if (options.subscript) {
        runVerticalAlign = "sub";
    } else if (options.superscript) {
        runVerticalAlign = "super";
    }

    // The letter-spacing in px of a run's spaces and of each of its words: `charSpacing`, plus on a target with an advance
    // grid the rounding of the run's advances to it, and its pair kerning when `kerned` (advanceGridWordSpacing), at the
    // size it is drawn at, reduced when escaped, carrying the paragraph's rounding in `cursor`, and kerned with the text
    // `after` it. A run of one word takes that word's; without a grid, or advances for the run's face, weight and style,
    // every character takes `charSpacing`.
    const { advanceGridPt, escapementSizeRatio } = RENDERING_TARGETS[target];
    const charSpacing = options.charSpacing ?? 0;
    const sizePt = (options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt) * (escapement === undefined ? 1 : escapementSizeRatio);
    const advances = advanceGridPt === undefined ? undefined : fontMetrics.glyphAdvances?.(fontFace, bold, italic);
    // A U+2011 drawn with the hyphen-minus glyph takes its advance.
    const drawn = nonBreakingHyphen === "hyphen-minus" ? text.replaceAll(NON_BREAKING_HYPHEN, "-") : text;
    const gridSpacing = advanceGridWordSpacing(drawn, sizePt, advances, advanceGridPt, charSpacing, kerned(options, target, fontMetrics), cursor, after);
    let spacing: Pick<NormalizedTextRun, "characterSpacing" | "wordCharacterSpacing" | "spaceCharacterSpacing">;

    if (!gridSpacing) {
        spacing = { characterSpacing: pointsToPixels(charSpacing) };
    } else {
        const [word, ...others] = gridSpacing.words;

        if (word !== undefined && !others.length && runPieces(text).length === 1) {
            spacing = { characterSpacing: word };
        } else if (!gridSpacing.words.length && !gridSpacing.spaces) {
            spacing = { characterSpacing: gridSpacing.space };
        } else {
            spacing = { characterSpacing: gridSpacing.space, wordCharacterSpacing: gridSpacing.words, ...(gridSpacing.spaces ? { spaceCharacterSpacing: gridSpacing.spaces } : {}) };
        }
    }

    return {
        text,
        fontFace,
        ...(fallbacks.length ? { fallbackFaces: fallbacks } : {}),
        fontSize: escapement === undefined ? fontSize : fontSize * RENDERING_TARGETS[target].escapementSizeRatio,
        color,
        bold,
        italic,
        decoration,
        verticalAlign: runVerticalAlign,
        baselineOffset: escapement === undefined ? 0 : escapement * fontSize,
        ...spacing,
        ...(kerned(options, target, fontMetrics) ? {} : { kerning: false as const }),
        ...(bold && syntheticBoldStrokeEm !== undefined ? { syntheticBold: syntheticBoldStrokeEm } : {}),
        ...(italic && syntheticItalicShear !== undefined ? { syntheticItalic: syntheticItalicShear } : {}),
        ...(nonBreakingHyphen && text.includes(NON_BREAKING_HYPHEN) ? { nonBreakingHyphen } : {}),
        highlight: options.highlight ? normalizeColor(options.highlight) : undefined,
        outline: options.outline ? { color: normalizeColor(options.outline.color), width: pointsToPixels(checkedSize(options.outline.size || PPTX_DEFAULTS.text.outlineSizePt, "outline.size", PPTX_DEFAULTS.limits.lineWidthPt)) } : undefined,
        glow: options.glow
            ? {
                  visible: true,
                  color: normalizeColor({
                      color: options.glow.color ?? PPTX_DEFAULTS.text.glowWhenEnabled.color,
                      transparency: (1 - Math.min(1, Math.max(0, options.glow.opacity))) * 100,
                  }),
                  blur: pointsToPixels(checkedSize(options.glow.size ?? PPTX_DEFAULTS.text.glowWhenEnabled.sizePt, "glow.size", PPTX_DEFAULTS.limits.glowSizePt)),
                  offsetX: 0,
                  offsetY: 0,
                  inset: false,
              }
            : undefined,
        shadow: options.shadow ? normalizeShadow(options.shadow) : undefined,
        language: options.lang ?? PPTX_DEFAULTS.theme.language,
        link,
        softBreakBefore: options.softBreakBefore ?? PPTX_DEFAULTS.text.softBreakBefore,
    };
}

// --- NUMBERING & BULLETS ---

const ROMAN_NUMERALS: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
];

function generateRoman(value: number, upper: boolean): string {
    let current = Math.max(1, value);
    let result = "";

    for (const [amount, glyph] of ROMAN_NUMERALS) {
        while (current >= amount) {
            result += glyph;
            current -= amount;
        }
    }

    return upper ? result : result.toLowerCase();
}

function generateAlpha(value: number, upper: boolean): string {
    let result = "";
    let current = Math.max(1, value);
    const baseCharCode = upper ? 65 : 97;

    while (current > 0) {
        current--;
        result = String.fromCharCode(baseCharCode + (current % 26)) + result;
        current = Math.floor(current / 26);
    }

    return result;
}

/** A numbered list open at one indent level, and the index the next numbered paragraph in it takes. */
interface NumberSequence {
    readonly level: number;
    readonly numberType: string | undefined;
    readonly start: number;
    readonly next: number;
}

/**
 * The index of a numbered paragraph in the list open at its level; each level keeps its own (`lists`). PowerPoint
 * starts a new list, at the paragraph's own startAt, when the `<a:buAutoNum>` type or startAt changes at the same
 * level: measured against PowerPoint's PDF export of a synthetic deck, arabicPeriod 1, 1, then alphaUcPeriod 1 x4,
 * then arabicPeriod startAt 2 draws "1. 2. A. B. C. D. 2.". A paragraph ends the lists deeper than its level, and a
 * bullet or unnumbered one its own level's too: measured against PowerPoint's PDF export of a synthetic deck (Arial
 * 12pt, one text box per sequence), levels 0 0 1 1 0 1 draw "1 2 1 2 3 1", 0 1 2 1 2 0 "1 1 1 2 1 2", 1 1 0 1
 * "1 2 1 1", and a bullet between level-0 numbered paragraphs restarts them at level 0 ("1 • 1") but not at level 1
 * ("1 • 2"). LibreOffice's PPTX import does the same since tdf#173712 (oox ListNumberingState::markParagraph).
 */
function sequenceIndex(lists: readonly NumberSequence[], { level, numberType, start }: Pick<NormalizedTextBullet, "level" | "numberType" | "start">): number {
    const list = lists.find(open => open.level === level);

    return list && list.numberType === numberType && list.start === start ? list.next : 0;
}

/** A paragraph's indent level, which PptxGenJS writes as `lvl` with or without a bullet. */
function paragraphLevel(options: PptxGenJS.TextPropsOptions): number {
    return Math.max(0, Math.floor(options.indentLevel ?? 0));
}

// --- PARAGRAPHS & GROUPING ---

const TAB_ALIGNMENT_MAP: Record<string, "left" | "right" | "center" | "decimal"> = {
    r: "right",
    ctr: "center",
    dec: "decimal",
    l: "left",
};

/**
 * The runs of `text`, one per stretch drawn from its own fallback face (normalize/fallback.ts). `kernedText` is the
 * text after `text` that PowerPoint kerns with it; only the last stretch takes it, since a face change ends kerning.
 */
function fallbackRuns(text: string, options: PptxGenJS.TextPropsOptions, target: RenderingTarget, fontMetrics: FontMetricsLookup, cursor: GridCursor, kernedText: string): NormalizedTextRun[] {
    const fontFace = options.fontFace ?? PPTX_DEFAULTS.text.fontFace;
    const bold = options.bold ?? PPTX_DEFAULTS.text.bold;
    const italic = options.italic ?? PPTX_DEFAULTS.text.italic;
    const fallback = fallbackSegments(text, fontFace, bold, italic, target, fontMetrics);
    const font = RENDERING_TARGETS[target].advanceGridPt === undefined ? undefined : fontMetrics.glyphAdvances?.(fontFace, bold, italic);
    let segments: FallbackSegment[] = fallback;

    if (font) {
        segments = [];

        for (const segment of fallback) {
            for (const stretch of fullWidthStretches(segment.text, font)) {
                segments.push({ ...segment, text: stretch });
            }
        }
    }

    const runs: NormalizedTextRun[] = [];

    for (const [index, { text: stretch, fallbackFaces }] of segments.entries()) {
        const run = normalizeTextRun(stretch, options, target, fontMetrics, cursor, index === segments.length - 1 ? kernedText : "");

        // Only the first stretch starts after the piece's soft break.
        runs.push({ ...run, ...(fallbackFaces.length ? { fallbackFaces } : {}), ...(index ? { softBreakBefore: false } : {}) });
    }

    return runs;
}

/**
 * Whether `spacing` lays the paragraph out as spaced lines: lineSpacingMultiple 1 is the single line (singleLineEm),
 * which PowerPoint lays out as single spacing, and on a target that reads the fonts (RENDERING_TARGETS.fontLineBaseline)
 * so is a lineSpacing exactly as tall: measured against PowerPoint's PDF export of a synthetic deck, 10pt Arial in 12pt
 * lines puts its baseline 9.72pt down, the font's single-spaced one, where 0.75 of the line is 9 (8pt in 12pt lines:
 * 9). `fontSize` is the paragraph's largest, in px.
 */
function isSpaced(spacing: LineSpacing | undefined, fontSize: number, target: RenderingTarget): spacing is LineSpacing {
    if (spacing === undefined) {
        return false;
    }

    const single = PPTX_DEFAULTS.text.singleLineEm;

    if ("em" in spacing) {
        return spacing.em !== single;
    }

    return !(RENDERING_TARGETS[target].fontLineBaseline && Math.abs(spacing.exact - single * fontSize) < SINGLE_LINE_EPSILON);
}

/** Line heights closer than this, in px, are the same: PptxGenJS writes spacing in 1/100 pt, sizes in 1/100 pt. */
const SINGLE_LINE_EPSILON = 1e-6;

/**
 * A spacing of `points` as `target` reads the `<a:spcPts>` PptxGenJS writes (Math.round(points * 100)): PowerPoint
 * rounds it half-up to whole points (RENDERING_TARGETS.spacingWholePoints), so 0.49 is 0 and 0.5 is 1.
 */
function spacingPoints(points: number, target: RenderingTarget): number {
    if (!RENDERING_TARGETS[target].spacingWholePoints) {
        return points;
    }

    const { spacingPointsPerPoint } = PPTX_DEFAULTS.units;

    // Whole hundredths, as written, so the half-up step is exact integer arithmetic.
    return Math.floor((Math.round(points * spacingPointsPerPoint) + spacingPointsPerPoint / 2) / spacingPointsPerPoint);
}

/** How PptxGenJS 4.0.1 writes a box's runs, beyond the options PdfLapas draws the box with. */
export interface RunWriting {
    /**
     * The box's options as PptxGenJS holds them when it writes them onto the runs (STEP 6), without the face or color
     * PdfLapas fills in to draw them; the drawn options when unset.
     */
    readonly box?: PptxGenJS.TextPropsOptions;
    /** What PptxGenJS wrote onto run options objects in earlier boxes; this box's writes are added to it. */
    readonly shared?: SharedRunOptions;
    /** A table cell's text, which no addTextDefinition cleans. */
    readonly cell?: boolean;
}

/** A run options record of one box: the options it started from and the copy this box's writes go to. */
interface RunRecord {
    readonly start: PptxGenJS.TextPropsOptions;
    readonly state: PptxGenJS.TextPropsOptions;
}

/** Box options PptxGenJS 4.0.1 copies onto runs (STEP 6 C) that no run draws. */
const UNWRITTEN_RUN_OPTIONS: ReadonlySet<string> = new Set([
    // Left out by PptxGenJS.
    "bullet",
    // genXmlTextRunProperties never writes a run's shadow (normalizeText).
    "shadow",
    // Written as a link to `rIdundefined`, a relationship PptxGenJS never creates: the box's link stays the shape's.
    "hyperlink",
]);

/**
 * `target` decides what PptxGenJS's file leaves to the application drawing it (RENDERING_TARGETS); `fontMetrics` looks up
 * the metrics of the faces that place a single-spaced baseline where the target reads them (`fontLineBaseline`) and
 * decide whether it kerns them (`readsKern`), and `themeFontFace` is the theme's minor font (`pres.theme.bodyFontFace`),
 * the font of soft breaks and, unless `markFontFace` names the one PptxGenJS writes on `<a:endParaRPr>` (a table cell's
 * fontFace), of the paragraph mark. `writing` says how PptxGenJS writes the box's runs (RunWriting).
 */
export function normalizeText(
    input: TextInput,
    options: PptxGenJS.TextPropsOptions = {},
    target: RenderingTarget = DEFAULT_RENDERING_TARGET,
    fontMetrics: FontMetricsLookup = builtInFontMetrics,
    themeFontFace: string = PPTX_DEFAULTS.theme.bodyFontFace,
    markFontFace: string = themeFontFace,
    writing: RunWriting = {},
): NormalizedTextBox {
    // Refused even when every run sets its own (each paragraph below checks the align it uses).
    paragraphAlign(options.align);
    const records = new Map<object, RunRecord>();
    // PptxGenJS 4.0.1 genXmlTextBody STEP 4 keeps one mutable options record per run: the run's own options object, or
    // for a run without one, the `{}` addTextDefinition stores on it in a text box and the cell's own options in a table
    // cell. Every piece split from a run shares it, and so do the runs that share it, so a write to one is seen by all of
    // them. `records` holds them by that object; each starts as a copy of what earlier boxes left on it (sharedRunOptions).
    const source = Array.isArray(input) ? input.map(item => ({ text: String(item.text ?? ""), key: item.options ?? item, own: item.options ?? {} })) : [{ text: String(input), key: options, own: options }];
    const pieces: TextPiece[] = [];

    for (const item of source) {
        const record = records.get(item.key);
        // A copy, so the mutations below never reach the caller's options.
        const runOptions = record?.state ?? sharedRunOptions(Array.isArray(input) ? writing.shared : undefined, item.key, item.own);

        if (!record) {
            // A run's own `shadow` draws nothing: PptxGenJS 4.0.1 genXmlTextRunProperties writes only `glow` into the run's
            // <a:effectLst> (COMPATIBILITY.text runShadow). A string's options are the text box's, whose shadow is written.
            if (Array.isArray(input)) {
                delete runOptions.shadow;
            }

            records.set(item.key, { start: { ...runOptions }, state: runOptions });
        }

        const text = item.text.replace(/\r\n?/g, "\n");
        // STEP 4 C splits a text with a line feed that does not end with one, and sets `breakLine` on the shared record,
        // so every piece ends a paragraph, the last one too. A text ending with a line feed is written whole, its line
        // feeds kept inside `<a:t>` (cut into paragraphs below).
        const itemLines = text.endsWith("\n") ? [text] : text.split("\n");

        if (itemLines.length > 1) {
            runOptions.breakLine = true;
        }

        for (const line of itemLines) {
            pieces.push({ text: line, options: runOptions, ...(line ? {} : { noRun: true }) });
        }
    }

    // STEP 4 A gives the first run the box's bullet.
    const firstRun = pieces[0]?.options;
    const box = writing.box ?? options;

    if (firstRun && !firstRun.bullet && box.bullet) {
        firstRun.bullet = box.bullet;
    }

    // PptxGenJS 4.0.1 genXmlTextBody (STEP 5) groups the runs into `<a:p>`s: when the run or the box has `align`, only a
    // change of the run's align starts a paragraph and `bullet` is not checked (the bullet test is an `else if`).
    // Otherwise a bullet run starts a paragraph and its `breakLine` is cleared on the shared record, so it does not also
    // end one.
    const lines: TextPiece[][] = [];
    let current: TextPiece[] = [];

    for (const [index, piece] of pieces.entries()) {
        const runOptions = piece.options;

        if (current.length > 0) {
            const aligned = Boolean(runOptions.align || options.align);
            const startsGroup = aligned ? runOptions.align !== pieces[index - 1]?.options.align : Boolean(runOptions.bullet);

            if (startsGroup) {
                lines.push(current);
                current = [];

                if (!aligned) {
                    runOptions.breakLine = false;
                }
            }
        }

        current.push(piece);

        if (runOptions.breakLine && index + 1 < pieces.length) {
            lines.push(current);
            current = [];
        }
    }

    if (current.length || lines.length === 0) {
        lines.push(current);
    }

    // PptxGenJS 4.0.1 genXmlTextBody STEP 6 writes the box's options onto each run's options, paragraph by paragraph:
    // each one the run leaves falsy (B for the paragraph options, C for the rest but `bullet`, and `color` on a linked
    // run), so `bold: false` or `paraSpaceAfter: 0` in a box that sets them takes the box's; and E gives an unsized box
    // the size of its first sized run, which the runs after it then take.
    // `Record`: options are written by name, which the declared option type does not index.
    const written: Record<string, unknown> = { ...box };

    for (const line of lines) {
        for (const { options: lineOptions } of line) {
            // `as`: the same record, written by name; its pieces read the writes.
            const run = lineOptions as Record<string, unknown>;

            for (const [name, value] of Object.entries(written)) {
                if (!run[name] && !UNWRITTEN_RUN_OPTIONS.has(name) && !(name === "color" && run.hyperlink)) {
                    run[name] = value;
                }
            }

            written.fontSize ||= run.fontSize;
        }
    }

    for (const [key, { start, state }] of records) {
        // A string's options and a cell's option-less runs are the box's own, not a run options object.
        if (writing.shared && Array.isArray(input) && key !== options) {
            recordSharedRun(writing.shared, key, start, state);
        }

        // A table cell gets no addTextDefinition, which turns a text box's `underline: true` into `{ style: "sng" }`:
        // in a cell the boolean writes no `u`. Set after STEP 6, which keeps the cell's underline off the run.
        // `unknown`: PptxGenJS's types declare only the object form; the boolean works at runtime.
        const underline: unknown = state.underline;

        if (writing.cell && underline === true) {
            Object.assign(state, { underline: false });
        }
    }

    const groups: PieceGroup[] = [];
    // The size PptxGenJS 4.0.1 genXmlTextBody writes on each `<a:p>`'s `<a:endParaRPr>`: the box's or cell's `fontSize`,
    // else the first truthy run `fontSize` up to the end of that `<a:p>` (step 6 E sets the shared options' `fontSize`
    // from it), else none. So "A" then an empty run with `fontSize: 20` in an 8pt cell writes `sz="800"` on the empty `<a:p>`.
    let markSize = options.fontSize || undefined;

    for (const line of lines) {
        for (const piece of line) {
            markSize ||= piece.options.fontSize || undefined;
        }

        // An `<a:p>`'s pieces cut at each line feed inside a run's `<a:t>`, which PowerPoint draws as a new paragraph.
        let feedPieces: TextPiece[] = [];
        const feedGroups = [feedPieces];

        for (const piece of line) {
            const texts = piece.text.split("\n");

            for (const [index, text] of texts.entries()) {
                if (index > 0) {
                    feedPieces = [];
                    feedGroups.push(feedPieces);
                }

                feedPieces.push(texts.length === 1 ? piece : { ...piece, text, ...(index === texts.length - 1 ? { tail: true } : {}) });
            }
        }

        for (const [index, feedGroup] of feedGroups.entries()) {
            groups.push({ pieces: feedGroup, paragraph: line[0]?.options, endsParagraph: index === feedGroups.length - 1, markFontSize: markSize });
        }
    }

    const { addsParagraphSpacing, spacesFirstParagraph, emptyNumberedParagraph } = RENDERING_TARGETS[target];
    let lists: readonly NumberSequence[] = [];
    const paragraphs: NormalizedTextParagraph[] = [];

    for (const [index, group] of groups.entries()) {
        // PowerPoint and LibreOffice give the empty text after a run's last line feed no size in a paragraph that holds
        // other text (measured against PowerPoint's PDF export); alone, it is an empty paragraph in the run's font. Without
        // it, the paragraph's properties come from its next run.
        const paragraphPieces = group.pieces.some(piece => !piece.tail) ? group.pieces.filter(piece => !piece.tail) : group.pieces;
        // PptxGenJS writes an <a:pPr> before every run of an <a:p>; PowerPoint reads the first for every paragraph its line
        // feeds make, LibreOffice the one of the run starting each line (RENDERING_TARGETS.lineFeedParagraph).
        const first = inheritedOptions(options, RENDERING_TARGETS[target].lineFeedParagraph === "paragraph" ? group.paragraph : paragraphPieces[0]?.options);
        // PptxGenJS writes lineSpacing as <a:spcPts> (exact points) and else lineSpacingMultiple as <a:spcPct> (of the single
        // line, 1.2x the font size); a 0 writes neither.
        const spacing: LineSpacing | undefined = first.lineSpacing ? { exact: pointsToPixels(spacingPoints(first.lineSpacing, target)) } : first.lineSpacingMultiple ? { em: PPTX_DEFAULTS.text.singleLineEm * first.lineSpacingMultiple } : undefined;
        // An <a:p> PptxGenJS writes without a run holds only its <a:endParaRPr>, and PowerPoint and LibreOffice draw it one
        // line at the size written there, not the size of the empty run it came from: measured against PowerPoint's PDF
        // export of synthetic decks and LibreOffice's, "A\n\nZ" at 12pt in an 8pt text box or table cell puts Z 24pt below
        // A (14.4 + 9.6), in a 20pt one 38.4pt (14.4 + 24). Unset (no `sz`) is the default size.
        const runless = paragraphPieces.every(piece => piece.noRun);
        const pieceOptions = (piece: TextPiece) => inheritedOptions(options, runless ? { ...piece.options, fontSize: group.markFontSize ?? PPTX_DEFAULTS.text.fontSizePt } : piece.options);
        // One advance grid sum for the paragraph's runs, in order (GridCursor).
        const cursor: GridCursor = { rounded: 0, laidOut: 0 };
        const normalizedRuns: NormalizedTextRun[] = [];

        for (const [pieceIndex, piece] of paragraphPieces.entries()) {
            const runOptions = pieceOptions(piece);
            // The text after this piece that PowerPoint kerns with it, up to `wordAfter`: the next pieces while both are
            // kerned in one face, size, weight and style, before a soft break. Measured against PowerPoint's PDF export of
            // a synthetic deck: a pair split by a change of colour, underline or nothing is kerned, by bold or size it is
            // not (#342).
            let kernedText = "";

            if (kerned(runOptions, target, fontMetrics)) {
                const { fontFace, bold, italic, fontSizePt } = PPTX_DEFAULTS.text;
                const font = (run: PptxGenJS.TextPropsOptions) => [run.fontFace ?? fontFace, run.bold ?? bold, run.italic ?? italic, run.fontSize ?? fontSizePt, run.superscript, run.subscript, run.baseline].join("|");
                let after = "";

                for (const next of paragraphPieces.values().drop(pieceIndex + 1)) {
                    const nextOptions = pieceOptions(next);

                    if (nextOptions.softBreakBefore || font(nextOptions) !== font(runOptions) || !kerned(nextOptions, target, fontMetrics)) {
                        break;
                    }

                    after += next.text;

                    if (next.text.includes(" ") || next.text.includes("\t")) {
                        break;
                    }
                }

                kernedText = wordAfter(after);
            }

            // The runs of the piece: one, or in a language with the target's `hangingMarks`, one per stretch around each
            // mark that hangs (normalize/eastAsianLineBreak.ts).
            // A soft break starts a line, so the sums start again with it, exactly where PowerPoint's line does.
            if (runOptions.softBreakBefore) {
                Object.assign(cursor, { rounded: 0, laidOut: 0, word: undefined });
            }

            const marks = languageHangingMarks(runOptions.lang ?? PPTX_DEFAULTS.theme.language, RENDERING_TARGETS[target].hangingMarks);

            if (!marks) {
                normalizedRuns.push(...fallbackRuns(piece.text, runOptions, target, fontMetrics, cursor, kernedText));
            } else {
                const next = paragraphPieces[pieceIndex + 1];
                const after = next && !next.options.softBreakBefore ? [...next.text][0] : undefined;
                const font = fontMetrics.glyphAdvances?.(runOptions.fontFace ?? PPTX_DEFAULTS.text.fontFace, runOptions.bold ?? PPTX_DEFAULTS.text.bold, runOptions.italic ?? PPTX_DEFAULTS.text.italic);
                const segments = hangingSegments(piece.text, after, marks);

                for (const [segmentIndex, { text, hangs }] of segments.entries()) {
                    const rest = segments.slice(segmentIndex + 1).map(segment => segment.text);
                    // A word does not go on into a mark that hangs: the mark's advance is cancelled and its U+3000 laid out apart.
                    const kernedWith = segments[segmentIndex + 1]?.hangs ? "" : wordAfter(`${rest.join("")}${kernedText}`);

                    for (const run of fallbackRuns(text, runOptions, target, fontMetrics, cursor, kernedWith)) {
                        // Only the piece's first stretch starts after its soft break.
                        const segment = segmentIndex ? { ...run, softBreakBefore: false } : run;

                        if (hangs) {
                            normalizedRuns.push(...hangingMarkRuns(segment, font));
                        } else {
                            normalizedRuns.push(segment);
                        }
                    }
                }
            }
        }

        const { joinsOpeningBracket, breaksAroundHanPunctuation, hangingMarks } = RENDERING_TARGETS[target];
        let joinedRuns = normalizedRuns;

        if (joinsOpeningBracket) {
            // A WORD_JOINER at each BEFORE_OPENING_BRACKET point, also where a run ends with ")" and the next run on the
            // same line starts with "(". Added after normalizeTextRun, so the advance grid's spacing does not count it, as
            // Chromium gives it no letter-spacing.
            joinedRuns = [];

            for (const [runIndex, run] of normalizedRuns.entries()) {
                const previous = run.softBreakBefore ? "" : (normalizedRuns[runIndex - 1]?.text.at(-1) ?? "");
                const text = `${previous}${run.text}`.replace(BEFORE_OPENING_BRACKET, WORD_JOINER).slice(previous.length);

                joinedRuns.push(text === run.text ? run : { ...run, text });
            }
        }

        let runs = joinedRuns;

        if (breaksAroundHanPunctuation) {
            // breakAroundHanPunctuation in each run, also at a mark on a run's edge.
            runs = [];

            for (const [runIndex, run] of joinedRuns.entries()) {
                const previous = run.softBreakBefore ? "" : (joinedRuns[runIndex - 1]?.text.at(-1) ?? "");
                const following = joinedRuns[runIndex + 1];
                const next = following && !following.softBreakBefore ? following.text.charAt(0) : "";
                const text = breakAroundHanPunctuation(run.text, previous, next, languageHangingMarks(run.language, hangingMarks) !== undefined);

                runs.push(text === run.text ? run : { ...run, text });
            }
        }

        // The mark of a paragraph whose <a:p> ends here, at its last run's size before a super/subscript reduction
        // (RENDERING_TARGETS.fullSizeMark); a line feed ends its line in the run's own font.
        const lastPiece = paragraphPieces.at(-1);
        const markFontSize = group.endsParagraph && lastPiece && RENDERING_TARGETS[target].fullSizeMark ? runFontSize(pieceOptions(lastPiece)) : undefined;
        const lineBox = paragraphLineBox({ runs, spacing }, target, fontMetrics, themeFontFace, markFontFace, markFontSize);
        // A line feed ends its line in the run's own font: only the <a:p>'s last line holds the paragraph mark.
        const { markBaseline: _markBaseline, ...feedLineBox } = lineBox;

        const align = paragraphAlign(first.align) ?? PPTX_DEFAULTS.text.align;
        const tabStops = (first.tabStops ?? [])
            .map(stop => ({
                // PptxGenJS writes `stop.position || 1` and `stop.alignment || "l"`.
                position: inch2EmuToPixels(stop.position || 1),
                alignment: TAB_ALIGNMENT_MAP[stop.alignment ?? "l"] ?? "left",
            }))
            .toSorted((a, b) => a.position - b.position);
        const level = paragraphLevel(first);
        let bullet: NormalizedTextBullet | undefined;

        if (first.bullet) {
            const config = typeof first.bullet === "object" ? first.bullet : {};
            const indentPt = config.indent ?? config.marginPt ?? PPTX_DEFAULTS.bullet.indentPt;
            const kind = config.type === "number" ? "number" : "bullet";
            const start = config.numberStartAt ?? config.startAt ?? PPTX_DEFAULTS.bullet.numberStartAt;
            const numberType = config.style ?? PPTX_DEFAULTS.bullet.numberType;
            const code = config.characterCode ?? config.code;

            let marker: string = PPTX_DEFAULTS.bullet.character;

            if (kind === "number") {
                // The marker of the paragraph's number in the list open at its level, in `numberType`'s style.
                const value = start + sequenceIndex(lists, { level, numberType, start });
                let core = String(value);

                if (numberType.startsWith("alphaLc")) {
                    core = generateAlpha(value, false);
                } else if (numberType.startsWith("alphaUc")) {
                    core = generateAlpha(value, true);
                } else if (numberType.startsWith("romanLc")) {
                    core = generateRoman(value, false);
                } else if (numberType.startsWith("romanUc")) {
                    core = generateRoman(value, true);
                }

                if (numberType.endsWith("ParenBoth")) {
                    marker = `(${core})`;
                } else if (numberType.endsWith("ParenR")) {
                    marker = `${core})`;
                } else if (numberType.endsWith("Plain")) {
                    marker = core;
                } else {
                    marker = `${core}.`;
                }
            } else if (code && /^[0-9a-f]{4,6}$/i.test(code)) {
                marker = String.fromCodePoint(parseInt(code, 16));
            }

            bullet = { kind, marker, indent: pointsToPixels(indentPt * (level + 1)), level, start, numberType };
        }

        // Where the text ends below its last line's bottom, in px, when this paragraph is the last: 0 except with explicit
        // spacing on a target that reads the fonts (RENDERING_TARGETS.fontLineBaseline), where PowerPoint ends the line at
        // its baseline plus its fonts' single-spaced descent, not at the spaced line's height. Measured against its PDF
        // export of a synthetic deck (Arial, one-line cells in rows sized to their text, margins 0 and 3.6pt): 8pt in 12pt
        // lines makes a 10.82pt row (9 + 1.82), 10pt at 1.2x lines a 13.08pt one (10.8 + 2.28), and 10pt in 12pt lines
        // 12pt (9.72 + 2.28).
        // shortcut: with lines spaced closer than that the end would fall below the line, which was not measured, so it
        // stays at the line's bottom; measure it when a deck needs it.
        const largestSize = Math.max(0, ...runs.map(run => run.fontSize));
        const lineEndOffset = !RENDERING_TARGETS[target].fontLineBaseline || !isSpaced(spacing, largestSize, target) ? 0 : Math.min(0, lineBox.baseline + singleLineExtents(runs, fontMetrics).descent - lineBox.height);
        // A paragraph PptxGenJS writes without a run gets no marker in PowerPoint or LibreOffice.
        const runlessGroup = group.pieces.every(piece => piece.noRun);
        const empty = runs.every(run => !run.text);
        // Shallower levels' lists stay open; a paragraph ends its own level's and deeper ones, and a numbered one
        // reopens its own (sequenceIndex).
        const shallower = lists.filter(open => open.level < level);

        if (bullet?.kind !== "number") {
            lists = shallower;
        } else {
            const numberIndex = sequenceIndex(lists, bullet);
            const next = emptyNumberedParagraph === "skipped" ? numberIndex + (empty ? 0 : 1) : runlessGroup ? 0 : numberIndex + 1;

            lists = [...shallower, { level, numberType: bullet.numberType, start: bullet.start, next }];
        }

        // shortcut: PowerPoint's dropped first space before was measured on top-anchored text boxes only; middle and
        // bottom anchors and table cells follow the same rule until a measurement says otherwise.
        const firstSpace = index === 0 && !spacesFirstParagraph ? { spaceBefore: 0 } : {};
        // PowerPoint and LibreOffice leave the last paragraph's space after out of the text height, so it does not
        // lift middle- or bottom-anchored text (or grow a table row); the text ends where its last line does.
        const lastSpace = index === groups.length - 1 ? { spaceAfter: lineEndOffset } : {};

        paragraphs.push({
            runs,
            align,
            ...(align === "justify" && RENDERING_TARGETS[target].justifiesAtSpaces ? { textJustify: "inter-word" as const } : {}),
            rtl: first.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
            lineBox: group.endsParagraph ? lineBox : feedLineBox,
            spaceBefore: pointsToPixels(spacingPoints(first.paraSpaceBefore ?? 0, target)),
            spaceAfter: pointsToPixels(spacingPoints(first.paraSpaceAfter ?? 0, target)),
            tabStops,
            defaultTabStop: inchesToPixels(PPTX_DEFAULTS.text.defaultTabStopIn),
            ...(bullet && !runlessGroup ? { bullet } : {}),
            ...firstSpace,
            ...lastSpace,
        });
    }

    // CSS keeps only the larger of two adjacent margins; a target that adds them gets each space after moved onto
    // the next paragraph's space before, so the gap is their sum in every renderer. The last keeps its line end.
    const lastIndex = paragraphs.length - 1;
    const spaced = addsParagraphSpacing ? paragraphs.map((paragraph, index) => ({ ...paragraph, spaceBefore: paragraph.spaceBefore + (paragraphs[index - 1]?.spaceAfter ?? 0), spaceAfter: index === lastIndex ? paragraph.spaceAfter : 0 })) : paragraphs;

    const vert = options.vert ?? PPTX_DEFAULTS.text.textDirection;
    let direction: NormalizedTextBox["direction"] = "horizontal";

    if (vert === "vert") {
        direction = "vertical";
    } else if (vert === "vert270") {
        direction = "vertical270";
    } else if (vert?.includes("wordArtVert")) {
        direction = "stacked";
    }

    let fit: NormalizedTextBox["fit"];

    if (options.fit) {
        fit = options.fit;
    } else if (options.shrinkText) {
        fit = "shrink";
    } else if (options.autoFit) {
        fit = "resize";
    } else {
        fit = PPTX_DEFAULTS.text.fit;
    }

    return {
        paragraphs: spaced,
        margin: textMarginPixels(options.margin, options.inset),
        verticalAlign: verticalAlign(options.valign, writing.cell ? "tableCell" : "textBox") ?? PPTX_DEFAULTS.text.valign,
        wrap: options.wrap ?? PPTX_DEFAULTS.text.wrap,
        fit,
        direction,
        rtl: options.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
    };
}

/** A paragraph's explicit line spacing: `exact` px (lineSpacing), or `em`, a multiple of its largest font size (lineSpacingMultiple). */
export type LineSpacing = { readonly exact: number } | { readonly em: number };

/** The runs that set a paragraph's line box, and its explicit spacing, if any. */
type LineBoxInput = Pick<NormalizedTextParagraph, "runs"> & { readonly spacing?: LineSpacing };

/**
 * LibreOffice's font-independent line box for a paragraph (PPTX_DEFAULTS.text.singleLineEm), in px:
 * `height` is each line's height and `baseline` its baseline's distance below the line top, both set
 * by the paragraph's largest run. Chromium's own line box depends on each font's ascent and descent.
 * `target` may place the baseline differently: with explicit spacing (RENDERING_TARGETS.spacedLineBaseline), and with
 * single spacing from the runs' fonts (RENDERING_TARGETS.fontLineBaseline), where the paragraph mark and soft breaks,
 * set in `markFontFace` and `themeFontFace`, may move the last line and the lines ending in a break (`markBaseline`,
 * `breakBaseline`). `markFontSize` is the mark's size when it is not the last run's (RENDERING_TARGETS.fullSizeMark):
 * it counts in the line's height as well. A raised or lowered run grows the line where it sticks out of it
 * (RENDERING_TARGETS.escapementGrowsLine). Each baseline then goes on the target's grid
 * (RENDERING_TARGETS.baselineGridPerInch).
 */
export function paragraphLineBox(paragraph: LineBoxInput, target: RenderingTarget = DEFAULT_RENDERING_TARGET, fontMetrics: FontMetricsLookup = builtInFontMetrics, themeFontFace: string = PPTX_DEFAULTS.theme.bodyFontFace, markFontFace: string = themeFontFace, markFontSize?: number): NormalizedTextParagraph["lineBox"] {
    // The line box before the baseline grid.
    // shortcut: one line box per paragraph, so a full-size mark sets the height of every line, not only the last; split
    // it per line when the model gets a line box per line.
    const fontSize = Math.max(...paragraph.runs.map(run => run.fontSize), markFontSize ?? 0) || pointsToPixels(PPTX_DEFAULTS.text.fontSizePt);
    const { spacing } = paragraph;
    const single = lineBoxOf(fontSize, spacing === undefined ? undefined : "exact" in spacing ? spacing.exact : spacing.em * fontSize);
    const { spacedLineBaseline, fontLineBaseline } = RENDERING_TARGETS[target];
    let box: NormalizedTextParagraph["lineBox"];

    if (isSpaced(spacing, fontSize, target)) {
        box = spacedLineBaseline !== undefined ? { ...single, baseline: spacedLineBaseline * single.height } : single;
    } else {
        const { runs } = paragraph;
        const last = runs.at(-1);

        if (!fontLineBaseline || !last) {
            box = single;
        } else {
            // PowerPoint counts the paragraph mark on the last line and a soft break on the line it ends, at the size of the
            // last run and of the run before the break; in a paragraph with a run it ignores the size PptxGenJS writes on
            // <a:endParaRPr> (a run-less one takes it, normalizeText) but reads its typeface,
            // written only in table cells (markFontFace), else takes the theme font.
            // shortcut: one line box per paragraph, so every line holds all the paragraph's runs and every break the largest
            // size before one; split it per line when the model gets a line box per line.
            const baseline = fontBaseline(runs, single.height, fontMetrics);
            const markBaseline = fontBaseline([...runs, { fontFace: markFontFace, fontSize: markFontSize ?? last.fontSize }], single.height, fontMetrics);
            const breakSize = Math.max(0, ...runs.map((run, index) => (index > 0 && run.softBreakBefore ? (runs[index - 1]?.fontSize ?? 0) : 0)));
            const breakBaseline = breakSize ? fontBaseline([...runs, { fontFace: themeFontFace, fontSize: breakSize }], single.height, fontMetrics) : baseline;

            box = { ...single, baseline, ...(markBaseline !== baseline ? { markBaseline } : {}), ...(breakBaseline !== baseline ? { breakBaseline } : {}) };
        }
    }

    // An exact line height (`<a:spcPts>`) is fixed whatever the line holds.
    const exact = paragraph.spacing !== undefined && "exact" in paragraph.spacing;

    if (RENDERING_TARGETS[target].escapementGrowsLine && !exact) {
        // The box grown by what the paragraph's raised or lowered runs stick out of it: each reaches the font-independent
        // line box at its drawn size, 1em above and `text.lineDescentEm` below its baseline, moved by its `baselineOffset`
        // (RENDERING_TARGETS.libreoffice). An empty run draws nothing and grows nothing, as in #294.
        // shortcut: one line box per paragraph, so the growth applies to every line of the paragraph, not only the one
        // holding the run; split it per line when the model gets a line box per line.
        // shortcut: with `lineSpacingMultiple` the growth is added to the spaced line unscaled, which LibreOffice's export
        // was not measured for; measure it when a deck combines the two.
        const { singleLineEm, lineDescentEm } = PPTX_DEFAULTS.text;
        const ascentEm = singleLineEm - lineDescentEm;
        const drawn = paragraph.runs.filter(run => run.text !== "");
        const size = Math.max(0, ...drawn.map(run => run.fontSize));
        const above = Math.max(0, ...drawn.map(run => ascentEm * run.fontSize + run.baselineOffset - ascentEm * size));
        const below = Math.max(0, ...drawn.map(run => lineDescentEm * run.fontSize - run.baselineOffset - lineDescentEm * size));

        if (above || below) {
            const { height, baseline, markBaseline, breakBaseline } = box;

            box = {
                height: height + above + below,
                baseline: baseline + above,
                ...(markBaseline === undefined ? {} : { markBaseline: markBaseline + above }),
                ...(breakBaseline === undefined ? {} : { breakBaseline: breakBaseline + above }),
            };
        }
    }

    // Each baseline on the target's grid, a mark or break baseline kept only where it still differs.
    const { baselineGridPerInch } = RENDERING_TARGETS[target];

    if (baselineGridPerInch === undefined) {
        return box;
    }

    // One division of whole numbers, so the HTML writes 23.36, not 23.359999999999996.
    const { cssDpi } = PPTX_DEFAULTS.units;
    const onGrid = (value: number) => (Math.round((value * baselineGridPerInch) / cssDpi) * cssDpi) / baselineGridPerInch;
    const { height, baseline, markBaseline, breakBaseline } = box;
    const [line, mark, soft] = [onGrid(baseline), markBaseline === undefined ? undefined : onGrid(markBaseline), breakBaseline === undefined ? undefined : onGrid(breakBaseline)];

    return { height, baseline: line, ...(mark !== undefined && mark !== line ? { markBaseline: mark } : {}), ...(soft !== undefined && soft !== line ? { breakBaseline: soft } : {}) };
}

/**
 * The single-spaced baseline below the top of a `height` px line holding `runs`: each reaches 1.2x its size, split by
 * its font's winAscent : winDescent; the largest ascent is the baseline, scaled down with the largest descent when the
 * two overflow the line.
 */
function fontBaseline(runs: ReadonlyArray<Pick<NormalizedTextRun, "fontFace" | "fontSize">>, height: number, fontMetrics: FontMetricsLookup): number {
    const { ascent, descent } = singleLineExtents(runs, fontMetrics);

    return ascent + descent > height ? (ascent * height) / (ascent + descent) : ascent;
}

/** The largest single-spaced ascent and descent of `runs`: each reaches 1.2x its size, split by its font's winAscent : winDescent. */
function singleLineExtents(runs: ReadonlyArray<Pick<NormalizedTextRun, "fontFace" | "fontSize">>, fontMetrics: FontMetricsLookup): { ascent: number; descent: number } {
    let ascent = 0;
    let descent = 0;

    for (const run of runs) {
        // The part of a single-spaced line above the baseline in the run's font, else the font-independent 1em of 1.2em.
        const metrics = fontMetrics(run.fontFace);
        const { singleLineEm, lineDescentEm } = PPTX_DEFAULTS.text;
        const share = metrics ? metrics.winAscent / (metrics.winAscent + metrics.winDescent) : (singleLineEm - lineDescentEm) / singleLineEm;

        ascent = Math.max(ascent, share * PPTX_DEFAULTS.text.singleLineEm * run.fontSize);
        descent = Math.max(descent, (1 - share) * PPTX_DEFAULTS.text.singleLineEm * run.fontSize);
    }

    return { ascent, descent };
}

/** The line box for a paragraph whose largest run is `fontSize` px: `height` px tall, or a single line. */
export function lineBoxOf(fontSize: number, height = PPTX_DEFAULTS.text.singleLineEm * fontSize): NormalizedTextParagraph["lineBox"] {
    return { height, baseline: height - PPTX_DEFAULTS.text.lineDescentEm * fontSize };
}

/** Steps closer than this to the grid count as on it: well under the 1e-3pt PptxGenJS's EMU keeps. */
const WRAP_GRID_EPSILON = 1e-6;

/**
 * The target's floor of the width inside the left and right insets (RENDERING_TARGETS.wrapWidthGridPt), moved into the
 * right inset so every renderer wraps at it: `width` is the box's, or a table cell's columns', in px. Right-to-left text
 * too: its left-aligned lines start at the left inset whatever the remainder (target/powerpoint.ts). Text that does not
 * wrap, or runs vertically, keeps its insets.
 */
export function floorTextWrapWidth(text: NormalizedTextBox, width: number, target: RenderingTarget): NormalizedTextBox {
    const grid = RENDERING_TARGETS[target].wrapWidthGridPt;

    if (grid === undefined || !text.wrap || text.direction !== "horizontal") {
        return text;
    }

    const [top, right, bottom, left] = text.margin;
    const step = pointsToPixels(grid);
    const inner = width - left - right;
    // A width on the grid in inches comes back a hair under it in px; it is on the grid.
    const remainder = inner - Math.floor(inner / step + WRAP_GRID_EPSILON) * step;

    if (inner <= 0 || remainder <= WRAP_GRID_EPSILON * step) {
        return text;
    }

    return { ...text, margin: [top, right + remainder, bottom, left] };
}

/**
 * A box shorter than its top and bottom insets: PowerPoint collapses the text area onto the box's vertical
 * midline, and the text is drawn from there by its anchor. LibreOffice (26.2, the visual image) draws the
 * same with equal insets; with unequal ones it lands between the midline and the inverted inset rectangle.
 */
export function collapseTextMargins(text: NormalizedTextBox, height: number): NormalizedTextBox {
    const [top, right, bottom, left] = text.margin;

    if (top + bottom <= height) {
        return text;
    }

    return { ...text, margin: [height / 2, right, height / 2, left] };
}
