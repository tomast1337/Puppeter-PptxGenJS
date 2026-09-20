import type PptxGenJS from "pptxgenjs";
import { type FourSideMargin, PPTX_DEFAULTS } from "../defaults";
import type { NormalizedShadow, NormalizedTextBox, NormalizedTextBullet, NormalizedTextParagraph, NormalizedTextRun } from "../model/types";
import { inchesToPixels, pointsToPixels } from "../utils";
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

function normalizeMargins(margin?: number | FourSideMargin): [number, number, number, number] {
    if (margin === undefined) {
        return PPTX_DEFAULTS.text.marginIn.map(inchesToPixels) as [number, number, number, number];
    }
    if (typeof margin === "number") {
        const value = pointsToPixels(margin);
        return [value, value, value, value];
    }
    const [left, right, bottom, top] = margin.map(pointsToPixels) as FourSideMargin;
    return [top, right, bottom, left];
}

function inheritedOptions(parent: PptxGenJS.TextPropsOptions, child: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions {
    const {
        x: _x,
        y: _y,
        w: _w,
        h: _h,
        fill: _fill,
        line: _line,
        shadow: _shadow,
        rotate: _rotate,
        flipH: _flipH,
        flipV: _flipV,
        rectRadius: _rectRadius,
        objectName: _objectName,
        ...parentText
    } = parent;
    const inherited = { ...parentText, ...child };
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

function getHyperlinkData(options: PptxGenJS.TextPropsOptions) {
    if (!options.hyperlink) return undefined;
    if (options.hyperlink.url) return { href: options.hyperlink.url, tooltip: options.hyperlink.tooltip };
    if (options.hyperlink.slide) return { href: `#slide-${options.hyperlink.slide}`, tooltip: options.hyperlink.tooltip, slide: options.hyperlink.slide };
    return undefined;
}

function getVerticalAlign(options: PptxGenJS.TextPropsOptions): "sub" | "super" | "baseline" {
    if (options.subscript) return "sub";
    if (options.superscript) return "super";
    return "baseline";
}

export function normalizeTextRun(text: string, options: PptxGenJS.TextPropsOptions): NormalizedTextRun {
    if (options.hyperlink && !options.hyperlink.url && !options.hyperlink.slide) {
        throw new Error("hyperlink requires either url or slide");
    }

    const underline = typeof options.underline === "object" ? options.underline : undefined;
    const strike = options.strike === true || options.strike === "sngStrike" || options.strike === "dblStrike";
    const baseline = options.baseline ?? 0;
    const link = getHyperlinkData(options);
    const defaultColor = link && options.color === undefined ? PPTX_DEFAULTS.theme.colors.hyperlink : PPTX_DEFAULTS.text.color;
    const hasUnderline = Boolean(link) || Boolean(underline && underline.style !== "none");

    return {
        text,
        fontFace: options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        fontSize: pointsToPixels(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt),
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
        baselineOffset: pointsToPixels(baseline / 100),
        characterSpacing: pointsToPixels(options.charSpacing ?? 0),
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

function paragraphFromPieces(pieces: TextPiece[], parent: PptxGenJS.TextPropsOptions, numberIndex: number): NormalizedTextParagraph {
    const first = inheritedOptions(parent, pieces[0]?.options);
    const lineHeight = first.lineSpacing !== undefined ? pointsToPixels(first.lineSpacing) : first.lineSpacingMultiple;

    return {
        runs: pieces.map(piece => normalizeTextRun(piece.text, inheritedOptions(parent, piece.options))),
        align: first.align ?? PPTX_DEFAULTS.text.align,
        rtl: first.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        lineHeight,
        spaceBefore: pointsToPixels(first.paraSpaceBefore ?? 0),
        spaceAfter: pointsToPixels(first.paraSpaceAfter ?? 0),
        tabStops: (first.tabStops ?? []).map(stop => ({
            position: inchesToPixels(stop.position),
            alignment: TAB_ALIGNMENT_MAP[stop.alignment!] ?? "left",
        })),
        bullet: normalizeBullet(first, numberIndex),
    };
}

function piecesFromInput(input: TextInput, parent: PptxGenJS.TextPropsOptions): TextPiece[] {
    const source = Array.isArray(input)
        ? input.map(item => ({ text: String(item.text ?? ""), options: item.options ?? {} }))
        : [{ text: String(input), options: parent }];
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

function shouldStartNewGroup(currentPiece: TextPiece, previousPiece?: TextPiece, parentAlign?: any): boolean {
    if (!previousPiece) return false;
    const alignmentChanged = currentPiece.options.align !== previousPiece.options.align && Boolean(currentPiece.options.align || parentAlign);
    return alignmentChanged || Boolean(currentPiece.options.bullet);
}

function groupPieces(pieces: TextPiece[], parentAlign?: any): TextPiece[][] {
    const groups: TextPiece[][] = [];
    let current: TextPiece[] = [];

    for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index]!;
        const previous = pieces[index - 1];

        if (current.length > 0 && shouldStartNewGroup(piece, previous, parentAlign)) {
            groups.push(current);
            current = [];
        }

        current.push(piece);

        if (piece.options.breakLine && index + 1 < pieces.length) {
            groups.push(current);
            current = [];
        }
    }

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
    if (options.fit) return options.fit as any;
    if (options.shrinkText) return "shrink";
    if (options.autoFit) return "resize";
    return PPTX_DEFAULTS.text.fit as any;
}

export function normalizeText(input: TextInput, options: PptxGenJS.TextPropsOptions = {}): NormalizedTextBox {
    const pieces = piecesFromInput(input, options);
    const groups = groupPieces(pieces, options.align);

    let numberIndex = 0;
    const paragraphs = groups.map(group => {
        const paragraph = paragraphFromPieces(group, options, numberIndex);
        numberIndex = paragraph.bullet?.kind === "number" ? numberIndex + 1 : 0;
        return paragraph;
    });

    const direction = options.vert ?? PPTX_DEFAULTS.text.textDirection;

    return {
        paragraphs,
        margin: normalizeMargins(options.margin as number | FourSideMargin | undefined),
        verticalAlign: options.valign ?? PPTX_DEFAULTS.text.valign,
        wrap: options.wrap ?? PPTX_DEFAULTS.text.wrap,
        fit: getFitMode(options),
        direction: getTextDirection(direction),
        rtl: options.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        borderRadius: options.shape === "roundRect" ? clamp(options.rectRadius ?? 0.1, 0, 1) * 50 : 0,
    };
}
