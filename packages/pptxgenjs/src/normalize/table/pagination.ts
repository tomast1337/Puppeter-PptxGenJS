import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "#src/defaults";
import type { NormalizedTable } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";
import { pixelsToInches } from "#src/units";
import { slideMarginInches, tableMarginInches } from "#src/normalize/margin";
import { normalizeTable, tableCell } from "./index";

export interface PaginatedTablePage {
    rows: PptxGenJS.TableRow[];
    y: number;
}

interface TextPiece {
    text: string;
    options?: PptxGenJS.TableCellProps;
}

const LINE_HEIGHT_MODIFIER = 1.67;

// --- UTILITIES ---

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function verticalInches(value: number | `${number}%` | undefined, fallback: number, pageHeight: number): number {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.endsWith("%")) return (parseFloat(value) / 100) * pageHeight;
    return fallback;
}

function cellValue(cell: PptxGenJS.TableCell): string | PptxGenJS.TableCell[] {
    return cell.text ?? "";
}

function cloneRows(rows: PptxGenJS.TableRow[]): PptxGenJS.TableRow[] {
    return rows.map(row => row.map(cell => ({ ...cell, options: cell.options ? { ...cell.options } : undefined })));
}

// --- TEXT PARSING & WRAPPING ---

function inputPieces(cell: PptxGenJS.TableCell): TextPiece[] {
    const value = cellValue(cell);
    if (!Array.isArray(value)) return [{ text: String(value).trim(), options: cell.options }];

    return value.flatMap(part => {
        const nested = cellValue(part);
        if (Array.isArray(nested)) return inputPieces(part);
        return [{ text: String(nested), options: part.options }];
    });
}

function splitExplicitLines(pieces: TextPiece[]): TextPiece[][] {
    const explicitLines: TextPiece[][] = [];
    let current: TextPiece[] = [];

    for (const piece of pieces) {
        const hardLines = piece.text.replace(/\r\n?/g, "\n").split("\n");
        hardLines.forEach((text, index) => {
            current.push({ text, options: piece.options });
            if (index < hardLines.length - 1 || piece.options?.breakLine) {
                explicitLines.push(current);
                current = [];
            }
        });
        if (current.length) {
            explicitLines.push(current);
            current = [];
        }
    }

    return explicitLines.length ? explicitLines : [[{ text: "", options: pieces[0]?.options }]];
}

function wrapLineToCapacity(line: TextPiece[], charactersPerLine: number): TextPiece[][] {
    const result: TextPiece[][] = [];
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
    return result;
}

