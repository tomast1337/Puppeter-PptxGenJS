import type PptxGenJS from "pptxgenjs";
import type { FourSideMargin } from "../defaults";
import type { PageSize } from "../pageLayouts";

export interface NormalizedHtmlTable {
    rows: PptxGenJS.TableRow[];
    headerRows: number;
    columnWidths: number[];
    x: number;
    y: number;
    continuationY: number;
    slideMargin: FourSideMargin;
}

function cssPixels(value: string | null | undefined, relativeTo: number): number {
    const source = value?.trim();
    if (!source || source === "auto") return 0;
    const amount = parseFloat(source);
    if (!Number.isFinite(amount)) return 0;
    if (source.endsWith("%")) return relativeTo * amount / 100;
    if (source.endsWith("in")) return amount * 96;
    if (source.endsWith("pt")) return amount * 96 / 72;
    return amount;
}

function margins(value?: PptxGenJS.Margin): FourSideMargin {
    if (Array.isArray(value)) return [...value] as FourSideMargin;
    const margin = typeof value === "number" ? value : 0.5;
    return [margin, margin, margin, margin];
}

function textContent(cell: HTMLTableCellElement): string {
    const read = (node: Node): string => {
        if (node.nodeType === node.TEXT_NODE) return node.nodeValue ?? "";
        if (node instanceof cell.ownerDocument.defaultView!.HTMLBRElement) return "\n";
        return Array.from(node.childNodes).map(read).join("");
    };
    return read(cell).trim();
}

function colorValue(value: string): string {
    if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return "FFFFFF";
    const channels = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    if (!channels) return value.replace(/^#/, "") || "000000";
    return channels.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function cellOptions(cell: HTMLTableCellElement): PptxGenJS.TableCellProps {
    const view = cell.ownerDocument.defaultView;
    if (!view) throw new Error("tableToSlides requires a document with a window");
    const style = view.getComputedStyle(cell);
    const inherited = (property: string): string => {
        let current: Element | null = cell;
        while (current) {
            const value = view.getComputedStyle(current).getPropertyValue(property).trim();
            if (value && value !== "inherit" && value !== "initial") return value;
            current = current.parentElement;
        }
        return "";
    };
    const fontWeight = inherited("font-weight");
    const fontFamily = inherited("font-family");
    const fontSize = inherited("font-size");
    const background = style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)"
        ? "FFFFFF"
        : colorValue(style.backgroundColor);
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
    if (align === "left" || align === "center" || align === "right") options.align = align;
    if (style.verticalAlign === "top" || style.verticalAlign === "middle" || style.verticalAlign === "bottom") {
        options.valign = style.verticalAlign;
    }
    if (style.paddingLeft) {
        options.margin = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
            .map(value => Math.round(parseFloat(value) || 0)) as FourSideMargin;
    }
    const borderSides = ["top", "right", "bottom", "left"] as const;
    options.border = borderSides.map(side => ({
        type: style.getPropertyValue(`border-${side}-style`) === "dashed" ? "dash" : style.getPropertyValue(`border-${side}-style`) === "none" ? "none" : "solid",
        pt: Math.round(parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0),
        color: colorValue(style.getPropertyValue(`border-${side}-color`)),
    })) as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps];
    return options;
}

export function normalizeHtmlTable(
    document: Document,
    elementId: string,
    options: PptxGenJS.TableToSlidesProps,
    pageSize: PageSize,
): NormalizedHtmlTable {
    const element = document.getElementById(elementId);
    if (!(element instanceof document.defaultView!.HTMLTableElement)) {
        throw new Error(`tableToSlides: Table ID "${elementId}" does not exist!`);
    }
    const slideMargin = margins(options.slideMargin);
    const outerWidth = typeof options.w === "number" ? options.w : pageSize.width;
    const usableWidth = outerWidth - slideMargin[1] - slideMargin[3];
    const tableWidthPx = cssPixels(element.style.width, usableWidth * 96) || usableWidth * 96;
    const firstRow = element.querySelector("tr");
    const firstCells = firstRow ? Array.from(firstRow.cells) : [];
    const measured: number[] = [];
    const explicitWidths: Array<number | undefined> = [];
    firstCells.forEach(cell => {
        const colspan = Math.max(1, cell.colSpan);
        const width = cssPixels(cell.style.width || cell.getAttribute("width"), tableWidthPx)
            || cssPixels(element.querySelector(`col:nth-child(${measured.length + 1})`)?.getAttribute("width"), tableWidthPx)
            || tableWidthPx / Math.max(1, firstCells.reduce((sum, item) => sum + item.colSpan, 0));
        const declared = Number(cell.getAttribute("data-pptx-width"));
        for (let index = 0; index < colspan; index++) {
            measured.push(width / colspan);
            explicitWidths.push(declared > 0 ? declared / colspan : undefined);
        }
    });
    const totalMeasured = measured.reduce((sum, width) => sum + width, 0) || 1;
    const columnWidths = measured.map((width, index) => explicitWidths[index] ?? Number((usableWidth * width / totalMeasured).toFixed(2)));

    const sectionRows = (selector: string): PptxGenJS.TableRow[] => Array.from(element.querySelectorAll<HTMLTableRowElement>(selector)).map(row =>
        Array.from(row.cells).map(cell => ({ text: textContent(cell), options: cellOptions(cell) })),
    );
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
