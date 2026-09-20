import type PptxGenJS from "pptxgenjs";
import { type FourSideMargin, PPTX_DEFAULTS } from "../defaults";
import type { PageSize } from "../pageLayouts";
import { normalizeTable } from "./table";

export interface PaginatedTablePage {
    rows: PptxGenJS.TableRow[];
    rowHeights: number[];
    y: number;
}

interface TextPiece {
    text: string;
    options?: PptxGenJS.TableCellProps;
}

const LINE_HEIGHT_MODIFIER = 1.67;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function cellValue(cell: PptxGenJS.TableCell): string | PptxGenJS.TableCell[] {
    return cell.text ?? "";
}

function inputPieces(cell: PptxGenJS.TableCell): TextPiece[] {
    const value = cellValue(cell);
    if (!Array.isArray(value)) return [{ text: String(value).trim(), options: cell.options }];
    return value.flatMap(part => {
        const nested = cellValue(part);
        if (Array.isArray(nested)) return inputPieces(part);
        return [{ text: String(nested), options: part.options }];
    });
}

function wrappedLines(cell: PptxGenJS.TableCell, columnWidth: number, table: PptxGenJS.TableProps): TextPiece[][] {
    const fontSize = cell.options?.fontSize ?? table.fontSize ?? PPTX_DEFAULTS.table.fontSizePt;
    const characterWeight = table.autoPageCharWeight ?? PPTX_DEFAULTS.table.autoPageCharWeight;
    const charactersPerLine = Math.max(1, Math.floor((columnWidth * 72) / (fontSize / (2.3 + characterWeight))));
    const explicitLines: TextPiece[][] = [];
    let current: TextPiece[] = [];

    for (const piece of inputPieces(cell)) {
        const hardLines = piece.text.replace(/\r\n?/g, "\n").split("\n");
        hardLines.forEach((text, index) => {
            current.push({ text, options: piece.options });
            if (index < hardLines.length - 1 || piece.options?.breakLine) {
                explicitLines.push(current);
                current = [];
            }
        });
        // PptxGenJS 4.0.1 flushes each rich-text table piece here.
        if (current.length) {
            explicitLines.push(current);
            current = [];
        }
    }
    if (!explicitLines.length) explicitLines.push([{ text: "", options: cell.options }]);

    const result: TextPiece[][] = [];
    for (const line of explicitLines) {
        let output: TextPiece[] = [];
        let length = 0;
        for (const piece of line) {
            const words = piece.text.split(" ");
            words.forEach((word, index) => {
                const text = word + (index + 1 < words.length ? " " : "");
                if (output.length && length + text.length > charactersPerLine) {
                    result.push(output);
                    output = [];
                    length = 0;
                }
                output.push({ text, options: piece.options });
                length += text.length;
            });
        }
        if (output.length) result.push(output);
    }
    return result.length ? result : [[{ text: "", options: cell.options }]];
}

function marginInches(margin?: number | FourSideMargin): FourSideMargin {
    const values = margin === undefined ? ([...PPTX_DEFAULTS.table.marginIn] as FourSideMargin) : typeof margin === "number" ? [margin, margin, margin, margin] : margin;
    return values[0]! >= 1 ? (values.map(value => value / 72) as FourSideMargin) : ([...values] as FourSideMargin);
}

function rowMargin(row: PptxGenJS.TableRow, table: PptxGenJS.TableProps): number {
    let top = 0;
    let bottom = 0;
    for (const cell of row) {
        // PptxGenJS 4.0.1's paginator indexes cell margins as arrays, so a
        // scalar cell margin falls through to the normalized table margin.
        const cellMargin = Array.isArray(cell.options?.margin) ? cell.options.margin : table.margin;
        const [cellTop, , cellBottom] = marginInches(cellMargin as number | FourSideMargin | undefined);
        top = Math.max(top, cellTop);
        bottom = Math.max(bottom, cellBottom);
    }
    return top + bottom;
}

function lineHeight(row: PptxGenJS.TableRow, table: PptxGenJS.TableProps): number {
    const weight = clamp(table.autoPageLineWeight ?? PPTX_DEFAULTS.table.autoPageLineWeight, -1, 1);
    return row.reduce((height, cell) => {
        if (cell.options?.rowspan) return height;
        const fontSize = cell.options?.fontSize ?? table.fontSize ?? PPTX_DEFAULTS.table.fontSizePt;
        return Math.max(height, (fontSize * (LINE_HEIGHT_MODIFIER + weight)) / 100);
    }, 0);
}

