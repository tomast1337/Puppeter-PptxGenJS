import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { paginateTableRows } from "../src/normalize/tablePagination";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

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

        const slides = presentation.page.querySelectorAll<HTMLElement>(".slide-container");
        expect(slides).toHaveLength(3);
        expect(slide.newAutoPagedSlides).toHaveLength(2);
        expect(slides[0]?.querySelectorAll(".slide-table-container")).toHaveLength(1);
        expect(slides[1]?.querySelector<HTMLElement>(".slide-table-container")?.style.top).toBe("72px");
        expect(slides[1]?.querySelector("td")?.textContent).toBe("Row 1");
        expect(slides[2]?.querySelector("td")?.textContent).toBe("Row 1");
    });
});
