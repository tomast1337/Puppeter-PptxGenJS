import type PptxGenJS from "pptxgenjs";
import { type FontMetricsLookup, PPTX_DEFAULTS } from "#src/defaults";
import { DEFAULT_RENDERING_TARGET, RENDERING_TARGETS, type RenderingTarget } from "#src/target/index";
import type { NormalizedTable, NormalizedTableBorder, NormalizedTableRow } from "@pdflapas/model";
import { builtInFontMetrics } from "#src/fontMetrics";
import type { PageSize } from "#src/pageLayouts";
import { type Px, inchesToPixels, millimetersToPixels, pointsToPixels, px } from "@pdflapas/model";
import { convertToPixels, emuToPixels, inch2EmuToPixels, smartParseEmu } from "#src/units";
import { tableMarginPixels } from "#src/normalize/margin";
import { TRANSPARENT } from "#src/color";
import { checkedSize } from "#src/normalize/size";
import { normalizeColor, normalizeFill } from "#src/normalize/style";
import type { SharedRunOptions } from "#src/normalize/sharedRunOptions";
import { floorTextWrapWidth, normalizeText, type TextInput } from "#src/normalize/text";

const INHERITED_CELL_OPTIONS = ["align", "bold", "border", "color", "fill", "fontFace", "fontSize", "margin", "textDirection", "underline", "valign"] as const;

function span(value?: number): number {
    return Number.isFinite(value) && value! > 1 ? Math.floor(value!) : 1;
}

export function columnCount(rows: PptxGenJS.TableRow[]): number {
    const firstRow = rows[0] ?? [];
    let total = 0;

    for (const cell of firstRow) {
        total += typeof cell !== "object" || cell === null ? 1 : span(cell.options?.colspan);
    }

    return Math.max(1, total);
}

/**
 * A table `w` or `h` as PptxGenJS 4.0.1 addTableDefinition leaves it for genXmlTable: getSmartParseNumber (step 3), then
 * an EMU result below 20 read as inches once more (step 4), so `w: 0.00001` (9 EMU) is 9 inches. `emu` is the step 3
 * value, `pixels` the step 4 one.
 */
function addTableSize(value: PptxGenJS.Coord, pageInches: number): { emu: number; pixels: number } {
    const emu = smartParseEmu(value, pageInches * PPTX_DEFAULTS.units.emuPerInch);
    const pixels = emu && emu < PPTX_DEFAULTS.table.emuReadAsInchesBelow ? inchesToPixels(emu) : convertToPixels(value, inchesToPixels(pageInches));

    return { emu, pixels };
}

/**
 * The table `w` genXmlTable shares among the columns when the table has a `colW`: addTableDefinition skips
 * getSmartParseNumber then and only reads a number below 20 as inches (step 4), so 30 is 30 EMU, and genXmlTable takes
 * 1 EMU for a string (`typeof w === "number" ? w : 1`).
 */
function widthBesideColW(w: PptxGenJS.Coord | undefined): number {
    if (typeof w !== "number") {
        return emuToPixels(1);
    }

    return w < PPTX_DEFAULTS.table.emuReadAsInchesBelow ? inchesToPixels(w) : emuToPixels(w);
}

/** Scalar `colW`, or a single-item one over several columns: PptxGenJS 4.0.1 gives every column that width. */
function repeatedColumnWidth(count: number, options: PptxGenJS.TableProps): { kind: "repeated"; width: number } | { kind: "notRepeated" } {
    if (typeof options.colW === "number") {
        return { kind: "repeated", width: options.colW };
    }

    const only = Array.isArray(options.colW) && options.colW.length === 1 && count > 1 ? options.colW[0] : undefined;

    return only === undefined ? { kind: "notRepeated" } : { kind: "repeated", width: only };
}

