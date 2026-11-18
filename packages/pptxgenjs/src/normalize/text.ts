import type PptxGenJS from "pptxgenjs";
import { DEFAULT_RENDERING_TARGET, PPTX_DEFAULTS, RENDERING_TARGETS, type RenderingTarget } from "#src/defaults";
import type { NormalizedShadow, NormalizedTextBox, NormalizedTextBullet, NormalizedTextParagraph, NormalizedTextRun } from "@pdflapas/model";
import { inchesToPixels, pointsToPixels } from "#src/units";
import { normalizeHyperlink } from "./link";
import { textMarginPixels } from "./margin";
import { normalizeColor, normalizeShadow } from "./style";

export type TextInput = string | number | PptxGenJS.TextProps[];

interface TextPiece {
    text: string;
    options: PptxGenJS.TextPropsOptions;
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
    const underline = typeof options.underline === "object" ? options.underline : undefined;
    const strike = options.strike === true || options.strike === "sngStrike" || options.strike === "dblStrike";
    const baseline = options.baseline ?? 0;
    const fontSize = pointsToPixels(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt);
    // A custom baseline wins over super/subscript, as in PptxGenJS's run XML.
    // shortcut: custom baselines keep their full size and the point-based offset; check them against LibreOffice's 58% when a fixture uses one.
    const escapement = options.baseline ? undefined : options.subscript ? PPTX_DEFAULTS.text.subscriptBaseline : options.superscript ? PPTX_DEFAULTS.text.superscriptBaseline : undefined;
    const link = normalizeHyperlink(options.hyperlink);
    const defaultColor = link && options.color === undefined ? PPTX_DEFAULTS.theme.colors.hyperlink : PPTX_DEFAULTS.text.color;
    const hasUnderline = Boolean(link) || Boolean(underline && underline.style !== "none");

    return {
        text,
        fontFace: options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        fontSize: escapement === undefined ? fontSize : fontSize * PPTX_DEFAULTS.text.escapementSizeRatio,
        color: normalizeColor({ color: options.color ?? defaultColor, transparency: options.transparency }),
        bold: options.bold ?? PPTX_DEFAULTS.text.bold,
        italic: options.italic ?? PPTX_DEFAULTS.text.italic,
        decoration: {
            underline: hasUnderline,
            underlineStyle: underlineStyle(underline?.style),
            underlineColor: underline?.color ? normalizeColor(underline.color) : undefined,
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

function paragraphFromPieces(pieces: TextPiece[], parent: PptxGenJS.TextPropsOptions, numberIndex: number, target: RenderingTarget): NormalizedTextParagraph {
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
        lineBox: paragraphLineBox({ runs, lineHeight }),
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

function piecesFromInput(input: TextInput, parent: PptxGenJS.TextPropsOptions): TextPiece[] {
    const source = Array.isArray(input) ? input.map(item => ({ text: String(item.text ?? ""), options: item.options ?? {} })) : [{ text: String(input), options: parent }];
    const pieces: TextPiece[] = [];

    for (const item of source) {
        const lines = item.text.replace(/\r\n?/g, "\n").split("\n");
        lines.forEach((line, index) => {
            pieces.push({
                text: line,
                options: { ...item.options, breakLine: index < lines.length - 1 || item.options.breakLine },
            });
        });
    }
    return pieces;
}

// PptxGenJS 4.0.1 genXmlTextBody (STEP 5): when the run or the box has `align`, only a change of the run's
// align starts a paragraph and `bullet` is not checked (the bullet test is an `else if`). Otherwise a bullet
// run starts a paragraph and its own `breakLine` is dropped, so it does not also end one.
function groupPieces(pieces: TextPiece[], parentAlign?: PptxGenJS.HAlign): TextPiece[][] {
    const groups: TextPiece[][] = [];
    let current: TextPiece[] = [];

    pieces.forEach((piece, index) => {
        let breakLine = piece.options.breakLine;
        if (current.length > 0) {
            const aligned = Boolean(piece.options.align || parentAlign);
            const startsGroup = aligned ? piece.options.align !== pieces[index - 1]?.options.align : Boolean(piece.options.bullet);
            if (startsGroup) {
                groups.push(current);
                current = [];
                if (!aligned) breakLine = false;
            }
        }

        current.push(piece);

        if (breakLine && index + 1 < pieces.length) {
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

/** `target` decides what PptxGenJS's file leaves to the application drawing it (RENDERING_TARGETS). */
export function normalizeText(input: TextInput, options: PptxGenJS.TextPropsOptions = {}, target: RenderingTarget = DEFAULT_RENDERING_TARGET): NormalizedTextBox {
    const pieces = piecesFromInput(input, options);
    const groups = groupPieces(pieces, options.align);

    const { addsParagraphSpacing, spacesFirstParagraph } = RENDERING_TARGETS[target];
    let numberIndex = 0;
    const paragraphs = groups.map((group, index) => {
        const paragraph = paragraphFromPieces(group, options, numberIndex, target);
        numberIndex = paragraph.bullet?.kind === "number" ? numberIndex + 1 : 0;
        // shortcut: PowerPoint's dropped first space before was measured on top-anchored text boxes only; middle and
        // bottom anchors and table cells follow the same rule until a measurement says otherwise.
        const first = index === 0 && !spacesFirstParagraph ? { spaceBefore: 0 } : {};
        // PowerPoint and LibreOffice leave the last paragraph's space after out of the text height, so it does not
        // lift middle- or bottom-anchored text (or grow a table row).
        const last = index === groups.length - 1 ? { spaceAfter: 0 } : {};
        return { ...paragraph, ...first, ...last };
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
 */
export function paragraphLineBox(paragraph: Pick<NormalizedTextParagraph, "runs" | "lineHeight">): NormalizedTextParagraph["lineBox"] {
    const fontSize = Math.max(...paragraph.runs.map(run => run.fontSize), 0) || pointsToPixels(PPTX_DEFAULTS.text.fontSizePt);
    const { lineHeight } = paragraph;
    // Model contract: values below 10 are lineSpacingMultiple, larger ones exact px (lineSpacing).
    return lineBoxOf(fontSize, lineHeight === undefined ? undefined : lineHeight < 10 ? lineHeight * fontSize : lineHeight);
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
