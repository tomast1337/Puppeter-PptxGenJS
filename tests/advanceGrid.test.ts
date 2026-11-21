import { afterAll, describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { existsSync, readFileSync } from "node:fs";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { FontFileError, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, readGlyphAdvances } from "../packages/pptxgenjs/src/index";
import type { GlyphAdvances } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { fontMetricsLookup } from "../packages/pptxgenjs/src/fontMetrics";
import { advanceGridWordSpacing, isWord, runPieces, wordAfter } from "../packages/pptxgenjs/src/normalize/advanceGrid";
import { floorTextWrapWidth, normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { PRINT_ZOOM, printHtml } from "../packages/puppeteer/src/printWorkarounds";
import { inchesToPixels, LAYOUT_UNITS_PER_PX, type NormalizedTextBox, pixelsToPoints, pointsToPixels } from "@pdflapas/model";
import { type BoxFloorCase, boxFloorCases, boxFloorDeck, contextFloorCases } from "./boxFloorCases";
import { kernWrapCases, kernWrapDeck } from "./kernWrapCases";
import { wrapLimitCases, wrapLimitDeck } from "./wrapLimitCases";

afterAll(closeBrowser);

const GRID = RENDERING_TARGETS.powerpoint.advanceGridPt;

if (GRID === undefined) {
    throw new Error("The PowerPoint target has no advance grid (advanceGridPt in target/powerpoint.ts).");
}

// Arial's (and Liberation Sans's) unitsPerEm and advances: space 569, "a" 1139, "i" 455.
const ARIAL: GlyphAdvances = { unitsPerEm: 2048, advances: new Map([..." ai"].map((character, index) => [character.codePointAt(0) ?? 0, [569, 1139, 455][index] ?? 0])) };

/** Big-endian 16-bit words. */
function words(...values: number[]): Uint8Array {
    const bytes = new Uint8Array(2 * values.length);
    const view = new DataView(bytes.buffer);

    for (const [index, value] of values.entries()) {
        view.setUint16(2 * index, value & 0xffff);
    }

    return bytes;
}

/** A minimal sfnt with head, hhea (numberOfHMetrics = advances.length), maxp, hmtx and the given cmap; `omit` leaves a table out. */
function sfnt({ cmap, advances, glyphs, omit = "", kern }: { cmap: Uint8Array; advances: number[]; glyphs: number; omit?: string; kern?: Uint8Array }): Uint8Array {
    const tables = [
        { tag: "cmap", bytes: cmap },
        ...(kern ? [{ tag: "kern", bytes: kern }] : []),
        { tag: "head", bytes: new Uint8Array(54) },
        { tag: "hhea", bytes: new Uint8Array(36) },
        { tag: "hmtx", bytes: words(...advances.flatMap(advance => [advance, 0])) },
        { tag: "maxp", bytes: words(0x0000, 0x5000, glyphs) },
    ].filter(table => table.tag !== omit);
    const directory = 12 + 16 * tables.length;
    let tableBytes = 0;

    for (const table of tables) {
        tableBytes += table.bytes.length;
    }

    const bytes = new Uint8Array(directory + tableBytes);
    const view = new DataView(bytes.buffer);

    view.setUint32(0, 0x00010000);
    view.setUint16(4, tables.length);
    let offset = directory;

    for (const [index, { tag, bytes: table }] of tables.entries()) {
        const record = 12 + 16 * index;

        bytes.set(
            [...tag].map(character => character.charCodeAt(0)),
            record,
        );
        view.setUint32(record + 8, offset);
        view.setUint32(record + 12, table.length);
        bytes.set(table, offset);
        if (tag === "head") {
            view.setUint16(offset + 18, 1000);
        }

        if (tag === "hhea") {
            view.setUint16(offset + 34, advances.length);
        }

        offset += table.length;
    }

    return bytes;
}

// cmap with one (3,1) format 4 subtable: A-B through idDelta (glyphs 1, 2), C through glyphIdArray (glyph 3), the 0xFFFF end segment.
const CMAP_FORMAT_4 = words(0, 1, 3, 1, 0, 12, 4, 42, 0, 6, 4, 1, 2, 66, 67, 0xffff, 0, 65, 67, 0xffff, -64, 0, 1, 0, 4, 0, 3);
// cmap with one (3,10) format 12 subtable: U+1F600-U+1F601 to glyphs 4 and 5.
const CMAP_FORMAT_12 = words(0, 1, 3, 10, 0, 12, 12, 0, 0, 28, 0, 0, 0, 1, 0x1, 0xf600, 0x1, 0xf601, 0, 4);

// Arial's advances (space 569, "A" 1366, "T" 1251, "o" 1139) and kern pairs "A " -113, " T" -37 and "To" -227.
const codePoint = (character: string) => character.codePointAt(0) ?? 0;
const KERNED: GlyphAdvances = {
    unitsPerEm: 2048,
    advances: new Map([..." ATo"].map((character, index) => [codePoint(character), [569, 1366, 1251, 1139][index] ?? 0])),
    kerning: new Map([
        [codePoint("A"), new Map([[codePoint(" "), -113]])],
        [codePoint(" "), new Map([[codePoint("T"), -37]])],
        [codePoint("T"), new Map([[codePoint("o"), -227]])],
    ]),
};

describe("advanceGridWordSpacing", () => {
    const LAYOUT_UNIT = 1 / LAYOUT_UNITS_PER_PX;
    /** Arial 8pt natural advances in px: space 2.2227pt, "a" 4.4492pt, "i" 1.7773pt. */
    const natural = (units: number) => pointsToPixels((units * 8) / 2048);
    /** The profile's width of a piece laid out with `spacing` after each of its `count` characters: rounded up to a LayoutUnit. */
    const laidOut = (naturalPx: number, count: number, spacing: number) => Math.ceil((naturalPx + count * spacing) * LAYOUT_UNITS_PER_PX) / LAYOUT_UNITS_PER_PX;

    test("is PowerPoint's 1/576 in grid on the PowerPoint target and none on LibreOffice", () => {
        expect(GRID).toBe(0.125);
        expect(RENDERING_TARGETS.libreoffice.advanceGridPt).toBeUndefined();
    });

    test("splits a run into its words and the spaces and tabs between them, in order", () => {
        expect(runPieces("  Lorem ipsum\t dolor, sit  ")).toEqual(["  ", "Lorem", " ", "ipsum", "\t ", "dolor,", " ", "sit", "  "]);
        expect(runPieces("  Lorem ipsum\t dolor, sit  ").filter(isWord)).toEqual(["Lorem", "ipsum", "dolor,", "sit"]);
        expect(runPieces("")).toEqual([]);
    });

    test("ends each word on its rounded advances floored to a LayoutUnit and gives each space one LayoutUnit more", () => {
        const spacing = advanceGridWordSpacing("a i", 8, ARIAL, GRID, 0, false);

        if (!spacing) {
            throw new Error("no spacing");
        }

        const [a, i] = spacing.words;

        // "a" rounds to 4.5pt, 6 px, a whole number of LayoutUnits; laid out 1/16 LayoutUnit under it.
        expect(laidOut(natural(1139), 1, a ?? 0)).toBe(6);
        // The space rounds to 2.25pt, 3 px, and is laid out a LayoutUnit wider.
        expect(laidOut(natural(569), 1, spacing.space)).toBe(3 + LAYOUT_UNIT);
        // "i" rounds to 1.75pt: the run's rounded 8.5pt (11.333 px) floored to 725/64, less what "a" and the space took.
        expect(laidOut(natural(455), 1, i ?? 0)).toBe(725 / 64 - 6 - (3 + LAYOUT_UNIT));
    });

    const font = resolveInstalledGlyphAdvances("Arial", false, false);

    test.skipIf(!font)("keeps every line of a long run within 3/64 px under its rounded width, never over, in Arial and charSpacing", () => {
        if (!font) {
            throw new Error("unreachable: skipped without Arial");
        }

        const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

        for (const [fontSize, charSpacing] of [
            [7, 0],
            [8, 0],
            [8.5, 0],
            [10, 0],
            [8, 1.5],
            [8, -0.3],
        ] as const) {
            const spacing = advanceGridWordSpacing(text, fontSize, font, GRID, charSpacing, false);

            if (!spacing) {
                throw new Error("no spacing");
            }

            const advance = (character: string) => ((font.advances.get(character.codePointAt(0) ?? 0) ?? 0) * fontSize) / font.unitsPerEm;
            // Each piece's PowerPoint width and laid-out width, px.
            let word = 0;
            const pieces = runPieces(text).map(piece => {
                const characters = [...piece];
                let roundedPt = 0;
                let naturalPt = 0;

                for (const character of characters) {
                    roundedPt = roundedPt + Math.round(advance(character) / GRID) * GRID + charSpacing;
                    naturalPt += advance(character);
                }

                const rounded = pointsToPixels(roundedPt);
                const naturalPx = pointsToPixels(naturalPt);

                return { word: isWord(piece), rounded, laidOut: laidOut(naturalPx, characters.length, isWord(piece) ? (spacing.words[word++] ?? Number.NaN) : spacing.space) };
            });

            expect(word).toBe(spacing.words.length);
            // Every line from a word's start to a later word's end.
            for (const [first, start] of pieces.entries()) {
                if (!start.word) {
                    continue;
                }

                let rounded = 0;
                let width = 0;

                for (const piece of pieces.slice(first)) {
                    rounded += piece.rounded;
                    width += piece.laidOut;
                    if (!piece.word) {
                        continue;
                    }

                    const under = rounded - width;

                    expect({ fontSize, charSpacing, within: under > -1e-9 && under < 3 * LAYOUT_UNIT }).toEqual({ fontSize, charSpacing, within: true });
                }
            }
        }
    });

    // The profile's fit (advanceGridWordSpacing): the line's pieces rounded up to LayoutUnits, kept within the width
    // floored to a LayoutUnit (Chromium at the print zoom: within 1/512 px of it, so no LayoutUnit more).
    test.skipIf(!font)("keeps every line of a long kerned run in the narrowest box on the grid PowerPoint keeps it in, and wraps a paragraph's first line in the next narrower", () => {
        if (!font) {
            throw new Error("unreachable: skipped without Arial");
        }

        const text = "AVAVA To Ty, Lorem AVA ipsum Wo Yo. dolor LT sit Va amet, PA consectetur AW adipiscing Te elit, sed AV do Ty";
        const step = pointsToPixels(GRID);
        const code = (character: string | undefined) => character?.codePointAt(0) ?? 0;

        for (const fontSize of [8, 10.5, 12, 14, 18, 24]) {
            const spacing = advanceGridWordSpacing(text, fontSize, font, GRID, 0, true);

            if (!spacing) {
                throw new Error("no spacing");
            }

            const units = (value: number) => pointsToPixels((value * fontSize) / font.unitsPerEm);
            const kern = (left: string | undefined, right: string | undefined) => units(font.kerning?.get(code(left))?.get(code(right)) ?? 0);
            const pieces = runPieces(text);
            let word = 0;
            let stretch = 0;
            // Each word's PowerPoint start and end and its laid-out start and end, px.
            let rounded = 0;
            let laid = 0;
            const words: { roundedStart: number; roundedEnd: number; start: number; end: number }[] = [];

            for (const [index, piece] of pieces.entries()) {
                const characters = [...piece];
                let inner = 0;
                let advancesPx = 0;
                let roundedPx = 0;

                for (const [at, character] of characters.entries()) {
                    inner += kern(characters[at - 1], character);
                    advancesPx += units(font.advances.get(code(character)) ?? 0);
                    roundedPx += pointsToPixels(Math.round(((font.advances.get(code(character)) ?? 0) * fontSize) / font.unitsPerEm / GRID) * GRID);
                }

                const edge = kern(characters.at(-1), pieces[index + 1]?.[0]);
                const naturalPx = inner + advancesPx;
                const width = laidOut(naturalPx, characters.length, isWord(piece) ? (spacing.words[word] ?? Number.NaN) : (spacing.spaces?.[stretch] ?? spacing.space));
                const start = { rounded, laid };

                rounded += inner + edge + roundedPx;
                laid += width;
                if (isWord(piece)) {
                    words.push({ roundedStart: start.rounded, roundedEnd: rounded, start: start.laid, end: laid });
                    word++;
                } else {
                    stretch++;
                }
            }

            for (const [at, first] of words.entries()) {
                for (const last of words.slice(at)) {
                    const powerPoint = last.roundedEnd - first.roundedStart;
                    const kept = Math.ceil(powerPoint / step - 1e-9) * step;
                    const width = last.end - first.start;
                    const fits = (box: number) => width <= Math.floor(box * LAYOUT_UNITS_PER_PX + 1e-9) / LAYOUT_UNITS_PER_PX + 1e-9;

                    expect({ fontSize, at, kept: fits(kept) }).toEqual({ fontSize, at, kept: true });
                    if (at === 0) {
                        expect({ fontSize, wrapped: fits(kept - step) }).toEqual({ fontSize, wrapped: false });
                    }
                }
            }
        }
    });

    // Measured against PowerPoint's PDF export (target/powerpoint.ts): a kerned run's word starts are its advances
    // rounded to the grid plus every kern pair unrounded, the pairs with a space included.
    test("adds a kerned run's pairs unrounded to PowerPoint's width, each across a span's edge on the piece of its left character", () => {
        const size = 12;
        const em = (units: number) => pointsToPixels((units * size) / 2048);
        const rounded = (units: number) => pointsToPixels(Math.round((units * size) / 2048 / GRID) * GRID);

        for (const kerned of [true, false]) {
            const spacing = advanceGridWordSpacing("A To", size, KERNED, GRID, 0, kerned);

            if (!spacing) {
                throw new Error("no spacing");
            }

            const [a, to] = spacing.words;
            const pair = (units: number) => (kerned ? em(units) : 0);

            // " T" starts on the space, which takes it in a span of its own; unkerned, the space keeps the run's.
            expect(spacing.spaces?.length ?? 0).toBe(kerned ? 1 : 0);
            // Chromium kerns "To" inside its span itself, and neither "A " nor " T" across the span edges.
            const start = laidOut(em(1366), 1, a ?? 0) + laidOut(em(569), 1, spacing.spaces?.[0] ?? spacing.space);
            const end = start + laidOut(em(1251) + em(1139) + pair(-227), 2, to ?? 0);
            const powerPointStart = rounded(1366) + rounded(569) + pair(-113 - 37);
            const powerPointEnd = powerPointStart + rounded(1251) + rounded(1139) + pair(-227);

            expect({ kerned, start: start - powerPointStart < 3 * LAYOUT_UNIT && start >= powerPointStart }).toEqual({ kerned, start: true });
            expect({ kerned, end: powerPointEnd - end < 3 * LAYOUT_UNIT && end <= powerPointEnd + 1e-9 }).toEqual({ kerned, end: true });
        }
    });

    test('keeps "A " in the word before a break and leaves " T" on the space after it, as PowerPoint\'s fit does', () => {
        const spacing = advanceGridWordSpacing("A T", 12, KERNED, GRID, 0, true);
        const unkerned = advanceGridWordSpacing("A T", 12, KERNED, GRID, 0, false);
        const pair = (units: number) => pointsToPixels((units * 12) / 2048);

        // "A " (-113 units at 12pt) narrows "A", the line's end were it to break there; " T" (-37) narrows the space.
        expect((spacing?.words[0] ?? 0) - (unkerned?.words[0] ?? 0)).toBeCloseTo(pair(-113), 1);
        expect((spacing?.spaces?.[0] ?? 0) - (unkerned?.space ?? 0)).toBeCloseTo(pair(-37), 1);
        expect(spacing?.words[1]).toBeCloseTo(unkerned?.words[1] ?? Number.NaN, 1);
    });

    test("gives a word split across kerned runs one letter-spacing, and kerns a pair across the run edge as inside one run", () => {
        const whole = advanceGridWordSpacing("AVA To", 24, KERNED, GRID, 0, true);
        const cursor = { rounded: 0, laidOut: 0 };
        const split = ["A", "V", "A ", "To"].map((text, index, texts) => advanceGridWordSpacing(text, 24, KERNED, GRID, 0, true, cursor, wordAfter(texts.slice(index + 1).join(""))));

        // Every piece of "AVA" takes the whole word's spacing, so Chromium shapes it across the spans and kerns "AV" and "VA".
        expect(split.slice(0, 3).map(spacing => spacing?.words[0])).toEqual([whole?.words[0], whole?.words[0], whole?.words[0]]);
        // " T", across the edge after "A ", is on the space as in one run, and "To" ends where it does in one run.
        expect(split[2]?.spaces).toEqual(whole?.spaces ?? []);
        expect(split[3]?.words).toEqual(whole?.words.slice(1) ?? []);
    });

    test("spaces a stretch of spaces with no pair as the run, and leaves a tab's neighbours unkerned", () => {
        expect(advanceGridWordSpacing("T o", 12, KERNED, GRID, 0, true)?.spaces).toBeUndefined();
        const tab = (kerned: boolean) => advanceGridWordSpacing("A\tT", 12, KERNED, GRID, 0, kerned);

        expect(tab(true)).toEqual(tab(false) ?? { space: Number.NaN, words: [] });
    });

    test("starts the sums again after a tab, and leaves an unmapped character unrounded", () => {
        const spacing = advanceGridWordSpacing("a\ta Z", 8, ARIAL, GRID, 0, false);

        expect(spacing?.words[1]).toBe(spacing?.words[0] ?? Number.NaN);
        // "Z" is not in ARIAL: no natural advance and no rounding, so it takes what the space's extra LayoutUnit left.
        expect(spacing?.words[2]).toBeCloseTo(-LAYOUT_UNIT - LAYOUT_UNIT / 16, 6);
    });

    test("carries the sums across a paragraph's runs through the cursor, as one run would (#370)", () => {
        const whole = advanceGridWordSpacing("i a i", 7, ARIAL, GRID, 0, false);
        const cursor = { rounded: 0, laidOut: 0 };

        advanceGridWordSpacing("i a", 7, ARIAL, GRID, 0, false, cursor);
        // At 7pt the first run ends off a LayoutUnit: started again at 0, " i" would end on another one.
        expect(advanceGridWordSpacing(" i", 7, ARIAL, GRID, 0, false, cursor)?.words).toEqual(whole?.words.slice(2) ?? []);
        expect(advanceGridWordSpacing(" i", 7, ARIAL, GRID, 0, false)?.words).not.toEqual(whole?.words.slice(2) ?? []);
        // A run without a font starts the sums again.
        advanceGridWordSpacing("a", 7, undefined, GRID, 0, false, cursor);
        expect(cursor).toEqual({ rounded: 0, laidOut: 0 });
    });

    test("is undefined without a grid, a font or a space in the font, and has no words for a run without any", () => {
        expect(advanceGridWordSpacing("a i", 8, ARIAL, undefined, 0, false)).toBeUndefined();
        expect(advanceGridWordSpacing("a i", 8, undefined, GRID, 0, false)).toBeUndefined();
        expect(advanceGridWordSpacing("a i", 8, { unitsPerEm: 2048, advances: new Map([[97, 1139]]) }, GRID, 0, false)).toBeUndefined();
        expect(advanceGridWordSpacing("  ", 8, ARIAL, GRID, 0, false)?.words).toEqual([]);
        expect(advanceGridWordSpacing("", 8, ARIAL, GRID, 0, false)?.words).toEqual([]);
    });
});

describe("readGlyphAdvances", () => {
    test("maps a format 4 cmap through idDelta and glyphIdArray, glyphs past numberOfHMetrics taking the last advance", () => {
        const advances = readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500, 600, 700], glyphs: 4 }));

        expect(advances.unitsPerEm).toBe(1000);
        expect([...advances.advances]).toEqual([
            [65, 600],
            [66, 700],
            [67, 700],
        ]);
    });

    test("prefers the full-repertoire format 12 cmap and leaves out glyphs past numGlyphs", () => {
        const advances = readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_12, advances: [500, 600, 700, 800, 900], glyphs: 5 }));

        expect([...advances.advances]).toEqual([[0x1f600, 900]]);
    });

    // A version 0 kern subtable: version, a length field, coverage, nPairs, three search fields, then the pairs
    // (left glyph, right glyph, value).
    const kernSubtable = (coverage: number, pairs: number[][], length = 14 + 6 * pairs.length) => [0, length, coverage, pairs.length, 0, 0, 0, ...pairs.flat()];

    test("reads the kern table's horizontal format 0 pairs by character, summed over subtables, past a length that overflowed", () => {
        const kern = words(
            0,
            4,
            // Arial's one subtable says 29,178 bytes for its 160,250: stepped over by its pairs, not its length.
            ...kernSubtable(
                0x0001,
                [
                    [1, 3, -50],
                    [3, 1, 20],
                ],
                6,
            ),
            ...kernSubtable(0x0001, [[1, 3, -10]]),
            // Vertical, then format 2 (stepped over by its length): neither is read.
            ...kernSubtable(0x0000, [[1, 2, -99]]),
            ...[0, 8, 0x0201, 0],
        );
        const { kerning } = readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500, 600, 700], glyphs: 4, kern }));

        // Glyph 3 is "C" only; glyph 1 is "A".
        expect(kerning).toEqual(
            new Map([
                [65, new Map([[67, -60]])],
                [67, new Map([[65, 20]])],
            ]),
        );
        // An Apple-format table (version 1.0), or none, gives no kerning.
        expect(readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500], glyphs: 4, kern: words(1, 0, 0, 0) }))).not.toHaveProperty("kerning");
        expect(readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500], glyphs: 4 }))).not.toHaveProperty("kerning");
        // A pair list past the table's end is a truncated font.
        expect(() => readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500], glyphs: 4, kern: words(0, 1, 0, 20, 0x0001, 3, 0, 0, 0, 1, 2, 3) }))).toThrow(FontFileError);
    });

    test("throws FontFileError naming readGlyphAdvances on a font it cannot read", () => {
        expect(() => readGlyphAdvances(sfnt({ cmap: CMAP_FORMAT_4, advances: [500], glyphs: 4, omit: "hhea" }))).toThrow(new FontFileError("the font has no hhea table", "readGlyphAdvances"));
        expect(() => readGlyphAdvances(new Uint8Array([0, 1]))).toThrow("readGlyphAdvances: the sfnt version at byte 0 is past the end of the 2-byte file; the font is truncated");
        // A glyphIdArray offset past the cmap table.
        const truncated = CMAP_FORMAT_4.slice(0, -2);

        expect(() => readGlyphAdvances(sfnt({ cmap: truncated, advances: [500, 600, 700], glyphs: 4 }))).toThrow(FontFileError);
    });

    const liberationSans = "/usr/share/fonts/liberation/LiberationSans-Regular.ttf";

    test.skipIf(!existsSync(liberationSans))("reads Liberation Sans, Arial's metric twin, with Arial's advances", () => {
        const advances = readGlyphAdvances(readFileSync(liberationSans));

        expect(advances.unitsPerEm).toBe(2048);
        expect([..." ai"].map(character => advances.advances.get(character.codePointAt(0) ?? 0))).toEqual([569, 1139, 455]);
    });
});