function cellFromLines(cell: PptxGenJS.TableCell, lines: TextPiece[][]): PptxGenJS.TableCell {
    const pieces: PptxGenJS.TableCell[] = [];
    lines.forEach((line, lineIndex) => {
        line.forEach((piece, pieceIndex) => {
            const isLastPiece = pieceIndex === line.length - 1;
            pieces.push({
                text: piece.text,
                options: {
                    ...piece.options,
                    breakLine: lineIndex + 1 < lines.length && isLastPiece ? true : piece.options?.breakLine,
                },
            });
        });
    });
    return { text: pieces, options: cell.options };
}

function cloneRows(rows: PptxGenJS.TableRow[]): PptxGenJS.TableRow[] {
    return rows.map(row => row.map(cell => ({ ...cell, options: cell.options ? { ...cell.options } : undefined })));
}

export function paginateTableRows(rows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize): PaginatedTablePage[] {
    if (!rows.length) return [];
    const normalized = normalizeTable(rows, options, pageSize);
    const extendedOptions = options as PptxGenJS.TableProps & { slideMargin?: PptxGenJS.Margin };
    const pageMargins = marginInches(extendedOptions.slideMargin ?? PPTX_DEFAULTS.slide.marginIn);
    const verticalInches = (value: number | `${number}%` | undefined, fallback: number): number => {
        if (typeof value === "number") return value;
        if (typeof value === "string" && value.endsWith("%")) return (parseFloat(value) / 100) * pageSize.height;
        return fallback;
    };
    const continuationY = options.autoPageSlideStartY ?? options.newSlideStartY ?? pageMargins[0];
    const firstY = verticalInches(options.y, pageMargins[0]);
    const bottomMargin = pageMargins[2];
    const heightLimit = verticalInches(options.h, pageSize.height);
    const firstAvailable = Math.max(0, heightLimit - firstY - bottomMargin);
    const continuationAvailable = Math.max(0, heightLimit - continuationY - bottomMargin);
    const headerCount = options.autoPageRepeatHeader ? Math.max(1, Math.floor(options.autoPageHeaderRows ?? PPTX_DEFAULTS.table.autoPageHeaderRows)) : 0;
    const headers = cloneRows(rows.slice(0, headerCount));
    const rowMetrics = (row: PptxGenJS.TableRow): { lines: TextPiece[][][]; cycles: number; lineHeight: number; margin: number } => {
        const widths: number[] = [];
        let column = 0;
        row.forEach(cell => {
            const colspan = Math.max(1, Math.floor(cell.options?.colspan ?? 1));
            widths.push(normalized.columns.slice(column, column + colspan).reduce((sum, width) => sum + width, 0) / 96);
            column += colspan;
        });
        const lines = row.map((cell, index) => wrappedLines(cell, widths[index] ?? normalized.width / 96, options));
        return {
            lines,
            cycles: Math.max(1, ...lines.map(cellLines => cellLines.length)),
            lineHeight: lineHeight(row, options),
            margin: rowMargin(row, options),
        };
    };
    const headerHeights = headers.map(row => {
        const metrics = rowMetrics(row);
        return metrics.margin + metrics.cycles * metrics.lineHeight;
    });
    const pages: PaginatedTablePage[] = [{ rows: [], rowHeights: [], y: firstY }];
    let used = 0;

    const startContinuation = (): void => {
        pages.push({ rows: cloneRows(headers), rowHeights: [...headerHeights], y: continuationY });
        // PptxGenJS 4.0.1 repeats headers after calculating the continuation
        // capacity and does not subtract their height from its heuristic.
        used = 0;
    };

    rows.forEach(row => {
        const { lines, cycles, lineHeight: perLine, margin: margins } = rowMetrics(row);
        const available = () => (pages.length === 1 ? firstAvailable : continuationAvailable);

        // Preserve the caller's exact cell data when the row fits as-is.
        if (used + margins + cycles * perLine <= available()) {
            pages.at(-1)!.rows.push(row);
            pages.at(-1)!.rowHeights.push(margins + cycles * perLine);
            used += margins + cycles * perLine;
            return;
        }

        let firstLine = 0;
        while (firstLine < cycles) {
            if (used + margins + perLine > available() && pages.at(-1)!.rows.length > (pages.length === 1 ? 0 : headers.length)) {
                startContinuation();
            }
            const capacity = perLine > 0 ? Math.max(1, Math.floor((available() - used - margins) / perLine)) : cycles - firstLine;
            const count = Math.min(capacity, cycles - firstLine);
            const fragment = row.map((cell, index) => cellFromLines(cell, lines[index]!.slice(firstLine, firstLine + count)));
            pages.at(-1)!.rows.push(fragment);
            pages.at(-1)!.rowHeights.push(margins + count * perLine);
            used += margins + count * perLine;
            firstLine += count;
            if (firstLine < cycles) startContinuation();
        }
    });
    return pages;
}
