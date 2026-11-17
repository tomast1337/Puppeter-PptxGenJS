import { describe, expect, test } from "bun:test";
import { renderedPage } from "./renderedPage";
import type PptxGenJS from "pptxgenjs";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

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
                            border: [{ type: "solid", color: "FF0000", pt: 2 }, { type: "dash", color: "00FF00", pt: 1 }, { type: "none" }, { type: "solid", color: "0000FF", pt: 3 }],
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
            [false, "solid", "transparent", 0],
            [true, "solid", "#0000FF", 4],
        ]);
        // PptxGenJS writes "dash" as prstDash sysDash: 3 line widths on, 1 off.
        expect(table.rows[0]!.cells[0]!.borders.map(border => border.dashArray)).toEqual([undefined, `${(3 * 96) / 72} ${96 / 72}`, undefined, undefined]);
    });

    // PptxGenJS 4.0.1 writes <a:lnX> solid lines for a border without `type` and none for a missing side.
    test("draws a given border without a type as a solid line", () => {
        const sides = (border: unknown) => normalizeTable([[{ text: "a", options: { border: border as PptxGenJS.BorderProps } }]], { w: 1 }, PAGE).rows[0]!.cells[0]!.borders.map(side => [side.visible, side.style, side.color, side.width]);
        const solid = [true, "solid", "#FF0000", 2];
        expect(sides({ color: "FF0000", pt: 1.5 })).toEqual([solid, solid, solid, solid]);
        expect(sides([{ color: "FF0000", pt: 1.5 }, null, { type: "none" }, {}])).toEqual([solid, [false, "solid", "transparent", 0], [false, "solid", "transparent", 0], [true, "solid", "#666666", 96 / 72]]);
        expect(sides(undefined)).toEqual(Array(4).fill([false, "solid", "transparent", 0]));
    });

    // PptxGenJS 4.0.1 writes a "none" side as <a:noFill/> and never reads its color, so it is not validated either.
    test("ignores the color of a none border, and validates a visible one", async () => {
        const none = [false, "solid", "transparent", 0];
        const sides = (border: PptxGenJS.BorderProps) => normalizeTable([[{ text: "a", options: { border } }]], { w: 1 }, PAGE).rows[0]!.cells[0]!.borders.map(side => [side.visible, side.style, side.color, side.width]);
        const injected = "red; background-image: url(http://127.0.0.1/x)";
        for (const color of ["transparent", injected]) {
            expect(sides({ type: "none", color, pt: 0 })).toEqual(Array(4).fill(none));
            const pres = new PuppeteerGen();
            pres.addSlide().addTable([[{ text: "a", options: { border: { type: "none", color, pt: 0 } } }]], { x: 0, y: 0, w: 1 });
            const { html } = await pres.toHtml();
            expect(html).toContain("border-top: 0px none transparent;");
            expect(html).not.toContain("background-image");
            expect(html).not.toContain("url(");
        }
        expect(() => sides({ type: "solid", color: "transparent", pt: 1 })).toThrow('color "transparent" is not a valid color');
        expect(() => sides({ color: "transparent", pt: 0 })).toThrow("is not a valid color");
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

    test("links a whole cell in the hyperlink color unless the cell or table sets one", () => {
        const link = (url: string, color?: string) => ({ text: url, options: { hyperlink: { url }, ...(color ? { color } : {}) } });
        const runs = (options: PptxGenJS.TableProps) =>
            normalizeTable([[link("https://example.com/a"), link("https://example.com/b", "00AA00")]], options, PAGE).rows[0]!.cells.map(cell => {
                const run = cell.text.paragraphs[0]!.runs[0]!;
                return [run.link?.href, run.color, run.decoration.underline];
            });
        // PptxGenJS 4.0.1 writes these cells' runs with u="sng", a hlinkClick and no solidFill; LibreOffice draws #0563C1.
        expect(runs({ w: 6 })).toEqual([
            ["https://example.com/a", "#0563C1", true],
            ["https://example.com/b", "#00AA00", true],
        ]);
        expect(runs({ w: 6, color: "FF0000" })[0]).toEqual(["https://example.com/a", "#FF0000", true]);
    });

    test("matches default, scalar, and mismatched column width behavior", () => {
        const rows = [[{ text: "A" }, { text: "B" }, { text: "C" }]];
        expect(normalizeTable(rows, {}, PAGE).columns).toEqual([288, 288, 288]);
        expect(normalizeTable(rows, { colW: 0.75 }, PAGE).columns).toEqual([64, 64, 64]);
        expect(normalizeTable(rows, { w: 6, colW: [1, 2] }, PAGE).columns).toEqual([192, 192, 192]);
        expect(normalizeTable([rows[0]!, rows[0]!], { h: 2, rowH: [0.5] }, PAGE).rows.map(row => row.height)).toEqual([48, 96]);
    });

    // PptxGenJS 4.0.1 writes a bare <a:bodyPr/> in every cell (genXmlTextBody), so a cell has no autofit (#197).
    test("ignores fit, shrinkText and autoFit on a cell or the table, as PptxGenJS does", () => {
        // `as`: the types leave these options off cells and tables, but PptxGenJS accepts them at runtime.
        const cells = [{ text: "A", options: { fit: "shrink" } }, { text: "B", options: { shrinkText: true } }, { text: "C", options: { autoFit: true } }, { text: "D" }] as unknown as PptxGenJS.TableCell[];
        const table = normalizeTable([cells], { fit: "shrink" } as PptxGenJS.TableProps, PAGE);
        expect(table.rows[0]?.cells.map(cell => cell.text.fit)).toEqual(["none", "none", "none", "none"]);
    });

    test("rejects empty and malformed row input", () => {
        expect(() => normalizeTable([], {}, PAGE)).toThrow("non-empty array");
        expect(() => normalizeTable(["bad"] as unknown as PptxGenJS.TableRow[], {}, PAGE)).toThrow("each row");
    });
});