describe("resolveGlyphAdvances option", () => {
    const font = (fontFace: string) => ({ fontFace, fontSize: 8, margin: 0 });

    test("carries the grid's sums from run to run of a paragraph, and starts them again at a soft break", () => {
        const lookup = fontMetricsLookup(undefined, null, () => ARIAL);
        const runs = normalizeText([{ text: "i a" }, { text: " i" }, { text: "i a", options: { softBreakBefore: true } }, { text: "a", options: { softBreakBefore: true } }], { ...font("Arial"), fontSize: 7 }, "powerpoint", lookup).paragraphs[0]?.runs;
        const words = (text: string) => advanceGridWordSpacing(text, 7, ARIAL, GRID, 0, false)?.words;

        expect(runs?.[1]?.wordCharacterSpacing).toEqual(words("i a i")?.slice(2) ?? []);
        // At 7pt "i a" ends off a LayoutUnit: carried on, the "a" after it would take another spacing.
        expect(runs?.[3]?.characterSpacing).toBe(words("a")?.[0] ?? Number.NaN);
    });

    test("lays the PowerPoint target's words out on the grid as letter-spacing, composed with charSpacing", () => {
        const lookup = fontMetricsLookup(undefined, null, () => ARIAL);
        const run = (text: string, options: PptxGenJS.TextPropsOptions = {}, target: "powerpoint" | "libreoffice" = "powerpoint") => normalizeText(text, { ...font("Arial"), ...options }, target, lookup).paragraphs[0]?.runs[0];
        const spacing = (charSpacing: number) => advanceGridWordSpacing("a i", 8, ARIAL, GRID, charSpacing, false);

        for (const charSpacing of [0, 2]) {
            expect(run("a i", { charSpacing })).toMatchObject({ characterSpacing: spacing(charSpacing)?.space, wordCharacterSpacing: spacing(charSpacing)?.words });
        }

        // A superscript at 2/3 of 12pt is rounded at the 8pt it is drawn at.
        expect(run("a i", { fontSize: 12, superscript: true })).toMatchObject({ characterSpacing: spacing(0)?.space, wordCharacterSpacing: spacing(0)?.words });
        // A run of one word takes its spacing on the run; the LibreOffice target has no grid.
        expect(run("a")).toMatchObject({ characterSpacing: advanceGridWordSpacing("a", 8, ARIAL, GRID, 0, false)?.words[0] });
        expect(run("a")).not.toHaveProperty("wordCharacterSpacing");
        expect(run("a i", { charSpacing: 2 }, "libreoffice")).toMatchObject({ characterSpacing: pointsToPixels(2) });
        expect(run("a i", {}, "libreoffice")).not.toHaveProperty("wordCharacterSpacing");
    });

    test("is asked once per face, weight and style, and never for the LibreOffice target", () => {
        const calls: string[] = [];
        const resolve = (fontFace: string, bold: boolean, italic: boolean) => {
            calls.push(`${fontFace} ${bold} ${italic}`);

            return undefined;
        };
        const deck = (presentation: PuppeteerGenPowerPoint | PuppeteerGenLibreOffice) => {
            const slide = presentation.addSlide();

            slide.addText("one", font("Arial"));
            slide.addText("two", font("ARIAL"));
            slide.addText("three", { ...font("Arial"), bold: true });
            slide.addText("four", { ...font("Arial"), bold: true, italic: true });
        };

        deck(new PuppeteerGenLibreOffice(undefined, { resolveGlyphAdvances: resolve }));
        expect(calls).toEqual([]);
        deck(new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: resolve }));
        expect(calls).toEqual(["Arial false false", "Arial true false", "Arial true true"]);
    });

    test("keeps the natural advances for a face it does not find, or with null", async () => {
        const html = async (options: ConstructorParameters<typeof PuppeteerGenPowerPoint>[1]) => {
            const presentation = new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null, ...options });

            presentation.addSlide().addText("a i", font("Arial"));

            return (await presentation.toHtml()).html;
        };

        expect(await html({ resolveGlyphAdvances: () => undefined })).not.toContain("letter-spacing");
        expect(await html({ resolveGlyphAdvances: null })).not.toContain("letter-spacing");
        // Each word in a span of its own letter-spacing; the space between keeps the run's, and the text reads as before.
        const spacing = advanceGridWordSpacing("a i", 8, ARIAL, GRID, 0, false);
        const grid = await html({ resolveGlyphAdvances: () => ARIAL });

        expect(grid).toContain(`letter-spacing: ${spacing?.space}px; font-kerning: none;" lang="en-US"><span style="letter-spacing: ${spacing?.words[0]}px;">a</span> <span style="letter-spacing: ${spacing?.words[1]}px;">i</span></span>`);
    });

    test("puts the spaces a kern pair starts on in a span of their own letter-spacing", async () => {
        const presentation = new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null, resolveGlyphAdvances: () => KERNED });

        presentation.addSlide().addText("A T o", { fontFace: "Arial", fontSize: 12, margin: 0 });
        const { html } = await presentation.toHtml();
        const spacing = advanceGridWordSpacing("A T o", 12, KERNED, GRID, 0, true);

        // " T" starts on the first space; the second, before "o", has no pair and keeps the run's.
        expect(spacing?.spaces?.[1]).toBe(spacing?.space ?? Number.NaN);
        expect(html).toContain(`>A</span><span style="letter-spacing: ${spacing?.spaces?.[0]}px;"> </span><span style="letter-spacing: ${spacing?.words[1]}px;">T</span> <span`);
    });

    test("throws a TypeError naming the option for a resolver that is not a function or returns invalid advances", () => {
        expect(() => new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: "fc-match" as unknown as null })).toThrow("`resolveGlyphAdvances` must be a function, or null to turn the lookup off; got string");
        const invalid = new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: () => ({ unitsPerEm: 0, advances: new Map() }) });

        expect(() => invalid.addSlide().addText("a", font("Arial"))).toThrow('`resolveGlyphAdvances` returned invalid advances for "Arial": unitsPerEm must be a positive integer');
        const kerning = new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: () => ({ ...ARIAL, kerning: new Map([[65, { 86: -152 }]]) }) as unknown as GlyphAdvances });

        expect(() => kerning.addSlide().addText("a", font("Arial"))).toThrow("kerning must be a Map from the left character's code point to a Map from the right one's to the pair's kerning in font units");
        const notMap = new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: () => ({ unitsPerEm: 2048, advances: { 97: 1139 } }) as unknown as GlyphAdvances });

        expect(() => notMap.addSlide().addText("a", font("Arial"))).toThrow("advances must be a Map from code point to advance width in font units");
    });
});

