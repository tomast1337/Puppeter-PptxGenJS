import type PptxGenJS from "pptxgenjs";
import { PPTX_DEFAULTS } from "#src/defaults";
import type { PageSize } from "#src/pageLayouts";
import { pixelsToInches, pointsToInches } from "@pdflapas/model";
import { convertToInches } from "#src/units";
import { slideMarginInches } from "#src/normalize/margin";
import { addTableLeavesNoWidth, columnCount, normalizeTable, tableCell, tableRow } from "./index";

export type PaginatedTablePage = {
    rows: PptxGenJS.TableRow[];
    y: number;
};

type TextPiece = {
    text: string;
    options?: PptxGenJS.TableCellProps;
};

const LINE_HEIGHT_MODIFIER = 1.67;

// --- UTILITIES ---

/** getSlidesForTableRows reads the table `y` and `h` through getSmartParseNumber: a number of 100 or more is EMU. */
function verticalInches(value: number | `${number}%` | undefined, fallback: number, pageHeight: number): number {
    return value === undefined ? fallback : convertToInches(value, pageHeight);
}

function cloneRows(rows: PptxGenJS.TableRow[]): PptxGenJS.TableRow[] {
    return rows.map(row => row.map(cell => ({ ...cell, options: cell.options ? { ...cell.options } : undefined })));
}

/**
 * getSlidesForTableRows (step 6 E, 4) draws every row, split or not, from its parsed words: the lines are concatenated
 * with no break between them (only a piece's own `breakLine` ends a paragraph), and a cell left without words gets one
 * empty run. So `"Hello " + "world"` reads `Helloworld` and a non-string run is gone, as in the slide XML.
 */
function cellFromLines(cell: PptxGenJS.TableCell, lines: TextPiece[][]): PptxGenJS.TableCell {
    const pieces = lines.flat();

    return { text: pieces.length ? pieces : [{ text: "" }], options: cell.options };
}

// --- PAGINATION ---

/**
 * The options addTableDefinition hands each autoPage table. When it leaves no `w` (addTableLeavesNoWidth),
 * getSlidesForTableRows (step 5) gives every column `((x || right margin) + left margin) / columns` inches, 1/3in each
 * over 3 columns by default, and every page keeps that `colW`.
 */
export function autoPageTableOptions(rows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize): PptxGenJS.TableProps {
    const count = columnCount(rows);

    if (!addTableLeavesNoWidth(count, options)) {
        return options;
    }

    const [, rightMargin, , leftMargin] = slideMarginInches((options as PptxGenJS.TableProps & { slideMargin?: PptxGenJS.Margin }).slideMargin);
    const x = options.x === undefined ? 0 : convertToInches(options.x, pageSize.width);

    return { ...options, colW: Array<number>(count).fill(((x || rightMargin) + leftMargin) / count) };
}