function wrappedLines(cell: PptxGenJS.TableCell, columnWidth: number, table: PptxGenJS.TableProps): TextPiece[][] {
    // PptxGenJS 4.0.1 parseTextToLines sizes characters per line from the cell's own fontSize or DEF_FONT_SIZE, never
    // the table fontSize (unlike the line height), and floors only the width in points: CPL = floor(w pt) / (size / FOCO).
    const fontSize = cell.options?.fontSize || PPTX_DEFAULTS.table.fontSizePt;
    const characterWeight = table.autoPageCharWeight ?? PPTX_DEFAULTS.table.autoPageCharWeight;
    const widthPoints = Math.floor((columnWidth / PPTX_DEFAULTS.units.emuPerPoint) * PPTX_DEFAULTS.units.emuPerInch);
    const charactersPerLine = widthPoints / (fontSize / (PPTX_DEFAULTS.table.autoPageCharConstant + characterWeight));

    const pieces = inputPieces(cell);
    const explicitLines = splitExplicitLines(pieces);
    const result = explicitLines.flatMap(line => wrapLineToCapacity(line, charactersPerLine));

    return result.length ? result : [[{ text: "", options: cell.options }]];
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

// --- ROW METRICS ---

interface RowMetrics {
    lines: TextPiece[][][];
    cycles: number;
    lineHeight: number;
    margin: number;
}

function rowMargin(row: PptxGenJS.TableRow, table: PptxGenJS.TableProps): number {
    let top = 0;
    let bottom = 0;
    for (const cell of row) {
        const cellMargin = Array.isArray(cell.options?.margin) ? cell.options.margin : table.margin;
        const [cellTop, , cellBottom] = tableMarginInches(cellMargin);
        top = Math.max(top, cellTop);
        bottom = Math.max(bottom, cellBottom);
    }
    return top + bottom;
}

function calculateLineHeight(row: PptxGenJS.TableRow, table: PptxGenJS.TableProps): number {
    const weight = clamp(table.autoPageLineWeight ?? PPTX_DEFAULTS.table.autoPageLineWeight, -1, 1);
    return row.reduce((height, cell) => {
        if (cell.options?.rowspan) return height;
        const fontSize = cell.options?.fontSize ?? table.fontSize ?? PPTX_DEFAULTS.table.fontSizePt;
        return Math.max(height, (fontSize * (LINE_HEIGHT_MODIFIER + weight)) / 100);
    }, 0);
}

function calculateRowMetrics(row: PptxGenJS.TableRow, normalized: NormalizedTable, options: PptxGenJS.TableProps): RowMetrics {
    const widths: number[] = [];
    let column = 0;

    row.forEach(cell => {
        const colspan = Math.max(1, Math.floor(cell.options?.colspan ?? 1));
        const colWidth = normalized.columns.slice(column, column + colspan).reduce((sum, width) => sum + width, 0);
        widths.push(pixelsToInches(colWidth));
        column += colspan;
    });

    const lines = row.map((cell, index) => wrappedLines(cell, widths[index] ?? pixelsToInches(normalized.width), options));

    return {
        lines,
        cycles: Math.max(1, ...lines.map(cellLines => cellLines.length)),
        lineHeight: calculateLineHeight(row, options),
        margin: rowMargin(row, options),
    };
}

// --- PAGINATION ---

export function paginateTableRows(inputRows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize): PaginatedTablePage[] {
    if (!inputRows.length) return [];
    const rows = inputRows.map((row, rowIndex) => row.map((cell, column) => tableCell(cell, rowIndex, column)));

    const normalized = normalizeTable(rows, options, pageSize);
    const extendedOptions = options as PptxGenJS.TableProps & { slideMargin?: PptxGenJS.Margin };
    const [topMargin, , bottomMargin] = slideMarginInches(extendedOptions.slideMargin);
    const startY = options.autoPageSlideStartY ?? options.newSlideStartY;

    // PptxGenJS 4.0.1 addTableDefinition places continuation tables at the slide layout's margin (DEF_SLIDE_MARGIN_IN
    // without a master), not at `slideMargin`, which only sizes the pages in getSlidesForTableRows.
    const continuationY = startY ?? PPTX_DEFAULTS.slide.marginIn;
    const firstY = verticalInches(options.y, topMargin, pageSize.height);
    const heightLimit = verticalInches(options.h, pageSize.height, pageSize.height);

    const firstAvailable = Math.max(0, heightLimit - firstY - bottomMargin);
    const secondAvailable = Math.max(0, heightLimit - (startY ?? topMargin) - bottomMargin);
    // getSlidesForTableRows (calcSlideTabH, rule D): from the third page on, without a start y, a table `y` above the top
    // margin starts the page there instead, and a table `h` is the least room a page gets.
    const laterAvailable = startY === undefined && options.y !== undefined && firstY ? Math.max(0, heightLimit - Math.min(firstY, topMargin) - bottomMargin, options.h === undefined ? 0 : heightLimit) : secondAvailable;

    const headerCount = options.autoPageRepeatHeader ? Math.max(1, Math.floor(options.autoPageHeaderRows ?? PPTX_DEFAULTS.table.autoPageHeaderRows)) : 0;
    const headers = cloneRows(rows.slice(0, headerCount));

    const pages: PaginatedTablePage[] = [{ rows: [], y: firstY }];
    let used = 0;

    // Repeated headers add nothing to the used height: getSlidesForTableRows (step G) sums `_lineHeight`, which the raw
    // header cells it repeats do not carry.
    const startContinuation = (): void => {
        pages.push({ rows: cloneRows(headers), y: continuationY });
        used = 0;
    };

    for (const row of rows) {
        const { lines, cycles, lineHeight: perLine, margin: margins } = calculateRowMetrics(row, normalized, options);
        const available = () => (pages.length === 1 ? firstAvailable : pages.length === 2 ? secondAvailable : laterAvailable);
        const rowHeight = margins + cycles * perLine;
        // getSlidesForTableRows (step 6, E-5) adds a line cycle to the used height only when it reaches the row's last
        // cell, and stops once every cell is out of lines: when the last cell is shorter than the tallest one, the row's
        // final line fits on the page but is left out of the used height.
        const uncounted = (lines.at(-1)?.length ?? 0) < cycles ? perLine : 0;

        if (used + rowHeight <= available()) {
            pages.at(-1)!.rows.push(row);
            used += rowHeight - uncounted;
            continue;
        }

        // getSlidesForTableRows (step 6, E/F): a new slide resets the used height to 0 right after adding the row's cell
        // margins, so the margins count only on the page the row starts on, not on the page it moves or continues to.
        let countedMargins = margins;
        let firstLine = 0;
        while (firstLine < cycles) {
            if (used + countedMargins + perLine > available() && pages.at(-1)!.rows.length > (pages.length === 1 ? 0 : headers.length)) {
                startContinuation();
                countedMargins = 0;
            }

            const capacity = perLine > 0 ? Math.max(1, Math.floor((available() - used - countedMargins) / perLine)) : cycles - firstLine;
            const count = Math.min(capacity, cycles - firstLine);
            // `lines` is `row.map(...)` from calculateRowMetrics, so every cell index has an entry.
            const fragment = row.map((cell, index) => cellFromLines(cell, lines[index]!.slice(firstLine, firstLine + count)));

            pages.at(-1)!.rows.push(fragment);
            used += countedMargins + count * perLine;
            firstLine += count;

            if (firstLine < cycles) {
                startContinuation();
                countedMargins = 0;
            }
        }
        used -= uncounted;
    }
    return pages;
}