describe("kerning from the kern table only on the PowerPoint target", () => {
    // A GPOS-only face: its advances are read, and it has no kern table, so no `kerning`.
    const GPOS_ONLY: GlyphAdvances = { unitsPerEm: KERNED.unitsPerEm, advances: KERNED.advances };
    const run = (fontSize: number, target: "libreoffice" | "powerpoint", advances: GlyphAdvances | undefined) =>
        normalizeText(
            "A To",
            { fontFace: "My Brand Sans", fontSize },
            target,
            fontMetricsLookup(undefined, null, () => advances),
        ).paragraphs[0]?.runs[0];

    test("draws a face whose advances carry no kern pairs unkerned at 12pt and above; LibreOffice is unchanged", () => {
        for (const fontSize of [12, 18]) {
            expect(run(fontSize, "powerpoint", GPOS_ONLY)?.kerning).toBe(false);
            // The word grid adds no pair: "A " and " T" leave the words as an unkerned run's.
            const unkerned = advanceGridWordSpacing("A To", fontSize, KERNED, GRID, 0, false)?.words ?? [];

            expect(run(fontSize, "powerpoint", GPOS_ONLY)?.wordCharacterSpacing).toEqual(unkerned);
            expect(run(fontSize, "powerpoint", KERNED)?.wordCharacterSpacing).not.toEqual(unkerned);
            expect(run(fontSize, "powerpoint", KERNED)).not.toHaveProperty("kerning");
            for (const advances of [GPOS_ONLY, KERNED, undefined]) {
                expect(run(fontSize, "libreoffice", advances)).not.toHaveProperty("kerning");
            }
        }

        // Without advances (a font that cannot be read) the face keeps the default: kerned from 12pt.
        expect(run(12, "powerpoint", undefined)).not.toHaveProperty("kerning");
    });

    test("writes font-kerning: none on a GPOS-only run at 12pt", async () => {
        const presentation = new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null, resolveGlyphAdvances: () => GPOS_ONLY });

        presentation.addSlide().addText("A To", { fontFace: "My Brand Sans", fontSize: 12, margin: 0 });
        expect((await presentation.toHtml()).html).toMatch(/class="text-run"[^>]*font-kerning: none;/);
    });

    const arial = resolveInstalledGlyphAdvances("Arial", false, false);

    test.skipIf(!arial?.kerning?.size)("keeps the installed Arial's kern pairs at 12pt", () => {
        const kerned = normalizeText(
            "A To",
            { fontFace: "Arial", fontSize: 12 },
            "powerpoint",
            fontMetricsLookup(undefined, null, () => arial),
        ).paragraphs[0]?.runs[0];

        expect(kerned).not.toHaveProperty("kerning");
    });

    // Noto Sans kerns from GPOS alone (no kern table).
    const noto = resolveInstalledGlyphAdvances("Noto Sans", false, false);

    test.skipIf(!noto || noto.kerning !== undefined)("draws the installed Noto Sans, kerned from GPOS alone, unkerned at 12pt", () => {
        expect(
            normalizeText(
                "AVATAR",
                { fontFace: "Noto Sans", fontSize: 12 },
                "powerpoint",
                fontMetricsLookup(undefined, null, () => noto),
            ).paragraphs[0]?.runs[0]?.kerning,
        ).toBe(false);
    });
});

