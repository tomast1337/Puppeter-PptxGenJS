import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { FontFileError, PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, readFontWinMetrics } from "../packages/pptxgenjs/src/index";
import { FONT_WIN_METRICS } from "../packages/pptxgenjs/src/defaults";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { fontMetricsTable } from "../packages/pptxgenjs/src/fontMetrics";

/** A minimal sfnt: a head table with unitsPerEm and an OS/2 table with usWinAscent and usWinDescent (`os2Length` bytes). */
function sfnt({ unitsPerEm = 1000, winAscent = 950, winDescent = 250, os2Length = 78, base = 0 } = {}): Uint8Array {
    const tables = [
        { tag: "OS/2", length: os2Length },
        { tag: "head", length: 54 },
    ];
    const directory = 12 + 16 * tables.length;
    const bytes = new Uint8Array(directory + tables.reduce((sum, table) => sum + table.length, 0));
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, tables.length);
    let offset = directory;
    tables.forEach((table, index) => {
        const record = 12 + 16 * index;
        bytes.set(
            [...table.tag].map(char => char.charCodeAt(0)),
            record,
        );
        view.setUint32(record + 8, base + offset);
        view.setUint32(record + 12, table.length);
        if (table.tag === "head") view.setUint16(offset + 18, unitsPerEm);
        else if (os2Length >= 78) {
            view.setUint16(offset + 74, winAscent);
            view.setUint16(offset + 76, winDescent);
        }
        offset += table.length;
    });
    return bytes;
}

/** A TrueType collection holding `face` as its only font. */
function ttc(face: (base: number) => Uint8Array): Uint8Array {
    const header = 16;
    const bytes = new Uint8Array(header + face(header).length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x74746366); // ttcf
    view.setUint32(4, 0x00010000);
    view.setUint32(8, 1);
    view.setUint32(12, header);
    bytes.set(face(header), header);
    return bytes;
}

function installedFont(family: string): string | undefined {
    try {
        const file = Bun.spawnSync(["fc-match", "-f", "%{file}", family]).stdout.toString();
        return file && existsSync(file) ? file : undefined;
    } catch {
        return undefined;
    }
}

const BRAND = { unitsPerEm: 1000, winAscent: 950, winDescent: 250 };

