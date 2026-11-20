import { afterAll, describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { existsSync, readFileSync } from "node:fs";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { FontFileError, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, readGlyphAdvances } from "../packages/pptxgenjs/src/index";
import type { GlyphAdvances } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { fontMetricsLookup } from "../packages/pptxgenjs/src/fontMetrics";
import { advanceGridWordSpacing, isWord, runPieces } from "../packages/pptxgenjs/src/normalize/advanceGrid";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { PRINT_ZOOM, printHtml } from "../packages/puppeteer/src/printWorkarounds";
import { LAYOUT_UNITS_PER_PX, pointsToPixels } from "@pdflapas/model";
import { wrapLimitCases, wrapLimitDeck } from "./wrapLimitCases";

afterAll(closeBrowser);

const GRID = powerPointGrid();

function powerPointGrid(): number {
    const grid = RENDERING_TARGETS.powerpoint.advanceGridPt;
    if (grid === undefined) throw new Error("The PowerPoint target has no advance grid (advanceGridPt in target/powerpoint.ts).");
    return grid;
}
// Arial's (and Liberation Sans's) unitsPerEm and advances: space 569, "a" 1139, "i" 455.
const ARIAL: GlyphAdvances = { unitsPerEm: 2048, advances: new Map([..." ai"].map((character, index) => [character.codePointAt(0) ?? 0, [569, 1139, 455][index] ?? 0])) };

/** Big-endian 16-bit words. */
function words(...values: number[]): Uint8Array {
    const bytes = new Uint8Array(2 * values.length);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint16(2 * index, value & 0xffff));
    return bytes;
}

/** A minimal sfnt with head, hhea (numberOfHMetrics = advances.length), maxp, hmtx and the given cmap; `omit` leaves a table out. */
function sfnt({ cmap, advances, glyphs, omit = "" }: { cmap: Uint8Array; advances: number[]; glyphs: number; omit?: string }): Uint8Array {
    const tables = [
        { tag: "cmap", bytes: cmap },
        { tag: "head", bytes: new Uint8Array(54) },
        { tag: "hhea", bytes: new Uint8Array(36) },
        { tag: "hmtx", bytes: words(...advances.flatMap(advance => [advance, 0])) },
        { tag: "maxp", bytes: words(0x0000, 0x5000, glyphs) },
    ].filter(table => table.tag !== omit);
    const directory = 12 + 16 * tables.length;
    const bytes = new Uint8Array(directory + tables.reduce((sum, table) => sum + table.bytes.length, 0));
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, tables.length);
    let offset = directory;
    tables.forEach(({ tag, bytes: table }, index) => {
        const record = 12 + 16 * index;
        bytes.set(
            [...tag].map(character => character.charCodeAt(0)),
            record,
        );
        view.setUint32(record + 8, offset);
        view.setUint32(record + 12, table.length);
        bytes.set(table, offset);
        if (tag === "head") view.setUint16(offset + 18, 1000);
        if (tag === "hhea") view.setUint16(offset + 34, advances.length);
        offset += table.length;
    });
    return bytes;
}