describe("the PowerPoint advance grid in Chromium", () => {
    const installed = resolveInstalledGlyphAdvances("Liberation Sans", false, false) !== undefined;
    const TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore";
    const CASES = [8, 9, 10].flatMap(fontSize => [false, true].map(bold => ({ fontSize, bold })));

    // Under 12pt (unkerned) each word and each space is laid out at its advances rounded to the grid, so a run, printed
    // at the print zoom as the PDF is, is as wide as its rounded advances: less one LayoutUnit at most, and less what
    // FreeType's 26.6 font size takes off Chromium's advances (the size in device px truncated to 1/64, at the zoom).
    test.skipIf(!installed)("lays an unkerned run out as wide as its advances rounded to 0.125pt, with the installed font", async () => {
        const presentation = new PuppeteerGenPowerPoint();
        const slide = presentation.addSlide();

        for (const [index, { fontSize, bold }] of CASES.entries()) {
            slide.addText(TEXT, { fontFace: "Liberation Sans", fontSize, bold, margin: 0, wrap: false, x: 0.1, y: 0.1 + 0.3 * index, w: 9, h: 0.2 });
        }

        const { html } = await presentation.toHtml();
        const widths = await withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                await page.setContent(printHtml(html));

                return await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".text-run"), run => run.getBoundingClientRect().width));
            } finally {
                await page.close();
            }
        });

        expect(widths).toHaveLength(CASES.length);
        for (const [index, { fontSize, bold }] of CASES.entries()) {
            const font = resolveInstalledGlyphAdvances("Liberation Sans", bold, false);
            const natural = (character: string) => ((font?.advances.get(character.codePointAt(0) ?? 0) ?? 0) * fontSize) / (font?.unitsPerEm ?? 1);
            let roundedPt = 0;
            let naturalPt = 0;

            for (const character of TEXT) {
                roundedPt += Math.round(natural(character) / GRID) * GRID;
                naturalPt += natural(character);
            }

            const rounded = pointsToPixels(roundedPt);
            const size = pointsToPixels(fontSize) * PRINT_ZOOM * LAYOUT_UNITS_PER_PX;
            const truncation = pointsToPixels(naturalPt) * (1 - Math.floor(size) / size);

            // 8pt rounds 2.7px wider than the natural advances: the grid, not the font, sets the width.
            if (fontSize === 8 && !bold) {
                expect(rounded - pointsToPixels(naturalPt)).toBeGreaterThan(2);
            }

            const width = (widths[index] ?? 0) / PRINT_ZOOM;

            expect({ fontSize, bold, under: Math.abs(rounded - truncation - width) < 1 / LAYOUT_UNITS_PER_PX }).toEqual({ fontSize, bold, under: true });
        }
    });
});

