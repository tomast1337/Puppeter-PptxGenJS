import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { FontFileError, PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, readFontWinMetrics } from "../packages/pptxgenjs/src/index";
import { FONT_WIN_METRICS, type FontWinMetrics } from "../packages/pptxgenjs/src/defaults";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { fontMetricsLookup } from "../packages/pptxgenjs/src/fontMetrics";
import { resolveInstalledFontMetrics } from "../packages/pptxgenjs/src/node";

/**
 * A minimal sfnt: a head table with unitsPerEm and an OS/2 table with usWinAscent and usWinDescent (`os2Length` bytes),
 * `kern` as its kern table when given, an empty GPOS table with `gpos`, and `version` as its sfnt version (TrueType's
 * 0x00010000, or OpenType CFF's OTTO).
 */
function sfnt({ unitsPerEm = 1000, winAscent = 950, winDescent = 250, os2Length = 78, base = 0, kern = undefined as Uint8Array | undefined, gpos = false, version = 0x00010000 } = {}): Uint8Array {
    const tables = [{ tag: "OS/2", length: os2Length }, { tag: "head", length: 54 }, ...(kern ? [{ tag: "kern", length: kern.length }] : []), ...(gpos ? [{ tag: "GPOS", length: 10 }] : [])];
    const directory = 12 + 16 * tables.length;
    const bytes = new Uint8Array(directory + tables.reduce((sum, table) => sum + table.length, 0));
    const view = new DataView(bytes.buffer);
    view.setUint32(0, version);
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
        else if (table.tag === "kern" && kern) bytes.set(kern, offset);
        else if (table.tag === "OS/2" && os2Length >= 78) {
            view.setUint16(offset + 74, winAscent);
            view.setUint16(offset + 76, winDescent);
        }
        offset += table.length;
    });
    return bytes;
}

/** A TrueType collection holding `faces`, each built for the offset it is given. */
function ttc(...faces: ((base: number) => Uint8Array)[]): Uint8Array {
    const header = 12 + 4 * faces.length;
    const fonts: Uint8Array[] = [];
    let offset = header;
    for (const face of faces) {
        const font = face(offset);
        fonts.push(font);
        offset += font.length;
    }
    const bytes = new Uint8Array(offset);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x74746366); // ttcf
    view.setUint32(4, 0x00010000);
    view.setUint32(8, faces.length);
    offset = header;
    fonts.forEach((font, index) => {
        view.setUint32(12 + 4 * index, offset);
        bytes.set(font, offset);
        offset += font.length;
    });
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

/** Big-endian 16-bit words, the units a kern table is made of. */
function words(...values: number[]): Uint8Array {
    const bytes = new Uint8Array(2 * values.length);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setUint16(2 * index, value));
    return bytes;
}
/** A version 0 kern subtable: version, `length` bytes, `coverage`, then format 0's nPairs, search fields and pairs. */
const subtable = (coverage: number, pairs: number, length = 14 + 6 * pairs) => [0, length, coverage, pairs, 0, 0, 0, ...Array<number>(3 * pairs).fill(0)];
/** A Microsoft-format (version 0) kern table holding `subtables`. */
const kernV0 = (...subtables: number[][]) => words(0, subtables.length, ...subtables.flat());
const HORIZONTAL_FORMAT_0 = 0x0001;
const OTTO = 0x4f54544f;
/** An Apple-format (version 1.0) kern table: 32-bit version 0x00010000, nTables 1, then a horizontal format 0 subtable. */
const KERN_APPLE = words(1, 0, 0, 1, 0, 20, 0x0001, 2, 0, 0, 0);

const BRAND = { unitsPerEm: 1000, winAscent: 950, winDescent: 250 };

