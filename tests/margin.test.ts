import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { mapSides, tableMarginInches, tableMarginPixels, tableMarginToCSS, textMarginPixels, textMarginToCSS } from "../packages/pptxgenjs/src/normalize/margin";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { paginateTableRows } from "../packages/pptxgenjs/src/normalize/table/pagination";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const round = (sides: number[]) => sides.map(side => Number(side.toFixed(6)));

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

    test("pins the current slideMargin reading, which PptxGenJS reads as inches (#165)", () => {
        const rows: PptxGenJS.TableRow[] = Array.from({ length: 30 }, (_, index) => [{ text: `Row ${index + 1}` }]);
        const options = (slideMargin: number) => ({ autoPage: true, y: 1, w: 8, slideMargin }) as PptxGenJS.TableProps;
        expect(paginateTableRows(rows, options(0.99), PAGE)[1]?.y).toBe(0.99);
        // shortcut: PptxGenJS 4.0.1 getSlidesForTableRows continues at 1in here; flip with #165.
        expect(paginateTableRows(rows, options(1), PAGE)[1]?.y).toBe(1 / 72);
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