describe("a kerned run on the PowerPoint grid in Chromium", () => {
    const font = resolveInstalledGlyphAdvances("Arial", false, false);
    // The kern-heavy line measured against PowerPoint's PDF export (target/powerpoint.ts), with pairs across spaces.
    const LINE = "AVAVA To Ty Wa Yo LT P. Te Vo AV Fa";
    const SIZES = [12, 18, 36];

    // From 12pt PowerPoint puts each word at the run's advances rounded to the grid plus every kern pair unrounded,
    // "A " and " T" too, which Chromium leaves out across a word span's edge.
    test.skipIf(!font?.kerning?.size)("starts each word where PowerPoint's rounded advances and kern pairs put it, with the installed Arial", async () => {
        if (!font) {
            throw new Error("unreachable: skipped without Arial");
        }

        const presentation = new PuppeteerGenPowerPoint();
        const slide = presentation.addSlide();

        for (const [index, fontSize] of SIZES.entries()) {
            slide.addText(LINE, { fontFace: "Arial", fontSize, margin: 0, wrap: false, x: 0.1, y: 0.1 + 0.9 * index, w: 9.8, h: 0.8 });
        }

        const { html } = await presentation.toHtml();
        const starts = await withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                await page.setContent(printHtml(html));

                return await page.evaluate(() =>
                    Array.from(document.querySelectorAll<HTMLElement>(".text-run"), run => {
                        const left = run.getBoundingClientRect().left;
                        const words = Array.from(run.querySelectorAll("span")).filter(span => span.textContent?.trim());

                        return words.map(word => word.getBoundingClientRect().left - left);
                    }),
                );
            } finally {
                await page.close();
            }
        });
        const characters = [...LINE];

        for (const [index, fontSize] of SIZES.entries()) {
            const units = (value: number) => (value * fontSize) / font.unitsPerEm;
            const expected: number[] = [];
            let x = 0;

            for (const [at, character] of characters.entries()) {
                if (character !== " " && (at === 0 || characters[at - 1] === " ")) {
                    expected.push(pointsToPixels(x));
                }

                const next = characters[at + 1];

                x += Math.round(units(font.advances.get(character.codePointAt(0) ?? 0) ?? 0) / GRID) * GRID + units(next === undefined ? 0 : (font.kerning?.get(character.codePointAt(0) ?? 0)?.get(next.codePointAt(0) ?? 0) ?? 0));
            }

            const drawn = (starts[index] ?? []).map(start => start / PRINT_ZOOM);

            // At most two LayoutUnits past PowerPoint's start (advanceGridWordSpacing).
            expect(drawn.map((start, word) => ({ fontSize, word, within: start - (expected[word] ?? Number.NaN) > -1e-6 && start - (expected[word] ?? Number.NaN) < 3 / LAYOUT_UNITS_PER_PX }))).toEqual(expected.map((_, word) => ({ fontSize, word, within: true })));
        }
    });
});

