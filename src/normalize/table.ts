import type PptxGenJS from "pptxgenjs";
import { type FourSideMargin, PPTX_DEFAULTS } from "../defaults";
import type { NormalizedTable, NormalizedTableBorder } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels, inchesToPixels, pointsToPixels } from "../utils";
import { normalizeColor, normalizeFill } from "./style";
import { normalizeText, type TextInput } from "./text";

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

function normalizeTableMargins(margin?: number | FourSideMargin): [number, number, number, number] {
    const values =
        margin === undefined ? ([...PPTX_DEFAULTS.table.marginIn] as FourSideMargin) : typeof margin === "number" ? [margin, margin, margin, margin] : margin;
    const convert = values[0]! >= 1 ? pointsToPixels : inchesToPixels;
    return values.map(convert) as [number, number, number, number];
}

function normalizeBorder(border?: PptxGenJS.BorderProps): NormalizedTableBorder {
    const type = border?.type ?? PPTX_DEFAULTS.table.border.type;
    return {
        visible: type !== "none",
        color: normalizeColor(border?.color ?? PPTX_DEFAULTS.table.border.color),
        width: type === "none" ? 0 : pointsToPixels(border?.pt ?? PPTX_DEFAULTS.table.border.widthPt),
        style: type === "dash" ? "dashed" : "solid",
    };
}

function normalizeBorders(
    border?: PptxGenJS.BorderProps | [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps],
): [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder] {
    const sides = Array.isArray(border) ? border : [border, border, border, border];
    return sides.map(side => normalizeBorder(side)) as [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder];
}

function richText(input: PptxGenJS.TableCell[]): PptxGenJS.TextProps[] {
    return input.flatMap(cell => {
        const value = cell.text ?? "";
        if (Array.isArray(value)) return richText(value);
        return [{ text: String(value), options: cell.options as PptxGenJS.TextPropsOptions }];
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
    if (inherited.color === undefined) inherited.color = PPTX_DEFAULTS.table.color;
    return inherited as PptxGenJS.TableCellProps;
}

export function normalizeTable(tableRows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize): NormalizedTable {
    if (!Array.isArray(tableRows) || tableRows.length === 0) {
        throw new Error("addTable: tableRows must be a non-empty array");
    }
    if (!Array.isArray(tableRows[0])) throw new Error("addTable: each row must be an array of cells");

    const count = columnCount(tableRows);
    const { width, columns } = tableWidthAndColumns(count, options, pageSize);
    const heights = rowHeights(tableRows.length, options, pageSize);
    const explicitHeight =
        options.h === undefined
            ? heights.every(height => height !== undefined)
                ? heights.reduce<number>((sum, height) => sum + height!, 0)
                : undefined
            : convertToPixels(options.h, inchesToPixels(pageSize.height));

    return {
        width,
        height: explicitHeight,
        columns,
        rows: tableRows.map((row, rowIndex) => ({
            height: heights[rowIndex],
            cells: row.map(rawCell => {
                const cell = typeof rawCell === "object" && rawCell !== null ? rawCell : ({ text: String(rawCell) } as PptxGenJS.TableCell);
                const cellOptions = inheritedCellOptions(options, cell.options ?? {});
                const input: TextInput = Array.isArray(cell.text) ? richText(cell.text) : String(cell.text ?? "");
                const textOptions = { ...cellOptions, vert: cellOptions.textDirection } as unknown as PptxGenJS.TextPropsOptions;
                const text = normalizeText(input, textOptions);
                text.margin = normalizeTableMargins(cellOptions.margin as number | FourSideMargin | undefined);
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