/**
 * PptxGenJS 4.0.1 addTableDefinition drops a `colW` array whose length is not the column count, and sets `w` to the
 * floored total of a repeated one; when that leaves no `w` (unset, 0, or a total floored to 0), genXmlTable draws 1in
 * columns and autoPage sizes them its own way (autoPageTableOptions).
 */
export function addTableLeavesNoWidth(count: number, options: PptxGenJS.TableProps): boolean {
    const repeated = repeatedColumnWidth(count, options);

    if (repeated.kind === "repeated") {
        return !Math.floor(repeated.width * count);
    }

    return Array.isArray(options.colW) && options.colW.length !== count && !options.w;
}

// PptxGenJS 4.0.1 genXmlTextBody (STEP 4 A) gives a run without options the cell's own options object
// (`itext.options || opts`), so those runs share one record that carries the cell's `align` (normalizeText). A run with
// options keeps its own object, which genXmlTextBody (STEP 6) writes the cell's options onto (normalizeText).
function richText(input: PptxGenJS.TableCell[], cellOptions: PptxGenJS.TextPropsOptions): PptxGenJS.TextProps[] {
    return input.flatMap(cell => {
        const value = cell.text ?? "";

        if (Array.isArray(value)) {
            return richText(value, cellOptions);
        }

        // `as`: a run in a cell takes the same text options as an addText() run.
        const own = cell.options as PptxGenJS.TextPropsOptions | undefined;

        return [{ text: String(value), options: own ?? cellOptions }];
    });
}

/** A cell's text options: its options with the text direction under the name addText() gives it. */
function cellTextOptions(cell: PptxGenJS.TableCellProps): PptxGenJS.TextPropsOptions {
    // `as`: a cell names its text options as addText() does, except `textDirection`, which addText() calls `vert`.
    return { ...cell, vert: cell.textDirection } as unknown as PptxGenJS.TextPropsOptions;
}

/** A cell option genXmlTable (step 2) fills from the table: falsy (`false`, `""`, `null`, unset) but not 0. */
function missing(value: unknown): boolean {
    return !value && value !== 0;
}

function inheritedCellOptions(table: PptxGenJS.TableProps, cell: PptxGenJS.TableCellProps): PptxGenJS.TableCellProps {
    const inherited: Record<string, unknown> = { ...cell };

    for (const name of INHERITED_CELL_OPTIONS) {
        // `bold: false` in a bold table is bold.
        if (missing(inherited[name]) && table[name] !== undefined) {
            inherited[name] = table[name];
        }
    }

    if (missing(inherited.fontSize)) {
        inherited.fontSize = PPTX_DEFAULTS.table.fontSizePt;
    }

    if (missing(inherited.valign)) {
        inherited.valign = PPTX_DEFAULTS.table.valign;
    }

    if (missing(inherited.margin)) {
        inherited.margin = PPTX_DEFAULTS.table.marginIn;
    }

    // PptxGenJS writes no color for an uncolored linked cell, so it takes the theme's hyperlink color (LibreOffice).
    if (missing(inherited.color) && !inherited.hyperlink) {
        inherited.color = PPTX_DEFAULTS.table.color;
    }

    return inherited as PptxGenJS.TableCellProps;
}

/**
 * PptxGenJS 4.0.1 accepts a plain string or number as a table cell at runtime, although `TableRow` lists only cell
 * objects: addTableDefinition (step 2, "B") turns it into a cell `{ text: cell.toString() }` with no options of its
 * own, before rendering and before getSlidesForTableRows paginates it, so it inherits the table options like an
 * object cell does. A `null` or `undefined` cell makes that step throw (it reads `cell.options` or `cell.text`), so it is
 * rejected here, at `rows[row][column]`, instead of being drawn as the text "null".
 *
 * That step keeps an object cell's text only when it is truthy, and genXmlTextBody writes nothing for `true`, so
 * `{ text: 0 }`, `{ text: false }` and `{ text: true }` are empty cells, as is a plain boolean cell.
 */
