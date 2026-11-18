import { describe, expect, test } from "bun:test";
import { renderedPage } from "./renderedPage";
import PptxGenJSRuntime from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { paginateTableRows } from "../packages/pptxgenjs/src/normalize/table/pagination";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { pixelsToInches, pointsToPixels } from "../packages/pptxgenjs/src/units";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const rows = (count: number): PptxGenJS.TableRow[] => Array.from({ length: count }, (_, index) => [{ text: `Row ${index + 1}` }, { text: `Value ${index + 1}` }]);

describe("table auto-pagination", () => {
    test("allocates rows using PptxGenJS line-height and continuation heuristics", () => {
        const pages = paginateTableRows(rows(30), { autoPage: true, y: 1, w: 8 }, PAGE);
        expect(pages.map(page => page.rows.length)).toEqual([13, 15, 2]);
        expect(pages.map(page => page.y)).toEqual([1, 0.5, 0.5]);

        const percentageY = paginateTableRows(rows(2), { autoPage: true, y: "20%", w: 8 }, PAGE);
        expect(percentageY[0]?.y).toBe(1.125);

        const heavierLines = paginateTableRows(
            rows(30),
            {
                autoPage: true,
                y: 1,
                w: 8,
                autoPageLineWeight: 1,
            },
            PAGE,
        );
        expect(heavierLines.map(page => page.rows.length)).toEqual([9, 11, 10]);
    });

    test("repeats the requested headers and honors the continuation start", () => {
        const input = rows(30);
        const pages = paginateTableRows(
            input,
            {
                autoPage: true,
                y: 1,
                w: 8,
                autoPageRepeatHeader: true,
                autoPageHeaderRows: 2,
                autoPageSlideStartY: 0.8,
            },
            PAGE,
        );
        expect(pages).toHaveLength(3);
        expect(pages[1]!.y).toBe(0.8);
        expect(pages[1]!.rows.slice(0, 2).map(row => row[0]?.text)).toEqual(["Row 1", "Row 2"]);
        expect(pages[2]!.rows.slice(0, 2).map(row => row[0]?.text)).toEqual(["Row 1", "Row 2"]);
    });

    test("splits long rows without losing text and applies character weight", () => {
        const text = "word ".repeat(300).trim();
        const input = [[{ text }]];
        const narrow = paginateTableRows(
            input,
            {
                autoPage: true,
                y: 1,
                w: 2,
                autoPageCharWeight: -1,
            },
            PAGE,
        );
        const wide = paginateTableRows(
            input,
            {
                autoPage: true,
                y: 1,
                w: 2,
                autoPageCharWeight: 1,
            },
            PAGE,
        );
        expect(narrow.length).toBeGreaterThan(wide.length);

        const reconstructed = narrow
            .flatMap(page => page.rows)
            .flatMap(row => {
                const value = row[0]?.text;
                return Array.isArray(value) ? value.map(piece => String(piece.text ?? "")) : [String(value ?? "")];
            })
            .join("")
            .replaceAll(/\s+/g, " ")
            .trim();
        expect(reconstructed).toBe(text);
    });

    test("creates continuation slides and reports them on the source slide", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addTable(rows(30), {
            autoPage: true,
            autoPageRepeatHeader: true,
            autoPageHeaderRows: 1,
            autoPageSlideStartY: 0.75,
            x: 1,
            y: 1,
            w: 8,
            fontFace: "Arial",
            fontSize: 12,
        });

        const slides = renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-container");
        expect(slides).toHaveLength(3);
        expect(slide.newAutoPagedSlides).toHaveLength(2);
        expect(slides[0]?.querySelectorAll(".slide-table-container")).toHaveLength(1);
        expect(slides[1]?.querySelector<HTMLElement>(".slide-table-container")?.style.top).toBe("72px");
        expect(slides[1]?.querySelector("td")?.textContent).toBe("Row 1");
        expect(slides[2]?.querySelector("td")?.textContent).toBe("Row 1");
    });

    test("draws plain string cells on every page they continue to", () => {
        const presentation = new PuppeteerGen(PAGE);
        const lines = Array.from({ length: 60 }, (_, line) => `Line ${line + 1}`);
        // `as`: PptxGenJS accepts plain string cells at runtime, but `TableRow` lists only cell objects.
        presentation.addSlide().addTable([["A", lines.join("\n")]] as unknown as PptxGenJS.TableRow[], { autoPage: true, y: 0.5, w: 8, fontSize: 12 });

        const slides = [...renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-container")];
        expect(slides.length).toBeGreaterThan(1);
        const drawn = slides.map(slide => slide.querySelectorAll("td")[1]?.textContent ?? "");
        expect(drawn.every(text => text.length > 0)).toBe(true);
        expect(drawn.join("").replaceAll(/\s+/g, "")).toBe(lines.join("").replaceAll(" ", ""));
    });

    // A row moved to a continuation slide is drawn as word runs carrying a copy of the cell options. PptxGenJS 4.0.1
    // genXmlTextBody (step 6 C) fills each unset run option from the cell, so `{ fontSize: undefined }` takes the
    // table's 10pt: its slide 2 XML has sz="1000" on every run, with or without repeated headers.
    test.each([false, true])("keeps the table font size on rows moved to a continuation slide (repeat header %p)", autoPageRepeatHeader => {
        const presentation = new PuppeteerGen(PAGE);
        const input: PptxGenJS.TableRow[] = Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}`, options: { fontSize: undefined } }, { text: `Value ${index + 1}` }]);
        presentation.addSlide().addTable(input, { autoPage: true, autoPageRepeatHeader, y: 1, w: 8, fontSize: 10 });

        const sizes = presentation.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "table" ? object.table.rows.flatMap(row => row.cells.flatMap(cell => cell.text.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.fontSize)))) : [])));
        expect(sizes.length).toBeGreaterThan(0);
        expect(new Set(sizes)).toEqual(new Set([pointsToPixels(10)]));
    });
});

/**
 * Row heights in inches per slide, as PptxGenJS 4.0.1 writes them to `<a:tr h>` (genXmlSlide, table step 4A): the
 * table's `rowH[row]`, a number `rowH`, or its `h` shared over the rows; 0 lets the row size to its content.
 */
function pptxGenJsRowHeights(rows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps): number[][] {
    const pptx = new PptxGenJSRuntime();
    pptx.layout = "LAYOUT_16x9";
    pptx.addSlide().addTable(rows, options);
    // `as`: `_slides`, `_slideObjects`, `arrTabRows` and the EMU `options.h` are PptxGenJS 4.0.1 internals the types omit.
    const slides = (pptx as unknown as { _slides: Array<{ _slideObjects: Array<{ _type: string; arrTabRows: unknown[]; options: { rowH?: number | number[]; h?: number } }> }> })._slides;
    const emu = PPTX_DEFAULTS.units.emuPerInch;
    return slides.flatMap(slide =>
        slide._slideObjects
            .filter(object => object._type === "table")
            .map(({ arrTabRows, options: { rowH, h } }) =>
                arrTabRows.map((_, index) => {
                    if (Array.isArray(rowH) && rowH[index]) return rowH[index];
                    if (typeof rowH === "number") return rowH;
                    return h ? Math.round(h / arrTabRows.length) / emu : 0;
                }),
            ),
    );
}

/** Row heights in inches per slide from our model; 0 is a row sized to its content. */
function rowHeightsOf(presentation: PuppeteerGen): number[][] {
    return presentation.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "table" ? [object.table.rows.map(row => (row.height === undefined ? 0 : pixelsToInches(row.height)))] : [])));
}

describe("autoPage row heights (PptxGenJS 4.0.1 addTableDefinition step 6 C: each page gets the caller's options)", () => {
    const round = (pages: number[][]) => pages.map(page => page.map(height => Number(height.toFixed(4))));
    test.each<[string, PptxGenJS.TableProps]>([
        ["no rowH", {}],
        ["repeated headers", { autoPageRepeatHeader: true, autoPageHeaderRows: 2 }],
        ["a number rowH", { rowH: 0.3 }],
        ["a rowH array, indexed per page", { rowH: [0.6, 0.2, 0.4] }],
        ["a table h", { h: 3 }],
    ])("sizes rows as PptxGenJS does with %s", (_, extra) => {
        const input = Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}` }, { text: index % 5 ? `Value ${index + 1}` : "Two\nlines" }]);
        const options: PptxGenJS.TableProps = { autoPage: true, y: 1, w: 8, ...extra };
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addTable(input, options);
        const ours = round(rowHeightsOf(presentation));
        expect(ours.length).toBeGreaterThan(1);
        // PptxGenJS writes into the rows and options it is given, so it gets copies.
        expect(ours).toEqual(round(pptxGenJsRowHeights(structuredClone(input), structuredClone(options))));
    });
});