// cmap with one (3,1) format 4 subtable: A-B through idDelta (glyphs 1, 2), C through glyphIdArray (glyph 3), the 0xFFFF end segment.
const CMAP_FORMAT_4 = words(0, 1, 3, 1, 0, 12, 4, 42, 0, 6, 4, 1, 2, 66, 67, 0xffff, 0, 65, 67, 0xffff, -64, 0, 1, 0, 4, 0, 3);
// cmap with one (3,10) format 12 subtable: U+1F600-U+1F601 to glyphs 4 and 5.
const CMAP_FORMAT_12 = words(0, 1, 3, 10, 0, 12, 12, 0, 0, 28, 0, 0, 0, 1, 0x1, 0xf600, 0x1, 0xf601, 0, 4);

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
        const spacing = advanceGridWordSpacing("a i", 8, ARIAL, GRID, 0);
        if (!spacing) throw new Error("no spacing");
        const [a, i] = spacing.words;
        // "a" rounds to 4.5pt, 6 px, a whole number of LayoutUnits; laid out 1/16 LayoutUnit under it.
        expect(laidOut(natural(1139), 1, a ?? 0)).toBe(6);
        // The space rounds to 2.25pt, 3 px, and is laid out a LayoutUnit wider.
        expect(laidOut(natural(569), 1, spacing.space)).toBe(3 + LAYOUT_UNIT);
        // "i" rounds to 1.75pt: the run's rounded 8.5pt (11.333 px) floored to 725/64, less what "a" and the space took.
        expect(laidOut(natural(455), 1, i ?? 0)).toBe(725 / 64 - 6 - (3 + LAYOUT_UNIT));
    });

    test("keeps every line of a long run within 3/64 px under its rounded width, never over, in Arial and charSpacing", () => {
        const font = resolveInstalledGlyphAdvances("Arial", false, false);
        if (!font) return console.warn("Arial is not installed: the long-run sums are not checked");
        const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
        for (const [fontSize, charSpacing] of [
            [7, 0],
            [8, 0],
            [8.5, 0],
            [10, 0],
            [8, 1.5],
            [8, -0.3],
        ] as const) {
            const spacing = advanceGridWordSpacing(text, fontSize, font, GRID, charSpacing);
            if (!spacing) throw new Error("no spacing");
            const advance = (character: string) => ((font.advances.get(character.codePointAt(0) ?? 0) ?? 0) * fontSize) / font.unitsPerEm;
            // Each piece's PowerPoint width and laid-out width, px.
            let word = 0;
            const pieces = runPieces(text).map(piece => {
                const characters = [...piece];
                const rounded = pointsToPixels(characters.reduce((sum, character) => sum + Math.round(advance(character) / GRID) * GRID + charSpacing, 0));
                const naturalPx = pointsToPixels(characters.reduce((sum, character) => sum + advance(character), 0));
                return { word: isWord(piece), rounded, laidOut: laidOut(naturalPx, characters.length, isWord(piece) ? (spacing.words[word++] ?? Number.NaN) : spacing.space) };
            });
            expect(word).toBe(spacing.words.length);
            // Every line from a word's start to a later word's end.
            pieces.forEach((start, first) => {
                if (!start.word) return;
                let rounded = 0;
                let width = 0;
                pieces.slice(first).forEach(piece => {
                    rounded += piece.rounded;
                    width += piece.laidOut;
                    if (!piece.word) return;
                    const under = rounded - width;
                    expect({ fontSize, charSpacing, within: under > -1e-9 && under < 3 * LAYOUT_UNIT }).toEqual({ fontSize, charSpacing, within: true });
                });
            });
        }
    });

    test("starts the sums again after a tab, and leaves an unmapped character unrounded", () => {
        const spacing = advanceGridWordSpacing("a\ta Z", 8, ARIAL, GRID, 0);
        expect(spacing?.words[1]).toBe(spacing?.words[0] ?? Number.NaN);
        // "Z" is not in ARIAL: no natural advance and no rounding, so it takes what the space's extra LayoutUnit left.
        expect(spacing?.words[2]).toBeCloseTo(-LAYOUT_UNIT - LAYOUT_UNIT / 16, 6);
    });

    test("is undefined without a grid, a font or a space in the font, and has no words for a run without any", () => {
        expect(advanceGridWordSpacing("a i", 8, ARIAL, undefined, 0)).toBeUndefined();
        expect(advanceGridWordSpacing("a i", 8, undefined, GRID, 0)).toBeUndefined();
        expect(advanceGridWordSpacing("a i", 8, { unitsPerEm: 2048, advances: new Map([[97, 1139]]) }, GRID, 0)).toBeUndefined();
        expect(advanceGridWordSpacing("  ", 8, ARIAL, GRID, 0)?.words).toEqual([]);
        expect(advanceGridWordSpacing("", 8, ARIAL, GRID, 0)?.words).toEqual([]);
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

    test("lays the PowerPoint target's words out on the grid as letter-spacing, composed with charSpacing", () => {
        const lookup = fontMetricsLookup(undefined, null, () => ARIAL);
        const run = (text: string, options: PptxGenJS.TextPropsOptions = {}, target: "powerpoint" | "libreoffice" = "powerpoint") => normalizeText(text, { ...font("Arial"), ...options }, target, lookup).paragraphs[0]?.runs[0];
        const spacing = (charSpacing: number) => advanceGridWordSpacing("a i", 8, ARIAL, GRID, charSpacing);
        for (const charSpacing of [0, 2]) expect(run("a i", { charSpacing })).toMatchObject({ characterSpacing: spacing(charSpacing)?.space, wordCharacterSpacing: spacing(charSpacing)?.words });
        // A superscript at 2/3 of 12pt is rounded at the 8pt it is drawn at.
        expect(run("a i", { fontSize: 12, superscript: true })).toMatchObject({ characterSpacing: spacing(0)?.space, wordCharacterSpacing: spacing(0)?.words });
        // A run of one word takes its spacing on the run; the LibreOffice target has no grid.
        expect(run("a")).toMatchObject({ characterSpacing: advanceGridWordSpacing("a", 8, ARIAL, GRID, 0)?.words[0] });
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
        const spacing = advanceGridWordSpacing("a i", 8, ARIAL, GRID, 0);
        const grid = await html({ resolveGlyphAdvances: () => ARIAL });
        expect(grid).toContain(`letter-spacing: ${spacing?.space}px; font-kerning: none;" lang="en-US"><span style="letter-spacing: ${spacing?.words[0]}px;">a</span> <span style="letter-spacing: ${spacing?.words[1]}px;">i</span></span>`);
    });

    test("throws a TypeError naming the option for a resolver that is not a function or returns invalid advances", () => {
        expect(() => new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: "fc-match" as unknown as null })).toThrow("`resolveGlyphAdvances` must be a function, or null to turn the lookup off; got string");
        const invalid = new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: () => ({ unitsPerEm: 0, advances: new Map() }) });
        expect(() => invalid.addSlide().addText("a", font("Arial"))).toThrow('`resolveGlyphAdvances` returned invalid advances for "Arial": unitsPerEm must be a positive integer');
        const notMap = new PuppeteerGenPowerPoint(undefined, { resolveGlyphAdvances: () => ({ unitsPerEm: 2048, advances: { 97: 1139 } }) as unknown as GlyphAdvances });
        expect(() => notMap.addSlide().addText("a", font("Arial"))).toThrow("advances must be a Map from code point to advance width in font units");
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
        CASES.forEach(({ fontSize, bold }, index) => slide.addText(TEXT, { fontFace: "Liberation Sans", fontSize, bold, margin: 0, wrap: false, x: 0.1, y: 0.1 + 0.3 * index, w: 9, h: 0.2 }));
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
        CASES.forEach(({ fontSize, bold }, index) => {
            const font = resolveInstalledGlyphAdvances("Liberation Sans", bold, false);
            const natural = (character: string) => ((font?.advances.get(character.codePointAt(0) ?? 0) ?? 0) * fontSize) / (font?.unitsPerEm ?? 1);
            const rounded = pointsToPixels([...TEXT].reduce((sum, character) => sum + Math.round(natural(character) / GRID) * GRID, 0));
            const size = pointsToPixels(fontSize) * PRINT_ZOOM * LAYOUT_UNITS_PER_PX;
            const truncation = pointsToPixels([...TEXT].reduce((sum, character) => sum + natural(character), 0)) * (1 - Math.floor(size) / size);
            // 8pt rounds 2.7px wider than the natural advances: the grid, not the font, sets the width.
            if (fontSize === 8 && !bold) expect(rounded - pointsToPixels([...TEXT].reduce((sum, character) => sum + natural(character), 0))).toBeGreaterThan(2);
            const width = (widths[index] ?? 0) / PRINT_ZOOM;
            expect({ fontSize, bold, under: Math.abs(rounded - truncation - width) < 1 / LAYOUT_UNITS_PER_PX }).toEqual({ fontSize, bold, under: true });
        });
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
