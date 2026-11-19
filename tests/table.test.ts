import { afterAll, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { renderedPage } from "./renderedPage";
import type PptxGenJS from "pptxgenjs";
import PptxGenJSRuntime from "pptxgenjs";
import JSZip from "jszip";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

afterAll(closeBrowser);

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

    // PptxGenJS 4.0.1 genXmlTable writes `<a:tr h>` from rowH, else h / rows; h alone is only the frame's cy, which
    // PowerPoint and LibreOffice ignore (#246): rowH 0.5 with h 3 draws 3 rows of 0.5 in, a 1.5 in table.
    test("sizes the table from its rows, not from a larger h (#246)", () => {
        const rows = [[{ text: "A" }], [{ text: "B" }], [{ text: "C" }]];
        const withRowH = normalizeTable(rows, { h: 3, rowH: 0.5 }, PAGE);
        expect(withRowH.rows.map(row => row.height)).toEqual([48, 48, 48]);
        expect(withRowH.height).toBe(144);
        const fromH = normalizeTable(rows, { h: 3 }, PAGE);
        expect(fromH.rows.map(row => row.height)).toEqual([96, 96, 96]);
        expect(fromH.height).toBe(288);
        expect(normalizeTable([[{ text: "A" }], [{ text: "B" }]], { rowH: [0.5] }, PAGE).height).toBeUndefined();

        const presentation = new PuppeteerGen();
        presentation.addSlide().addTable(rows, { x: 0.5, y: 0.5, w: 8, h: 3, rowH: 0.5 });
        const page = renderedPage(presentation);
        expect(parseFloat(page.querySelector<HTMLElement>(".slide-table-container")?.style.height ?? "")).toBe(144);
        expect(parseFloat(page.querySelector<HTMLElement>("table.slide-table")?.style.height ?? "")).toBe(144);
        expect([...page.querySelectorAll<HTMLElement>("tr")].map(row => parseFloat(row.style.height))).toEqual([48, 48, 48]);
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
    // PowerPoint and LibreOffice stroke each grid line once at the border's width; Chromium fills a CSS border as a
    // box floored to whole device px (0.47pt for 0.5pt), which viewers anti-alias to a pale line.
    test("prints table borders as one stroke per grid line, not filled boxes per cell side", async () => {
        const presentation = new PuppeteerGen(PAGE);
        const line = { type: "solid", pt: 0.5, color: "000000" } as const;
        const dash = { ...line, type: "dash" } as const;
        const slide = presentation.addSlide();
        slide.addTable(
            [
                ["A", "B"],
                ["C", "D"],
            ].map(row => row.map(text => ({ text, options: { border: line } }))),
            { x: 1, y: 1, w: 4, fontFace: "Arial" },
        );
        slide.addTable([[{ text: "E", options: { border: [dash, { type: "none" }, dash, { type: "none" }] } }]], { x: 1, y: 3, w: 4, fontFace: "Arial" });
        const content = pdfContent(await presentation.toPdf());

        // Three row lines and three column lines of the grid, then the dashed top and bottom, one subpath per dash.
        const strokes = content.match(/(?:[-\d. ]+ [ml]\n)+S\n/g) ?? [];
        expect(strokes).toHaveLength(8);
        expect(strokes.slice(-2).every(path => (path.match(/ m\n/g) ?? []).length > 1)).toBe(true);
        // The only filled rectangle is the slide background.
        expect(content.match(/ re\nf\n/g)).toHaveLength(1);
    }, 60_000);

    // PptxGenJS writes <a:tr h> and PowerPoint and LibreOffice grow the row to its text, so the text stays in flow.
    test("keeps cell text in flow in rows with a height, so a row grows to its text", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addTable([[{ text: "one\ntwo\nthree" }, { text: "up", options: { textDirection: "vert" } }]], { x: 1, y: 1, w: 4, rowH: 0.2 });

        const [horizontal, vertical] = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".table-cell-text"));
        expect(parseFloat(renderedPage(presentation).querySelector<HTMLElement>("tr")?.style.height ?? "")).toBeCloseTo(19.2);
        expect([horizontal?.style.position, horizontal?.style.width]).toEqual(["", "100%"]);
        expect(vertical?.style.position).toBe("absolute");
    });

    // LibreOffice's Cell::getMinimumHeight is GetTextHeight() + 1 (1/100 mm) plus the margins; PowerPoint adds nothing.
    test("makes a content-sized row 1/100 mm taller than its text and margins for LibreOffice, away from the anchor", () => {
        const slack = 96 / 2540;
        const rows: PptxGenJS.TableRow[] = [[{ text: "top" }, { text: "middle", options: { valign: "middle" } }, { text: "bottom", options: { valign: "bottom" } }]];
        const paddings = (presentation: PuppeteerGen) => Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".table-cell-text"), cell => [parseFloat(cell.style.paddingTop), parseFloat(cell.style.paddingBottom)]);
        const deck = (target: "libreoffice" | "powerpoint", options: PptxGenJS.TableProps) => {
            const presentation = new PuppeteerGen(PAGE, { target });
            presentation.addSlide().addTable(rows, { x: 1, y: 1, w: 6, margin: 0.05, ...options });
            return presentation;
        };

        const libreOffice = deck("libreoffice", {});
        const table = libreOffice.getModel().slides[0]?.objects[0];
        expect(table?.kind === "table" ? table.table.contentRowSlack : undefined).toBeCloseTo(slack);
        // Cell margins stay the drawn margins; the slack is applied where the row is laid out.
        const margin = table?.kind === "table" ? table.table.rows[0]?.cells[0]?.text.margin : undefined;
        expect(margin?.[0]).toBeCloseTo(4.8);
        expect(margin?.[2]).toBeCloseTo(4.8);
        const [top, middle, bottom] = paddings(libreOffice);
        expect(top?.[0]).toBeCloseTo(4.8);
        expect(top?.[1]).toBeCloseTo(4.8 + slack);
        expect(middle?.[0]).toBeCloseTo(4.8 + slack / 2);
        expect(middle?.[1]).toBeCloseTo(4.8 + slack / 2);
        expect(bottom?.[0]).toBeCloseTo(4.8 + slack);
        expect(bottom?.[1]).toBeCloseTo(4.8);

        // A row with a height, and the PowerPoint target, keep the plain margins.
        for (const presentation of [deck("libreoffice", { rowH: 0.5 }), deck("powerpoint", {})]) {
            for (const [paddingTop, paddingBottom] of paddings(presentation)) {
                expect(paddingTop).toBeCloseTo(4.8);
                expect(paddingBottom).toBeCloseTo(4.8);
            }
        }
        const powerPoint = deck("powerpoint", {}).getModel().slides[0]?.objects[0];
        expect(powerPoint?.kind === "table" && "contentRowSlack" in powerPoint.table).toBe(false);
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

