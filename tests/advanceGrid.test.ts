import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import { FontFileError, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, readGlyphAdvances } from "../packages/pptxgenjs/src/index";
import type { GlyphAdvances } from "../packages/pptxgenjs/src/defaults";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { fontMetricsLookup } from "../packages/pptxgenjs/src/fontMetrics";
import { advanceGridSpacing } from "../packages/pptxgenjs/src/normalize/advanceGrid";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { pointsToPixels } from "@pdflapas/model";

afterAll(closeBrowser);

const GRID = RENDERING_TARGETS.powerpoint.advanceGridPt;
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

describe("advanceGridSpacing", () => {
    test("is PowerPoint's 1/576 in grid on the PowerPoint target and none on LibreOffice", () => {
        expect(GRID).toBe(0.125);
        expect(RENDERING_TARGETS.libreoffice.advanceGridPt).toBeUndefined();
    });

    test("spreads the rounding of each advance to 0.125pt over the run's characters", () => {
        // Arial 8pt: space 2.2227 -> 2.25, "a" 4.4492 -> 4.5, "i" 1.7773 -> 1.75.
        expect(advanceGridSpacing(" ", 8, ARIAL, GRID)).toBeCloseTo(2.25 - (569 * 8) / 2048, 10);
        const natural = ((569 + 1139 + 455) * 8) / 2048;
        expect(advanceGridSpacing("a i", 8, ARIAL, GRID) * 3).toBeCloseTo(2.25 + 4.5 + 1.75 - natural, 10);
        // 9pt: "a" 5.0054 -> 5.0, rounded down.
        expect(advanceGridSpacing("a", 9, ARIAL, GRID)).toBeCloseTo(5 - (1139 * 9) / 2048, 10);
    });

    test("counts a character the font does not map without rounding it, and gives 0 without a grid, a font or text", () => {
        expect(advanceGridSpacing("aZ", 8, ARIAL, GRID)).toBeCloseTo((4.5 - (1139 * 8) / 2048) / 2, 10);
        expect(advanceGridSpacing("a", 8, ARIAL, undefined)).toBe(0);
        expect(advanceGridSpacing("a", 8, undefined, GRID)).toBe(0);
        expect(advanceGridSpacing("", 8, ARIAL, GRID)).toBe(0);
        // An astral character is one character.
        expect(advanceGridSpacing("😀", 8, ARIAL, GRID)).toBe(0);
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

    test("lays the PowerPoint target's runs out on the grid as letter-spacing, composed with charSpacing", () => {
        const lookup = fontMetricsLookup(undefined, null, () => ARIAL);
        const runs = (charSpacing?: number) => normalizeText("a i", { ...font("Arial"), charSpacing }, "powerpoint", lookup).paragraphs[0]?.runs[0]?.characterSpacing;
        const grid = advanceGridSpacing("a i", 8, ARIAL, GRID);
        expect(runs()).toBeCloseTo(pointsToPixels(grid), 10);
        expect(runs(2)).toBeCloseTo(pointsToPixels(2 + grid), 10);
        // A superscript at 2/3 of 12pt is rounded at the 8pt it is drawn at.
        expect(normalizeText("a i", { ...font("Arial"), fontSize: 12, superscript: true }, "powerpoint", lookup).paragraphs[0]?.runs[0]?.characterSpacing).toBeCloseTo(pointsToPixels(grid), 10);
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
        expect(await html({ resolveGlyphAdvances: () => ARIAL })).toContain(`letter-spacing: ${pointsToPixels(advanceGridSpacing("a i", 8, ARIAL, GRID))}px`);
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

    // Under 12pt (unkerned) a run is its advances plus its letter-spacing after each character: Chromium's own advances
    // (canvas, one character at a time) plus the font file's rounding to the grid must give the run's width.
    test.skipIf(!installed)("widens or narrows an unkerned run by its advances' rounding to 0.125pt, with the installed font", async () => {
        const presentation = new PuppeteerGenPowerPoint();
        const slide = presentation.addSlide();
        CASES.forEach(({ fontSize, bold }, index) => slide.addText(TEXT, { fontFace: "Liberation Sans", fontSize, bold, margin: 0, wrap: false, x: 0.1, y: 0.1 + 0.3 * index, w: 9, h: 0.2 }));
        const { html } = await presentation.toHtml();
        const runs = await withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent(html);
                return await page.evaluate(() => {
                    const context = document.createElement("canvas").getContext("2d");
                    if (!context) throw new Error("no 2d canvas");
                    return Array.from(document.querySelectorAll<HTMLElement>(".text-run"), run => {
                        const style = getComputedStyle(run);
                        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                        const advances = Array.from(run.textContent ?? "").reduce((sum, character) => sum + context.measureText(character).width, 0);
                        return { width: run.getBoundingClientRect().width, advances };
                    });
                });
            } finally {
                await page.close();
            }
        });
        expect(runs).toHaveLength(CASES.length);
        const roundings = CASES.map(({ fontSize, bold }) => pointsToPixels(advanceGridSpacing(TEXT, fontSize, resolveInstalledGlyphAdvances("Liberation Sans", bold, false), GRID) * TEXT.length));
        // Regular 8pt rounds 2.7px wider: more than the 0.05px the comparison allows.
        expect(roundings[0]).toBeGreaterThan(2);
        roundings.forEach((rounding, index) => expect(runs[index]?.width).toBeCloseTo((runs[index]?.advances ?? 0) + rounding, 1));
    });
});
