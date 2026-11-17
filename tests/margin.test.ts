import { describe, expect, test } from "bun:test";
import PptxGenJSRuntime from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { mapSides, slideMarginInches, tableMarginInches, tableMarginPixels, tableMarginToCSS, textMarginPixels, textMarginToCSS } from "../packages/pptxgenjs/src/normalize/margin";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { paginateTableRows } from "../packages/pptxgenjs/src/normalize/table/pagination";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const round = (sides: number[]) => sides.map(side => Number(side.toFixed(6)));

/** Rows per slide and table y from PptxGenJS itself, run on the same input. */
function pptxGenJsPages(rows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps): Array<{ rows: number; y: number }> {
    const pptx = new PptxGenJSRuntime();
    pptx.layout = "LAYOUT_16x9";
    pptx.addSlide().addTable(rows, options);
    // `as`: `_slides`, `_slideObjects`, `arrTabRows` and the EMU `options.y` are PptxGenJS 4.0.1 internals the types omit.
    const slides = (pptx as unknown as { _slides: Array<{ _slideObjects: Array<{ _type: string; arrTabRows: unknown[]; options: { y: number } }> }> })._slides;
    return slides.flatMap(slide => slide._slideObjects.filter(object => object._type === "table").map(table => ({ rows: table.arrTabRows.length, y: table.options.y / PPTX_DEFAULTS.units.emuPerInch })));
}

describe("mapSides", () => {
    test("converts each side in order", () => {
        expect(mapSides(["1", "2", "3", "4"], Number)).toEqual([1, 2, 3, 4]);
    });
});