/** The runs PptxGenJS 4.0.1 writes for a one-slide table, per cell: each run's text and whether it has `b="1"`. */
async function pptxGenJsRuns(rows: unknown[], options: PptxGenJS.TableProps): Promise<string[]> {
    const pptx = new PptxGenJSRuntime();
    pptx.addSlide().addTable(structuredClone(rows) as PptxGenJS.TableRow[], structuredClone(options));
    // `as`: write() returns a Buffer for the nodebuffer output type.
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    return [...xml.matchAll(/<a:tc>(.*?)<\/a:tc>/g)].map(([, cell]) => [...(cell ?? "").matchAll(/<a:r><a:rPr([^>]*)>.*?<a:t>([^<]*)<\/a:t><\/a:r>/g)].map(([, props, text]) => `${text}${props?.includes('b="1"') ? "/b" : ""}`).join("|"));
}

/** Every page content stream of a Chromium PDF, inflated and joined. */
function pdfContent(pdf: Uint8Array): string {
    const bytes = Buffer.from(pdf);
    const streams: string[] = [];
    for (let at = bytes.indexOf("stream\n"); at >= 0; at = bytes.indexOf("stream\n", at + 1)) {
        const end = bytes.indexOf("endstream", at);
        try {
            streams.push(inflateSync(bytes.subarray(at + "stream\n".length, end)).toString("latin1"));
        } catch {
            // Not a Flate stream (fonts are, but images may not be); content streams always are.
        }
    }
    return streams.join("\n");
}

function ourRuns(rows: unknown[], options: PptxGenJS.TableProps): string[] {
    const table = normalizeTable(structuredClone(rows) as PptxGenJS.TableRow[], options, PAGE);
    return table.rows.flatMap(row => row.cells.map(cell => cell.text.paragraphs.flatMap(paragraph => paragraph.runs.filter(run => run.text).map(run => `${run.text}${run.bold ? "/b" : ""}`)).join("|")));
}

describe("falsy cell values (PptxGenJS 4.0.1 fills falsy options from the parent and keeps only truthy text)", () => {
    test.each<[string, unknown[], PptxGenJS.TableProps]>([
        ["a run's bold: false in a bold cell", [[{ text: [{ text: "a", options: { bold: false } }, { text: "b" }], options: { bold: true } }]], {}],
        ["a cell's bold: false in a bold table", [[{ text: "a", options: { bold: false } }, { text: "b" }]], { bold: true }],
        ["a cell's bold: null in a bold table", [[{ text: "a", options: { bold: null } }]], { bold: true }],
        ["falsy and boolean text", [[{ text: 0 }, { text: false }, { text: true }, { text: "" }, 0, "0"]], {}],
    ])("draws %s as PptxGenJS writes it", async (_, rows, options) => {
        expect(ourRuns(rows, options)).toEqual(await pptxGenJsRuns(rows, options));
    });

    test("the HTML run shows the inherited bold", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.addSlide().addTable([[{ text: [{ text: "Bold", options: { bold: false } }], options: { bold: true } }]], {});
        const run = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-table-container td .text-run")).find(span => span.textContent === "Bold");
        expect(run?.style.fontWeight).toBe("bold");
    });

    test("a later row that is not an array names the row", () => {
        const rows = [[{ text: "a" }], { text: "b" }] as unknown as PptxGenJS.TableRow[];
        expect(() => normalizeTable(rows, {}, PAGE)).toThrow("addTable: rows[1] is of type object, not an array of cells");
        expect(() => new PuppeteerGen(PAGE).addSlide().addTable(rows, { autoPage: true })).toThrow("rows[1] is of type object");
    });
});