describe("kerning across a run edge in Chromium", () => {
    const font = resolveInstalledGlyphAdvances("Arial", false, false);

    type Piece = { readonly text: string; readonly options?: PptxGenJS.TextPropsOptions };
    type Case = readonly [name: string, pieces: readonly Piece[], measuredPt: number];
    const split = (each: (index: number) => PptxGenJS.TextPropsOptions): Piece[] => [..."AVAVAVAV"].map((text, index) => ({ text, options: each(index) }));
    // Measured against PowerPoint's PDF export of a synthetic deck: "<pieces> xo" in Arial at 24pt, margin 0, the x of
    // "xo" from the line's start, in pt. A pair split across runs is kerned while both runs keep the face, size and
    // weight (colour, the same options, underline: within 0.03pt of one run), and not across a bold or size change.
    const LETTER_CASES: readonly Case[] = [
        ["one run", [{ text: "AVAVAVAV" }], 122.143],
        ["colour", split(index => ({ color: index % 2 ? "000000" : "C00000" })), 122.136],
        ["same options", split(() => ({})), 122.143],
        ["bold", split(index => ({ bold: index % 2 === 1 })), 134.67],
        ["size", split(index => ({ fontSize: index % 2 ? 20 : 24 })), 124.08],
        ["underline", split(index => (index % 2 ? { underline: { style: "sng" } } : {})), 122.16],
    ];
    // The same for the space pairs "A " and " T" of "AVA To": PowerPoint kerns them across a run edge too.
    const SPACE_CASES: readonly Case[] = [
        ['"A" | " To"', [{ text: "AVA" }, { text: " To", options: { color: "C00000" } }], 81.24],
        ['"AVA " | "To"', [{ text: "AVA " }, { text: "To", options: { color: "C00000" } }], 81.24],
        ['"A" | " " | "To"', [{ text: "AVA" }, { text: " ", options: { color: "C00000" } }, { text: "To" }], 81.248],
    ];
    /** Whether each case's "xo" starts within 0.1pt of PowerPoint's: word starts on the advance grid are that close (advanceGridWordSpacing). */
    const matches = async (cases: readonly Case[]) => {
        const presentation = new PuppeteerGenPowerPoint();
        const slide = presentation.addSlide();

        for (const [index, [, pieces]] of cases.entries()) {
            const runs = [...pieces, { text: " xo" }].map(({ text, options }) => ({ text, options: { fontFace: "Arial", fontSize: 24, ...options } }));

            slide.addText(runs, { x: 0.25, y: 0.15 + 0.52 * index, w: 8.3, h: 0.5, margin: 0, valign: "top", fontFace: "Arial", fontSize: 24 });
        }

        const { html } = await presentation.toHtml();
        const starts = await withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                await page.setContent(printHtml(html));

                return await page.evaluate(() =>
                    Array.from(document.querySelectorAll(".slide-text"), box => {
                        const left = box.querySelector(".text-run")?.getBoundingClientRect().left ?? Number.NaN;
                        const xo = Array.from(box.querySelectorAll(".text-run span")).find(word => word.textContent === "xo");

                        return (xo?.getBoundingClientRect().left ?? Number.NaN) - left;
                    }),
                );
            } finally {
                await page.close();
            }
        });

        expect(cases.map(([name, , measured], index) => ({ name, near: Math.abs(pixelsToPoints((starts[index] ?? Number.NaN) / PRINT_ZOOM) - measured) < 0.1 }))).toEqual(cases.map(([name]) => ({ name, near: true })));
    };

    test.skipIf(!font)("kerns a pair split across runs of one face, size and weight, as PowerPoint does", () => matches(LETTER_CASES));
    test.skipIf(!font)("kerns a space pair split across runs, as PowerPoint does", () => matches(SPACE_CASES));
});

