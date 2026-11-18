import type PptxGenJS from "pptxgenjs";
import { DEFAULT_RENDERING_TARGET, PPTX_DEFAULTS, RENDERING_TARGETS, type RenderingTarget } from "#src/defaults";
import type { NormalizedTable, NormalizedTableBorder } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";
import { convertToPixels, inchesToPixels, millimetersToPixels, pointsToPixels } from "#src/units";
import { tableMarginPixels } from "#src/normalize/margin";
import { normalizeColor, normalizeFill } from "#src/normalize/style";
import { normalizeText, type TextInput } from "#src/normalize/text";

const INHERITED_CELL_OPTIONS = ["align", "bold", "border", "color", "fill", "fontFace", "fontSize", "margin", "textDirection", "underline", "valign"] as const;

function span(value?: number): number {
    return Number.isFinite(value) && value! > 1 ? Math.floor(value!) : 1;
}

function columnCount(rows: PptxGenJS.TableRow[]): number {
    const firstRow = rows[0] ?? [];
    return Math.max(
        1,
        firstRow.reduce((total, cell) => {
            if (typeof cell !== "object" || cell === null) return total + 1;
            return total + span(cell.options?.colspan);
        }, 0),
    );
}

function tableWidthAndColumns(count: number, options: PptxGenJS.TableProps, pageSize: PageSize): { width: number; columns: number[] } {
    const defaultWidth = inchesToPixels(Math.floor(pageSize.width - PPTX_DEFAULTS.slide.marginIn * 2));
    const widths = Array.isArray(options.colW) ? options.colW : undefined;
    const repeatedWidth = typeof options.colW === "number" ? options.colW : widths?.length === 1 && count > 1 ? widths[0] : undefined;

    // PptxGenJS 4.0.1 floors the total inch width for scalar/single-item colW.
    if (repeatedWidth !== undefined) {
        const width = inchesToPixels(Math.floor(repeatedWidth * count));
        return { width, columns: Array(count).fill(width / count) };
    }
    if (widths?.length === count) {
        const columns = widths.map(inchesToPixels);
        return { width: columns.reduce((sum, width) => sum + width, 0), columns };
    }

    const width = options.w === undefined ? defaultWidth : convertToPixels(options.w, inchesToPixels(pageSize.width));
    return { width, columns: Array(count).fill(width / count) };
}

function rowHeights(rowCount: number, options: PptxGenJS.TableProps, pageSize: PageSize): Array<number | undefined> {
    const heightFromTable = options.h === undefined ? undefined : convertToPixels(options.h, inchesToPixels(pageSize.height)) / Math.max(1, rowCount);
    if (Array.isArray(options.rowH)) {
        const rowHeights = options.rowH;
        return Array.from({ length: rowCount }, (_, index) => {
            const height = rowHeights[index];
            return typeof height === "number" && height > 0 ? inchesToPixels(height) : heightFromTable;
        });
    }
    if (typeof options.rowH === "number" && options.rowH > 0) {
        return Array(rowCount).fill(inchesToPixels(options.rowH));
    }
    if (options.h !== undefined) {
        return Array(rowCount).fill(heightFromTable);
    }
    return Array(rowCount).fill(undefined);
}

// PptxGenJS 4.0.1 (addTableDefinition) gives a missing side { type: "none" } and fills a given one from
// DEF_CELL_BORDER with `||`: `{ color, pt }` is a solid line.
function normalizeBorder(border?: PptxGenJS.BorderProps): NormalizedTableBorder {
    const type = border ? border.type || PPTX_DEFAULTS.border.whenProvidedType : PPTX_DEFAULTS.table.border.type;
    const width = type === "none" ? 0 : pointsToPixels(border?.pt ?? PPTX_DEFAULTS.table.border.widthPt);
    return {
        visible: type !== "none",
        // A "none" side is written as <a:noFill/> without its color, so PptxGenJS never checks that color either.
        color: type === "none" ? "transparent" : normalizeColor(border?.color || PPTX_DEFAULTS.table.border.color),
        width,
        style: type === "dash" ? "dashed" : "solid",
        // PptxGenJS 4.0.1 writes a "dash" cell border as <a:prstDash val="sysDash"/>.
        ...(type === "dash" && width > 0 ? { dashArray: PPTX_DEFAULTS.shape.dashPatterns.sysDash?.map(part => part * width).join(" ") } : {}),
    };
}

function normalizeBorders(border?: PptxGenJS.BorderProps | [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps]): [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder] {
    const sides = Array.isArray(border) ? border : [border, border, border, border];
    return sides.map(side => normalizeBorder(side)) as [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder];
}

