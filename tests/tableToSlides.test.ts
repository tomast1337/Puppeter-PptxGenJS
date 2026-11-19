import { describe, expect, test } from "bun:test";
import { renderedPage } from "./renderedPage";
import PptxGenJSRuntime from "pptxgenjs";
import JSZip from "jszip";
import type PptxGenJS from "pptxgenjs";
import { normalizeHtmlTable } from "../packages/pptxgenjs/src/normalize/table/html";
import { createNodeDocument, PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { pointsToPixels } from "@pdflapas/model";

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

/**
 * PptxGenJS 4.0.1 tableToSlides on the same table: per slide, its rows and the `h`/`rowH` of the table it drew. It reads
 * the global `document` and `window`, and the `offsetWidth` and `innerText` jsdom leaves out (shimmed as in
 * tests/visual/compare.ts).
 */
function pptxGenJsTableToSlides(rowCount: number, options: PptxGenJS.TableToSlidesProps): Array<{ rows: number; h: unknown; rowH: unknown }> {
    const pptx = runPptxGenJsTableToSlides(tableHtml(rowCount), options);
    // `as`: `_slides`, `_slideObjects` and `arrTabRows` are PptxGenJS 4.0.1 internals the types omit.
    const slides = (pptx as unknown as { _slides: Array<{ _slideObjects: Array<{ arrTabRows: unknown[]; options: { h?: unknown; rowH?: unknown } }> }> })._slides;
    return slides.map(slide => ({ rows: slide._slideObjects[0]?.arrTabRows.length ?? 0, h: slide._slideObjects[0]?.options.h, rowH: slide._slideObjects[0]?.options.rowH }));
}

/** PptxGenJS 4.0.1 tableToSlides("source") on `html`, in a jsdom document installed as the global one meanwhile. */
function runPptxGenJsTableToSlides(html: string, options: PptxGenJS.TableToSlidesProps): PptxGenJSRuntime {
    const document = createNodeDocument();
    const view = document.defaultView!;
    document.body.innerHTML = html;
    Object.defineProperty(view.HTMLElement.prototype, "offsetWidth", {
        get: function (this: HTMLElement) {
            return parseFloat(this.style.width) || 0;
        },
    });
    Object.defineProperty(view.HTMLElement.prototype, "innerText", {
        get: function (this: HTMLElement) {
            return textOf(this, view);
        },
    });
    const global = globalThis as { document?: Document; window?: Window };
    const previous = { document: global.document, window: global.window };
    Object.assign(global, { document, window: view });
    try {
        const pptx = new PptxGenJSRuntime();
        pptx.layout = "LAYOUT_16x9";
        pptx.tableToSlides("source", structuredClone(options));
        return pptx;
    } finally {
        Object.assign(global, previous);
    }
}

function textOf(node: Node, view: Window & typeof globalThis): string {
    const read = (child: Node): string => (child.nodeType === child.TEXT_NODE ? (child.nodeValue ?? "") : child instanceof view.HTMLBRElement ? "\n" : Array.from(child.childNodes).map(read).join(""));
    return read(node).trim();
}

// PptxGenJS 4.0.1 genTableToSlides (step 5 C) adds each table with only x, y, w and colW: `h` and `rowH` decide how
// many rows fit on a slide, then the drawn rows size to their content on every slide.
test.each<[string, PptxGenJS.TableToSlidesProps]>([
    ["rowH", { rowH: 0.8 }],
    ["h", { h: 3 }],
    ["h and rowH", { h: 4, rowH: [0.6, 0.4] }],
])("tableToSlides paginates with %s but leaves row heights to the content", (_, options) => {
    const presentation = new PuppeteerGen(PAGE);
    presentation.tableToSlides(sourceTable(30), options);
    const tables = presentation.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "table" ? [object.table] : [])));
    const theirs = pptxGenJsTableToSlides(30, options);
    expect(tables.length).toBeGreaterThan(1);
    expect(theirs.every(table => table.h === undefined && table.rowH === undefined)).toBe(true);
    expect(tables.map(table => table.rows.length)).toEqual(theirs.map(table => table.rows));
    expect(tables.flatMap(table => table.rows.map(row => row.height))).toEqual(tables.flatMap(table => table.rows.map(() => undefined)));
    expect(tables.map(table => table.height)).toEqual(tables.map(() => undefined));
    const rowStyles = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-table-container tr")).map(row => row.style.height);
    expect(rowStyles.length).toBeGreaterThan(30);
    expect(new Set(rowStyles)).toEqual(new Set([""]));
});

// Under jsdom a cell has no computed font-size: PptxGenJS reads 0 and writes its run without `sz`, so PowerPoint takes the
// deck's default text size, 18pt (`<a:defRPr sz="1800">` in presentation.xml p:defaultTextStyle and the master's
// p:otherStyle, both lvl1pPr). A cell with a computed size keeps it.
test("tableToSlides draws a jsdom cell without a font size at the deck's default 18pt", async () => {
    const html = `<table id="source" style="width:600px"><tr><td style="width:300px;color:rgb(0,0,0)">Plain</td><td style="width:300px;color:rgb(0,0,0);font-size:10px">Sized</td></tr></table>`;
    const pptx = runPptxGenJsTableToSlides(html, {});
    // `as`: write() returns a Buffer for the nodebuffer output type.
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    const slide = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    const presentation = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
    expect([...slide.matchAll(/<a:rPr([^>]*)>/g)].map(([, props]) => props?.match(/sz="(\d+)"/)?.[1])).toEqual([undefined, "1000"]);
    expect(presentation).toMatch(/<p:defaultTextStyle><a:lvl1pPr[^>]*><a:defRPr sz="1800"/);

    const ours = new PuppeteerGen(PAGE);
    const document = createNodeDocument();
    document.body.innerHTML = html;
    ours.tableToSlides(document.getElementById("source") as HTMLTableElement);
    const runs = ours.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "table" ? object.table.rows.flatMap(row => row.cells.flatMap(cell => cell.text.paragraphs.flatMap(paragraph => paragraph.runs))) : [])));
    expect(runs.filter(run => run.text).map(run => run.fontSize)).toEqual([pointsToPixels(PPTX_DEFAULTS.table.unsizedRunFontSizePt), pointsToPixels(10)]);
});
