/**
 * A bare CFF font program (Adobe Technical Note #5176) with Type 2 charstrings (#5177), as PDF embeds in a
 * `/FontFile3 /Subtype /Type1C` stream: name-keyed, no hints, no subroutines, glyph space 1000 units per em, y up.
 */

/** One outline segment in glyph space, absolute coordinates. */
export type CffSegment = { readonly op: "move" | "line"; readonly points: readonly [number, number] } | { readonly op: "curve"; readonly points: readonly [number, number, number, number, number, number] };

export interface CffGlyph {
    /** The glyph name; the first glyph of a font is always `.notdef`, whatever its name. */
    readonly name: string;
    readonly width: number;
    /** Filled with the nonzero winding rule, the only one CFF has; a subpath closes at the next move. */
    readonly path: readonly CffSegment[];
}

const HEADER = [1, 0, 4, 4]; // #5176 6: major, minor, hdrSize, offSize
const STANDARD_STRINGS = 391; // #5176 10: custom strings start at SID 391
const OFFSET_SIZE = 4;
// #5176 Table 9, Type 2 charstring operators (#5177 Appendix A).
const OP = { rlineto: 5, rrcurveto: 8, endchar: 14, rmoveto: 21 } as const;
// #5176 Table 9: Top DICT FontBBox, charset, CharStrings, Private; Table 23: Private defaultWidthX, nominalWidthX.
const DICT = { FontBBox: 5, charset: 15, CharStrings: 17, Private: 18, defaultWidthX: 20, nominalWidthX: 21 } as const;
// Type 2 fixed numbers are 16.16 (#5177 3.2).
const FIXED_ONE = 65536;

/** The CFF font program `fontName` holding `glyphs` (the first is `.notdef`) and `bbox` [llx lly urx ury]. */
export function cffFont(fontName: string, glyphs: readonly CffGlyph[], bbox: readonly number[]): Uint8Array {
    const names = glyphs.slice(1).map(glyph => glyph.name);
    const strings = index(names.map(ascii));
    // Each glyph's Type 2 charstring: its width before the first operator (nominalWidthX is 0), the path, endchar.
    const glyphCharStrings: number[][] = [];

    for (const { width, path } of glyphs) {
        const out = number(width);
        let x = 0;
        let y = 0;

        for (const { op, points } of path) {
            // On the 16.16 grid, so deltas between points are exact and the outline does not drift.
            const fixed = points.map(value => Math.round(value * FIXED_ONE) / FIXED_ONE);

            for (let index = 0; index < fixed.length; index += 2) {
                const nextX = fixed[index] ?? 0;
                const nextY = fixed[index + 1] ?? 0;

                out.push(...number(nextX - x), ...number(nextY - y));
                x = nextX;
                y = nextY;
            }

            out.push(op === "move" ? OP.rmoveto : op === "line" ? OP.rlineto : OP.rrcurveto);
        }

        out.push(OP.endchar);
        glyphCharStrings.push(out);
    }

    const charStrings = index(glyphCharStrings);
    const privateDict = [...dictInteger(0), DICT.defaultWidthX, ...dictInteger(0), DICT.nominalWidthX];
    // Every Top DICT offset is a 5-byte integer, so the Top DICT's size is known before the offsets are.
    const topDictSize = (offsets: readonly number[]) => index([topDict(bbox, offsets)]).length;
    const nameIndex = index([ascii(fontName)]);
    const charsetStart = HEADER.length + nameIndex.length + topDictSize([0, 0, 0, 0]) + strings.length + index([]).length;
    const charset = [0, ...names.flatMap((_, glyph) => card16(STANDARD_STRINGS + glyph))]; // format 0
    const charStringsStart = charsetStart + charset.length;
    const privateStart = charStringsStart + charStrings.length;
    const top = index([topDict(bbox, [charsetStart, charStringsStart, privateDict.length, privateStart])]);

    return Uint8Array.from([...HEADER, ...nameIndex, ...top, ...strings, ...index([]), ...charset, ...charStrings, ...privateDict]);
}

function topDict(bbox: readonly number[], [charset, charStrings, privateSize, privateOffset]: readonly number[]): number[] {
    return [...bbox.flatMap(value => dictInteger(Math.round(value))), DICT.FontBBox, ...dictInteger(charset ?? 0), DICT.charset, ...dictInteger(charStrings ?? 0), DICT.CharStrings, ...dictInteger(privateSize ?? 0), ...dictInteger(privateOffset ?? 0), DICT.Private];
}

/** A Type 2 charstring operand (#5177 3.2): the shortest integer form, or 16.16 fixed. */
function number(value: number): number[] {
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
        return [255, ...int32(Math.round(value * FIXED_ONE))];
    }

    if (value >= -107 && value <= 107) {
        return [value + 139];
    }

    if (value >= 108 && value <= 1131) {
        return [((value - 108) >> 8) + 247, (value - 108) & 0xff];
    }

    if (value >= -1131 && value <= -108) {
        return [((-value - 108) >> 8) + 251, (-value - 108) & 0xff];
    }

    return [28, ...card16(value & 0xffff)];
}

/** A DICT integer operand (#5176 Table 3), always the 5-byte form. */
function dictInteger(value: number): number[] {
    return [29, ...int32(value)];
}

/** A CFF INDEX (#5176 5) with 4-byte offsets; an empty one is its count alone. */
function index(items: readonly (readonly number[])[]): number[] {
    if (!items.length) {
        return card16(0);
    }

    const offsets = [1];

    for (const item of items) {
        offsets.push((offsets.at(-1) ?? 1) + item.length);
    }

    return [...card16(items.length), OFFSET_SIZE, ...offsets.flatMap(int32), ...items.flat()];
}

function card16(value: number): number[] {
    return [(value >> 8) & 0xff, value & 0xff];
}

function int32(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(text: string): number[] {
    return Array.from(text, char => char.charCodeAt(0) & 0x7f);
}