/** PptxGenJS 4.0.1 autoPage pages: per slide, the text of each row's first cell, from its parsed word runs. */
function pptxGenJsPages(input: unknown[], options: PptxGenJS.TableProps): string[][] {
    const pptx = new PptxGenJSRuntime();
    pptx.layout = "LAYOUT_16x9";
    pptx.addSlide().addTable(structuredClone(input) as PptxGenJS.TableRow[], structuredClone(options));
    // `as`: `_slides`, `_slideObjects` and `arrTabRows` are PptxGenJS 4.0.1 internals the types omit.
    const slides = (pptx as unknown as { _slides: Array<{ _slideObjects: Array<{ arrTabRows: PptxGenJS.TableCell[][] }> }> })._slides;
    return slides.map(slide => (slide._slideObjects[0]?.arrTabRows ?? []).map(row => firstCellText(row)));
}

function firstCellText(row: PptxGenJS.TableRow): string {
    const text: unknown = row[0]?.text;
    return Array.isArray(text) ? text.map(run => (typeof run.text === "string" ? run.text : "")).join("") : String(text ?? "");
}

function ourPages(input: unknown[], options: PptxGenJS.TableProps): string[][] {
    return paginateTableRows(structuredClone(input) as PptxGenJS.TableRow[], options, PAGE).map(page => page.rows.map(row => firstCellText(row)));
}

