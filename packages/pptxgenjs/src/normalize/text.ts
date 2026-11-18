import type PptxGenJS from "pptxgenjs";
import { DEFAULT_RENDERING_TARGET, type FontMetricsLookup, type FontWinMetrics, PPTX_DEFAULTS, RENDERING_TARGETS, type RenderingTarget } from "#src/defaults";
import { builtInFontMetrics } from "#src/fontMetrics";
import type { NormalizedShadow, NormalizedTextBox, NormalizedTextBullet, NormalizedTextParagraph, NormalizedTextRun } from "@pdflapas/model";
import { inchesToPixels, pointsToPixels } from "#src/units";
import { normalizeHyperlink } from "./link";
import { textMarginPixels } from "./margin";
import { normalizeColor, normalizeShadow } from "./style";

export type TextInput = string | number | PptxGenJS.TextProps[];

interface TextPiece {
    text: string;
    /** The run's options record, shared and mutated as in PptxGenJS (piecesFromInput). */
    options: PptxGenJS.TextPropsOptions;
    /** A line feed PptxGenJS keeps inside the run's `<a:t>` ends this piece, which PowerPoint draws as a new paragraph. */
    lineFeed?: boolean;
    /** PptxGenJS writes no `<a:r>` for this piece: an empty text of its own (genXmlTextRun skips it). */
    noRun?: boolean;
}