describe("fontMetrics option", () => {
    test("rejects invalid metrics with an error naming the face, the field and the fix", () => {
        const cases: [unknown, string][] = [
            [{ "My Brand Sans": { ...BRAND, unitsPerEm: 0 } }, '`fontMetrics["My Brand Sans"].unitsPerEm` must be a positive integer (head.unitsPerEm)'],
            [{ "My Brand Sans": { ...BRAND, winAscent: -1 } }, '`fontMetrics["My Brand Sans"].winAscent` must be a non-negative integer (OS/2 usWinAscent)'],
            [{ "My Brand Sans": { ...BRAND, winDescent: 250.5 } }, '`fontMetrics["My Brand Sans"].winDescent` must be a non-negative integer (OS/2 usWinDescent)'],
            [{ "My Brand Sans": { unitsPerEm: 1000, winAscent: 950 } }, '`fontMetrics["My Brand Sans"].winDescent` must be a non-negative integer'],
            [{ "My Brand Sans": { ...BRAND, winAscent: 0, winDescent: 0 } }, '`fontMetrics["My Brand Sans"]` winAscent + winDescent must be greater than 0'],
            [{ "My Brand Sans": { ...BRAND, ascent: 900 } }, '`fontMetrics["My Brand Sans"]`'],
            ["My Brand Sans", "`fontMetrics` must be an object keyed by font face name"],
        ];
        for (const [fontMetrics, message] of cases) {
            // `as`: the option arrives unchecked from JavaScript callers.
            const create = () => new PuppeteerGen(undefined, { fontMetrics: fontMetrics as Record<string, typeof BRAND> });
            expect(create).toThrow(TypeError);
            expect(create).toThrow(message);
            expect(create).toThrow("readFontWinMetrics(fontBytes)");
        }
        expect(() => new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": BRAND, "MY BRAND SANS": BRAND } })).toThrow('lists "My Brand Sans" and "MY BRAND SANS", the same face');
    });

    test("merges the caller's faces over FONT_WIN_METRICS, case-insensitively, frozen", () => {
        const table = fontMetricsTable({ "My Brand Sans": BRAND, ARIAL: { unitsPerEm: 1000, winAscent: 800, winDescent: 200 } });
        expect(table["my brand sans"]).toEqual(BRAND);
        expect(table.arial).toEqual({ unitsPerEm: 1000, winAscent: 800, winDescent: 200 });
        expect(table.calibri).toEqual(FONT_WIN_METRICS.calibri!);
        expect(Object.isFrozen(table)).toBe(true);
        expect(Object.isFrozen(table["my brand sans"])).toBe(true);
        expect(fontMetricsTable(undefined)).toBe(FONT_WIN_METRICS);
    });

    // 18pt = 24px on a 28.8px line: the baseline is the line's winAscent share.
    test("the PowerPoint target places a single-spaced baseline from the caller's metrics; LibreOffice ignores them", () => {
        const baseline = (fontFace: string, target: "libreoffice" | "powerpoint", fontMetrics = FONT_WIN_METRICS) => normalizeText("Line", { fontFace, fontSize: 18 }, target, fontMetrics).paragraphs[0]?.lineBox.baseline;
        const table = fontMetricsTable({ "My Brand Sans": BRAND, Arial: { unitsPerEm: 1000, winAscent: 800, winDescent: 200 } });
        // An unlisted face: 1em without the option, 28.8 x 950/1200 with it.
        expect(baseline("My Brand Sans", "powerpoint")).toBeCloseTo(24, 6);
        expect(baseline("my brand sans", "powerpoint", table)).toBeCloseTo(22.8, 6);
        // A built-in face overridden: 28.8 x 1854/2288 before, 28.8 x 800/1000 after.
        expect(baseline("Arial", "powerpoint")).toBeCloseTo(23.337, 3);
        expect(baseline("Arial", "powerpoint", table)).toBeCloseTo(23.04, 6);
        for (const face of ["My Brand Sans", "Arial"]) expect(baseline(face, "libreoffice", table)).toBeCloseTo(24, 6);
        // A face matching an Object.prototype member is not listed.
        expect(baseline("constructor", "powerpoint", table)).toBeCloseTo(24, 6);
    });

    test("toHtml() writes data-line-baseline from the caller's metrics only for the PowerPoint target, the same on every call", async () => {
        const html = async (presentation: PuppeteerGen) => {
            const slide = presentation.addSlide();
            slide.addText("Line", { x: 1, y: 1, w: 3, h: 2, fontFace: "My Brand Sans", fontSize: 18 });
            slide.addTable([[{ text: "Cell" }]], { x: 1, y: 3, w: 3, fontFace: "My Brand Sans", fontSize: 18 });
            return (await presentation.toHtml()).html;
        };
        const baselines = (document: string) => [...document.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
        const fontMetrics = { "My Brand Sans": BRAND };
        const powerPoint = await html(new PuppeteerGenPowerPoint(undefined, { fontMetrics }));
        expect(baselines(powerPoint)).toEqual([expect.closeTo(22.8, 6), expect.closeTo(22.8, 6)]);
        expect(await html(new PuppeteerGenPowerPoint(undefined, { fontMetrics }))).toBe(powerPoint);
        expect(baselines(await html(new PuppeteerGenPowerPoint()))).toEqual([expect.closeTo(24, 6), expect.closeTo(24, 6)]);
        const libreOffice = await html(new PuppeteerGenLibreOffice(undefined, { fontMetrics }));
        expect(baselines(libreOffice)).toEqual([expect.closeTo(24, 6), expect.closeTo(24, 6)]);
        expect(libreOffice).toBe(await html(new PuppeteerGenLibreOffice()));
    });
});

describe("readFontWinMetrics", () => {
    const liberationSans = installedFont("Liberation Sans");
    test.skipIf(liberationSans === undefined || !liberationSans.endsWith("LiberationSans-Regular.ttf"))("reads Liberation Sans, Arial's metric-compatible face, as FONT_WIN_METRICS.arial", () => {
        const metrics = readFontWinMetrics(readFileSync(liberationSans ?? ""));
        expect(metrics).toEqual({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434 });
        expect(metrics).toEqual(FONT_WIN_METRICS.arial!);
        expect(() => new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": metrics } })).not.toThrow();
    });

    test("reads a TrueType font, a subarray of a larger buffer and a collection's first face", () => {
        expect(readFontWinMetrics(sfnt())).toEqual(BRAND);
        const padded = new Uint8Array(8 + sfnt().length);
        padded.set(sfnt(), 8);
        expect(readFontWinMetrics(padded.subarray(8))).toEqual(BRAND);
        expect(readFontWinMetrics(ttc(base => sfnt({ base })))).toEqual(BRAND);
    });

    test("throws FontFileError on bytes it cannot read", () => {
        const truncated = sfnt().subarray(0, 60);
        const cases: [Uint8Array, string][] = [
            [new Uint8Array(), "the sfnt version at byte 0 is past the end of the 0-byte file"],
            [new TextEncoder().encode("wOFF0000000000000000"), "not a TrueType or OpenType font (WOFF and WOFF2 must be decompressed first)"],
            [truncated, "past the end of the 60-byte file; the font is truncated"],
            [sfnt({ os2Length: 70 }), "the OS/2 table is 70 bytes, too short for usWinAscent"],
            [sfnt({ unitsPerEm: 0 }), "head.unitsPerEm is 0"],
            [sfnt({ winAscent: 0, winDescent: 0 }), "OS/2 usWinAscent and usWinDescent are both 0"],
            [ttc(() => new Uint8Array(4)).subarray(0, 12), "the collection's first font offset at byte 12 is past the end"],
        ];
        for (const [bytes, message] of cases) {
            expect(() => readFontWinMetrics(bytes)).toThrow(FontFileError);
            expect(() => readFontWinMetrics(bytes)).toThrow(message);
        }
        const noOs2 = sfnt();
        noOs2.set([0x78, 0x78, 0x78, 0x78], 12); // rename the OS/2 record
        expect(() => readFontWinMetrics(noOs2)).toThrow("the font has no OS/2 table");
        // `as`: JavaScript callers may pass anything.
        expect(() => readFontWinMetrics("font" as unknown as Uint8Array)).toThrow("expected the font file's bytes as a Uint8Array");
    });
});
