import type PptxGenJS from "pptxgenjs";
import type { FourSideMargin } from "#src/defaults";
import type { PageSize } from "#src/pageLayouts";
import { HEX_COLOR } from "#src/color";
import { inchesToPixels, pointsToPixels } from "@pdflapas/model";
import { mapSides, slideMarginInches } from "#src/normalize/margin";
import { checkTableHtmlLimits, type TableHtmlLimits } from "./htmlLimits";

export type NormalizedHtmlTable = {
    rows: PptxGenJS.TableRow[];
    headerRows: number;
    columnWidths: number[];
    x: number;
    y: number;
    continuationY: number;
    slideMargin: FourSideMargin;
};

function cssPixels(value: string | null | undefined, relativeTo: number): number {
    const source = value?.trim();

    if (!source || source === "auto") {
        return 0;
    }

    const amount = parseFloat(source);

    if (!Number.isFinite(amount)) {
        return 0;
    }

    if (source.endsWith("%")) {
        return (relativeTo * amount) / 100;
    }

    if (source.endsWith("in")) {
        return inchesToPixels(amount);
    }

    if (source.endsWith("pt")) {
        return pointsToPixels(amount);
    }

    return amount;
}

function colorValue(value: string): string {
    if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") {
        return "FFFFFF";
    }

    const channels = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);

    // A computed color that is not rgb() (jsdom's "canvastext") becomes "NaNNaNNaN" in PptxGenJS 4.0.1, which writes black.
    if (!channels) {
        return HEX_COLOR.test(value) ? value.replace(/^#/, "") : "000000";
    }

    return channels
        .slice(1, 4)
        .map(channel => Number(channel).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
}

/** The element if it is a <table> in a document with a window, whose computed styles tableToSlides() reads. */
function tableWithWindow(element: Element | null | undefined): { kind: "table"; table: HTMLTableElement } | { kind: "notTable" } {
    const view = element?.ownerDocument?.defaultView;

    return view && element instanceof view.HTMLTableElement ? { kind: "table", table: element } : { kind: "notTable" };
}

/**
 * The tableToSlides() source table. A string is PptxGenJS's element id, looked up in the global document, where
 * PptxGenJS looks, unless it starts with `<`: then it is
 * HTML markup, checked against `limits`, parsed into a `createDocument()` document, and its first <table> is the
 * source. A <table> element is used as it is. The element and markup forms are PdfLapas's; PptxGenJS 4.0.1 takes
 * only the id.
 */
export function findHtmlTable(source: string | HTMLTableElement, createDocument: () => Document, limits?: TableHtmlLimits): HTMLTableElement {
    if (typeof source !== "string") {
        const found = tableWithWindow(source);

        if (found.kind === "notTable") {
            throw new TypeError("tableToSlides: the element is not a <table> in a document with a window, whose computed styles are read; pass a table of the page (or of a jsdom document), its id, or its HTML");
        }

        return found.table;
    }

    if (source.trimStart().startsWith("<")) {
        checkTableHtmlLimits(source, limits);
        const document = createDocument();

        if (!document.defaultView) {
            throw new Error("tableToSlides: parsing an HTML string needs a document with a window to read computed styles, and createDocument() made one without (a browser's createHTMLDocument()); insert the table into the page and pass the element or its id, or pass a createDocument option");
        }

        document.body.innerHTML = source;
        const found = tableWithWindow(document.querySelector("table"));

        if (found.kind === "notTable") {
            throw new Error("tableToSlides: the HTML string has no <table> element");
        }

        return found.table;
    }

    const globalDocument = (globalThis as { document?: Document }).document;
    const found = tableWithWindow(globalDocument?.getElementById(source));

    if (found.kind === "notTable") {
        throw new Error(`tableToSlides: Table ID "${source}" does not exist! Put the table in the global document, or pass the <table> element or its HTML`);
    }

    return found.table;
}

export function normalizeHtmlTable(element: HTMLTableElement, options: PptxGenJS.TableToSlidesProps, pageSize: PageSize): NormalizedHtmlTable {
    const slideMargin = slideMarginInches(options.slideMargin);
    const outerWidth = typeof options.w === "number" ? options.w : pageSize.width;
    const usableWidth = outerWidth - slideMargin[1] - slideMargin[3];
    const tableWidthPx = cssPixels(element.style.width, inchesToPixels(usableWidth)) || inchesToPixels(usableWidth);
    const firstRow = element.querySelector("tr");
    const firstCells = firstRow ? Array.from(firstRow.cells) : [];
    const measured: number[] = [];
    const explicitWidths: Array<number | undefined> = [];
    // The first row's span, which shares the table width among cells without a width of their own.
    let firstRowSpan = 0;

    for (const item of firstCells) {
        firstRowSpan += item.colSpan;
    }

    for (const cell of firstCells) {
        const colspan = Math.max(1, cell.colSpan);
        const width = cssPixels(cell.style.width || cell.getAttribute("width"), tableWidthPx) || cssPixels(element.querySelector(`col:nth-child(${measured.length + 1})`)?.getAttribute("width"), tableWidthPx) || tableWidthPx / Math.max(1, firstRowSpan);
        const declared = Number(cell.getAttribute("data-pptx-width"));

        for (let index = 0; index < colspan; index++) {
            measured.push(width / colspan);
            explicitWidths.push(declared > 0 ? declared / colspan : undefined);
        }
    }

    let totalWidth = 0;

    for (const width of measured) {
        totalWidth += width;
    }

    const totalMeasured = totalWidth || 1;
    const columnWidths = measured.map((width, index) => explicitWidths[index] ?? Number(((usableWidth * width) / totalMeasured).toFixed(2)));

    const sectionRows = (selector: string): PptxGenJS.TableRow[] => {
        const rows: PptxGenJS.TableRow[] = [];

        for (const row of Array.from(element.querySelectorAll<HTMLTableRowElement>(selector))) {
            const cells: PptxGenJS.TableCell[] = [];

            for (const cell of Array.from(row.cells)) {
                // The cell's text: its text nodes, a <br> as a line feed, trimmed.
                const read = (node: Node): string => {
                    if (node.nodeType === node.TEXT_NODE) {
                        return node.nodeValue ?? "";
                    }

                    if (node instanceof cell.ownerDocument.defaultView!.HTMLBRElement) {
                        return "\n";
                    }

                    return Array.from(node.childNodes).map(read).join("");
                };
                const text = read(cell).trim();
                // The cell's options, from its computed style.
                const view = cell.ownerDocument.defaultView;

                if (!view) {
                    throw new Error("tableToSlides requires a document with a window");
                }

                const style = view.getComputedStyle(cell);
                const inherited = (property: string): string => {
                    let current: Element | null = cell;

                    while (current) {
                        const value = view.getComputedStyle(current).getPropertyValue(property).trim();

                        if (value && value !== "inherit" && value !== "initial") {
                            return value;
                        }

                        current = current.parentElement;
                    }

                    return "";
                };
                const fontWeight = inherited("font-weight");
                const fontFamily = inherited("font-family");
                const fontSize = inherited("font-size");
                const background = style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)" ? "FFFFFF" : colorValue(style.backgroundColor);
                const options: PptxGenJS.TableCellProps = {
                    bold: fontWeight === "bold" || Number(fontWeight) >= 500,
                    color: colorValue(inherited("color")),
                    fill: { color: background },
                    fontFace: fontFamily.split(",")[0]?.replaceAll('"', "").trim() || undefined,
                    // PptxGenJS copies the numeric CSS px value directly into its point API.
                    fontSize: parseFloat(fontSize) || undefined,
                    colspan: cell.colSpan > 1 ? cell.colSpan : undefined,
                    rowspan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
                };
                const align = style.textAlign === "start" ? "left" : style.textAlign === "end" ? "right" : style.textAlign;

                if (align === "left" || align === "center" || align === "right") {
                    options.align = align;
                }

                if (style.verticalAlign === "top" || style.verticalAlign === "middle" || style.verticalAlign === "bottom") {
                    options.valign = style.verticalAlign;
                }

                if (style.paddingLeft) {
                    options.margin = mapSides([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], value => Math.round(parseFloat(value) || 0));
                }

                const borderSides = ["top", "right", "bottom", "left"] as const;

                options.border = borderSides.map(side => ({
                    type: style.getPropertyValue(`border-${side}-style`) === "dashed" ? "dash" : style.getPropertyValue(`border-${side}-style`) === "none" ? "none" : "solid",
                    pt: Math.round(parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0),
                    color: colorValue(style.getPropertyValue(`border-${side}-color`)),
                })) as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps];
                cells.push({ text, options });
            }

            rows.push(cells);
        }

        return rows;
    };
    const head = sectionRows(":scope > thead > tr");
    const body = sectionRows(":scope > tbody > tr");
    const foot = sectionRows(":scope > tfoot > tr");
    const unsectioned = head.length || body.length || foot.length ? [] : sectionRows(":scope > tr");

    element.dataset.puppeteerGenSource = "true";

    return {
        rows: [...head, ...body, ...foot, ...unsectioned],
        headerRows: head.length,
        columnWidths,
        x: typeof options.x === "number" ? options.x : slideMargin[3],
        y: typeof options.y === "number" ? options.y : slideMargin[0],
        continuationY: options.autoPageSlideStartY ?? options.newSlideStartY ?? slideMargin[0],
        slideMargin,
    };
}
