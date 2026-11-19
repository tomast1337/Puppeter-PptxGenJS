import { describe, expect, test } from "bun:test";
import { px } from "@pdflapas/model";
import type PptxGenJS from "pptxgenjs";
import PptxGenJSRuntime from "pptxgenjs";
import JSZip from "jszip";
import type { NormalizedSlideObject } from "@pdflapas/model";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { textMarginPixels } from "../packages/pptxgenjs/src/normalize/margin";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { convertToPixels, emuToPixels, inch2EmuToPixels } from "../packages/pptxgenjs/src/units";

// PptxGenJS 4.0.1 reads a length number below 100 as inches and any other as EMU (#280). getSmartParseNumber (x, y, w, h,
// image sizing, custGeom points, slideNumber, table x/y/w/h) keeps 100 as EMU and takes "50%" of the slide; inch2Emu
// (colW, rowH, tabStops, inset, inch cell margins) reads 100 as inches and only a number above it as EMU. valToPts
// (text margin, line width, shadow, border pt, bullet indent) has no such rule: every number is points.
const SMART_VALUES = [1, 99.9, 100, 914400, "50%"] as const;
const INCH_VALUES = [1, 99.9, 100, 914400] as const;
const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type Build = (slide: PptxGenJS.Slide) => void;

const cells = (...rows: string[][]): PptxGenJS.TableRow[] => rows.map(row => row.map(text => ({ text })));

/** The slide XML PptxGenJS 4.0.1 writes for one slide. */
async function slideXml(build: Build): Promise<string> {
    const pptx = new PptxGenJSRuntime();
    build(pptx.addSlide());
    // `as`: write() returns a Buffer for the nodebuffer output type.
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    return (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
}

/** The objects PdfLapas models for the same slide. */
function ourObjects(build: Build): readonly NormalizedSlideObject[] {
    const presentation = new PuppeteerGen();
    // `as`: PuppeteerSlide implements the PptxGenJS slide API the builders call.
    build(presentation.addSlide() as unknown as PptxGenJS.Slide);
    return presentation.getModel().slides[0]?.objects ?? [];
}

/** Every value of `attribute` in `xml`, as CSS pixels. */
function pixels(xml: string, pattern: RegExp): number[] {
    return [...xml.matchAll(pattern)].map(([, emu]) => emuToPixels(Number(emu)));
}

/** The first `<a:off>`/`<a:ext>` pair after `marker`, as [x, y, cx, cy] in pixels. */
function frame(xml: string, marker: string): number[] {
    const match = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml.slice(xml.indexOf(marker)));
    return (match?.slice(1) ?? []).map(emu => emuToPixels(Number(emu)));
}

function geometry(object: NormalizedSlideObject | undefined): number[] {
    const { x, y, width, height } = object?.style.geometry ?? { x: Number.NaN, y: Number.NaN };
    return [x, y, width ?? Number.NaN, height ?? Number.NaN];
}

const close = <T>(values: number[]): T[] => values.map(value => expect.closeTo(value, 3));