describe("a kerned line at the wrap limit in Chromium", () => {
    const font = resolveInstalledGlyphAdvances("Arial", false, false);
    const cases = font ? kernWrapCases(font) : [];

    // Measured against PowerPoint's PDF export of the same deck: "A " counts in the line, " T" leaves with the space.
    test.skipIf(!cases.length)("keeps or wraps the last word of each measured box as PowerPoint does", async () => {
        const { html } = await kernWrapDeck(new PuppeteerGenPowerPoint(), cases).toHtml();
        // Whether "AVAVA" is on its box's first line, for each case, printed as the PDF is.
        const drawn = await withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                await page.setContent(printHtml(html));

                return await page.evaluate(() =>
                    Array.from(document.querySelectorAll(".slide-text"), box => {
                        const words = Array.from(box.querySelectorAll(".text-run span"));
                        const top = (text: string) => words.find(word => word.textContent === text)?.getBoundingClientRect().top;

                        return top("AVAVA") === top("Lorem");
                    }),
                );
            } finally {
                await page.close();
            }
        });

        expect(cases.map(({ label }, index) => ({ label, fits: drawn[index] }))).toEqual(cases.map(({ label, fits }) => ({ label, fits })));
    });
});

describe("a line in a box whose width inside the insets is off the 1/576 in grid, in Chromium", () => {
    const font = resolveInstalledGlyphAdvances("Arial", false, false);
    const cases = font ? boxFloorCases(font) : [];
    /** Whether the line's last word is on its box's first line, for each case, printed as the PDF is. */
    const fits = async (selected: readonly BoxFloorCase[]) => {
        const { html } = await boxFloorDeck(new PuppeteerGenPowerPoint(), selected).toHtml();

        return withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                await page.setContent(printHtml(html));

                return await page.evaluate(() =>
                    Array.from(document.querySelectorAll(".slide-container"), box => {
                        const words = Array.from(box.querySelectorAll(".text-run span")).filter(word => word.textContent?.trim());
                        const top = (word: Element | undefined) => word?.getBoundingClientRect().top;

                        return top(words.at(-2)) === top(words[0]);
                    }),
                );
            } finally {
                await page.close();
            }
        });
    };

    // Measured against PowerPoint's PDF export of the same deck: the width inside the insets floored to 0.125pt. The two
    // 14pt "Dolor sit AVA" boxes end 0.002pt past it, under a LayoutUnit (0.0117pt), and wrap (#341).
    test.skipIf(!cases.length)("keeps or wraps the last word of each measured box as PowerPoint does", async () => {
        expect(cases.some(({ overflowPt }) => overflowPt > 0 && overflowPt < pixelsToPoints(1 / LAYOUT_UNITS_PER_PX))).toBe(true);
        const drawn = await fits(cases);

        expect(cases.map(({ label }, index) => ({ label, fits: drawn[index] }))).toEqual(cases.map(({ label, fits }) => ({ label, fits })));
    });
    test.skipIf(!font)("floors a centered, right-aligned, justified, shape, table cell and right-to-left line's width as PowerPoint does", async () => {
        const measured = contextFloorCases();
        const drawn = await fits(measured);

        expect(measured.map(({ label }, index) => ({ label, fits: drawn[index] }))).toEqual(measured.map(({ label, fits }) => ({ label, fits })));
    });
});

