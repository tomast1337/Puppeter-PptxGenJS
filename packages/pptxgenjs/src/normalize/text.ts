import type PptxGenJS from "pptxgenjs";
import { type FontMetricsLookup, type FontWinMetrics, PPTX_DEFAULTS } from "#src/defaults";
import { DEFAULT_RENDERING_TARGET, RENDERING_TARGETS, type RenderingTarget } from "#src/target/index";
import { builtInFontMetrics } from "#src/fontMetrics";
import type { NormalizedShadow, NormalizedTextBox, NormalizedTextBullet, NormalizedTextParagraph, NormalizedTextRun } from "@pdflapas/model";
import { inchesToPixels, pointsToPixels } from "@pdflapas/model";
import { inch2EmuToPixels } from "#src/units";
import { advanceGridWordSpacing, runPieces } from "./advanceGrid";
import { breakAroundHanPunctuation, hangingMarkRuns, hangingSegments, languageHangingMarks } from "./eastAsianLineBreak";
import { normalizeHyperlink } from "./link";
import { textMarginPixels } from "./margin";
import { recordSharedRun, type SharedRunOptions, sharedRunOptions } from "./sharedRunOptions";
import { normalizeColor, normalizeShadow } from "./style";
import { OOXML_PERCENT } from "./shape/path";

export type TextInput = string | number | PptxGenJS.TextProps[];