describe("fontMetrics option", () => {
    test("rejects invalid metrics with an error naming the face, the field and the fix", () => {
        const cases: [unknown, string][] = [
            [{ "My Brand Sans": { ...BRAND, unitsPerEm: 0 } }, '`fontMetrics["My Brand Sans"].unitsPerEm` must be a positive integer (head.unitsPerEm)'],
            [{ "My Brand Sans": { ...BRAND, winAscent: -1 } }, '`fontMetrics["My Brand Sans"].winAscent` must be a non-negative integer (OS/2 usWinAscent)'],
            [{ "My Brand Sans": { ...BRAND, winDescent: 250.5 } }, '`fontMetrics["My Brand Sans"].winDescent` must be a non-negative integer (OS/2 usWinDescent)'],
            [{ "My Brand Sans": { unitsPerEm: 1000, winAscent: 950 } }, '`fontMetrics["My Brand Sans"].winDescent` must be a non-negative integer'],
            [{ "My Brand Sans": { ...BRAND, winAscent: 0, winDescent: 0 } }, '`fontMetrics["My Brand Sans"]` winAscent + winDescent must be greater than 0'],
            [{ "My Brand Sans": { ...BRAND, pairKerning: "yes" } }, '`fontMetrics["My Brand Sans"].pairKerning` must be a boolean (whether PowerPoint pair-kerns the font)'],
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

    test("looks the caller's faces up over FONT_WIN_METRICS, case-insensitively, frozen", () => {
        const lookup = fontMetricsLookup({ "My Brand Sans": BRAND, ARIAL: { unitsPerEm: 1000, winAscent: 800, winDescent: 200 } }, null);
        expect(lookup("my brand sans")).toEqual(BRAND);
        expect(lookup("Arial")).toEqual({ unitsPerEm: 1000, winAscent: 800, winDescent: 200 });
        expect(lookup("Calibri")).toBe(FONT_WIN_METRICS.calibri!);
        expect(Object.isFrozen(lookup("My Brand Sans"))).toBe(true);
        expect(lookup("constructor")).toBeUndefined();
        expect(fontMetricsLookup(undefined, undefined)("ARIAL")).toBe(FONT_WIN_METRICS.arial!);
    });

    // 18pt = 24px on a 28.8px line: the baseline is the line's winAscent share, on the PowerPoint target's 1/600 in grid.
    test("the PowerPoint target places a single-spaced baseline from the caller's metrics; LibreOffice ignores them", () => {
        const baseline = (fontFace: string, target: "libreoffice" | "powerpoint", fontMetrics?: (face: string) => FontWinMetrics | undefined) => normalizeText("Line", { fontFace, fontSize: 18 }, target, fontMetrics).paragraphs[0]?.lineBox.baseline;
        const table = fontMetricsLookup({ "My Brand Sans": BRAND, Arial: { unitsPerEm: 1000, winAscent: 800, winDescent: 200 } }, null);
        // An unlisted face: 1em without the option, 28.8 x 950/1200 = 22.8 (22.72 on the grid) with it.
        expect(baseline("My Brand Sans", "powerpoint")).toBeCloseTo(24, 6);
        expect(baseline("my brand sans", "powerpoint", table)).toBeCloseTo(22.72, 6);
        // A built-in face overridden: 28.8 x 1854/2288 = 23.337 (23.36) before, 28.8 x 800/1000 = 23.04 after.
        expect(baseline("Arial", "powerpoint")).toBeCloseTo(23.36, 6);
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
        // 22.8px on the 1/600 in grid.
        expect(baselines(powerPoint)).toEqual([22.72, 22.72]);
        expect(await html(new PuppeteerGenPowerPoint(undefined, { fontMetrics }))).toBe(powerPoint);
        expect(baselines(await html(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null })))).toEqual([expect.closeTo(24, 6), expect.closeTo(24, 6)]);
        const libreOffice = await html(new PuppeteerGenLibreOffice(undefined, { fontMetrics }));
        expect(baselines(libreOffice)).toEqual([expect.closeTo(24, 6), expect.closeTo(24, 6)]);
        expect(libreOffice).toBe(await html(new PuppeteerGenLibreOffice()));
    });
});

describe("readFontWinMetrics", () => {
    const liberationSans = installedFont("Liberation Sans");
    test.skipIf(liberationSans === undefined || !liberationSans.endsWith("LiberationSans-Regular.ttf"))("reads Liberation Sans, Arial's metric-compatible face, as FONT_WIN_METRICS.arial", () => {
        const metrics = readFontWinMetrics(readFileSync(liberationSans ?? ""));
        expect(metrics).toEqual({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434, pairKerning: true });
        expect(metrics).toEqual(FONT_WIN_METRICS.arial!);
        expect(() => new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": metrics } })).not.toThrow();
    });

    test("reads a TrueType font, a subarray of a larger buffer and a collection's first face", () => {
        const unkerned = { ...BRAND, pairKerning: false };
        expect(readFontWinMetrics(sfnt())).toEqual(unkerned);
        const padded = new Uint8Array(8 + sfnt().length);
        padded.set(sfnt(), 8);
        expect(readFontWinMetrics(padded.subarray(8))).toEqual(unkerned);
        expect(readFontWinMetrics(ttc(base => sfnt({ base })))).toEqual(unkerned);
    });

    test("reports pair kerning only for a version 0 kern table with a horizontal format 0 subtable holding pairs", () => {
        const pairKerning = (kern?: Uint8Array) => readFontWinMetrics(sfnt({ kern })).pairKerning;
        expect(pairKerning()).toBe(false);
        expect(pairKerning(kernV0(subtable(HORIZONTAL_FORMAT_0, 2)))).toBe(true);
        // Found after subtables that do not count: no pairs, not horizontal, format 2.
        expect(pairKerning(kernV0(subtable(HORIZONTAL_FORMAT_0, 0), subtable(0x0000, 1), subtable(0x0201, 1), subtable(HORIZONTAL_FORMAT_0, 1)))).toBe(true);
        expect(pairKerning(kernV0(subtable(HORIZONTAL_FORMAT_0, 0), subtable(0x0000, 3)))).toBe(false);
        expect(pairKerning(kernV0())).toBe(false);
        // Apple's format: a 32-bit version 1.0 and nTables, then a subtable that would read as horizontal format 0.
        expect(pairKerning(KERN_APPLE)).toBe(false);
        expect(readFontWinMetrics(ttc(base => sfnt({ base, kern: kernV0(subtable(HORIZONTAL_FORMAT_0, 1)) }))).pairKerning).toBe(true);
    });

    test("without a kern table, reports pair kerning when the font has a GPOS table, TrueType or OpenType CFF alike", () => {
        expect(readFontWinMetrics(sfnt({ version: OTTO, gpos: true })).pairKerning).toBe(true);
        expect(readFontWinMetrics(sfnt({ gpos: true })).pairKerning).toBe(true);
        expect(readFontWinMetrics(sfnt({ version: OTTO })).pairKerning).toBe(false);
        expect(readFontWinMetrics(sfnt())).toEqual({ ...BRAND, pairKerning: false });
    });

    test("a kern table decides alone: an Apple-format one gives false and a version 0 one true, GPOS or not", () => {
        expect(readFontWinMetrics(sfnt({ kern: KERN_APPLE, gpos: true })).pairKerning).toBe(false);
        expect(readFontWinMetrics(sfnt({ kern: kernV0(subtable(HORIZONTAL_FORMAT_0, 0)), gpos: true })).pairKerning).toBe(false);
        expect(readFontWinMetrics(sfnt({ kern: kernV0(subtable(HORIZONTAL_FORMAT_0, 1)), gpos: true })).pairKerning).toBe(true);
    });

    test("throws FontFileError on a malformed version 0 kern table", () => {
        const cases: [Uint8Array, string][] = [
            [words(0), "the kern table is 2 bytes, too short for nTables"],
            [words(0, 1, 0, 14), "the kern table is 8 bytes, too short for subtable 0 coverage"],
            [words(0, 1, 0, 14, HORIZONTAL_FORMAT_0), "the kern table is 10 bytes, too short for subtable 0 nPairs"],
            [kernV0(subtable(0x0000, 1, 0), subtable(HORIZONTAL_FORMAT_0, 1)), "kern subtable 0 is 0 bytes long, shorter than its header"],
            [kernV0(subtable(0x0000, 1, 400), subtable(HORIZONTAL_FORMAT_0, 1)), "too short for subtable 1 coverage"],
        ];
        for (const [kern, message] of cases) {
            expect(() => readFontWinMetrics(sfnt({ kern }))).toThrow(FontFileError);
            expect(() => readFontWinMetrics(sfnt({ kern }))).toThrow(message);
        }
    });

    test("reads a collection's face at faceIndex, and rejects a face it does not have", () => {
        const collection = ttc(
            base => sfnt({ base }),
            base => sfnt({ base, unitsPerEm: 2048, winAscent: 1900, winDescent: 500 }),
        );
        expect(readFontWinMetrics(collection, 0)).toEqual({ ...BRAND, pairKerning: false });
        expect(readFontWinMetrics(collection, 1)).toEqual({ unitsPerEm: 2048, winAscent: 1900, winDescent: 500, pairKerning: false });
        expect(() => readFontWinMetrics(collection, 2)).toThrow("the collection has 2 faces, so no face 2");
        expect(() => readFontWinMetrics(sfnt(), 1)).toThrow("a single font has only face 0, not face 1");
        expect(() => readFontWinMetrics(sfnt(), -1)).toThrow(FontFileError);
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
            [ttc(() => new Uint8Array(4)).subarray(0, 12), "the collection's font 0 offset at byte 12 is past the end"],
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

describe("resolveFontMetrics option", () => {
    const INSTALLED = { unitsPerEm: 2000, winAscent: 1500, winDescent: 500 };
    const baselines = async (presentation: PuppeteerGen, faces: string[]) => {
        const slide = presentation.addSlide();
        faces.forEach((fontFace, index) => slide.addText("Line", { x: 1, y: 0.5 + index, w: 3, h: 1, fontFace, fontSize: 18 }));
        const { html } = await presentation.toHtml();
        return [...html.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
    };

    // 18pt = 24px on a 28.8px line: caller 22.8 (950/1200), resolver 21.6 (1500/2000), Calibri 22.464 (1950/2500), else 24;
    // on the 1/600 in baseline grid 22.72, 21.6, 22.4 and 24.
    test("the caller's fontMetrics come before the resolver, the resolver before FONT_WIN_METRICS, which comes before 1em", async () => {
        const resolveFontMetrics = (face: string) => (["My Brand Sans", "My Brand Serif", "Arial"].includes(face) ? INSTALLED : undefined);
        const presentation = new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": BRAND }, resolveFontMetrics });
        expect(await baselines(presentation, ["My Brand Sans", "My Brand Serif", "Arial", "Calibri", "No Such Font 123"])).toEqual([22.72, 21.6, 21.6, 22.4, 24]);
    });

    test("is called once per face per presentation, only for faces fontMetrics does not list, and never for the LibreOffice target", async () => {
        const calls: string[] = [];
        const resolveFontMetrics = (face: string) => (calls.push(face), INSTALLED);
        await baselines(new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": BRAND }, resolveFontMetrics }), ["My Brand Serif", "my brand serif", "My Brand Sans", "My Brand Serif"]);
        // The paragraph mark is set in the theme font, Calibri, which is looked up as well.
        expect(calls).toEqual(["My Brand Serif", "Calibri"]);
        calls.length = 0;
        expect(await baselines(new PuppeteerGenLibreOffice(undefined, { resolveFontMetrics }), ["My Brand Serif"])).toEqual([expect.closeTo(24, 6)]);
        expect(await baselines(new PuppeteerGen(undefined, { resolveFontMetrics }), ["My Brand Serif"])).toEqual([expect.closeTo(24, 6)]);
        expect(calls).toEqual([]);
    });

    test("null turns the lookup off; the result is checked and an invalid one throws naming the face", async () => {
        expect(await baselines(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null }), ["Arial", "My Brand Sans"])).toEqual([23.36, 24]);
        const broken = () => ({ unitsPerEm: 0, winAscent: 1, winDescent: 1 });
        await expect(baselines(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: broken }), ["My Brand Sans"])).rejects.toThrow('`resolveFontMetrics` returned invalid metrics for "My Brand Sans": unitsPerEm must be a positive integer');
        // `as`: the option arrives unchecked from JavaScript callers.
        expect(() => new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: "fc-match" as unknown as null })).toThrow("`resolveFontMetrics` must be a function, or null to turn the lookup off");
    });
});

describe("resolveInstalledFontMetrics (the Node entry's default)", () => {
    const liberationSans = installedFont("Liberation Sans");
    test.skipIf(liberationSans === undefined || !liberationSans.endsWith("LiberationSans-Regular.ttf"))("reads the installed Liberation Sans through fontconfig, case-insensitively", () => {
        // Liberation Sans carries a version 0 kern table, as Arial does.
        expect(resolveInstalledFontMetrics("Liberation Sans")).toEqual({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434, pairKerning: true });
        expect(resolveInstalledFontMetrics("LIBERATION SANS")).toEqual({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434, pairKerning: true });
    });

    const liberationMono = installedFont("Liberation Mono");
    test.skipIf(liberationMono === undefined || !liberationMono.endsWith("LiberationMono-Regular.ttf"))("reports a font whose only pair kerning is GPOS (no kern table) as pair-kerned", () => {
        expect(resolveInstalledFontMetrics("Liberation Mono")?.pairKerning).toBe(true);
    });

    test("does not take the substitute fontconfig answers with for a face that is not installed", () => {
        expect(resolveInstalledFontMetrics("No Such Font 123")).toBeUndefined();
        // fontconfig pattern syntax in a name stays part of the name.
        expect(resolveInstalledFontMetrics("Liberation Sans:weight=200")).toBeUndefined();
        expect(resolveInstalledFontMetrics("Liberation Sans-12")).toBeUndefined();
    });
});

describe("pair kerning on the PowerPoint target", () => {
    const UNKERNED = { ...BRAND, pairKerning: false };
    const run = (fontSize: number, target: "libreoffice" | "powerpoint", metrics: FontWinMetrics | undefined) => normalizeText("AV", { fontFace: "My Brand Sans", fontSize }, target, () => metrics).paragraphs[0]?.runs[0];

    test("kerns from 12pt only a face whose pairKerning is not false; LibreOffice kerns every run", () => {
        for (const metrics of [undefined, BRAND, { ...BRAND, pairKerning: true }]) {
            expect(run(12, "powerpoint", metrics)).not.toHaveProperty("kerning");
            expect(run(11, "powerpoint", metrics)?.kerning).toBe(false);
        }
        for (const fontSize of [11, 12, 18, 40]) expect(run(fontSize, "powerpoint", UNKERNED)?.kerning).toBe(false);
        for (const fontSize of [11, 18]) expect(run(fontSize, "libreoffice", UNKERNED)).not.toHaveProperty("kerning");
    });

    // Whether each "AVATAR" run is drawn unkerned: a text box, an Arial text box, a table cell and a shape's text.
    const unkerned = async (presentation: PuppeteerGen) => {
        const slide = presentation.addSlide();
        slide.addText("AVATAR", { x: 1, y: 0.5, w: 3, h: 1, fontFace: "My Brand Sans", fontSize: 12 });
        slide.addText("AVATAR", { x: 1, y: 1.5, w: 3, h: 1, fontFace: "Arial", fontSize: 12 });
        slide.addTable([[{ text: "AVATAR", options: { fontFace: "My Brand Sans", fontSize: 12 } }]], { x: 1, y: 3, w: 3 });
        slide.addText("AVATAR", { shape: "rect", x: 5, y: 0.5, w: 3, h: 1, fontFace: "My Brand Sans", fontSize: 18 });
        const { html } = await presentation.toHtml();
        return [...html.matchAll(/class="text-run"[^>]*>AVATAR</g)].map(match => match[0].includes("font-kerning: none;"));
    };

    test("a resolver reporting no pair kerning leaves the face unkerned in text boxes, table cells and shapes", async () => {
        const resolveFontMetrics = (face: string) => (face === "My Brand Sans" ? UNKERNED : undefined);
        expect(await unkerned(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics }))).toEqual([true, false, true, true]);
        expect(await unkerned(new PuppeteerGenPowerPoint(undefined, { fontMetrics: { "My Brand Sans": { ...BRAND, pairKerning: true } }, resolveFontMetrics }))).toEqual([false, false, false, false]);
        expect(await unkerned(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null }))).toEqual([false, false, false, false]);
        expect(await unkerned(new PuppeteerGenLibreOffice(undefined, { resolveFontMetrics }))).toEqual([false, false, false, false]);
    });
});
