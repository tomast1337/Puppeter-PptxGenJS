import { describe, expect, test } from "bun:test";
import { renderedPage } from "./renderedPage";
import { normalizeHtmlTable } from "../packages/pptxgenjs/src/normalize/table/html";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;

/** The source table, in a jsdom document of its own. */
function sourceTable(rowCount = 2): HTMLTableElement {
    const document = createNodeDocument();
    document.body.innerHTML = tableHtml(rowCount);
    return document.getElementById("source") as HTMLTableElement;
}

function tableHtml(rowCount: number): string {
    return `
        <table id="source" style="width:600px;border-collapse:collapse;font-family:Arial;font-size:12px;color:rgb(31,78,121)">
            <thead><tr>
                <th style="width:100px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">ID</th>
                <th style="width:300px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">Description</th>
                <th style="width:200px;background:#4472C4;color:white;padding:6px;border:1px solid #17365D">State</th>
            </tr></thead>
            <tbody>${Array.from(
                { length: rowCount },
                (_, index) => `
                <tr>
                    <td style="padding:4px;text-align:center;border:1px solid #A6A6A6">${index + 1}</td>
                    <td style="padding:4px;border:1px solid #A6A6A6">Row ${index + 1}<br>detail</td>
                    <td style="padding:4px;text-align:right;background:rgb(226,240,217);border:1px dashed #70AD47">Ready</td>
                </tr>`,
            ).join("")}
            </tbody>
            <tfoot><tr><td colspan="3" style="padding:4px;font-weight:bold">Footer</td></tr></tfoot>
        </table>`;
}

describe("HTML table normalization", () => {
    test("extracts sections, proportional widths, spans, text, and computed styles", () => {
        const source = sourceTable();
        const table = normalizeHtmlTable(
            source,
            {
                w: 10,
                slideMargin: 0.5,
            },
            PAGE,
        );

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
        const div = createNodeDocument().createElement("div");
        expect(() => presentation.tableToSlides("missing")).toThrow('tableToSlides: Table ID "missing" does not exist!');
        expect(() => presentation.tableToSlides(div as unknown as HTMLTableElement)).toThrow("the element is not a <table>");
        expect(() => presentation.tableToSlides("<p>no table</p>")).toThrow("the HTML string has no <table> element");
        expect(presentation.getModel().slides).toHaveLength(0);
    });
});

describe("tableToSlides source", () => {
    const slidesFrom = (populate: (presentation: PuppeteerGen) => void) => {
        const presentation = new PuppeteerGen(PAGE);
        populate(presentation);
        return presentation.getModel().slides;
    };
    const fromElement = slidesFrom(presentation => presentation.tableToSlides(sourceTable(30), { autoPageRepeatHeader: true }));

    test("takes HTML markup as well as the <table> element, with the same slides", () => {
        expect(fromElement.length).toBeGreaterThan(1);
        expect(slidesFrom(presentation => presentation.tableToSlides(tableHtml(30), { autoPageRepeatHeader: true }))).toEqual(fromElement);
        expect(slidesFrom(presentation => presentation.tableToSlides(`  <div>${tableHtml(30)}</div>`, { autoPageRepeatHeader: true }))).toEqual(fromElement);
    });

    test("finds the id in the global document, where PptxGenJS looks, and only there", () => {
        const global = globalThis as { document?: Document };
        const previous = global.document;
        global.document = createNodeDocument();
        try {
            global.document.body.innerHTML = tableHtml(30);
            expect(slidesFrom(presentation => presentation.tableToSlides("source", { autoPageRepeatHeader: true }))).toEqual(fromElement);
            global.document.body.innerHTML = '<div id="not-table"></div>';
            expect(() => new PuppeteerGen(PAGE).tableToSlides("not-table")).toThrow('Table ID "not-table" does not exist');
        } finally {
            global.document = previous;
        }
    });

    test("an HTML string needs a createDocument() with a window, and says so", () => {
        // A browser's default, document.implementation.createHTMLDocument(), has no window to compute styles in.
        const windowless = () => createNodeDocument().implementation.createHTMLDocument();
        const presentation = new PuppeteerGen(PAGE, { createDocument: windowless });
        expect(() => presentation.tableToSlides(tableHtml(1))).toThrow("parsing an HTML string needs a document with a window");
    });
});

describe("tableToSlides", () => {
    test("creates paginated slides and adds supported decorations to each", () => {
        const presentation = new PuppeteerGen(PAGE);
        presentation.tableToSlides(sourceTable(30), {
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

        const slides = renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-container");
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

// PptxGenJS 4.0.1 genTableToSlides (step 5 C) adds each table with only x, y, w and colW: no rowH, so rows size to
// their content on every slide.
test("tableToSlides leaves row heights to the content, whatever rowH says", () => {
    const presentation = new PuppeteerGen(PAGE);
    presentation.tableToSlides(sourceTable(30), { rowH: 0.8 });
    const tables = presentation.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "table" ? [object.table] : [])));
    expect(tables.length).toBeGreaterThan(1);
    expect(tables.flatMap(table => table.rows.map(row => row.height))).toEqual(tables.flatMap(table => table.rows.map(() => undefined)));
});