/** U+2060 WORD JOINER: no line break on either side, and drawn as nothing by Chromium and pdf-core. */
const WORD_JOINER = "⁠";
/** The point between a closing bracket or "%" and an opening bracket (RENDERING_TARGETS.joinsOpeningBracket). */
const BEFORE_OPENING_BRACKET = /(?<=[)\]}%])(?=[([{])/gu;
/** U+2011 NON-BREAKING HYPHEN (RENDERING_TARGETS.nonBreakingHyphen). */
const NON_BREAKING_HYPHEN = "\u2011";

interface TextPiece {
    text: string;
    /** The run's options record, shared and mutated as in PptxGenJS (piecesFromInput). */
    options: PptxGenJS.TextPropsOptions;
    /** PptxGenJS writes no `<a:r>` for this piece: an empty text of its own (genXmlTextRun skips it). */
    noRun?: boolean;
    /** The empty text after a run's last line feed: a paragraph of its own only when nothing else falls into it (paragraphFromPieces). */
    tail?: boolean;
}

/** One paragraph of the model: an `<a:p>`'s pieces up to a line feed kept inside `<a:t>`, or to the `<a:p>`'s end. */
interface PieceGroup {
    pieces: TextPiece[];
    /** The options of the `<a:p>`'s first run, whose `<a:pPr>` PowerPoint reads for each of its paragraphs. */
    paragraph: PptxGenJS.TextPropsOptions | undefined;
    /** The group ends its `<a:p>`, so its last line holds the paragraph mark, not a line feed. */
    endsParagraph: boolean;
    /** The size PptxGenJS writes on the `<a:p>`'s `<a:endParaRPr>`, in points (markFontSizes); unset is no `sz`. */
    markFontSize: number | undefined;
}

// --- UTILITIES ---

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

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
    if (child.hyperlink && child.color == null) delete inherited.color;
    return inherited;
}

// --- TEXT STYLING ---

function underlineStyle(style?: string): NormalizedTextRun["decoration"]["underlineStyle"] {
    if (style === "dbl" || style === "wavyDbl") return "double";
    if (style?.includes("dash") || style?.includes("Dash")) return "dashed";
    if (style?.includes("dot") || style?.includes("Dot")) return "dotted";
    if (style?.includes("wavy")) return "wavy";
    return "solid";
}

/**
 * The `u` PptxGenJS 4.0.1 genXmlTextRunProperties writes for a run: `underline.style`, a string as given (deprecated
 * since 3.5.0, still written), or `sng` for a hyperlink. addTextDefinition turns `underline: true` on a text box or its
 * runs into `{ style: "sng" }`; a table cell's `true` stays a boolean (tableTextOptions) and writes no `u`.
 */
function underlineType(options: PptxGenJS.TextPropsOptions): string | undefined {
    // `unknown`: PptxGenJS's types declare only the object form; the string and boolean forms work at runtime.
    const underline: unknown = options.underline;
    if (typeof underline === "string") return underline;
    if (underline === true) return "sng";
    return options.underline?.style || (options.hyperlink ? "sng" : undefined);
}

function textShadow(options: PptxGenJS.TextPropsOptions): NormalizedShadow | undefined {
    if (!options.glow) return undefined;
    return {
        visible: true,
        color: normalizeColor({
            color: options.glow.color ?? PPTX_DEFAULTS.text.glowWhenEnabled.color,
            transparency: (1 - clamp(options.glow.opacity, 0, 1)) * 100,
        }),
        blur: pointsToPixels(options.glow.size),
        offsetX: 0,
        offsetY: 0,
        inset: false,
    };
}

function getVerticalAlign(options: PptxGenJS.TextPropsOptions): "sub" | "super" | "baseline" {
    if (options.subscript) return "sub";
    if (options.superscript) return "super";
    return "baseline";
}

/**
 * Whether `target` kerns a run: PptxGenJS writes `kern="0"` with `charSpacing`, and inherits 12pt otherwise. PowerPoint
 * kerns only from a face's `kern` table, never from GPOS (target/powerpoint.ts): a face whose `pairKerning` is false, or
 * whose advances in the run's weight and style are read with no `kern` pairs, is drawn unkerned.
 * shortcut: a face whose advances are not read (its font is not readable) and whose `pairKerning` is not false is
 * kerned, so the renderers kern it from GPOS where PowerPoint may not; pass its advances or `pairKerning` when a deck
 * uses one.
 */
function kerned(options: PptxGenJS.TextPropsOptions, target: RenderingTarget, fontMetrics: FontMetricsLookup): boolean {
    if (!RENDERING_TARGETS[target].readsKern) return true;
    if (options.charSpacing || (options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt) < PPTX_DEFAULTS.text.kernMinSizePt) return false;
    const fontFace = options.fontFace ?? PPTX_DEFAULTS.text.fontFace;
    if (fontMetrics(fontFace)?.pairKerning === false) return false;
    const advances = fontMetrics.glyphAdvances?.(fontFace, options.bold ?? PPTX_DEFAULTS.text.bold, options.italic ?? PPTX_DEFAULTS.text.italic);
    return advances === undefined || Boolean(advances.kerning?.size);
}

/**
 * The letter-spacing in px of a run's spaces and of each of its words: `charSpacing`, plus on a target with an advance
 * grid the rounding of the run's advances to it, and its pair kerning when `kerned` (advanceGridWordSpacing), at the
 * size it is drawn at, reduced when `escaped`. A run of one word takes that word's; without a grid, or advances for the run's face, weight and style,
 * every character takes `charSpacing`.
 */
function runSpacing(text: string, options: PptxGenJS.TextPropsOptions, escaped: boolean, target: RenderingTarget, fontMetrics: FontMetricsLookup): Pick<NormalizedTextRun, "characterSpacing" | "wordCharacterSpacing" | "spaceCharacterSpacing"> {
    const { advanceGridPt, escapementSizeRatio } = RENDERING_TARGETS[target];
    const charSpacing = options.charSpacing ?? 0;
    const sizePt = (options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt) * (escaped ? escapementSizeRatio : 1);
    const font = advanceGridPt === undefined ? undefined : fontMetrics.glyphAdvances?.(options.fontFace ?? PPTX_DEFAULTS.text.fontFace, options.bold ?? PPTX_DEFAULTS.text.bold, options.italic ?? PPTX_DEFAULTS.text.italic);
    // A U+2011 drawn with the hyphen-minus glyph takes its advance.
    const drawn = RENDERING_TARGETS[target].nonBreakingHyphen === "hyphen-minus" ? text.replaceAll(NON_BREAKING_HYPHEN, "-") : text;
    const spacing = advanceGridWordSpacing(drawn, sizePt, font, advanceGridPt, charSpacing, kerned(options, target, fontMetrics));
    if (!spacing) return { characterSpacing: pointsToPixels(charSpacing) };
    const [word, ...others] = spacing.words;
    if (word !== undefined && !others.length && runPieces(text).length === 1) return { characterSpacing: word };
    if (!spacing.words.length) return { characterSpacing: spacing.space };
    return { characterSpacing: spacing.space, wordCharacterSpacing: spacing.words, ...(spacing.spaces ? { spaceCharacterSpacing: spacing.spaces } : {}) };
}

/** A run's font size in px, before any superscript or subscript reduction. */
function runFontSize(options: PptxGenJS.TextPropsOptions): number {
    return pointsToPixels(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt);
}

export function normalizeTextRun(text: string, options: PptxGenJS.TextPropsOptions, target: RenderingTarget = DEFAULT_RENDERING_TARGET, fontMetrics: FontMetricsLookup = builtInFontMetrics): NormalizedTextRun {
    const underline = underlineType(options);
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
    const { syntheticBoldStrokeEm, syntheticItalicShear, fallbackFaces, nonBreakingHyphen } = RENDERING_TARGETS[target];
    const fontFace = options.fontFace ?? PPTX_DEFAULTS.text.fontFace;
    const fallbacks = fallbackFaces.filter(face => face.toLowerCase() !== fontFace.toLowerCase());

    return {
        text,
        fontFace,
        ...(fallbacks.length ? { fallbackFaces: fallbacks } : {}),
        fontSize: escapement === undefined ? fontSize : fontSize * RENDERING_TARGETS[target].escapementSizeRatio,
        color: normalizeColor({ color: options.color ?? defaultColor, transparency: options.transparency }),
        bold,
        italic,
        decoration: {
            // `u=""`, which only the string form writes, is no underline type: it draws none.
            underline: Boolean(underline) && underline !== "none",
            underlineStyle: underlineStyle(underline),
            underlineColor: typeof options.underline === "object" && options.underline.color ? normalizeColor(options.underline.color) : undefined,
            strike,
            doubleStrike: options.strike === "dblStrike",
        },
        verticalAlign: getVerticalAlign(options),
        baselineOffset: escapement === undefined ? 0 : escapement * fontSize,
        ...runSpacing(text, options, escapement !== undefined, target, fontMetrics),
        ...(kerned(options, target, fontMetrics) ? {} : { kerning: false as const }),
        ...(bold && syntheticBoldStrokeEm !== undefined ? { syntheticBold: syntheticBoldStrokeEm } : {}),
        ...(italic && syntheticItalicShear !== undefined ? { syntheticItalic: syntheticItalicShear } : {}),
        ...(nonBreakingHyphen && text.includes(NON_BREAKING_HYPHEN) ? { nonBreakingHyphen } : {}),
        highlight: options.highlight ? normalizeColor(options.highlight) : undefined,
        outline: options.outline ? { color: normalizeColor(options.outline.color), width: pointsToPixels(options.outline.size) } : undefined,
        glow: textShadow(options),
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

function numberMarker(type: string, value: number): string {
    let core = String(value);

    if (type.startsWith("alphaLc")) core = generateAlpha(value, false);
    else if (type.startsWith("alphaUc")) core = generateAlpha(value, true);
    else if (type.startsWith("romanLc")) core = generateRoman(value, false);
    else if (type.startsWith("romanUc")) core = generateRoman(value, true);

    if (type.endsWith("ParenBoth")) return `(${core})`;
    if (type.endsWith("ParenR")) return `${core})`;
    if (type.endsWith("Plain")) return core;
    return `${core}.`;
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

function normalizeBullet(options: PptxGenJS.TextPropsOptions, lists: readonly NumberSequence[]): NormalizedTextBullet | undefined {
    if (!options.bullet) return undefined;

    const config = typeof options.bullet === "object" ? options.bullet : {};
    const level = paragraphLevel(options);
    const indentPt = config.indent ?? config.marginPt ?? PPTX_DEFAULTS.bullet.indentPt;
    const kind = config.type === "number" ? "number" : "bullet";
    const start = config.numberStartAt ?? config.startAt ?? PPTX_DEFAULTS.bullet.numberStartAt;
    const numberType = config.style ?? PPTX_DEFAULTS.bullet.numberType;
    const code = config.characterCode ?? config.code;

    let marker: string = PPTX_DEFAULTS.bullet.character;
    if (kind === "number") {
        marker = numberMarker(numberType, start + sequenceIndex(lists, { level, numberType, start }));
    } else if (code && /^[0-9a-f]{4,6}$/i.test(code)) {
        marker = String.fromCodePoint(parseInt(code, 16));
    }

    return { kind, marker, indent: pointsToPixels(indentPt * (level + 1)), level, start, numberType };
}

// --- PARAGRAPHS & GROUPING ---

const TAB_ALIGNMENT_MAP: Record<string, "left" | "right" | "center" | "decimal"> = {
    r: "right",
    ctr: "center",
    dec: "decimal",
    l: "left",
};

function paragraphFromPieces(
    { pieces: group, paragraph, endsParagraph, markFontSize: markFontSizePt }: PieceGroup,
    parent: PptxGenJS.TextPropsOptions,
    lists: readonly NumberSequence[],
    target: RenderingTarget,
    fontMetrics: FontMetricsLookup,
    themeFontFace: string,
    markFontFace: string,
): NormalizedTextParagraph & { readonly level: number } {
    // PowerPoint and LibreOffice give the empty text after a run's last line feed no size in a paragraph that holds
    // other text (measured against PowerPoint's PDF export); alone, it is an empty paragraph in the run's font. Without
    // it, the paragraph's properties come from its next run.
    const pieces = group.some(piece => !piece.tail) ? group.filter(piece => !piece.tail) : group;
    // PptxGenJS writes an <a:pPr> before every run of an <a:p>; PowerPoint reads the first for every paragraph its line
    // feeds make, LibreOffice the one of the run starting each line (RENDERING_TARGETS.lineFeedParagraph).
    const first = inheritedOptions(parent, RENDERING_TARGETS[target].lineFeedParagraph === "paragraph" ? paragraph : pieces[0]?.options);
    // PptxGenJS writes lineSpacing as <a:spcPts> (exact points) and else lineSpacingMultiple as <a:spcPct> (of the single
    // line, 1.2x the font size); a 0 writes neither.
    const spacing: LineSpacing | undefined = first.lineSpacing ? { exact: pointsToPixels(spacingPoints(first.lineSpacing, target)) } : first.lineSpacingMultiple ? { em: PPTX_DEFAULTS.text.singleLineEm * first.lineSpacingMultiple } : undefined;
    // An <a:p> PptxGenJS writes without a run holds only its <a:endParaRPr>, and PowerPoint and LibreOffice draw it one
    // line at the size written there, not the size of the empty run it came from: measured against PowerPoint's PDF
    // export of synthetic decks and LibreOffice's, "A\n\nZ" at 12pt in an 8pt text box or table cell puts Z 24pt below
    // A (14.4 + 9.6), in a 20pt one 38.4pt (14.4 + 24). Unset (no `sz`) is the default size.
    const runless = pieces.every(piece => piece.noRun);
    const pieceOptions = (piece: TextPiece) => inheritedOptions(parent, runless ? { ...piece.options, fontSize: markFontSizePt ?? PPTX_DEFAULTS.text.fontSizePt } : piece.options);
    const normalizedRuns = pieces.flatMap((piece, index) => pieceRuns(piece, pieces[index + 1], pieceOptions(piece), target, fontMetrics));
    const { joinsOpeningBracket, breaksAroundHanPunctuation, hangingMarks } = RENDERING_TARGETS[target];
    const joinedRuns = joinsOpeningBracket ? joinOpeningBrackets(normalizedRuns) : normalizedRuns;
    const runs = breaksAroundHanPunctuation ? hanPunctuationBreaks(joinedRuns, hangingMarks) : joinedRuns;
    // The mark of a paragraph whose <a:p> ends here, at its last run's size before a super/subscript reduction
    // (RENDERING_TARGETS.fullSizeMark); a line feed ends its line in the run's own font.
    const lastPiece = pieces.at(-1);
    const markFontSize = endsParagraph && lastPiece && RENDERING_TARGETS[target].fullSizeMark ? runFontSize(pieceOptions(lastPiece)) : undefined;
    const lineBox = paragraphLineBox({ runs, spacing }, target, fontMetrics, themeFontFace, markFontFace, markFontSize);
    // A line feed ends its line in the run's own font: only the <a:p>'s last line holds the paragraph mark.
    const { markBaseline: _markBaseline, ...feedLineBox } = lineBox;

    return {
        runs,
        align: first.align ?? PPTX_DEFAULTS.text.align,
        rtl: first.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        lineBox: endsParagraph ? lineBox : feedLineBox,
        spaceBefore: pointsToPixels(spacingPoints(first.paraSpaceBefore ?? 0, target)),
        spaceAfter: pointsToPixels(spacingPoints(first.paraSpaceAfter ?? 0, target)),
        tabStops: (first.tabStops ?? [])
            .map(stop => ({
                // PptxGenJS writes `stop.position || 1` and `stop.alignment || "l"`.
                position: inch2EmuToPixels(stop.position || 1),
                alignment: TAB_ALIGNMENT_MAP[stop.alignment ?? "l"] ?? "left",
            }))
            .toSorted((a, b) => a.position - b.position),
        defaultTabStop: inchesToPixels(PPTX_DEFAULTS.text.defaultTabStopIn),
        bullet: normalizeBullet(first, lists),
        level: paragraphLevel(first),
    };
}

/**
 * The runs of `piece`: one, or in a language with the target's `hangingMarks`, one per stretch around each mark that
 * hangs (normalize/eastAsianLineBreak.ts); `next` is the piece after it in the paragraph.
 */
function pieceRuns(piece: TextPiece, next: TextPiece | undefined, options: PptxGenJS.TextPropsOptions, target: RenderingTarget, fontMetrics: FontMetricsLookup): NormalizedTextRun[] {
    const marks = languageHangingMarks(options.lang ?? PPTX_DEFAULTS.theme.language, RENDERING_TARGETS[target].hangingMarks);
    if (!marks) return [normalizeTextRun(piece.text, options, target, fontMetrics)];
    const after = next && !next.options.softBreakBefore ? [...next.text][0] : undefined;
    const font = fontMetrics.glyphAdvances?.(options.fontFace ?? PPTX_DEFAULTS.text.fontFace, options.bold ?? PPTX_DEFAULTS.text.bold, options.italic ?? PPTX_DEFAULTS.text.italic);
    return hangingSegments(piece.text, after, marks).flatMap(({ text, hangs }, index) => {
        const run = normalizeTextRun(text, options, target, fontMetrics);
        // Only the piece's first stretch starts after its soft break.
        const segment = index ? { ...run, softBreakBefore: false } : run;
        return hangs ? hangingMarkRuns(segment, font) : [segment];
    });
}

/** `runs` with breakAroundHanPunctuation in each run, also at a mark on a run's edge. */
function hanPunctuationBreaks(runs: NormalizedTextRun[], hangingMarks: Readonly<Record<string, string>>): NormalizedTextRun[] {
    return runs.map((run, index) => {
        const previous = run.softBreakBefore ? "" : (runs[index - 1]?.text.at(-1) ?? "");
        const following = runs[index + 1];
        const next = following && !following.softBreakBefore ? following.text.charAt(0) : "";
        const text = breakAroundHanPunctuation(run.text, previous, next, languageHangingMarks(run.language, hangingMarks) !== undefined);
        return text === run.text ? run : { ...run, text };
    });
}

/**
 * `runs` with a WORD_JOINER at each BEFORE_OPENING_BRACKET point, also where a run ends with ")" and the next run on
 * the same line starts with "(". Added after normalizeTextRun, so the advance grid's spacing does not count it, as
 * Chromium gives it no letter-spacing.
 */
function joinOpeningBrackets(runs: NormalizedTextRun[]): NormalizedTextRun[] {
    return runs.map((run, index) => {
        const previous = run.softBreakBefore ? "" : (runs[index - 1]?.text.at(-1) ?? "");
        const text = `${previous}${run.text}`.replace(BEFORE_OPENING_BRACKET, WORD_JOINER).slice(previous.length);
        return text === run.text ? run : { ...run, text };
    });
}

/**
 * A spacing of `points` as `target` reads the `<a:spcPts>` PptxGenJS writes (Math.round(points * 100)): PowerPoint
 * rounds it half-up to whole points (RENDERING_TARGETS.spacingWholePoints), so 0.49 is 0 and 0.5 is 1.
 */
function spacingPoints(points: number, target: RenderingTarget): number {
    if (!RENDERING_TARGETS[target].spacingWholePoints) return points;
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

// PptxGenJS 4.0.1 genXmlTextBody STEP 4 keeps one mutable options record per run: the run's own options object, or for
// a run without one, the `{}` addTextDefinition stores on it in a text box and the cell's own options in a table cell.
// Every piece split from a run shares it, and so do the runs that share it, so a write to one is seen by all of them.
// `records` holds them by that object; each starts as a copy of what earlier boxes left on it (sharedRunOptions).
function piecesFromInput(input: TextInput, parent: PptxGenJS.TextPropsOptions, writing: RunWriting, records: Map<object, RunRecord>): TextPiece[] {
    const source = Array.isArray(input) ? input.map(item => ({ text: String(item.text ?? ""), key: item.options ?? item, own: item.options ?? {} })) : [{ text: String(input), key: parent, own: parent }];
    const pieces: TextPiece[] = [];

    for (const item of source) {
        const record = records.get(item.key);
        // A copy, so the mutations below never reach the caller's options.
        const options = record?.state ?? sharedRunOptions(Array.isArray(input) ? writing.shared : undefined, item.key, item.own);
        if (!record) {
            // A run's own `shadow` draws nothing: PptxGenJS 4.0.1 genXmlTextRunProperties writes only `glow` into the run's
            // <a:effectLst> (COMPATIBILITY.text runShadow). A string's options are the text box's, whose shadow is written.
            if (Array.isArray(input)) delete options.shadow;
            records.set(item.key, { start: { ...options }, state: options });
        }
        const text = item.text.replace(/\r\n?/g, "\n");
        // STEP 4 C splits a text with a line feed that does not end with one, and sets `breakLine` on the shared record,
        // so every piece ends a paragraph, the last one too. A text ending with a line feed is written whole, its line
        // feeds kept inside `<a:t>` (splitAtLineFeeds).
        const lines = text.endsWith("\n") ? [text] : text.split("\n");
        if (lines.length > 1) options.breakLine = true;
        for (const line of lines) pieces.push({ text: line, options, ...(line ? {} : { noRun: true }) });
    }
    // STEP 4 A gives the first run the box's bullet.
    const first = pieces[0]?.options;
    const box = writing.box ?? parent;
    if (first && !first.bullet && box.bullet) first.bullet = box.bullet;
    return pieces;
}

/** Whether `options.underline` is the boolean `true`. */
function underlinedTrue(options: PptxGenJS.TextPropsOptions): boolean {
    // `unknown`: PptxGenJS's types declare only the object form; the boolean works at runtime.
    const underline: unknown = options.underline;
    return underline === true;
}

/** Box options PptxGenJS 4.0.1 copies onto runs (STEP 6 C) that no run draws. */
const UNWRITTEN_RUN_OPTIONS: ReadonlySet<string> = new Set([
    // Left out by PptxGenJS.
    "bullet",
    // genXmlTextRunProperties never writes a run's shadow (piecesFromInput).
    "shadow",
    // Written as a link to `rIdundefined`, a relationship PptxGenJS never creates: the box's link stays the shape's.
    "hyperlink",
]);

/**
 * PptxGenJS 4.0.1 genXmlTextBody STEP 6 writes the box's options onto each run's options, paragraph by paragraph: each
 * one the run leaves falsy (B for the paragraph options, C for the rest but `bullet`, and `color` on a linked run), so
 * `bold: false` or `paraSpaceAfter: 0` in a box that sets them takes the box's; and E gives an unsized box the size of
 * its first sized run, which the runs after it then take.
 */
function writeBoxOptions(lines: readonly TextPiece[][], box: PptxGenJS.TextPropsOptions): void {
    // `Record`: options are written by name, which the declared option type does not index.
    const written: Record<string, unknown> = { ...box };
    for (const line of lines) {
        for (const { options } of line) {
            // `as`: the same record, written by name; its pieces read the writes.
            const run = options as Record<string, unknown>;
            for (const [name, value] of Object.entries(written)) {
                if (!run[name] && !UNWRITTEN_RUN_OPTIONS.has(name) && !(name === "color" && run.hyperlink)) run[name] = value;
            }
            written.fontSize ||= run.fontSize;
        }
    }
}

// PptxGenJS 4.0.1 genXmlTextBody (STEP 5) groups the runs into `<a:p>`s: when the run or the box has `align`, only a change of the run's
// align starts a paragraph and `bullet` is not checked (the bullet test is an `else if`). Otherwise a bullet
// run starts a paragraph and its `breakLine` is cleared on the shared record, so it does not also end one.
function groupPieces(pieces: TextPiece[], parentAlign?: PptxGenJS.HAlign): TextPiece[][] {
    const groups: TextPiece[][] = [];
    let current: TextPiece[] = [];

    pieces.forEach((piece, index) => {
        const { options } = piece;
        if (current.length > 0) {
            const aligned = Boolean(options.align || parentAlign);
            const startsGroup = aligned ? options.align !== pieces[index - 1]?.options.align : Boolean(options.bullet);
            if (startsGroup) {
                groups.push(current);
                current = [];
                if (!aligned) options.breakLine = false;
            }
        }

        current.push(piece);

        if (options.breakLine && index + 1 < pieces.length) {
            groups.push(current);
            current = [];
        }
    });

    if (current.length || groups.length === 0) groups.push(current);
    return groups;
}

/**
 * The size PptxGenJS 4.0.1 genXmlTextBody writes on each `<a:p>`'s `<a:endParaRPr>`: the box's or cell's `fontSize`, else
 * the first truthy run `fontSize` up to the end of that `<a:p>` (step 6 E sets the shared options' `fontSize` from it),
 * else none. So "A" then an empty run with `fontSize: 20` in an 8pt cell writes `sz="800"` on the empty `<a:p>`.
 */
function markFontSizes(lines: readonly TextPiece[][], parent: PptxGenJS.TextPropsOptions): Array<number | undefined> {
    let size = parent.fontSize || undefined;
    return lines.map(line => {
        for (const piece of line) size ||= piece.options.fontSize || undefined;
        return size;
    });
}

/** An `<a:p>`'s pieces cut at each line feed inside a run's `<a:t>`, which PowerPoint draws as a new paragraph. */
function splitAtLineFeeds(line: TextPiece[], markFontSize: number | undefined): PieceGroup[] {
    let current: TextPiece[] = [];
    const groups = [current];
    for (const piece of line) {
        const lines = piece.text.split("\n");
        lines.forEach((text, index) => {
            if (index > 0) {
                current = [];
                groups.push(current);
            }
            current.push(lines.length === 1 ? piece : { ...piece, text, ...(index === lines.length - 1 ? { tail: true } : {}) });
        });
    }
    return groups.map((pieces, index) => ({ pieces, paragraph: line[0]?.options, endsParagraph: index === groups.length - 1, markFontSize }));
}

function getTextDirection(vert?: string): "vertical" | "vertical270" | "stacked" | "horizontal" {
    if (vert === "vert") return "vertical";
    if (vert === "vert270") return "vertical270";
    if (vert?.includes("wordArtVert")) return "stacked";
    return "horizontal";
}

function getFitMode(options: PptxGenJS.TextPropsOptions): "shrink" | "resize" | "none" {
    if (options.fit) return options.fit;
    if (options.shrinkText) return "shrink";
    if (options.autoFit) return "resize";
    return PPTX_DEFAULTS.text.fit;
}

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
    const records = new Map<object, RunRecord>();
    const lines = groupPieces(piecesFromInput(input, options, writing, records), options.align);
    writeBoxOptions(lines, writing.box ?? options);
    for (const [key, { start, state }] of records) {
        // A string's options and a cell's option-less runs are the box's own, not a run options object.
        if (writing.shared && Array.isArray(input) && key !== options) recordSharedRun(writing.shared, key, start, state);
        // A table cell gets no addTextDefinition, which turns a text box's `underline: true` into `{ style: "sng" }`:
        // in a cell the boolean writes no `u`. Set after STEP 6, which keeps the cell's underline off the run.
        if (writing.cell && underlinedTrue(state)) Object.assign(state, { underline: false });
    }
    const markSizes = markFontSizes(lines, options);
    const groups = lines.flatMap((line, index) => splitAtLineFeeds(line, markSizes[index]));

    const { addsParagraphSpacing, spacesFirstParagraph, emptyNumberedParagraph } = RENDERING_TARGETS[target];
    let lists: readonly NumberSequence[] = [];
    const paragraphs = groups.map((group, index) => {
        const { bullet, level, ...paragraph } = paragraphFromPieces(group, options, lists, target, fontMetrics, themeFontFace, markFontFace);
        // A paragraph PptxGenJS writes without a run gets no marker in PowerPoint or LibreOffice.
        const runless = group.pieces.every(piece => piece.noRun);
        const empty = paragraph.runs.every(run => !run.text);
        // Shallower levels' lists stay open; a paragraph ends its own level's and deeper ones, and a numbered one
        // reopens its own (sequenceIndex).
        const shallower = lists.filter(open => open.level < level);
        if (bullet?.kind !== "number") lists = shallower;
        else {
            const numberIndex = sequenceIndex(lists, bullet);
            const next = emptyNumberedParagraph === "skipped" ? numberIndex + (empty ? 0 : 1) : runless ? 0 : numberIndex + 1;
            lists = [...shallower, { level, numberType: bullet.numberType, start: bullet.start, next }];
        }
        // shortcut: PowerPoint's dropped first space before was measured on top-anchored text boxes only; middle and
        // bottom anchors and table cells follow the same rule until a measurement says otherwise.
        const first = index === 0 && !spacesFirstParagraph ? { spaceBefore: 0 } : {};
        // PowerPoint and LibreOffice leave the last paragraph's space after out of the text height, so it does not
        // lift middle- or bottom-anchored text (or grow a table row).
        const last = index === groups.length - 1 ? { spaceAfter: 0 } : {};
        return { ...paragraph, ...(bullet && !runless ? { bullet } : {}), ...first, ...last };
    });
    // CSS keeps only the larger of two adjacent margins; a target that adds them gets each space after moved onto
    // the next paragraph's space before, so the gap is their sum in every renderer.
    const spaced = addsParagraphSpacing ? paragraphs.map((paragraph, index) => ({ ...paragraph, spaceBefore: paragraph.spaceBefore + (paragraphs[index - 1]?.spaceAfter ?? 0), spaceAfter: 0 })) : paragraphs;

    const direction = options.vert ?? PPTX_DEFAULTS.text.textDirection;

    return {
        paragraphs: spaced,
        margin: textMarginPixels(options.margin, options.inset),
        verticalAlign: options.valign ?? PPTX_DEFAULTS.text.valign,
        wrap: options.wrap ?? PPTX_DEFAULTS.text.wrap,
        fit: getFitMode(options),
        direction: getTextDirection(direction),
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
    const box = fontLineBox(paragraph, target, fontMetrics, themeFontFace, markFontFace, markFontSize);
    // An exact line height (`<a:spcPts>`) is fixed whatever the line holds.
    const exact = paragraph.spacing !== undefined && "exact" in paragraph.spacing;
    return baselinesOnGrid(RENDERING_TARGETS[target].escapementGrowsLine && !exact ? escapementLineBox(box, paragraph.runs) : box, target);
}

/**
 * `box` grown by what the paragraph's raised or lowered runs stick out of it: each reaches the font-independent line
 * box at its drawn size, 1em above and `text.lineDescentEm` below its baseline, moved by its `baselineOffset`
 * (RENDERING_TARGETS.libreoffice). An empty run draws nothing and grows nothing, as in #294.
 * shortcut: one line box per paragraph, so the growth applies to every line of the paragraph, not only the one holding
 * the run; split it per line when the model gets a line box per line.
 * shortcut: with `lineSpacingMultiple` the growth is added to the spaced line unscaled, which LibreOffice's export was
 * not measured for; measure it when a deck combines the two.
 */
function escapementLineBox(box: NormalizedTextParagraph["lineBox"], runs: readonly NormalizedTextRun[]): NormalizedTextParagraph["lineBox"] {
    const { singleLineEm, lineDescentEm } = PPTX_DEFAULTS.text;
    const ascentEm = singleLineEm - lineDescentEm;
    const drawn = runs.filter(run => run.text !== "");
    const size = Math.max(0, ...drawn.map(run => run.fontSize));
    const above = Math.max(0, ...drawn.map(run => ascentEm * run.fontSize + run.baselineOffset - ascentEm * size));
    const below = Math.max(0, ...drawn.map(run => lineDescentEm * run.fontSize - run.baselineOffset - lineDescentEm * size));
    if (!above && !below) return box;
    const { height, baseline, markBaseline, breakBaseline } = box;
    return {
        height: height + above + below,
        baseline: baseline + above,
        ...(markBaseline === undefined ? {} : { markBaseline: markBaseline + above }),
        ...(breakBaseline === undefined ? {} : { breakBaseline: breakBaseline + above }),
    };
}

/** `lineBox` with each baseline on the target's grid, a mark or break baseline kept only where it still differs. */
function baselinesOnGrid(lineBox: NormalizedTextParagraph["lineBox"], target: RenderingTarget): NormalizedTextParagraph["lineBox"] {
    const { baselineGridPerInch } = RENDERING_TARGETS[target];
    if (baselineGridPerInch === undefined) return lineBox;
    // One division of whole numbers, so the HTML writes 23.36, not 23.359999999999996.
    const { cssDpi } = PPTX_DEFAULTS.units;
    const onGrid = (value: number) => (Math.round((value * baselineGridPerInch) / cssDpi) * cssDpi) / baselineGridPerInch;
    const { height, baseline, markBaseline, breakBaseline } = lineBox;
    const [line, mark, soft] = [onGrid(baseline), markBaseline === undefined ? undefined : onGrid(markBaseline), breakBaseline === undefined ? undefined : onGrid(breakBaseline)];
    return { height, baseline: line, ...(mark !== undefined && mark !== line ? { markBaseline: mark } : {}), ...(soft !== undefined && soft !== line ? { breakBaseline: soft } : {}) };
}

/** The line box before the baseline grid (`paragraphLineBox`). */
function fontLineBox(paragraph: LineBoxInput, target: RenderingTarget, fontMetrics: FontMetricsLookup, themeFontFace: string, markFontFace: string, markFontSize: number | undefined): NormalizedTextParagraph["lineBox"] {
    // shortcut: one line box per paragraph, so a full-size mark sets the height of every line, not only the last; split
    // it per line when the model gets a line box per line.
    const fontSize = Math.max(...paragraph.runs.map(run => run.fontSize), markFontSize ?? 0) || pointsToPixels(PPTX_DEFAULTS.text.fontSizePt);
    const { spacing } = paragraph;
    const box = lineBoxOf(fontSize, spacing === undefined ? undefined : "exact" in spacing ? spacing.exact : spacing.em * fontSize);
    const { spacedLineBaseline, fontLineBaseline } = RENDERING_TARGETS[target];
    // lineSpacingMultiple 1 is the single line (singleLineEm), which PowerPoint lays out as single spacing.
    const spaced = spacing !== undefined && !("em" in spacing && spacing.em === PPTX_DEFAULTS.text.singleLineEm);
    if (spaced) return spacedLineBaseline !== undefined ? { ...box, baseline: spacedLineBaseline * box.height } : box;
    const { runs } = paragraph;
    const last = runs.at(-1);
    if (!fontLineBaseline || !last) return box;
    // PowerPoint counts the paragraph mark on the last line and a soft break on the line it ends, at the size of the last
    // run and of the run before the break; in a paragraph with a run it ignores the size PptxGenJS writes on <a:endParaRPr> (a
    // run-less one takes it, paragraphFromPieces) but reads its typeface,
    // written only in table cells (markFontFace), else takes the theme font.
    // shortcut: one line box per paragraph, so every line holds all the paragraph's runs and every break the largest
    // size before one; split it per line when the model gets a line box per line.
    const baseline = fontBaseline(runs, box.height, fontMetrics);
    const markBaseline = fontBaseline([...runs, { fontFace: markFontFace, fontSize: markFontSize ?? last.fontSize }], box.height, fontMetrics);
    const breakSize = Math.max(0, ...runs.map((run, index) => (index > 0 && run.softBreakBefore ? (runs[index - 1]?.fontSize ?? 0) : 0)));
    const breakBaseline = breakSize ? fontBaseline([...runs, { fontFace: themeFontFace, fontSize: breakSize }], box.height, fontMetrics) : baseline;
    return { ...box, baseline, ...(markBaseline !== baseline ? { markBaseline } : {}), ...(breakBaseline !== baseline ? { breakBaseline } : {}) };
}

/**
 * The single-spaced baseline below the top of a `height` px line holding `runs`: each reaches 1.2x its size, split by
 * its font's winAscent : winDescent; the largest ascent is the baseline, scaled down with the largest descent when the
 * two overflow the line.
 */
function fontBaseline(runs: ReadonlyArray<Pick<NormalizedTextRun, "fontFace" | "fontSize">>, height: number, fontMetrics: FontMetricsLookup): number {
    let ascent = 0;
    let descent = 0;
    for (const run of runs) {
        const share = ascentShare(fontMetrics(run.fontFace));
        ascent = Math.max(ascent, share * PPTX_DEFAULTS.text.singleLineEm * run.fontSize);
        descent = Math.max(descent, (1 - share) * PPTX_DEFAULTS.text.singleLineEm * run.fontSize);
    }
    return ascent + descent > height ? (ascent * height) / (ascent + descent) : ascent;
}

/** The part of a single-spaced line above the baseline in a font with `metrics`, else the font-independent 1em of 1.2em. */
function ascentShare(metrics: FontWinMetrics | undefined): number {
    const { singleLineEm, lineDescentEm } = PPTX_DEFAULTS.text;
    return metrics ? metrics.winAscent / (metrics.winAscent + metrics.winDescent) : (singleLineEm - lineDescentEm) / singleLineEm;
}

/** The line box for a paragraph whose largest run is `fontSize` px: `height` px tall, or a single line. */
export function lineBoxOf(fontSize: number, height = PPTX_DEFAULTS.text.singleLineEm * fontSize): NormalizedTextParagraph["lineBox"] {
    return { height, baseline: height - PPTX_DEFAULTS.text.lineDescentEm * fontSize };
}

/** Steps closer than this to the grid count as on it: well under the 1e-3pt PptxGenJS's EMU keeps. */
const WRAP_GRID_EPSILON = 1e-6;

/**
 * The target's floor of the width inside the left and right insets (RENDERING_TARGETS.wrapWidthGridPt), moved into the
 * end inset so every renderer wraps at it: `width` is the box's, in px. Text that does not wrap, or runs vertically,
 * keeps its insets.
 */
export function floorTextWrapWidth(text: NormalizedTextBox, width: number, target: RenderingTarget): NormalizedTextBox {
    const grid = RENDERING_TARGETS[target].wrapWidthGridPt;
    if (grid === undefined || !text.wrap || text.direction !== "horizontal") return text;
    const [top, right, bottom, left] = text.margin;
    const step = pointsToPixels(grid);
    const inner = width - left - right;
    // A width on the grid in inches comes back a hair under it in px; it is on the grid.
    const remainder = inner - Math.floor(inner / step + WRAP_GRID_EPSILON) * step;
    if (inner <= 0 || remainder <= WRAP_GRID_EPSILON * step) return text;
    return { ...text, margin: text.rtl ? [top, right, bottom, left + remainder] : [top, right + remainder, bottom, left] };
}

/**
 * A box shorter than its top and bottom insets: PowerPoint collapses the text area onto the box's vertical
 * midline, and the text is drawn from there by its anchor. LibreOffice (26.2, the visual image) draws the
 * same with equal insets; with unequal ones it lands between the midline and the inverted inset rectangle.
 */
export function collapseTextMargins(text: NormalizedTextBox, height: number): NormalizedTextBox {
    const [top, right, bottom, left] = text.margin;
    if (top + bottom <= height) return text;
    return { ...text, margin: [height / 2, right, height / 2, left] };
}
