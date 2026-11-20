import { deflateSync, inflateSync } from "node:zlib";
import { type CffGlyph, type CffSegment, cffFont } from "./cffFont";
import { appendObjects, objectOffsets, type PdfObject, pdfText, readTrailer } from "./pdfUpdate";

/**
 * Skia, Chromium's PDF backend, embeds no font with CFF outlines: SkPDFFont::FontType turns `kCFF_Font` (an OpenType
 * `OTTO` face such as URW Gothic) into a Type 3 font whose glyphs are path procedures (src/pdf/SkPDFFont.cpp,
 * Chromium 138), while PowerPoint's export embeds the face as Type 1C. A Type 3 font is no font to a reader: it is
 * rasterized without hinting, and text extractors place its words from the font matrix and bounding box, which
 * Skia writes y-down. `withType1CFonts` rewrites each such font as a Type 1 font with a CFF program built from
 * those same glyph procedures, so the glyphs, codes, encoding, widths and ToUnicode stay as Chromium wrote them
 * and no content stream changes. A Type 3 font whose glyphs are not plain filled outlines (colour or bitmap glyphs,
 * even-odd fills) stays as it is.
 */
export function withType1CFonts(pdf: Uint8Array): Uint8Array {
    const text = pdfText(pdf);
    if (!TYPE3.test(text)) return pdf;
    const offsets = objectOffsets(text, fontError);
    const trailer = readTrailer(text, fontError);
    const objects: PdfObject[] = [];
    let next = trailer.size;
    for (const match of text.matchAll(TYPE3_ALL)) {
        const font = objectContaining(text, match.index, offsets);
        const rewritten = font && type1CFont(text, offsets, font, next);
        if (!rewritten) continue;
        objects.push(rewritten.font, rewritten.descriptor, rewritten.fontFile);
        next += NEW_OBJECTS_PER_FONT;
    }
    return objects.length ? appendObjects(pdf, trailer, objects) : pdf;
}

interface IndirectObject {
    readonly number: number;
    readonly body: string;
}

// Each rewritten font gets its own descriptor, as Skia shares one among the Type 3 fonts of a face, and a font file.
const NEW_OBJECTS_PER_FONT = 2;
const TYPE3 = /\/Subtype\s*\/Type3\b/;
const TYPE3_ALL = new RegExp(TYPE3.source, "g");
const OBJECT_HEADER = /(\d+) (\d+) obj\s*$/;
const FONT_MATRIX = /\/FontMatrix\s*\[([^\]]*)\]/;
const FONT_BBOX = /\/FontBBox\s*\[([^\]]*)\]/;
const WIDTHS = /\/Widths\s*\[([^\]]*)\]/;
const CHAR_PROCS = /\/CharProcs\s*<<([^>]*)>>/;
const CHAR_PROC = /\/([^\s/<>[\]()]+)\s+(\d+)\s+0\s+R/g;
const ENCODING = /\/Encoding\s*(<<[^>]*>>|\d+\s+\d+\s+R|\/[A-Za-z]+)/;
const TO_UNICODE = /\/ToUnicode\s*(\d+\s+\d+\s+R)/;
const FIRST_CHAR = /\/FirstChar\s+(\d+)/;
const LAST_CHAR = /\/LastChar\s+(\d+)/;
const DESCRIPTOR = /\/FontDescriptor\s+(\d+)\s+0\s+R/;
const FONT_NAME = /\/FontName\s*\/([^\s/<>[\]()]+)/;
const CAP_HEIGHT = /\/CapHeight\s+(-?[\d.]+)/;
const X_HEIGHT = /\/XHeight\s+(-?[\d.]+)/;
// The entries the rewritten descriptor writes itself.
const REPLACED_DESCRIPTOR_ENTRIES = /\/(CapHeight|XHeight|FontBBox|Ascent|Descent|FontFile\d?)\s*(\[[^\]]*\]|-?[\d.]+|\d+\s+\d+\s+R)/g;
const STREAM_LENGTH = /\/Length\s+(\d+)(?!\s+\d+\s+R)/;
const FLATE = /\/Filter\s*\/FlateDecode\b/;
const ANY_FILTER = /\/Filter\b/;
const WHITESPACE_RUN = /\s+/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const NOTDEF = "g0"; // Skia names glyph 0 g0 and gives it to the codes of the range no glyph uses
// Operand counts of the glyph procedure operators an outline glyph uses (ISO 32000-1 8.5.2, 9.6.5).
const OPERANDS: Readonly<Record<string, number>> = { d1: 6, m: 2, l: 2, c: 6, v: 4, y: 4, re: 4, h: 0, f: 0, F: 0 };
// The Type 1 font matrix (ISO 32000-1 9.2.4): glyph space is 1000 units per text space unit.
const TYPE1_UNITS_PER_EM = 1000;
const FLOAT32_DIGITS = 6; // significant decimal digits a float32 always holds