export function tableCell(cell: PptxGenJS.TableCell | string | number | boolean | null | undefined, row: number, column: number): PptxGenJS.TableCell {
    if (cell === null || cell === undefined) {
        throw new Error(`addTable: rows[${row}][${column}] is ${cell}. PptxGenJS 4.0.1 fails on a missing cell; pass "" or { text: "" } for an empty cell.`);
    }

    if (typeof cell === "string" || typeof cell === "number") {
        return { text: String(cell) };
    }

    if (typeof cell !== "object") {
        return { text: "" };
    }

    const text: unknown = cell.text;

    return text === "" || (text && text !== true) ? cell : { ...cell, text: "" };
}

/**
 * PptxGenJS 4.0.1 checks only the first row; a later row that is not an array it logs and writes as a row without
 * cells (addTableDefinition step 2), and autoPage then fails on it with a TypeError. That row is rejected here instead.
 */
export function tableRow(row: unknown, index: number): PptxGenJS.TableRow {
    if (!Array.isArray(row)) {
        throw new Error(`addTable: rows[${index}] is ${row === null ? "null" : `of type ${typeof row}`}, not an array of cells. Wrap the cells of each row in an array: [[{ text: "A" }], [{ text: "B" }]].`);
    }

    return row;
}

/** How PptxGenJS 4.0.1 writes a table's runs (normalizeText's RunWriting). */
export interface TableRunWriting {
    /** The table's options as the caller gave them, without the face PdfLapas fills in to draw them; `options` when unset. */
    readonly table?: PptxGenJS.TableProps;
    /** What PptxGenJS wrote onto run options objects in earlier text boxes and cells. */
    readonly shared?: SharedRunOptions;
}

