import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { normalizeTable } from "../src/normalize/table";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

describe("table normalization", () => {
    test("normalizes explicit columns, rows, spans, and per-side borders", () => {
        const table = normalizeTable(
            [
                [
                    {
                        text: "Merged",
                        options: {
                            colspan: 2,
                            rowspan: 2,
                            margin: [0.1, 0.2, 0.3, 0.4],
                            border: [
                                { type: "solid", color: "FF0000", pt: 2 },
                                { type: "dash", color: "00FF00", pt: 1 },
                                { type: "none" },
                                { type: "solid", color: "0000FF", pt: 3 },
                            ],
                        },
                    },
                    { text: "Third" },
                ],
                [{ text: "Tail" }],
            ],
            {
                colW: [1, 2, 3],
                rowH: [0.5, 0.75],
            },
            PAGE,
        );

        expect(table.width).toBe(576);
        expect(table.height).toBe(120);
        expect(table.columns).toEqual([96, 192, 288]);
        expect(table.rows.map(row => row.height)).toEqual([48, 72]);
        expect(table.rows[0]!.cells[0]!.colspan).toBe(2);
        expect(table.rows[0]!.cells[0]!.rowspan).toBe(2);
        expect(table.rows[0]!.cells[0]!.text.margin).toEqual([9.600000000000001, 19.200000000000003, 28.799999999999997, 38.400000000000006]);
        expect(table.rows[0]!.cells[0]!.borders.map(border => [border.visible, border.style, border.color, border.width])).toEqual([
            [true, "solid", "#FF0000", (2 * 96) / 72],
            [true, "dashed", "#00FF00", 96 / 72],
            [false, "solid", "#666666", 0],
            [true, "solid", "#0000FF", 4],
        ]);
    });

    test("inherits table typography, fill, margins, and direction into cells", () => {
        const table = normalizeTable(
            [
                [
                    {
                        text: [
                            { text: "Bold ", options: { bold: true } },
                            { text: "link", options: { hyperlink: { url: "https://example.com" } } },
                        ],
                        options: { color: "ED7D31" },
                    },
                ],
            ],
            {
                w: 4,
                fontFace: "Arial",
                fontSize: 15,
                italic: true,
                color: "4472C4",
                fill: { color: "D9EAF7" },
                margin: 6,
                valign: "bottom",
                textDirection: "vert270",
                border: { type: "solid", color: "17365D", pt: 1 },
            },
            PAGE,
        );

        const cell = table.rows[0]!.cells[0]!;
        expect(table.columns).toEqual([384]);
        expect(cell.fill?.color).toBe("#D9EAF7");
        expect(cell.text.margin).toEqual([8, 8, 8, 8]);
        expect(cell.text.verticalAlign).toBe("bottom");
        expect(cell.text.direction).toBe("vertical270");
        // PptxGenJS only inherits its selected table-cell option list; italic is
        // intentionally absent from that list for object-form cells.
        expect(cell.text.paragraphs[0]!.runs.map(run => [run.text, run.bold, run.italic, run.color])).toEqual([
            ["Bold ", true, false, "#ED7D31"],
            ["link", false, false, "#0563C1"],
        ]);
        expect(cell.text.paragraphs[0]!.runs[1]!.link?.href).toBe("https://example.com");
    });

    test("matches default, scalar, and mismatched column width behavior", () => {
        const rows = [[{ text: "A" }, { text: "B" }, { text: "C" }]];
        expect(normalizeTable(rows, {}, PAGE).columns).toEqual([288, 288, 288]);
        expect(normalizeTable(rows, { colW: 0.75 }, PAGE).columns).toEqual([64, 64, 64]);
        expect(normalizeTable(rows, { w: 6, colW: [1, 2] }, PAGE).columns).toEqual([192, 192, 192]);
        expect(normalizeTable([rows[0]!, rows[0]!], { h: 2, rowH: [0.5] }, PAGE).rows.map(row => row.height)).toEqual([48, 96]);
    });

    test("rejects empty and malformed row input", () => {
        expect(() => normalizeTable([], {}, PAGE)).toThrow("non-empty array");
        expect(() => normalizeTable(["bad"] as unknown as PptxGenJS.TableRow[], {}, PAGE)).toThrow("each row");
    });
});

describe("table rendering", () => {
    test("renders colgroups, merged cells, rich runs, and inherited styling", () => {
        const presentation = new PuppeteerGen(PAGE);
        const slide = presentation.addSlide();
        slide.addTable(
            [
                [
                    {
                        text: [
                            { text: "One", options: { bold: true } },
                            { text: " two", options: { italic: true } },
                        ],
                        options: { colspan: 2, rowspan: 2, fill: { color: "D9EAF7" } },
                    },
                    { text: "Three" },
                ],
                [{ text: "Four" }],
            ],
            {
                x: 1,
                y: 1,
                colW: [1, 1, 2],
                rowH: 0.5,
                border: { type: "solid", color: "4472C4", pt: 1 },
            },
        );

        const container = presentation.page.querySelector<HTMLElement>(".slide-table-container");
        const cells = presentation.page.querySelectorAll<HTMLTableCellElement>("td");
        expect(container?.style.width).toBe("384px");
        expect(container?.style.height).toBe("96px");
        expect(presentation.page.querySelectorAll("col")).toHaveLength(3);
        expect(cells[0]?.colSpan).toBe(2);
        expect(cells[0]?.rowSpan).toBe(2);
        expect(cells[0]?.querySelectorAll(".text-run")).toHaveLength(2);
        expect(cells[0]?.style.borderTop).toContain("solid");
    });
});