describe("getSmartParseNumber lengths (PptxGenJS 4.0.1): a number of 100 or more is EMU (#280)", () => {
    test("convertToPixels reads numbers, numeric strings, percentages and other strings as PptxGenJS does", () => {
        expect(convertToPixels(1, 960)).toBe(px(96));
        expect(convertToPixels(99.9, 960)).toBeCloseTo(9590.4, 6);
        expect(convertToPixels(100, 960)).toBeCloseTo(100 / 9525, 9);
        expect(convertToPixels(914400, 960)).toBe(px(96));
        expect(convertToPixels("50%", 960)).toBe(px(480));
        // `as`: PptxGenJS accepts a numeric string at runtime (getSmartParseNumber, "FIRST"), although Coord omits it.
        expect(convertToPixels("2" as `${number}%`, 960)).toBe(px(192));
        expect(convertToPixels("914400" as `${number}%`, 960)).toBe(px(96));
        // Neither a number nor a percentage: getSmartParseNumber's "LAST" default.
        expect(convertToPixels("2in" as `${number}%`, 960)).toBe(px(0));
        expect(convertToPixels(Number.NaN, 960)).toBe(px(0));
    });

    test.each([...SMART_VALUES])("places text, shapes, images and the slide number at x, y, w, h = %p as PptxGenJS does", async value => {
        const box = { x: value, y: value, w: value, h: value };
        const builders: Array<[string, Build, string]> = [
            ["text", slide => slide.addText("A", box), "<p:sp>"],
            ["shape", slide => slide.addShape("rect", box), "<p:sp>"],
            ["image", slide => slide.addImage({ data: PNG, ...box }), "<p:pic>"],
            [
                "slide number",
                slide => {
                    slide.slideNumber = box;
                },
                "<p:sp>",
            ],
        ];
        for (const [name, build, marker] of builders) {
            expect({ name, geometry: geometry(ourObjects(build).at(-1)) }).toEqual({ name, geometry: close(frame(await slideXml(build), marker)) });
        }
    });

    test.each([...SMART_VALUES])("crops an image with sizing x, y, w, h = %p as PptxGenJS does", async value => {
        const build: Build = slide => slide.addImage({ data: PNG, x: 1, y: 1, w: 2, h: 2, sizing: { type: "crop", x: value, y: value, w: value, h: value } });
        const xml = await slideXml(build);
        const [image] = ourObjects(build);
        // <a:srcRect l t> is the crop offset as a share (1/100000) of the 2in source picture.
        const [, left = "", top = ""] = /<a:srcRect l="(-?\d+)" r="-?\d+" t="(-?\d+)"/.exec(xml) ?? [];
        const source = 2 * PPTX_DEFAULTS.units.cssDpi;
        expect(image?.kind === "image" ? image.image.sizing : undefined).toMatchObject({ type: "crop", offsetX: expect.closeTo((Number(left) / 100000) * source, 1), offsetY: expect.closeTo((Number(top) / 100000) * source, 1) });
        expect(geometry(image).slice(2)).toEqual(close(frame(xml, "<p:pic>").slice(2)));
    });

    test.each([...SMART_VALUES])("draws a custGeom point at %p as PptxGenJS does", async value => {
        const build: Build = slide =>
            // `as`: PptxGenJS accepts "custGeom" at runtime, although SHAPE_NAME leaves it out.
            slide.addShape("custGeom" as PptxGenJS.SHAPE_NAME, { x: 0, y: 0, w: 2, h: 2, points: [{ x: 0, y: 0 }, { x: value, y: value }, { close: true }] });
        const [shape] = ourObjects(build);
        const path = shape?.kind === "shape" && shape.shape.geometry.kind === "path" ? shape.shape.geometry.data : "";
        const point = /<a:lnTo>\s*<a:pt x="(\d+)" y="(\d+)"/.exec(await slideXml(build))?.slice(1) ?? [];
        expect(/L (\S+) (\S+)/.exec(path)?.slice(1).map(Number)).toEqual(close(point.map(emu => emuToPixels(Number(emu)))));
    });

    test.each([...SMART_VALUES])("places and sizes a table at x, y, w, h = %p as PptxGenJS does", async value => {
        const build: Build = slide => slide.addTable(cells(["A", "B"], ["C", "D"]), { x: value, y: value, w: value, h: value });
        const xml = await slideXml(build);
        const [table] = ourObjects(build);
        const model = table?.kind === "table" ? table.table : undefined;
        expect(geometry(table).slice(0, 2)).toEqual(close(frame(xml, "<p:graphicFrame>").slice(0, 2)));
        expect(model?.columns).toEqual(close(pixels(xml, /<a:gridCol w="(\d+)"/g)));
        // h: 100 is a 100 EMU frame, but genXmlTable shares inch2Emu(100), 100 inches, among the rows.
        expect(model?.rows.map(row => row.height)).toEqual(close(pixels(xml, /<a:tr h="(\d+)"/g)));
    });
});