describe("table rendering", () => {
    // PptxGenJS writes <a:tr h> and PowerPoint and LibreOffice grow the row to its text, so the text stays in flow.
    test("keeps cell text in flow in rows with a height, so a row grows to its text", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addTable([[{ text: "one\ntwo\nthree" }, { text: "up", options: { textDirection: "vert" } }]], { x: 1, y: 1, w: 4, rowH: 0.2 });

        const [horizontal, vertical] = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".table-cell-text"));
        expect(parseFloat(renderedPage(presentation).querySelector<HTMLElement>("tr")?.style.height ?? "")).toBeCloseTo(19.2);
        expect([horizontal?.style.position, horizontal?.style.width]).toEqual(["", "100%"]);
        expect(vertical?.style.position).toBe("absolute");
    });

    test("keeps a dashed border's DrawingML pattern, which CSS can only draw as dashed", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addTable([[{ text: "a", options: { border: [{ type: "dash", pt: 2, color: "70AD47" }, { type: "none" }, { type: "solid", pt: 1 }, { type: "none" }] } }]], { x: 1, y: 1, w: 2 });

        const cell = renderedPage(presentation).querySelector("td");
        const borders = presentation.getModel().slides[0]?.objects[0];
        const top = borders?.kind === "table" ? borders.table.rows[0]?.cells[0]?.borders[0] : undefined;
        expect(top?.dashArray).toBeDefined();
        expect(cell?.getAttribute("data-border-top-dash-array")).toBe(top?.dashArray ?? "");
        expect(cell?.hasAttribute("data-border-bottom-dash-array")).toBe(false);
    });

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

        const container = renderedPage(presentation).querySelector<HTMLElement>(".slide-table-container");
        const cells = renderedPage(presentation).querySelectorAll<HTMLTableCellElement>("td");
        expect(container?.style.width).toBe("384px");
        expect(container?.style.height).toBe("96px");
        expect(renderedPage(presentation).querySelectorAll("col")).toHaveLength(3);
        expect(cells[0]?.colSpan).toBe(2);
        expect(cells[0]?.rowSpan).toBe(2);
        expect(cells[0]?.querySelectorAll(".text-run")).toHaveLength(2);
        expect(cells[0]?.style.borderTop).toContain("solid");
    });
});