describe("autoPage line counting (PptxGenJS 4.0.1 parseTextToLines and getSlidesForTableRows E-3)", () => {
    const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor";
    test.each<[string, unknown[], PptxGenJS.TableProps]>([
        // A first word longer than the line adds an empty line in front of it (parseTextToLines step 4 A).
        ["an over-long first word", Array.from({ length: 24 }, (_, index) => [{ text: `Abcdefghijklmnopqrstuvwxyz${index} end` }, { text: "x" }]), { autoPage: true, colW: [1, 8] }],
        // colW is read at the cell index, and a colspan adds every width from there to the end.
        ["a colspan cell", Array.from({ length: 16 }, (_, index) => [{ text: `${index} ${filler}`, options: { colspan: 2 } }, { text: "x" }]), { autoPage: true, colW: [1, 1, 7] }],
        ["a cell after a colspan", Array.from({ length: 16 }, (_, index) => [{ text: `${index}`, options: { colspan: 2 } }, { text: filler }]), { autoPage: true, colW: [1, 7, 1] }],
        // Each run starts a line, a run that is not a string adds none, and a run without a line feed is trimmed.
        ["rich-text runs", Array.from({ length: 20 }, (_, index) => [{ text: [{ text: `${index} ` }, { text: "b" }, { text: 7 }, { text: "c\nd" }] }, { text: "x" }]), { autoPage: true, colW: [4, 4] }],
        ["runs trimmed before counting", Array.from({ length: 30 }, (_, index) => [{ text: [{ text: `${index}${"m".repeat(20)}${" ".repeat(40)}` }] }, { text: "x" }]), { autoPage: true, colW: [2, 6] }],
        // A falsy cell or table fontSize is skipped for the line height.
        ["a zero cell fontSize", Array.from({ length: 30 }, (_, index) => [{ text: `${index}`, options: { fontSize: 0 } }, { text: "x" }]), { autoPage: true, fontSize: 20 }],
    ])("splits rows as PptxGenJS does with %s", (_, input, options) => {
        const theirs = pptxGenJsPages(input, options);
        expect(theirs.length).toBeGreaterThan(1);
        expect(ourPages(input, options).map(page => page.length)).toEqual(theirs.map(page => page.length));
    });
});