// --- UTILITIES ---

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function inheritedOptions(parent: PptxGenJS.TextPropsOptions, child: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions {
    const { x: _x, y: _y, w: _w, h: _h, fill: _fill, line: _line, shadow: _shadow, rotate: _rotate, flipH: _flipH, flipV: _flipV, rectRadius: _rectRadius, objectName: _objectName, ...parentText } = parent;
    // PptxGenJS 4.0.1 genXmlTextBody (step 6 C) fills a run option the run leaves unset from its parent's, so a key
    // present with an undefined value (a table cell's `{ fontSize: undefined }`, copied onto its autoPage word runs)
    // inherits rather than resetting to the default.
    const inherited = { ...parentText, ...Object.fromEntries(Object.entries(child).filter(([, value]) => value !== undefined)) };
    if (child.hyperlink && child.color === undefined) delete inherited.color;
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

/** Whether `target` kerns a run: PptxGenJS writes `kern="0"` with `charSpacing`, and inherits 12pt otherwise. */
function kerned(options: PptxGenJS.TextPropsOptions, target: RenderingTarget): boolean {
    if (!RENDERING_TARGETS[target].readsKern) return true;
    return !options.charSpacing && (options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt) >= PPTX_DEFAULTS.text.kernMinSizePt;
}

export function normalizeTextRun(text: string, options: PptxGenJS.TextPropsOptions, target: RenderingTarget = DEFAULT_RENDERING_TARGET): NormalizedTextRun {
    const underline = underlineType(options);
    const strike = options.strike === true || options.strike === "sngStrike" || options.strike === "dblStrike";
    const baseline = options.baseline ?? 0;
    const fontSize = pointsToPixels(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt);
    // A custom baseline wins over super/subscript, as in PptxGenJS's run XML.
    // shortcut: custom baselines keep their full size and the point-based offset; check them against LibreOffice's 58% when a fixture uses one.
    const escapement = options.baseline ? undefined : options.subscript ? PPTX_DEFAULTS.text.subscriptBaseline : options.superscript ? PPTX_DEFAULTS.text.superscriptBaseline : undefined;
    const link = normalizeHyperlink(options.hyperlink);
    const defaultColor = link && options.color === undefined ? PPTX_DEFAULTS.theme.colors.hyperlink : PPTX_DEFAULTS.text.color;

    return {
        text,
        fontFace: options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        fontSize: escapement === undefined ? fontSize : fontSize * PPTX_DEFAULTS.text.escapementSizeRatio,
        color: normalizeColor({ color: options.color ?? defaultColor, transparency: options.transparency }),
        bold: options.bold ?? PPTX_DEFAULTS.text.bold,
        italic: options.italic ?? PPTX_DEFAULTS.text.italic,
        decoration: {
            // `u=""`, which only the string form writes, is no underline type: it draws none.
            underline: Boolean(underline) && underline !== "none",
            underlineStyle: underlineStyle(underline),
            underlineColor: typeof options.underline === "object" && options.underline.color ? normalizeColor(options.underline.color) : undefined,
            strike,
            doubleStrike: options.strike === "dblStrike",
        },
        verticalAlign: getVerticalAlign(options),
        baselineOffset: escapement === undefined ? pointsToPixels(baseline / 100) : escapement * fontSize,
        characterSpacing: pointsToPixels(options.charSpacing ?? 0),
        ...(kerned(options, target) ? {} : { kerning: false as const }),
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

function normalizeBullet(options: PptxGenJS.TextPropsOptions, numberIndex: number): NormalizedTextBullet | undefined {
    if (!options.bullet) return undefined;

    const config = typeof options.bullet === "object" ? options.bullet : {};
    const level = Math.max(0, Math.floor(options.indentLevel ?? 0));
    const indentPt = config.indent ?? config.marginPt ?? PPTX_DEFAULTS.bullet.indentPt;
    const kind = config.type === "number" ? "number" : "bullet";
    const start = config.numberStartAt ?? config.startAt ?? PPTX_DEFAULTS.bullet.numberStartAt;
    const numberType = config.style ?? PPTX_DEFAULTS.bullet.numberType;
    const code = config.characterCode ?? config.code;

    let marker: string = PPTX_DEFAULTS.bullet.character;
    if (kind === "number") {
        marker = numberMarker(numberType, start + numberIndex);
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

function paragraphFromPieces(pieces: TextPiece[], parent: PptxGenJS.TextPropsOptions, numberIndex: number, target: RenderingTarget, fontMetrics: FontMetricsLookup, themeFontFace: string, markFontFace: string): NormalizedTextParagraph {
    const first = inheritedOptions(parent, pieces[0]?.options);
    // lineSpacingMultiple (spcPct) multiplies the single line, 1.2x the font size; the model's multiples are of the font size.
    const multiple = first.lineSpacingMultiple === undefined ? undefined : PPTX_DEFAULTS.text.singleLineEm * first.lineSpacingMultiple;
    const lineHeight = first.lineSpacing !== undefined ? pointsToPixels(first.lineSpacing) : multiple;
    const runs = pieces.map(piece => normalizeTextRun(piece.text, inheritedOptions(parent, piece.options), target));

    return {
        runs,
        align: first.align ?? PPTX_DEFAULTS.text.align,
        rtl: first.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        lineHeight,
        lineBox: paragraphLineBox({ runs, lineHeight }, target, fontMetrics, themeFontFace, markFontFace),
        spaceBefore: pointsToPixels(first.paraSpaceBefore ?? 0),
        spaceAfter: pointsToPixels(first.paraSpaceAfter ?? 0),
        tabStops: (first.tabStops ?? [])
            .map(stop => ({
                // PptxGenJS writes `stop.position || 1` and `stop.alignment || "l"`.
                position: inchesToPixels(stop.position || 1),
                alignment: TAB_ALIGNMENT_MAP[stop.alignment ?? "l"] ?? "left",
            }))
            .toSorted((a, b) => a.position - b.position),
        defaultTabStop: inchesToPixels(PPTX_DEFAULTS.text.defaultTabStopIn),
        bullet: normalizeBullet(first, numberIndex),
    };
}

// PptxGenJS 4.0.1 genXmlTextBody STEP 4 keeps one mutable options record per run: the run's own options object, or for
// a run without one, a fresh `{}` in a text box (addTextDefinition) and the cell's own options in a table cell. Every
// piece split from a run shares it, and so do the runs that share it, so a write to one is seen by all of them.
function piecesFromInput(input: TextInput, parent: PptxGenJS.TextPropsOptions): TextPiece[] {
    const source = Array.isArray(input) ? input.map(item => ({ text: String(item.text ?? ""), options: item.options ?? {} })) : [{ text: String(input), options: parent }];
    // Copies, so the mutations below never reach the caller's options.
    const records = new Map<PptxGenJS.TextPropsOptions, PptxGenJS.TextPropsOptions>();
    const pieces: TextPiece[] = [];

    for (const item of source) {
        const options = records.get(item.options) ?? { ...item.options };
        // A run's own `shadow` draws nothing: PptxGenJS 4.0.1 genXmlTextRunProperties writes only `glow` into the run's
        // <a:effectLst> (COMPATIBILITY.text runShadow). A string's options are the text box's, whose shadow is written.
        if (Array.isArray(input)) delete options.shadow;
        records.set(item.options, options);
        const text = item.text.replace(/\r\n?/g, "\n");
        const lines = text.split("\n");
        // STEP 4 C splits a text with a line feed that does not end with one, and sets `breakLine` on the shared record,
        // so every piece ends a paragraph, the last one too. A text ending with a line feed is written whole, its line
        // feeds kept inside `<a:t>`.
        if (lines.length > 1 && !text.endsWith("\n")) options.breakLine = true;
        const lineFeeds = text.endsWith("\n");
        lines.forEach((line, index) => pieces.push({ text: line, options, ...(lineFeeds && index < lines.length - 1 ? { lineFeed: true } : {}), ...(!lineFeeds && !line ? { noRun: true } : {}) }));
    }
    return pieces;
}

// PptxGenJS 4.0.1 genXmlTextBody (STEP 5): when the run or the box has `align`, only a change of the run's
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

        if ((piece.lineFeed || options.breakLine) && index + 1 < pieces.length) {
            groups.push(current);
            current = [];
        }
    });

    if (current.length || groups.length === 0) groups.push(current);
    return groups;
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
 * the metrics of the faces that place a single-spaced baseline where the target reads them (`fontLineBaseline`), and
 * `themeFontFace` is the theme's minor font (`pres.theme.bodyFontFace`), the font of soft breaks and, unless
 * `markFontFace` names the one PptxGenJS writes on `<a:endParaRPr>` (a table cell's fontFace), of the paragraph mark.
 */
export function normalizeText(input: TextInput, options: PptxGenJS.TextPropsOptions = {}, target: RenderingTarget = DEFAULT_RENDERING_TARGET, fontMetrics: FontMetricsLookup = builtInFontMetrics, themeFontFace: string = PPTX_DEFAULTS.theme.bodyFontFace, markFontFace: string = themeFontFace): NormalizedTextBox {
    const pieces = piecesFromInput(input, options);
    const groups = groupPieces(pieces, options.align);

    const { addsParagraphSpacing, spacesFirstParagraph, emptyNumberedParagraph } = RENDERING_TARGETS[target];
    let numberIndex = 0;
    const paragraphs = groups.map((group, index) => {
        const { bullet, ...paragraph } = paragraphFromPieces(group, options, numberIndex, target, fontMetrics, themeFontFace, markFontFace);
        // A paragraph PptxGenJS writes without a run gets no marker in PowerPoint or LibreOffice.
        const runless = group.every(piece => piece.noRun);
        const empty = paragraph.runs.every(run => !run.text);
        if (bullet?.kind !== "number") numberIndex = 0;
        else if (emptyNumberedParagraph === "skipped") numberIndex += empty ? 0 : 1;
        else numberIndex = runless ? 0 : numberIndex + 1;
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

/**
 * LibreOffice's font-independent line box for a paragraph (PPTX_DEFAULTS.text.singleLineEm), in px:
 * `height` is each line's height and `baseline` its baseline's distance below the line top, both set
 * by the paragraph's largest run. Chromium's own line box depends on each font's ascent and descent.
 * `target` may place the baseline differently: with explicit spacing (RENDERING_TARGETS.spacedLineBaseline), and with
 * single spacing from the runs' fonts (RENDERING_TARGETS.fontLineBaseline), where the paragraph mark and soft breaks,
 * set in `markFontFace` and `themeFontFace`, may move the last line and the lines ending in a break (`markBaseline`,
 * `breakBaseline`).
 */
export function paragraphLineBox(
    paragraph: Pick<NormalizedTextParagraph, "runs" | "lineHeight">,
    target: RenderingTarget = DEFAULT_RENDERING_TARGET,
    fontMetrics: FontMetricsLookup = builtInFontMetrics,
    themeFontFace: string = PPTX_DEFAULTS.theme.bodyFontFace,
    markFontFace: string = themeFontFace,
): NormalizedTextParagraph["lineBox"] {
    const fontSize = Math.max(...paragraph.runs.map(run => run.fontSize), 0) || pointsToPixels(PPTX_DEFAULTS.text.fontSizePt);
    const { lineHeight } = paragraph;
    // Model contract: values below 10 are lineSpacingMultiple, larger ones exact px (lineSpacing).
    const box = lineBoxOf(fontSize, lineHeight === undefined ? undefined : lineHeight < 10 ? lineHeight * fontSize : lineHeight);
    const { spacedLineBaseline, fontLineBaseline } = RENDERING_TARGETS[target];
    // lineSpacingMultiple 1 is the single line (singleLineEm), which PowerPoint lays out as single spacing.
    const spaced = lineHeight !== undefined && lineHeight !== PPTX_DEFAULTS.text.singleLineEm;
    if (spaced) return spacedLineBaseline !== undefined ? { ...box, baseline: spacedLineBaseline * box.height } : box;
    const { runs } = paragraph;
    const last = runs.at(-1);
    if (!fontLineBaseline || !last) return box;
    // PowerPoint counts the paragraph mark on the last line and a soft break on the line it ends, at the size of the last
    // run and of the run before the break; it ignores the size PptxGenJS writes on <a:endParaRPr> but reads its typeface,
    // written only in table cells (markFontFace), else takes the theme font.
    // shortcut: one line box per paragraph, so every line holds all the paragraph's runs and every break the largest
    // size before one; split it per line when the model gets a line box per line.
    const baseline = fontBaseline(runs, box.height, fontMetrics);
    const markBaseline = fontBaseline([...runs, { fontFace: markFontFace, fontSize: last.fontSize }], box.height, fontMetrics);
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