describe("inch2Emu lengths (PptxGenJS 4.0.1): a number above 100 is EMU (#280)", () => {
    test("inch2EmuToPixels reads 100 as inches and strings as inches", () => {
        expect(inch2EmuToPixels(100)).toBe(px(9600));
        expect(inch2EmuToPixels(100.5)).toBeCloseTo(100.5 / 9525, 9);
        expect(inch2EmuToPixels(914400)).toBe(px(96));
        expect(inch2EmuToPixels("2in")).toBe(px(192));
        expect(inch2EmuToPixels("914400")).toBe(px(87782400));
    });

    test.each([...INCH_VALUES])("sizes table columns, rows and cell margins of %p as PptxGenJS does", async value => {
        for (const options of [{ colW: [value, 1] }, { colW: [1, 1], rowH: [value, 1] }, { colW: [1, 1], rowH: value }, { colW: [1, 1], margin: [0.1, value, 0.1, 0.1] }] satisfies PptxGenJS.TableProps[]) {
            const rows = cells(["A", "B"], ["C", "D"]);
            const xml = await slideXml(slide => slide.addTable(structuredClone(rows), structuredClone(options)));
            const table = normalizeTable(rows, options, PAGE);
            expect({ options, columns: table.columns }).toEqual({ options, columns: close(pixels(xml, /<a:gridCol w="(\d+)"/g)) });
            expect({ options, rows: table.rows.map(row => row.height ?? px(0)) }).toEqual({ options, rows: close(pixels(xml, /<a:tr h="(\d+)"/g)) });
            const [marL = "", marR = "", marT = "", marB = ""] = /<a:tcPr marL="(\d+)" marR="(\d+)" marT="(\d+)" marB="(\d+)"/.exec(xml)?.slice(1) ?? [];
            expect({ options, margin: [...(table.rows[0]?.cells[0]?.text.margin ?? [])] }).toEqual({ options, margin: close([marT, marR, marB, marL].map(emu => emuToPixels(Number(emu)))) });
        }
    });

    test.each([...INCH_VALUES])("sets a tab stop and the deprecated inset of %p as PptxGenJS does", async value => {
        // `as`: `inset` is deprecated and left off TextPropsOptions, but PptxGenJS 4.0.1 still writes it.
        const options = { x: 1, y: 1, w: 1, h: 1, tabStops: [{ position: value }], inset: value } as PptxGenJS.TextPropsOptions;
        const xml = await slideXml(slide => slide.addText("A", options));
        expect(normalizeText("A", options).paragraphs[0]?.tabStops[0]?.position).toBeCloseTo(pixels(xml, /<a:tab pos="(\d+)"/g)[0] ?? Number.NaN, 3);
        const inset = (side: string) => pixels(xml, new RegExp(`${side}Ins="(\\d+)"`, "g"));
        expect([...textMarginPixels(undefined, value)]).toEqual(close([...inset("t"), ...inset("r"), ...inset("b"), ...inset("l")]));
    });
});

describe("addTableDefinition (PptxGenJS 4.0.1, step 4) reads a table size below 20 EMU as inches again", () => {
    test.each<[string, PptxGenJS.TableProps]>([
        // floor(7 * 3) = 21 is not below 20, so it stays EMU: three 7 EMU columns.
        ["scalar colW whose total is 20 or more", { colW: 7 }],
        ["scalar colW of 99.9", { colW: 99.9 }],
        ["scalar colW in EMU", { colW: 914400 }],
        // getSmartParseNumber makes 0.00001 in 9 EMU, which step 4 reads as 9 inches.
        ["a tiny w", { w: 0.00001 }],
        ["a tiny h", { h: 0.00001 }],
    ])("sizes %s as PptxGenJS does", async (_, options) => {
        const rows = cells(["A", "B", "C"], ["D", "E", "F"]);
        const xml = await slideXml(slide => slide.addTable(structuredClone(rows), structuredClone(options)));
        const table = normalizeTable(rows, options, PAGE);
        expect(table.columns).toEqual(close(pixels(xml, /<a:gridCol w="(\d+)"/g)));
        expect(table.rows.map(row => row.height ?? px(0))).toEqual(close(pixels(xml, /<a:tr h="(\d+)"/g)));
    });
});