/** The object around `position`, if it is the newest version of that object. */
function objectContaining(text: string, position: number, offsets: ReadonlyMap<number, number>): IndirectObject | undefined {
    const start = text.lastIndexOf(" obj", position);
    const lineStart = text.lastIndexOf("\n", start) + 1;
    const header = OBJECT_HEADER.exec(text.slice(lineStart, start + " obj".length));
    if (!header) throw fontError(`the Type 3 font at byte ${position} has no "n g obj" header line`);
    const number = Number(header[1]);
    if (offsets.get(number) !== lineStart) return undefined;
    return { number, body: text.slice(start + " obj".length, text.indexOf("endobj", start)).trim() };
}

/** The dictionary of object `number`, and its stream's data when it has one (still filtered). */
function object(text: string, offsets: ReadonlyMap<number, number>, number: number): { dictionary: string; data?: string } {
    const offset = offsets.get(number);
    if (offset === undefined) throw fontError(`object ${number} is not in its cross-reference table`);
    const start = text.indexOf("obj", offset) + "obj".length;
    const end = text.indexOf("endobj", start);
    const streamAt = text.indexOf("stream", start);
    if (streamAt < 0 || streamAt > end) return { dictionary: text.slice(start, end).trim() };
    const dictionary = text.slice(start, streamAt).trim();
    const length = Number(STREAM_LENGTH.exec(dictionary)?.[1] ?? Number.NaN);
    if (!Number.isInteger(length)) throw fontError(`stream object ${number} has no direct /Length`);
    const dataStart = streamAt + "stream".length + (text.startsWith("\r\n", streamAt + "stream".length) ? 2 : 1);
    return { dictionary, data: text.slice(dataStart, dataStart + length) };
}

/** The glyph procedure of a CharProcs stream, decoded. */
function glyphProcedure(text: string, offsets: ReadonlyMap<number, number>, number: number): string | undefined {
    const { dictionary, data } = object(text, offsets, number);
    if (data === undefined) throw fontError(`glyph procedure ${number} is not a stream`);
    if (!ANY_FILTER.test(dictionary)) return data;
    // Another filter is not a Skia glyph procedure: the font stays Type 3.
    if (!FLATE.test(dictionary) || dictionary.includes("/DecodeParms")) return undefined;
    return inflateSync(Buffer.from(data, "latin1")).toString("latin1");
}

/**
 * The font, descriptor and font file objects that make Type 3 `font` a Type 1 font with an embedded CFF program,
 * the new descriptor numbered `firstNumber` and the font file after it; undefined when one of its glyphs is not a plain filled outline.
 */
function type1CFont(text: string, offsets: ReadonlyMap<number, number>, font: IndirectObject, firstNumber: number): { font: PdfObject; descriptor: PdfObject; fontFile: PdfObject } | undefined {
    const matrix = numbers(FONT_MATRIX.exec(font.body)?.[1]);
    const [a, b, c, d, e, f] = matrix;
    // Skia writes [s 0 0 -s 0 0]: anything else is not a font this rewrite can express in a Type 1 font matrix.
    if (a === undefined || d === undefined || matrix.length !== 6 || b !== 0 || c !== 0 || e !== 0 || f !== 0 || a <= 0 || d === 0) throw fontError(`its Type 3 font ${font.number} has the font matrix [${matrix.join(" ")}]`);
    const scale: Scale = { x: unitScale(a), y: unitScale(d) };
    const descriptorNumber = Number(DESCRIPTOR.exec(font.body)?.[1] ?? Number.NaN);
    const procedures = CHAR_PROCS.exec(font.body)?.[1];
    const encoding = ENCODING.exec(font.body)?.[1];
    const bbox = numbers(FONT_BBOX.exec(font.body)?.[1]);
    if (!Number.isInteger(descriptorNumber) || procedures === undefined || encoding === undefined || bbox.length !== 4) throw fontError(`its Type 3 font ${font.number} has no /FontDescriptor, /CharProcs, /Encoding or /FontBBox`);

    const glyphs: CffGlyph[] = [];
    for (const [, name = "", number = ""] of procedures.matchAll(CHAR_PROC)) {
        const procedure = glyphProcedure(text, offsets, Number(number));
        const glyph = procedure === undefined ? undefined : outlineGlyph(name, procedure, scale);
        if (!glyph) return undefined;
        if (name === NOTDEF) glyphs.unshift(glyph);
        else glyphs.push(glyph);
    }
    if (glyphs[0]?.name !== NOTDEF) glyphs.unshift({ name: NOTDEF, width: 0, path: [] });

    const [llx = 0, lly = 0, urx = 0, ury = 0] = bbox;
    const box = [Math.min(llx * scale.x, urx * scale.x), Math.min(lly * scale.y, ury * scale.y), Math.max(llx * scale.x, urx * scale.x), Math.max(lly * scale.y, ury * scale.y)];
    const descriptor = object(text, offsets, descriptorNumber).dictionary;
    const fontName = FONT_NAME.exec(descriptor)?.[1];
    if (fontName === undefined || !descriptor.endsWith(">>")) throw fontError(`the descriptor of its Type 3 font ${font.number} has no /FontName`);
    const program = deflateSync(cffFont(fontName, glyphs, box));
    const widths = numbers(WIDTHS.exec(font.body)?.[1]).map(width => pdfNumber(width * scale.x));
    const toUnicode = TO_UNICODE.exec(font.body)?.[1];
    const heights = [CAP_HEIGHT, X_HEIGHT].map(entry => {
        const value = Number(entry.exec(descriptor)?.[1] ?? Number.NaN);
        // Skia writes them in its y-down glyph space, the cap height negative: a height is a distance above the baseline.
        return Number.isFinite(value) ? `/${entry === CAP_HEIGHT ? "CapHeight" : "XHeight"} ${pdfNumber(Math.abs(value * scale.y))}` : "";
    });
    return {
        font: {
            number: font.number,
            generation: 0,
            body: `<</Type /Font\n/Subtype /Type1\n/BaseFont /${fontName}\n/FirstChar ${FIRST_CHAR.exec(font.body)?.[1] ?? 0}\n/LastChar ${LAST_CHAR.exec(font.body)?.[1] ?? widths.length - 1}\n/Widths [${widths.join(" ")}]\n/Encoding ${encoding}${toUnicode ? `\n/ToUnicode ${toUnicode}` : ""}\n/FontDescriptor ${firstNumber} 0 R>>`,
        },
        descriptor: {
            number: firstNumber,
            generation: 0,
            body: `${descriptor.slice(0, -">>".length).replace(REPLACED_DESCRIPTOR_ENTRIES, "").trimEnd()}\n${heights.filter(Boolean).join("\n")}\n/FontBBox [${box.map(pdfNumber).join(" ")}]\n/Ascent ${pdfNumber(box[3] ?? 0)}\n/Descent ${pdfNumber(box[1] ?? 0)}\n/FontFile3 ${firstNumber + 1} 0 R>>`,
        },
        fontFile: { number: firstNumber + 1, generation: 0, body: `<</Subtype /Type1C\n/Filter /FlateDecode\n/Length ${program.length}>> stream\n${program.toString("latin1")}\nendstream` },
    };
}