export function normalizeTable(tableRows: PptxGenJS.TableRow[], options: PptxGenJS.TableProps, pageSize: PageSize, target: RenderingTarget = DEFAULT_RENDERING_TARGET, fontMetrics: FontMetricsLookup = builtInFontMetrics, writing: TableRunWriting = {}): NormalizedTable {
    if (!Array.isArray(tableRows) || tableRows.length === 0) {
        throw new Error("addTable: tableRows must be a non-empty array");
    }

    if (!Array.isArray(tableRows[0])) {
        throw new Error("addTable: each row must be an array of cells");
    }

    const count = columnCount(tableRows);
    const evenly = (width: number) => ({ width, columns: Array<number>(count).fill(width / count) });
    let sized: { width: number; columns: number[] };

    // The table width and its column widths.
    if (addTableLeavesNoWidth(count, options)) {
        sized = evenly(inchesToPixels(count));
    } else {
        // PptxGenJS 4.0.1 sets `w` to the floored total for scalar/single-item colW, which addTableDefinition (step 4) reads
        // as inches below 20 and as EMU from 20 on: colW 7 over 3 columns is a 21 EMU table, colW 914400 an inch a column.
        const repeated = repeatedColumnWidth(count, options);

        if (repeated.kind === "repeated") {
            const total = Math.floor(repeated.width * count);

            sized = evenly(total < PPTX_DEFAULTS.table.emuReadAsInchesBelow ? inchesToPixels(total) : emuToPixels(total));
        } else if (Array.isArray(options.colW) && options.colW.length === count) {
            // genXmlTable (step 2) writes each width through inch2Emu (100 is inches, 914400 EMU) and shares `w` for one
            // that is not a number.
            const colWColumns = options.colW.map(width => {
                const pixels = inch2EmuToPixels(width);

                return Number.isNaN(pixels) ? widthBesideColW(options.w) / count : pixels;
            });
            let colWTotal = 0;

            for (const width of colWColumns) {
                colWTotal += width;
            }

            sized = { width: colWTotal, columns: colWColumns };
        } else if (Array.isArray(options.colW)) {
            // A `colW` of the wrong length is dropped, and `w` shared as it stands.
            sized = evenly(widthBesideColW(options.w));
        } else {
            // Without `colW`, a falsy `w` (unset or 0) is the slide width less the default margins, floored to the inch.
            sized = evenly(options.w ? addTableSize(options.w, pageSize.width).pixels : inchesToPixels(Math.floor(pageSize.width - PPTX_DEFAULTS.slide.marginIn * 2)));
        }
    }

    const { width, columns } = sized;
    // Each row's height as genXmlTable (step 4 A) writes it: `rowH[row]` when truthy, else `Number(rowH)` when it is a
    // number, else `h` shared over the rows. `Number` reads a one-item array as its item, so `rowH: [0.5]` sizes every
    // row and `[]` or `[0]` none; a longer array is NaN and leaves its missing rows to `h` (#304). 0 sizes a row to its
    // content.
    const { rowH, h } = options;
    let heightFromTable: Px | undefined;

    if (h !== undefined) {
        // The height genXmlTable (step 4 A) shares among the rows: `h` as addTableDefinition leaves it, through inch2Emu,
        // which reads 100 EMU or less as inches. So `h: 100` is a 100 EMU frame but 100 inches of rows.
        const { emu, pixels } = addTableSize(h, pageSize.height);
        const rowsHeight = emu >= PPTX_DEFAULTS.table.emuReadAsInchesBelow && emu <= PPTX_DEFAULTS.units.inchesBelow ? inchesToPixels(emu) : pixels;

        heightFromTable = px(rowsHeight / Math.max(1, tableRows.length));
    }

    const heights = Array.from({ length: tableRows.length }, (_, index) => {
        const own = Array.isArray(rowH) ? rowH[index] : undefined;
        let inches: number;

        if (own) {
            inches = Number(own);
        } else if (rowH && !Number.isNaN(Number(rowH))) {
            inches = Number(rowH);
        } else {
            return heightFromTable;
        }

        return inches > 0 ? inch2EmuToPixels(inches) : undefined;
    });
    // PptxGenJS 4.0.1 genXmlTable (step 4 A) writes `h` into the rows only without `rowH`; otherwise `h` is just the
    // frame's `cy`, which PowerPoint and LibreOffice ignore: a table is as tall as its rows (#246).
    let height: number | undefined = 0;

    for (const row of heights) {
        height = height === undefined || row === undefined ? undefined : height + row;
    }

    const { contentRowSlackMm } = RENDERING_TARGETS[target];
    const builtRows = tableRows.map((row, rowIndex): NormalizedTableRow => ({
        height: heights[rowIndex],
        cells: tableRow(row, rowIndex).map((rawCell, column) => {
            const cell = tableCell(rawCell, rowIndex, column);
            const cellOptions = inheritedCellOptions(options, cell.options ?? {});
            const textOptions = cellTextOptions(cellOptions);
            // The cell's options as genXmlTable (step 2) leaves them, which genXmlTextBody writes onto its runs.
            // shortcut: PptxGenJS gives the table no default color when any of its cells holds a link, not only this
            // one (addTableDefinition step 3); match it when a deck shares run options with such a table.
            const box = writing.table ? cellTextOptions(inheritedCellOptions(writing.table, cell.options ?? {})) : textOptions;
            const input: TextInput = Array.isArray(cell.text) ? richText(cell.text, textOptions) : String(cell.text ?? "");
            // PptxGenJS writes the cell's fontFace on <a:endParaRPr>, the paragraph mark's font in PowerPoint.
            // shortcut: the theme font (soft breaks, a cell without fontFace) is the default Calibri whatever the
            // deck's theme; pass pres.theme.bodyFontFace in once #256 settles the table normalizer's inputs.
            const theme = PPTX_DEFAULTS.theme.bodyFontFace;
            const text = normalizeText(input, textOptions, target, fontMetrics, theme, cellOptions.fontFace ?? theme, { box, shared: writing.shared, cell: true });

            text.margin = tableMarginPixels(cellOptions.margin);
            // PptxGenJS 4.0.1 writes `fit` (and `shrinkText`, `autoFit`) only into a text box's <a:bodyPr>
            // (genXmlBodyProperties); a cell gets a bare <a:bodyPr/>, so its row grows to the text instead.
            text.fit = "none";

            const colspan = span(cellOptions.colspan);
            const rowspan = span(cellOptions.rowspan);
            const fill = cellOptions.fill ? normalizeFill(cellOptions.fill) : undefined;
            const border = cellOptions.border;
            const sides = Array.isArray(border) ? border : [border, border, border, border];
            // PptxGenJS 4.0.1 (addTableDefinition) gives a missing side { type: "none" } and fills a given one from
            // DEF_CELL_BORDER with `||`: `{ color, pt }` is a solid line.
            const borders = sides.map((side): NormalizedTableBorder => {
                const type = side ? side.type || PPTX_DEFAULTS.border.whenProvidedType : PPTX_DEFAULTS.table.border.type;
                const width = type === "none" ? 0 : pointsToPixels(checkedSize(side?.pt ?? PPTX_DEFAULTS.table.border.widthPt, "border.pt", PPTX_DEFAULTS.limits.lineWidthPt));

                return {
                    visible: type !== "none",
                    // A "none" side is written as <a:noFill/> without its color, so PptxGenJS never checks that color either.
                    color: type === "none" ? TRANSPARENT : normalizeColor(side?.color || PPTX_DEFAULTS.table.border.color),
                    width,
                    style: type === "dash" ? "dashed" : "solid",
                    // PptxGenJS 4.0.1 writes a "dash" cell border as <a:prstDash val="sysDash"/>.
                    ...(type === "dash" && width > 0 ? { dashArray: PPTX_DEFAULTS.shape.dashPatterns.sysDash?.map(part => part * width).join(" ") } : {}),
                };
            }) as [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder];

            return { text, colspan, rowspan, fill, borders };
        }),
    }));
    // The rows with only the cells that start inside the table's grid columns, a colspan that crosses the last column
    // cut at it. PptxGenJS 4.0.1 genXmlTable writes one <a:gridCol> per column of the first row but every <a:tc> of each
    // row, and PowerPoint draws only the cells that fit the grid: the rest take no text, no border and no height (#286).
    // Each cell starts in the first column of its row not taken by a rowspan above, as in <a:tc> order once PptxGenJS
    // inserts its merge cells. A row with fewer cells than columns is kept as it is.
    // The drop is documented (docs/DEFAULTS.md) rather than thrown: PptxGenJS and PowerPoint accept these rows and
    // real decks rely on it, and normalization has no warning channel.
    // shortcut: the cut of a colspan across the last column is assumed (no PowerPoint export checks it); measure it if a
    // deck relies on it.
    // Each cell's text then wraps at the width of its columns floored as a text box's is (floorTextWrapWidth).
    const gridColumns = columns.length;
    const taken = new Set<string>();
    const rows = builtRows.map((row, rowIndex) => {
        let column = 0;
        const cells = row.cells.flatMap(cell => {
            while (taken.has(`${rowIndex},${column}`)) {
                column++;
            }

            if (column >= gridColumns) {
                return [];
            }

            const colspan = Math.min(cell.colspan, gridColumns - column);

            for (let r = rowIndex; r < rowIndex + cell.rowspan; r++) {
                for (let c = column; c < column + colspan; c++) {
                    taken.add(`${r},${c}`);
                }
            }

            let cellWidth = 0;

            for (const value of columns.slice(column, column + colspan)) {
                cellWidth += value;
            }

            column += colspan;

            return [{ ...cell, colspan, text: floorTextWrapWidth(cell.text, cellWidth, target) }];
        });

        return { ...row, cells };
    });

    return {
        width: px(width),
        height: height === undefined ? undefined : px(height),
        columns: columns.map(px),
        ...(contentRowSlackMm ? { contentRowSlack: millimetersToPixels(contentRowSlackMm) } : {}),
        rows,
    };
}