describe("table cell margin convention (PptxGenJS 4.0.1 genXmlTextBody: cellMargin[0] >= 1 is points)", () => {
    test("defaults to DEF_CELL_MARGIN_IN, top/right/bottom/left", () => {
        expect(tableMarginInches()).toEqual([...PPTX_DEFAULTS.table.marginIn]);
        expect(tableMarginToCSS()).toBe("4.8px 9.6px 4.8px 9.6px");
    });

    test.each([
        [0.99, 0.99, "95.04px"],
        [1, 1 / 72, "1.333333px"],
        [1.01, 1.01 / 72, "1.346667px"],
    ])("reads %p on all sides at the 1-point/1-inch boundary", (margin, inches, css) => {
        expect(tableMarginInches(margin)).toEqual([inches, inches, inches, inches]);
        expect(tableMarginToCSS(margin)).toBe(`${css} ${css} ${css} ${css}`);
        const cell = normalizeTable([[{ text: "c" }]], { margin }, PAGE).rows[0]?.cells[0];
        expect(round(cell?.text.margin ?? [])).toEqual(round(tableMarginPixels(margin)));
    });

    test("picks the unit of the whole array from its top side", () => {
        expect(tableMarginToCSS([0.05, 0.1, 0.05, 0.1])).toBe("4.8px 9.6px 4.8px 9.6px");
        expect(tableMarginToCSS(6)).toBe("8px 8px 8px 8px");
        expect(tableMarginInches([0.99, 3, 0.5, 2])).toEqual([0.99, 3, 0.5, 2]);
        expect(tableMarginInches([1, 0.5, 72, 36])).toEqual([1 / 72, 0.5 / 72, 1, 0.5]);
    });

    test("paginates with the cell margin it draws", () => {
        const rows = (margin: number): PptxGenJS.TableRow[] => Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}`, options: { margin: [margin, margin, margin, margin] } }]);
        // 0.99 is inches (tall rows), 1 is one point (short rows): fewer rows fit per page below the boundary.
        const pagesBelow = paginateTableRows(rows(0.99), { autoPage: true, y: 1, w: 8 }, PAGE);
        const pagesAt = paginateTableRows(rows(1), { autoPage: true, y: 1, w: 8 }, PAGE);
        expect(pagesBelow[0]?.rows.length).toBeLessThan(pagesAt[0]?.rows.length ?? 0);
    });
});

describe("slide margin convention (PptxGenJS 4.0.1 getSlidesForTableRows: inches whatever the size)", () => {
    test("reads a number or a [top, right, bottom, left] array as inches, 0.5 when unset", () => {
        expect(slideMarginInches()).toEqual([0.5, 0.5, 0.5, 0.5]);
        expect(slideMarginInches(1)).toEqual([1, 1, 1, 1]);
        expect(slideMarginInches([1, 0.5, 1.5, 0.25])).toEqual([1, 0.5, 1.5, 0.25]);
    });

    // The continuation slides start at the slide layout's 0.5in margin whatever `slideMargin` is (addTableDefinition),
    // and from the third page on a table `y` above the top margin starts the page (the [2, ...] array).
    test.each<[PptxGenJS.Margin, number[]]>([
        [0.5, [13, 15, 2]],
        [0.99, [12, 12, 6]],
        [1, [12, 12, 6]],
        [2, [8, 5, 9, 8]],
        [
            [1, 0.5, 1.5, 0.5],
            [10, 10, 10],
        ],
        [
            [2, 0.5, 0.5, 0.5],
            [13, 10, 7],
        ],
    ])("paginates slideMargin %p as PptxGenJS does", (slideMargin, rowsPerPage) => {
        const rows: PptxGenJS.TableRow[] = Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}` }]);
        // `as`: getSlidesForTableRows reads `slideMargin`, which TableProps does not declare.
        const options = { autoPage: true, y: 1, w: 8, slideMargin } as PptxGenJS.TableProps;
        const pages = paginateTableRows(rows, options, PAGE);
        expect(pages.map(page => page.rows.length)).toEqual(rowsPerPage);
        expect(pages.map(page => ({ rows: page.rows.length, y: page.y }))).toEqual(pptxGenJsPages(rows, options));
    });

    // getSlidesForTableRows counts a row's cell margins only on the page the row starts on (step 6, E/F reset the
    // height after adding them) and repeated header rows count nothing (step G).
    const longRows = (count: number, lines: (index: number) => number): PptxGenJS.TableRow[] => Array.from({ length: count }, (_, index) => [{ text: `Row ${index + 1}` }, { text: Array.from({ length: lines(index) }, (_, line) => `Line ${line + 1}`).join("\n") }]);
    test.each<[string, PptxGenJS.TableRow[]]>([
        ["40 one-line rows", longRows(40, () => 1)],
        ["35 rows of 1 to 4 lines", longRows(35, index => (index % 4) + 1)],
        ["32 rows of 1 or 9 lines", longRows(32, index => (index % 5 === 0 ? 9 : 1))],
        // The last cell ends before the tallest one, so the row's final line is left out of the used height.
        ["35 rows of 1 to 4 lines, last column shorter", longRows(35, index => (index % 4) + 1).map(row => [...row].reverse())],
        ["32 rows of 1 or 9 lines, last column shorter", longRows(32, index => (index % 5 === 0 ? 9 : 1)).map(row => [...row].reverse())],
        // getSlidesForTableRows tells points from inches by the cell's own margin only (a table margin of 6 would be 6in).
        ["35 rows with a 6pt cell margin", longRows(35, index => (index % 3) + 1).map(row => row.map(cell => ({ ...cell, options: { margin: [6, 4, 6, 4] } })))],
    ])("paginates %s as PptxGenJS does", (_, rows) => {
        for (const fontSize of [8, 12, 18])
            for (const margin of [undefined, 0.1, 0.3, [0.2, 0.1, 0.05, 0.1]])
                for (const slideMargin of [0.5, 1.2])
                    for (const autoPageRepeatHeader of [false, true]) {
                        // `as`: getSlidesForTableRows reads `slideMargin`, which TableProps does not declare.
                        const options = { autoPage: true, autoPageRepeatHeader, y: 1, w: 8, fontSize, margin, slideMargin } as PptxGenJS.TableProps;
                        const pages = paginateTableRows(rows, options, PAGE).map(page => ({ rows: page.rows.length, y: page.y }));
                        // PptxGenJS writes into the rows and options it is given (cell options, colW), so it gets copies.
                        const reference = pptxGenJsPages(structuredClone(rows), { ...options });
                        expect({ fontSize, margin, slideMargin, autoPageRepeatHeader, pages }).toEqual({ fontSize, margin, slideMargin, autoPageRepeatHeader, pages: reference });
                    }
    });
});

describe("text margin convention (PptxGenJS 4.0.1 writes lIns, rIns, bIns, tIns from indexes 0..3, in points)", () => {
    test("defaults to the Normal inset, then the deprecated inset in inches", () => {
        expect(PPTX_DEFAULTS.text.marginIn).toEqual([0.05, 0.1, 0.05, 0.1]);
        expect(textMarginToCSS()).toBe("4.8px 9.6px 4.8px 9.6px");
        expect(textMarginPixels(undefined, 0.5)).toEqual([48, 48, 48, 48]);
        expect(textMarginPixels(6, 0.5)).toEqual([8, 8, 8, 8]);
        expect(textMarginPixels(undefined, Number.NaN)).toEqual(textMarginPixels());
    });

    test("reads an array as [left, right, bottom, top]", () => {
        expect(textMarginToCSS([1, 2, 3, 4])).toBe("5.333333px 2.666667px 4px 1.333333px");
        expect(normalizeText("t", { margin: [1, 2, 3, 4] }).margin).toEqual(textMarginPixels([1, 2, 3, 4]));
    });

    test.each([
        [0.99, 1.32],
        [1, 1.333333],
        [1.01, 1.346667],
    ])("reads %p as points, with no inch boundary", (margin, px) => {
        expect(round(textMarginPixels(margin))).toEqual([px, px, px, px]);
        expect(normalizeText("t", { margin }).margin).toEqual(textMarginPixels(margin));
    });
});

