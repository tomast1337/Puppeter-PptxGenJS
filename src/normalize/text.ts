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
    // PptxGenJS 4.0.1 emits array margins as left, right, bottom, top.
    const [left, right, bottom, top] = margin.map(pointsToPixels) as FourSideMargin;
    return [top, right, bottom, left];
}

function inheritedOptions(parent: PptxGenJS.TextPropsOptions, child: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions {
    const { x: _x, y: _y, w: _w, h: _h, fill: _fill, line: _line, shadow: _shadow, rotate: _rotate, flipH: _flipH, flipV: _flipV, rectRadius: _rectRadius, objectName: _objectName, ...parentText } = parent;
    const inherited = { ...parentText, ...child };
    if (child.hyperlink && child.color === undefined) delete inherited.color;
    return inherited;
}

function underlineStyle(style?: string): NormalizedTextRun["decoration"]["underlineStyle"] {
    if (style === "dbl" || style === "wavyDbl") return "double";
    if (style?.includes("dash") || style?.includes("Dash")) return "dashed";
    if (style?.includes("dot") || style?.includes("Dot")) return "dotted";
    if (style?.includes("wavy")) return "wavy";
    return "solid";
}

function textShadow(options: PptxGenJS.TextPropsOptions): NormalizedShadow | undefined {
    if (options.glow) {
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
    return undefined;
}

export function normalizeTextRun(text: string, options: PptxGenJS.TextPropsOptions): NormalizedTextRun {
    if (options.hyperlink && !options.hyperlink.url && !options.hyperlink.slide) {
        throw new Error("hyperlink requires either url or slide");
    }
    const underline = typeof options.underline === "object" ? options.underline : undefined;
    const strike = options.strike === true || options.strike === "sngStrike" || options.strike === "dblStrike";
    const baseline = options.baseline ?? 0;
    const link = options.hyperlink?.url ? { href: options.hyperlink.url, tooltip: options.hyperlink.tooltip } : options.hyperlink?.slide ? { href: `#slide-${options.hyperlink.slide}`, tooltip: options.hyperlink.tooltip, slide: options.hyperlink.slide } : undefined;
    const defaultColor = link && options.color === undefined ? PPTX_DEFAULTS.theme.colors.hyperlink : PPTX_DEFAULTS.text.color;

    return {
        text,
        fontFace: options.fontFace ?? PPTX_DEFAULTS.text.fontFace,
        fontSize: pointsToPixels(options.fontSize ?? PPTX_DEFAULTS.text.fontSizePt),
        color: normalizeColor({ color: options.color ?? defaultColor, transparency: options.transparency }),
        bold: options.bold ?? PPTX_DEFAULTS.text.bold,
        italic: options.italic ?? PPTX_DEFAULTS.text.italic,
        decoration: {
            underline: Boolean(link) || Boolean(underline && underline.style !== "none"),
            underlineStyle: underlineStyle(underline?.style),
            underlineColor: underline?.color ? normalizeColor(underline.color) : undefined,
            strike,
            doubleStrike: options.strike === "dblStrike",
        },
        verticalAlign: options.subscript ? "sub" : options.superscript ? "super" : "baseline",
        baselineOffset: pointsToPixels(baseline / 100),
        characterSpacing: pointsToPixels(options.charSpacing ?? 0),
        highlight: options.highlight ? normalizeColor(options.highlight) : undefined,
        outline: options.outline
            ? {
                  color: normalizeColor(options.outline.color),
                  width: pointsToPixels(options.outline.size),
              }
            : undefined,
        glow: textShadow(options),
        shadow: options.shadow ? normalizeShadow(options.shadow) : undefined,
        language: options.lang ?? PPTX_DEFAULTS.theme.language,
        link,
        softBreakBefore: options.softBreakBefore ?? PPTX_DEFAULTS.text.softBreakBefore,
    };
}

function numberMarker(type: string, value: number): string {
    const alpha = (upper: boolean) => {
        let result = "";
        let current = Math.max(1, value);
        while (current > 0) {
            current--;
            result = String.fromCharCode((upper ? 65 : 97) + (current % 26)) + result;
            current = Math.floor(current / 26);
        }
        return result;
    };
    const roman = (upper: boolean) => {
        const values: Array<[number, string]> = [
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
        let current = Math.max(1, value);
        let result = "";
        for (const [amount, glyph] of values)
            while (current >= amount) {
                result += glyph;
                current -= amount;
            }
        return upper ? result : result.toLowerCase();
    };
    let core = String(value);
    if (type.startsWith("alphaLc")) core = alpha(false);
    else if (type.startsWith("alphaUc")) core = alpha(true);
    else if (type.startsWith("romanLc")) core = roman(false);
    else if (type.startsWith("romanUc")) core = roman(true);
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
    // PptxGenJS 4.0.1 documents `numberType`, but its OOXML writer reads the
    // deprecated `style` field. Preserve that runtime quirk for compatibility.
    const numberType = config.style ?? PPTX_DEFAULTS.bullet.numberType;
    const code = config.characterCode ?? config.code;
    const marker = kind === "number" ? numberMarker(numberType, start + numberIndex) : code && /^[0-9a-f]{4,6}$/i.test(code) ? String.fromCodePoint(parseInt(code, 16)) : PPTX_DEFAULTS.bullet.character;
    return { kind, marker, indent: pointsToPixels(indentPt * (level + 1)), level, start, numberType };
}

function tabAlignment(value?: "l" | "r" | "ctr" | "dec"): "left" | "right" | "center" | "decimal" {
    return value === "r" ? "right" : value === "ctr" ? "center" : value === "dec" ? "decimal" : "left";
}

function paragraphFromPieces(pieces: TextPiece[], parent: PptxGenJS.TextPropsOptions, numberIndex: number): NormalizedTextParagraph {
    const first = inheritedOptions(parent, pieces[0]?.options);
    const lineHeight = first.lineSpacing !== undefined ? pointsToPixels(first.lineSpacing) : first.lineSpacingMultiple !== undefined ? first.lineSpacingMultiple : undefined;
    return {
        runs: pieces.map(piece => normalizeTextRun(piece.text, inheritedOptions(parent, piece.options))),
        align: first.align ?? PPTX_DEFAULTS.text.align,
        rtl: first.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        lineHeight,
        spaceBefore: pointsToPixels(first.paraSpaceBefore ?? 0),
        spaceAfter: pointsToPixels(first.paraSpaceAfter ?? 0),
        tabStops: (first.tabStops ?? []).map(stop => ({
            position: inchesToPixels(stop.position),
            alignment: tabAlignment(stop.alignment),
        })),
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

export function normalizeText(input: TextInput, options: PptxGenJS.TextPropsOptions = {}): NormalizedTextBox {
    const pieces = piecesFromInput(input, options);
    const groups: TextPiece[][] = [];
    let current: TextPiece[] = [];
    for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index]!;
        const previous = pieces[index - 1];
        const alignmentChanged = current.length > 0 && piece.options.align !== previous?.options.align && Boolean(piece.options.align || options.align);
        if (alignmentChanged || (current.length > 0 && Boolean(piece.options.bullet))) {
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

    let numberIndex = 0;
    const paragraphs = groups.map(group => {
        const paragraph = paragraphFromPieces(group, options, numberIndex);
        if (paragraph.bullet?.kind === "number") numberIndex++;
        else numberIndex = 0;
        return paragraph;
    });
    // PptxGenJS 4.0.1 only copies `vert` into a:bodyPr; `textDirection` is
    // declared on TextBaseProps but is ignored by the runtime.
    const direction = options.vert ?? PPTX_DEFAULTS.text.textDirection;
    return {
        paragraphs,
        margin: normalizeMargins(options.margin as number | FourSideMargin | undefined),
        verticalAlign: options.valign ?? PPTX_DEFAULTS.text.valign,
        wrap: options.wrap ?? PPTX_DEFAULTS.text.wrap,
        fit: options.fit ?? (options.shrinkText ? "shrink" : options.autoFit ? "resize" : PPTX_DEFAULTS.text.fit),
        direction: direction === "vert" ? "vertical" : direction === "vert270" ? "vertical270" : direction.includes("wordArtVert") ? "stacked" : "horizontal",
        rtl: options.rtlMode ?? PPTX_DEFAULTS.text.rtlMode,
        borderRadius: options.shape === "roundRect" ? clamp(options.rectRadius ?? 0.1, 0, 1) * 50 : 0,
    };
}