interface Scale {
    readonly x: number;
    readonly y: number;
}

/**
 * The glyph a Type 3 glyph procedure draws, in Type 1 glyph space, when it is an uncoloured outline filled with the
 * nonzero rule (`wx 0 llx lly urx ury d1`, path operators, `f`), as Skia writes a glyph that has a path.
 */
function outlineGlyph(name: string, procedure: string, scale: Scale): CffGlyph | undefined {
    const path: CffSegment[] = [];
    const operands: number[] = [];
    let width: number | undefined;
    let filled = false;
    let current: readonly [number, number] = [0, 0];
    let subpathStart = current;
    const point = (x = 0, y = 0): [number, number] => [x * scale.x, y * scale.y];
    for (const token of procedure.trim().split(WHITESPACE_RUN)) {
        if (NUMBER.test(token)) {
            operands.push(Number(token));
            continue;
        }
        if (OPERANDS[token] !== operands.length || filled || (width === undefined) !== (token === "d1")) return undefined;
        const [o1, o2, o3, o4, o5, o6] = operands;
        operands.length = 0;
        if (token === "d1") width = (o1 ?? 0) * scale.x;
        else if (token === "f" || token === "F") filled = true;
        else if (token === "h") current = subpathStart;
        else if (token === "re") {
            const [x, y] = point(o1, o2);
            const [w, h] = point(o3, o4);
            path.push({ op: "move", points: [x, y] }, { op: "line", points: [x + w, y] }, { op: "line", points: [x + w, y + h] }, { op: "line", points: [x, y + h] });
            current = subpathStart = [x, y];
        } else if (token === "m" || token === "l") {
            current = point(o1, o2);
            if (token === "m") subpathStart = current;
            path.push({ op: token === "m" ? "move" : "line", points: current });
        } else {
            // c: both control points given; v: the first is the current point; y: the second is the end point.
            const first = token === "v" ? current : point(o1, o2);
            const second = token === "v" ? point(o1, o2) : point(o3, o4);
            const end = token === "c" ? point(o5, o6) : point(o3, o4);
            path.push({ op: "curve", points: [...first, ...second, ...end] });
            current = end;
        }
    }
    if (width === undefined || operands.length || (path.length > 0 && !filled)) return undefined;
    return { name, width, path };
}

/**
 * Type 1 glyph units per Type 3 glyph unit. Skia prints the float32 nearest its 1/1000 (`.00100000005`): rounded
 * to float32's precision the scale is 1 and the outlines keep their integer coordinates, the CFF's compact numbers.
 */
function unitScale(matrixEntry: number): number {
    return Number((TYPE1_UNITS_PER_EM * matrixEntry).toPrecision(FLOAT32_DIGITS));
}

function numbers(list: string | undefined): number[] {
    return list === undefined ? [] : list.trim().split(WHITESPACE_RUN).filter(Boolean).map(Number);
}

/** A PDF number to a thousandth of a unit, no exponent. */
function pdfNumber(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function fontError(problem: string): Error {
    return new Error(`Cannot embed the PDF's CFF fonts: Chromium's PDF is not in the shape expected (${problem}). Report it with the Chromium version.`);
}