describe("autoPage with plain string and number cells (PptxGenJS 4.0.1 addTableDefinition step 2B: `{ text: cell.toString() }`)", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, line) => `Line ${line + 1}`).join("\n");
    // `as`: PptxGenJS accepts plain string and number cells at runtime, but `TableRow` lists only cell objects.
    const plain = (cells: Array<Array<string | number | PptxGenJS.TableCell>>) => cells as PptxGenJS.TableRow[];
    const tableMargins: Array<PptxGenJS.Margin | undefined> = [undefined, 0.1, [0.2, 0.1, 0.05, 0.1]];
    // getSlidesForTableRows leaves a row's last line cycle out of the used height when its last cell ends earlier.
    test.each<[string, PptxGenJS.TableRow[]]>([
        ["string cells", plain(Array.from({ length: 8 }, (_, index) => [`Row ${index + 1}`, lines(60)]))],
        ["number cells", plain(Array.from({ length: 40 }, (_, index) => [index, index * 1.5]))],
        ["mixed rows", plain(Array.from({ length: 30 }, (_, index) => [`Row ${index + 1}`, index, { text: lines((index % 4) + 1) }]))],
        ["mixed rows, string tallest", plain(Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}` }, index, lines((index % 4) + 1)]))],
        ["mixed rows, last column shorter", plain(Array.from({ length: 30 }, (_, index) => [lines((index % 4) + 1), index, { text: `Row ${index + 1}` }]))],
        ["a long string row, last column shorter", plain([[lines(60), "A"], ...Array.from({ length: 20 }, (_, index) => [lines((index % 3) + 1), `Row ${index + 1}`])])],
    ])("paginates %s as PptxGenJS does", (_, rows) => {
        for (const fontSize of [8, 12, 18])
            for (const margin of tableMargins)
                for (const autoPageRepeatHeader of [false, true]) {
                    const options: PptxGenJS.TableProps = { autoPage: true, autoPageRepeatHeader, y: 0.5, w: 8, fontSize, margin };
                    const pages = paginateTableRows(rows, options, PAGE).map(page => ({ rows: page.rows.length, y: page.y }));
                    // PptxGenJS writes into the rows and options it is given (cell options, colW), so it gets copies.
                    const reference = pptxGenJsPages(structuredClone(rows), { ...options });
                    expect({ fontSize, margin, autoPageRepeatHeader, pages }).toEqual({ fontSize, margin, autoPageRepeatHeader, pages: reference });
                }
    });

    test("splits a long string row and continues its text on the next page", () => {
        const flat = (cell: PptxGenJS.TableCell | undefined): string => (Array.isArray(cell?.text) ? cell.text.map(part => `${flat(part)}${part.options?.breakLine ? "\n" : ""}`).join("") : String(cell?.text ?? ""));
        const pages = paginateTableRows(plain([["A", lines(60)]]), { autoPage: true, y: 0.5, w: 8, fontSize: 12 }, PAGE);
        const firstCells = pages.map(page => flat(page.rows[0]?.[1]));
        expect(pages.length).toBeGreaterThan(1);
        expect(firstCells.every(text => text.length > 0)).toBe(true);
        expect(firstCells.join("\n")).toBe(lines(60));
    });
});

describe("autoPage wrap width (PptxGenJS 4.0.1 parseTextToLines: the cell's own fontSize or DEF_FONT_SIZE, not the table's)", () => {
    const words = (count: number, seed: number) => Array.from({ length: count }, (_, index) => ["table", "of", "wrapping", "text", "at", "several", "widths"][(index + seed) % 7]).join(" ");
    test.each<[string, PptxGenJS.TableRow[]]>([
        ["long wrapping cells", Array.from({ length: 12 }, (_, index) => [{ text: `Row ${index + 1}` }, { text: words(20 + index * 9, index) }, { text: words(10 + index * 5, index + 3) }])],
        ["long wrapping cells with a cell fontSize", Array.from({ length: 12 }, (_, index) => [{ text: words(15 + index * 7, index), options: { fontSize: index % 2 ? 10 : 16 } }, { text: words(25 + index * 6, index + 1) }, { text: `Row ${index + 1}` }])],
    ])("wraps %s by the cell font size for pages, as PptxGenJS does", (_, rows) => {
        for (const fontSize of [8, 12, 18])
            for (const colW of [
                [1.5, 4, 2.5],
                [3, 2, 1],
            ]) {
                const options: PptxGenJS.TableProps = { autoPage: true, y: 0.5, colW, fontSize };
                const pages = paginateTableRows(rows, options, PAGE).map(page => ({ rows: page.rows.length, y: page.y }));
                // PptxGenJS writes into the rows and options it is given (cell options, colW), so it gets copies.
                const reference = pptxGenJsPages(structuredClone(rows), { ...options, colW: [...colW] });
                expect({ fontSize, colW, pages }).toEqual({ fontSize, colW, pages: reference });
            }
    });
});
