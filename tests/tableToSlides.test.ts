import { describe, expect, test } from "bun:test";
import { normalizeHtmlTable } from "../src/normalize/htmlTable";
import { PAGE_SIZES } from "../src/pageLayouts";
import { PuppeteerGen } from "../src/PuppeterrGen";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

function installTable(presentation: PuppeteerGen, rowCount = 2): HTMLTableElement {
    const host = presentation.page.createElement("div");
    host.innerHTML = `
        <table id="source" style="width:600px;border-collapse:collapse;font-family:Arial;font-size:12px;color:rgb(31,78,121)">
            <thead><tr>
                <th style="width:100px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">ID</th>
                <th style="width:300px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">Description</th>
                <th style="width:200px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">State</th>
            </tr></thead>
            <tbody>${Array.from({ length: rowCount }, (_, index) => `
                <tr>
                    <td style="padding:4px;text-align:center;border:1px solid #A6A6A6">${index + 1}</td>
                    <td style="padding:4px;border:1px solid #A6A6A6">Row ${index + 1}<br>detail</td>
                    <td style="padding:4px;text-align:right;background:rgb(226,240,217);border:1px dashed #70AD47">Ready</td>
                </tr>`).join("")}
            </tbody>
            <tfoot><tr><td colspan="3" style="padding:4px;font-weight:bold">Footer</td></tr></tfoot>
        </table>`;
    presentation.page.body.appendChild(host);
    return presentation.page.getElementById("source") as HTMLTableElement;
}

describe("HTML table normalization", () => {
    test("extracts sections, proportional widths, spans, text, and computed styles", () => {
        const presentation = new PuppeteerGen(PAGE);
        const source = installTable(presentation);
        const table = normalizeHtmlTable(presentation.page, "source", {
            w: 10,
            slideMargin: 0.5,
        }, PAGE);

        expect(table.columnWidths).toEqual([1.5, 4.5, 3]);
        expect(table.headerRows).toBe(1);
        expect(table.rows).toHaveLength(4);
        expect(table.rows[1]?.[1]?.text).toBe("Row 1\ndetail");
        expect(table.rows[3]?.[0]?.options?.colspan).toBe(3);
        expect(table.rows[0]?.[0]?.options).toMatchObject({
            bold: true,
            color: "FFFFFF",
            fontFace: "Arial",
            fontSize: 12,
            margin: [6, 6, 6, 6],
        });
        expect(table.rows[1]?.[2]?.options?.fill).toEqual({ color: "E2F0D9" });
        expect(Array.isArray(table.rows[1]?.[2]?.options?.border)).toBe(true);
        expect(source.dataset.puppeteerGenSource).toBe("true");
    });

    test("rejects missing and non-table element IDs", () => {
        const presentation = new PuppeteerGen(PAGE);
        const div = presentation.page.createElement("div");
        div.id = "not-table";
        presentation.page.body.appendChild(div);
        expect(() => normalizeHtmlTable(presentation.page, "missing", {}, PAGE)).toThrow('Table ID "missing" does not exist');
        expect(() => normalizeHtmlTable(presentation.page, "not-table", {}, PAGE)).toThrow('Table ID "not-table" does not exist');
    });
});

describe("tableToSlides", () => {
    test("creates paginated slides and adds supported decorations to each", () => {
        const presentation = new PuppeteerGen(PAGE);
        installTable(presentation, 30);
        presentation.tableToSlides("source", {
            w: 10,
            y: 0.75,
            slideMargin: 0.5,
            autoPageRepeatHeader: true,
            autoPageSlideStartY: 0.5,
            addText: { text: [{ text: "Generated" }], options: { x: 7.5, y: 0.1, w: 2, h: 0.3, fontSize: 9 } },
            addShape: { shapeName: "rect", options: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, fill: { color: "4472C4" } } },
            addImage: {
                image: { data: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=" },
                options: { x: 0.35, y: 0.1, w: 0.2, h: 0.2 },
            },
            addTable: { rows: [[{ text: "Extra" }]], options: { x: 8.5, y: 5, w: 1, h: 0.3, fontSize: 7, margin: 0 } },
        });

        const slides = presentation.page.querySelectorAll<HTMLElement>(".slide-container");
        expect(slides.length).toBeGreaterThan(1);
        slides.forEach(slide => {
            expect(slide.querySelectorAll(".slide-table-container").length).toBe(2);
            expect(slide.querySelector(".slide-text")?.textContent).toBe("Generated");
            expect(slide.querySelectorAll(".slide-shape")).toHaveLength(1);
            expect(slide.querySelectorAll(".slide-image")).toHaveLength(1);
        });
        expect(slides[1]?.querySelector("td")?.textContent).toBe("ID");
    });
});