// PptxGenJS 4.0.1 genXmlTextBody (STEP 4 A) gives a run without options the cell's own options object
// (`itext.options || opts`), so those runs share one record that carries the cell's `align` (normalizeText).
function richText(input: PptxGenJS.TableCell[], cellOptions: PptxGenJS.TextPropsOptions): PptxGenJS.TextProps[] {
    return input.flatMap(cell => {
        const value = cell.text ?? "";
        if (Array.isArray(value)) return richText(value, cellOptions);
        // `as`: a run in a cell takes the same text options as an addText() run.
        return [{ text: String(value), options: (cell.options as PptxGenJS.TextPropsOptions | undefined) ?? cellOptions }];
    });
}

function inheritedCellOptions(table: PptxGenJS.TableProps, cell: PptxGenJS.TableCellProps): PptxGenJS.TableCellProps {
    const inherited: Record<string, unknown> = { ...cell };
    for (const name of INHERITED_CELL_OPTIONS) {
        if (inherited[name] === undefined && table[name] !== undefined) inherited[name] = table[name];
    }
    if (inherited.fontSize === undefined) inherited.fontSize = PPTX_DEFAULTS.table.fontSizePt;
    if (inherited.valign === undefined) inherited.valign = PPTX_DEFAULTS.table.valign;
    if (inherited.margin === undefined) inherited.margin = PPTX_DEFAULTS.table.marginIn;
    // PptxGenJS writes no color for an uncolored linked cell, so it takes the theme's hyperlink color (LibreOffice).
    if (inherited.color === undefined && !inherited.hyperlink) inherited.color = PPTX_DEFAULTS.table.color;
    return inherited as PptxGenJS.TableCellProps;
}

/**
 * PptxGenJS 4.0.1 accepts a plain string or number as a table cell at runtime, although `TableRow` lists only cell
 * objects: addTableDefinition (step 2, "B") turns it into a cell `{ text: cell.toString() }` with no options of its
 * own, before rendering and before getSlidesForTableRows paginates it, so it inherits the table options like an
 * object cell does. A `null` or `undefined` cell makes that step throw (it reads `cell.options` or `cell.text`), so it is
 * rejected here, at `rows[row][column]`, instead of being drawn as the text "null".
 */
export function tableCell(cell: PptxGenJS.TableCell | string | number | null | undefined, row: number, column: number): PptxGenJS.TableCell {
    if (cell === null || cell === undefined) {
        throw new Error(`addTable: rows[${row}][${column}] is ${cell}. PptxGenJS 4.0.1 fails on a missing cell; pass "" or { text: "" } for an empty cell.`);
    }
    return typeof cell === "object" ? cell : { text: String(cell) };
}

export function normalizeTable(tableRows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize, target: RenderingTarget = DEFAULT_RENDERING_TARGET): NormalizedTable {
    if (!Array.isArray(tableRows) || tableRows.length === 0) {
        throw new Error("addTable: tableRows must be a non-empty array");
    }
    if (!Array.isArray(tableRows[0])) throw new Error("addTable: each row must be an array of cells");

    const count = columnCount(tableRows);
    const { width, columns } = tableWidthAndColumns(count, options, pageSize);
    const heights = rowHeights(tableRows.length, options, pageSize);
    // PptxGenJS 4.0.1 genXmlTable (step 4 A) writes `h` into the rows only without `rowH`; otherwise `h` is just the
    // frame's `cy`, which PowerPoint and LibreOffice ignore: a table is as tall as its rows (#246).
    const height = heights.reduce<number | undefined>((sum, row) => (sum === undefined || row === undefined ? undefined : sum + row), 0);
    const { contentRowSlackMm } = RENDERING_TARGETS[target];

    return {
        width,
        height,
        columns,
        ...(contentRowSlackMm ? { contentRowSlack: millimetersToPixels(contentRowSlackMm) } : {}),
        rows: tableRows.map((row, rowIndex) => ({
            height: heights[rowIndex],
            cells: row.map((rawCell, column) => {
                const cell = tableCell(rawCell, rowIndex, column);
                const cellOptions = inheritedCellOptions(options, cell.options ?? {});
                // `as`: a cell names its text options as addText() does, except `textDirection`, which addText() calls `vert`.
                const textOptions = { ...cellOptions, vert: cellOptions.textDirection } as unknown as PptxGenJS.TextPropsOptions;
                const input: TextInput = Array.isArray(cell.text) ? richText(cell.text, textOptions) : String(cell.text ?? "");
                const text = normalizeText(input, textOptions, target);
                text.margin = tableMarginPixels(cellOptions.margin);
                // PptxGenJS 4.0.1 writes `fit` (and `shrinkText`, `autoFit`) only into a text box's <a:bodyPr>
                // (genXmlBodyProperties); a cell gets a bare <a:bodyPr/>, so its row grows to the text instead.
                text.fit = "none";
                return {
                    text,
                    colspan: span(cellOptions.colspan),
                    rowspan: span(cellOptions.rowspan),
                    fill: cellOptions.fill ? normalizeFill(cellOptions.fill) : undefined,
                    borders: normalizeBorders(cellOptions.border),
                };
            }),
        })),
    };
}