describe("floorTextWrapWidth", () => {
    const box = (margin: [number, number, number, number], extra: Partial<NormalizedTextBox> = {}): NormalizedTextBox => ({ paragraphs: [], margin, verticalAlign: "top", wrap: true, fit: "none", direction: "horizontal", rtl: false, ...extra });
    const step = pointsToPixels(GRID);

    test("moves the width's remainder past the 1/576 in grid into the right inset on the PowerPoint target", () => {
        // 7.2pt insets (0.1 in) leave 100 - 9.6 - 9.6 px, 484.8 steps: 0.8 of a step goes to the end inset.
        const [top, right, bottom, left] = floorTextWrapWidth(box([0, 9.6, 0, 9.6]), 100, "powerpoint").margin;

        expect([top, right - 9.6, bottom, left].map(value => Number((value / step).toFixed(9)))).toEqual([0, 0.8, 0, 9.6 / step]);
        // Right-to-left text too: PowerPoint starts its left-aligned lines at the left inset whatever the remainder.
        const rtl = floorTextWrapWidth(box([0, 9.6, 0, 9.6], { rtl: true }), 100, "powerpoint").margin;

        expect(Number(((rtl[1] - 9.6) / step).toFixed(9))).toBe(0.8);
        expect(rtl[3]).toBe(9.6);
    });
    test("keeps a width on the grid, text that does not wrap or runs vertically, and the LibreOffice target", () => {
        const inches = box([0, 0, 0, 0]);

        expect(floorTextWrapWidth(inches, inchesToPixels(7.5), "powerpoint")).toBe(inches);
        expect(floorTextWrapWidth(box([0, 9.6, 0, 9.6], { wrap: false }), 100, "powerpoint").margin).toEqual([0, 9.6, 0, 9.6]);
        expect(floorTextWrapWidth(box([0, 9.6, 0, 9.6], { direction: "vertical" }), 100, "powerpoint").margin).toEqual([0, 9.6, 0, 9.6]);
        expect(floorTextWrapWidth(box([0, 9.6, 0, 9.6]), 100, "libreoffice").margin).toEqual([0, 9.6, 0, 9.6]);
    });
});

describe("the PowerPoint target's wrap limit in Chromium", () => {
    const arial = (bold: boolean) => resolveInstalledGlyphAdvances("Arial", bold, false);
    const installed = arial(false) !== undefined && arial(true) !== undefined;

    // A line fits in PowerPoint while its rounded advances are no wider than the box: exactly as wide or 0.125pt
    // narrower keeps the last word, 0.125pt wider wraps it, on the first, second or third line of one long run.
    test.skipIf(!installed)("keeps a last line exactly as wide as the box or 0.125pt narrower, and wraps one 0.125pt wider, as PowerPoint does", async () => {
        const cases = wrapLimitCases(bold => arial(bold) ?? { unitsPerEm: 1, advances: new Map() });
        const { html } = await wrapLimitDeck(new PuppeteerGenPowerPoint(), cases).toHtml();
        const drawn = await withBrowser(async browser => {
            const page = await browser.newPage();

            try {
                // Printed as the PDF is: at the print zoom.
                await page.setContent(printHtml(html));

                return await page.evaluate(() => Array.from(document.querySelectorAll(".slide-text"), box => new Set(Array.from(box.querySelectorAll(".text-run"), run => Array.from(run.getClientRects(), rect => Math.round(rect.top))).flat()).size));
            } finally {
                await page.close();
            }
        });

        expect(cases.map(({ fontSize, bold, lines, steps }, index) => ({ fontSize, bold, lines, steps, drawn: drawn[index] }))).toEqual(cases.map(({ fontSize, bold, lines, steps, expectedLines }) => ({ fontSize, bold, lines, steps, drawn: expectedLines })));
    });
});
