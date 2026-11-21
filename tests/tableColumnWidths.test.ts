import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import PptxGenJSRuntime from "pptxgenjs";
import JSZip from "jszip";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { emuToPixels } from "../packages/pptxgenjs/src/units";

// PptxGenJS 4.0.1 addTableDefinition drops a `colW` array whose length is not the column count (#302): genXmlTable then
// shares the table `w` (read by step 4 only, so 30 is 30 EMU) or, without one, draws 1in columns, and autoPage gives
// each column ((x || right margin) + left margin) / columns inches.
type Build = (slide: PptxGenJS.Slide) => void;

const ROWS: PptxGenJS.TableRow[] = [
    [{ text: "A" }, { text: "B" }, { text: "C" }],
    [{ text: "D" }, { text: "E" }, { text: "F" }],
];

/** The `<a:gridCol>` widths PptxGenJS 4.0.1 writes on the first slide, in CSS pixels. */
async function gridColumns(build: Build): Promise<number[]> {
    const pptx = new PptxGenJSRuntime();

    build(pptx.addSlide());
    // `as`: write() returns a Buffer for the nodebuffer output type.
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";

    return [...xml.matchAll(/<a:gridCol w="(\d+)"/g)].map(([, emu]) => emuToPixels(Number(emu)));
}

/** The column widths PdfLapas models for the first table of the same slide. */
function ourColumns(build: Build): number[] {
    const presentation = new PuppeteerGen();

    // `as`: PuppeteerSlide implements the PptxGenJS slide API the builders call.
    build(presentation.addSlide() as unknown as PptxGenJS.Slide);
    const table = presentation.getModel().slides[0]?.objects.find(object => object.kind === "table");

    return table?.kind === "table" ? [...table.table.columns] : [];
}

describe("table colW against the column count (PptxGenJS 4.0.1 gridCol)", () => {
    test.each<[string, PptxGenJS.TableProps]>([
        ["shorter colW", { colW: [1, 2] }],
        ["equal colW", { colW: [1, 2, 3] }],
        ["longer colW", { colW: [1, 2, 3, 4] }],
        ["empty colW", { colW: [] }],
        ["shorter colW with w", { colW: [1, 2], w: 6 }],
        ["equal colW with w", { colW: [1, 2, 3], w: 6 }],
        ["longer colW with w", { colW: [1, 2, 3, 4], w: 6 }],
        ["shorter colW with w of 30 (EMU)", { colW: [1, 2], w: 30 }],
        ["shorter colW with w in EMU", { colW: [1, 2], w: 914400 }],
        ["shorter colW with w 0", { colW: [1, 2], w: 0 }],
        ["shorter colW with a percent w", { colW: [1, 2], w: "50%" }],
        // `as`: a width that is not a number, which genXmlTable replaces with w / columns.
        ["equal colW with a width that is not a number", { colW: [1, "x" as unknown as number, 3], w: 9 }],
        ["scalar colW floored to 0", { colW: 0.2 }],
        ["w 0 without colW", { w: 0 }],
        ["shorter colW with autoPage", { colW: [1, 2], autoPage: true }],
        ["shorter colW with autoPage and x", { colW: [1, 2], autoPage: true, x: 2 }],
        ["shorter colW with autoPage and w", { colW: [1, 2], autoPage: true, w: 6 }],
    ])("sizes the columns of %s as PptxGenJS does", async (_, options) => {
        const build: Build = slide => slide.addTable(structuredClone(ROWS), structuredClone(options));

        expect(ourColumns(build)).toEqual((await gridColumns(build)).map(width => expect.closeTo(width, 1)));
    });
});