export function paginateTableRows(inputRows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize): PaginatedTablePage[] {
    if (!inputRows.length) {
        return [];
    }

    const rows = inputRows.map((row, rowIndex) => tableRow(row, rowIndex).map((cell, column) => tableCell(cell, rowIndex, column)));

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
        // getSlidesForTableRows (E-3) reads `colW` at the cell's index, not its column, and for any `colspan` adds every
        // width from that index to the end (its `idx < idx + colspan` is always true).
        const widths = row.map((cell, index) => {
            const columns = normalized.columns.slice(index, cell.options?.colspan ? undefined : index + 1);
            let total = 0;

            for (const width of columns) {
                total += width;
            }

            return columns.length ? pixelsToInches(total) : undefined;
        });
        // The lines getSlidesForTableRows counts for each cell; without a column width (a cell past the last column) it
        // never wraps.
        const lines = row.map((cell, index) => {
            const columnWidth = widths[index];
            // PptxGenJS 4.0.1 parseTextToLines sizes characters per line from the cell's own fontSize or DEF_FONT_SIZE, never
            // the table fontSize (unlike the line height), and floors only the width in points: CPL = floor(w pt) / (size / FOCO).
            const fontSize = cell.options?.fontSize || PPTX_DEFAULTS.table.fontSizePt;
            const characterWeight = options.autoPageCharWeight ?? PPTX_DEFAULTS.table.autoPageCharWeight;
            const widthPoints = columnWidth === undefined ? Number.NaN : Math.floor((columnWidth / PPTX_DEFAULTS.units.emuPerPoint) * PPTX_DEFAULTS.units.emuPerInch);
            const charactersPerLine = widthPoints / (fontSize / (PPTX_DEFAULTS.table.autoPageCharConstant + characterWeight));
            // PptxGenJS 4.0.1 parseTextToLines (steps 1 and 2): the cell's text as pieces that each start a line. A string
            // or number is trimmed. In rich text each run starts a line of its own: a run whose `text` is not a string adds
            // nothing, a run without a line feed is trimmed, and a run with line feeds is split, untrimmed, into pieces that
            // each end with a break.
            const text: unknown = cell.text;
            const runs: ReadonlyArray<{ text?: unknown; options?: PptxGenJS.TableCellProps }> = text && String(text).trim().length === 0 ? [{ text: " " }] : typeof text === "string" || typeof text === "number" ? [{ text: String(text).trim() }] : Array.isArray(text) ? text : [];
            const pieces = runs.flatMap((run): TextPiece[] => {
                if (typeof run.text !== "string") {
                    return [];
                }

                const runLines = run.text.split("\n");

                return runLines.length > 1 ? runLines.map(line => ({ text: line, options: { ...run.options, breakLine: true } })) : [{ text: run.text.trim(), options: run.options }];
            });
            const cellLines: TextPiece[][] = [];

            // parseTextToLines (steps 3 and 4): a piece's words, starting a new line whenever the next word would pass
            // `charactersPerLine`. The check runs before the first word too, so a first word longer than a line leaves an
            // empty line in front of it. A piece that ends with a break keeps the break on its last word only.
            for (const piece of pieces) {
                const words = piece.text.split(" ");
                let line: TextPiece[] = [];
                let length = 0;

                for (const [wordIndex, word] of words.entries()) {
                    const last = wordIndex + 1 === words.length;
                    const wordText = last ? word : `${word} `;

                    if (length + wordText.length > charactersPerLine) {
                        cellLines.push(line);
                        line = [];
                        length = 0;
                    }

                    line.push({ text: wordText, options: piece.options?.breakLine ? { ...piece.options, breakLine: last } : piece.options });
                    length += wordText.length;
                }

                if (line.length) {
                    cellLines.push(line);
                }
            }

            return cellLines;
        });
        const cycles = Math.max(1, ...lines.map(cellLines => cellLines.length));
        const weight = Math.min(1, Math.max(-1, options.autoPageLineWeight ?? PPTX_DEFAULTS.table.autoPageLineWeight));
        let perLine = 0;

        for (const cell of row) {
            if (cell.options?.rowspan) {
                continue;
            }

            // getSlidesForTableRows (D) skips a falsy cell or table fontSize.
            const fontSize = cell.options?.fontSize || options.fontSize || PPTX_DEFAULTS.table.fontSizePt;

            perLine = Math.max(perLine, (fontSize * (LINE_HEIGHT_MODIFIER + weight)) / 100);
        }

        // Top plus bottom cell margin as getSlidesForTableRows counts it, in inches. getSlidesForTableRows (step 6B) picks
        // points or inches from the cell's own margin array only (`margin[0] >= 1` is points) and applies that unit to the
        // table margin too. A cell without a margin array (none, or a number) therefore reads the table margin as inches
        // whatever its size, unlike the drawn cell (genXmlTextBody), which reads a table margin of 1 or more as points. Per
        // side, the row keeps the largest of each cell's side and, whenever that side is missing, 0 or not larger than the
        // largest so far (the `else if`), the table's side.
        // addTableDefinition: a number is all four sides, unset is DEF_CELL_MARGIN_IN.
        const tableSides = options.margin === undefined ? PPTX_DEFAULTS.table.marginIn : typeof options.margin === "number" ? [options.margin, options.margin, options.margin, options.margin] : options.margin;
        let top = 0;
        let bottom = 0;

        for (const cell of row) {
            const own = Array.isArray(cell.options?.margin) ? cell.options.margin : undefined;
            const toInches = own && own[0] >= 1 ? pointsToInches : (value: number) => value;
            const side = (index: 0 | 2, largest: number): number => {
                const cellSide = toInches(own?.[index] ?? 0);

                return cellSide > largest ? cellSide : Math.max(largest, toInches(tableSides[index] ?? 0));
            };

            top = side(0, top);
            bottom = side(2, bottom);
        }

        const margins = top + bottom;
        const available = () => (pages.length === 1 ? firstAvailable : pages.length === 2 ? secondAvailable : laterAvailable);
        const rowHeight = margins + cycles * perLine;
        // getSlidesForTableRows (step 6, E-5) adds a line cycle to the used height only when it reaches the row's last
        // cell, and stops once every cell is out of lines: when the last cell is shorter than the tallest one, the row's
        // final line fits on the page but is left out of the used height.
        const uncounted = (lines.at(-1)?.length ?? 0) < cycles ? perLine : 0;

        if (used + rowHeight <= available()) {
            pages.at(-1)!.rows.push(row.map((cell, index) => cellFromLines(cell, lines[index] ?? [])));
            used += rowHeight - uncounted;
            continue;
        }

        // getSlidesForTableRows (step 6, E/F): a new slide resets the used height to 0 right after adding the row's cell
        // margins, so the margins count only on the page the row starts on, not on the page it moves or continues to.
        let countedMargins = margins;
        let firstLine = 0;

        while (firstLine < cycles) {
            if (used + countedMargins + perLine > available()) {
                if (pages.length === 1 && !pages[0]!.rows.length) {
                    // getSlidesForTableRows leaves the first slide empty when the first row's cell margins and one line do
                    // not fit below the table `y`, and addTableDefinition then throws `addTable: Array expected!`. That
                    // happens to a table-level margin of 1 or more, which the drawn cell reads as points but the pagination
                    // reads as inches (6 is 12in of margins).
                    const inches = (value: number) => `${Number(value.toFixed(3))}in`;

                    throw new Error(
                        `addTable autoPage: the first row needs ${inches(margins + perLine)} (top and bottom cell margins ${inches(margins)} plus one line) but the first slide leaves ${inches(firstAvailable)} below the table y, so PptxGenJS 4.0.1 throws "addTable: Array expected!" here. Move the table up, or lower the cell margins: autoPage reads a table-level \`margin\` as inches whatever its size, so give points per cell (options.margin: [6, 4, 6, 4]) or a table-level margin below 1 in inches.`,
                    );
                }

                if (pages.at(-1)!.rows.length > (pages.length === 1 ? 0 : headers.length)) {
                    startContinuation();
                    countedMargins = 0;
                }
            }

            const capacity = perLine > 0 ? Math.max(1, Math.floor((available() - used - countedMargins) / perLine)) : cycles - firstLine;
            const count = Math.min(capacity, cycles - firstLine);
            // `lines` is `row.map(...)` above, so every cell index has an entry.
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
