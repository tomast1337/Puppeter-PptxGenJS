// Tables (docs/HTML_PROFILE.md "Table"), as pdf-core's table.rs draws them: origin cells placed on the column grid the
// way HTML places them, rows grown until their cells' text fits (a row's `height` is a minimum), then every cell fill,
// every cell's text through the text box code, and every grid edge once.
import { type Color, color, px, readStyle, type Style, take } from "#src/css";
import { attribute, children, type Element, hasClass } from "#src/dom";
import { dash, fill, type Paint, stroke } from "#src/paint";
import { anchorTop, drawLayout, type Frame, measureBox } from "#src/text/draw";
import type { BoxLayout } from "#src/text/layout";
import { type Report, readTextBox, reportUnread, type TextBox } from "#src/text/read";

/** A drawn cell side. A hidden side, or one too thin or transparent to see, is undefined. */
interface Border {
    readonly width: number;
    readonly color: Color;
    readonly dashArray?: string;
}

/** Top, right, bottom, left, as `TableCell.borders` orders them. */
type Borders = readonly [Border | undefined, Border | undefined, Border | undefined, Border | undefined];

interface Cell {
    readonly colspan: number;
    readonly rowspan: number;
    readonly fill?: Color;
    readonly borders: Borders;
    /** Undefined for text the renderer reports instead of drawing (vertical text). */
    readonly text?: TextBox;
}

interface Row {
    readonly height: number;
    readonly cells: readonly Cell[];
}

/** One origin cell on the grid: its first row and column and how many it covers, and its text laid out to its width. */
interface Placed {
    readonly cell: Cell;
    readonly row: number;
    readonly col: number;
    readonly rows: number;
    readonly cols: number;
    readonly layout?: BoxLayout;
}

const SIDES = ["top", "right", "bottom", "left"] as const;
/** What the profile's `borderCSS` writes for a hidden side. */
const HIDDEN_BORDER = "0px none transparent";
const SPAN = /^\d+$/;
/** CSS that `toHtml()` writes for Chromium's table layout and that states no drawn value of its own. */
const TABLE_LAYOUT: ReadonlySet<string> = new Set(["width", "height", "table-layout", "border-collapse", "border-spacing"]);
/** `vertical-align` repeats the cell text's `align-items`, which is what the text is anchored by. */
const CELL_LAYOUT: ReadonlySet<string> = new Set(["overflow", "position", "vertical-align"]);
const CELL_TEXT_LAYOUT: ReadonlySet<string> = new Set(["display", "box-sizing", "position", "inset", "width", "overflow"]);
const CELL_ATTRIBUTES = SIDES.map(side => `data-border-${side}-dash-array`);

function invalid(what: string): Error {
    return new Error(`invalid PdfLapas HTML: ${what}`);
}

/** `border-<side>: <width>px <solid|dashed> <color>`, or `0px none transparent` when hidden. */
function readBorder(cell: Element, style: Style, side: (typeof SIDES)[number]): Border | undefined {
    const value = take(style, `border-${side}`);
    if (value === undefined) throw invalid(`a table cell has no border-${side}`);
    if (value === HIDDEN_BORDER) return undefined;
    const [width, lineStyle, ...rest] = value.split(" ");
    const parsedWidth = px(width);
    const parsedColor = color(rest.join(" "));
    if (parsedWidth === undefined || (lineStyle !== "solid" && lineStyle !== "dashed") || !parsedColor) {
        throw invalid(`a table cell's border-${side} '${value}' is not '<width>px <solid|dashed> <color>' or '${HIDDEN_BORDER}'`);
    }
    if (!(parsedWidth > 0 && Number.isFinite(parsedWidth)) || parsedColor.alpha <= 0) return undefined;
    const dashArray = attribute(cell, `data-border-${side}-dash-array`);
    return { width: parsedWidth, color: parsedColor, ...(dashArray ? { dashArray } : {}) };
}

function readSpan(cell: Element, name: string): number {
    const value = attribute(cell, name);
    if (value === undefined || !SPAN.test(value)) throw invalid(`a table cell's ${name} '${value ?? ""}' is missing or not a whole number`);
    return Math.max(1, Number(value));
}

function readCell(cell: Element, report: Report): Cell {
    const style = readStyle(cell);
    const borders: Borders = [readBorder(cell, style, "top"), readBorder(cell, style, "right"), readBorder(cell, style, "bottom"), readBorder(cell, style, "left")];
    const background = color(take(style, "background-color"));
    // The cell margin is the .table-cell-text padding; a td padding would add to it, as pdf-core refuses.
    const padding = take(style, "padding");
    if (padding !== undefined && px(padding) !== 0) throw invalid(`a <td>'s padding is '${padding}', expected 0px (the cell margin is the .table-cell-text padding)`);
    const [box, ...extra] = children(cell);
    if (!box || extra.length || !hasClass(box, "table-cell-text")) throw invalid("a <td> must hold one div.table-cell-text");
    const fit = attribute(box, "data-text-fit") ?? "none";
    if (fit !== "none") throw invalid(`a table cell's data-text-fit is '${fit}', expected 'none' (a cell has no autofit; its row grows to the text)`);
    const boxStyle = readStyle(box);
    const text = readTextBox(box, boxStyle, report);
    reportUnread(box, boxStyle, ["data-text-fit", "data-text-direction"], report, CELL_TEXT_LAYOUT);
    reportUnread(cell, style, CELL_ATTRIBUTES, report, CELL_LAYOUT);
    return {
        colspan: readSpan(cell, "colspan"),
        rowspan: readSpan(cell, "rowspan"),
        ...(background && background.alpha > 0 ? { fill: background } : {}),
        borders,
        ...(text ? { text } : {}),
    };
}

function readRow(row: Element, report: Report): Row {
    const style = readStyle(row);
    const height = px(take(style, "height")) ?? 0;
    reportUnread(row, style, [], report);
    const cells = children(row).filter(cell => {
        if (cell.tagName !== "td") report(`<${cell.tagName}> in a table row is not drawn`);
        return cell.tagName === "td";
    });
    return { height: checkLength("row", height), cells: cells.map(cell => readCell(cell, report)) };
}

function checkLength(what: string, value: number): number {
    if (!Number.isFinite(value) || value < 0) throw invalid(`a table ${what} has size ${value}: expected a finite px value >= 0`);
    return value;
}

function readTable(table: Element, report: Report): { columns: number[]; rows: Row[] } {
    const style = readStyle(table);
    reportUnread(table, style, [], report, TABLE_LAYOUT);
    const [colgroup, ...rest] = children(table);
    if (colgroup?.tagName !== "colgroup") throw invalid("table.slide-table must start with <colgroup>");
    const columns = children(colgroup).map(col => {
        const colStyle = readStyle(col);
        const width = px(take(colStyle, "width"));
        if (col.tagName !== "col" || width === undefined) throw invalid("a <colgroup> may hold only <col style='width: <n>px'>");
        reportUnread(col, colStyle, [], report);
        return checkLength("column", width);
    });
    // The serializer writes rows straight under <table>; hand-written HTML may wrap them in <tbody>.
    const rows = rest.flatMap(child => (child.tagName === "tbody" ? children(child) : [child]));
    return {
        columns,
        rows: rows.flatMap(row => {
            if (row.tagName === "tr") return [readRow(row, report)];
            report(`<${row.tagName}> in a table is not drawn`);
            return [];
        }),
    };
}

/**
 * HTML's cell placement, which is also how PptxGenJS expands `colspan`/`rowspan` into `hMerge`/`vMerge` slots: each
 * origin cell takes the next grid column its row has free, and a span is clipped to the grid. Cells without a free
 * column are reported.
 */
function placeCells(rows: readonly Row[], columnCount: number, report: Report): Omit<Placed, "layout">[] {
    const busyUntil: number[] = new Array(columnCount).fill(0);
    const placed: Omit<Placed, "layout">[] = [];
    let dropped = 0;
    rows.forEach((row, r) => {
        let col = 0;
        for (const cell of row.cells) {
            while ((busyUntil[col] ?? 0) > r) col++;
            if (col >= columnCount) {
                dropped++;
                continue;
            }
            const spanRows = Math.min(cell.rowspan, rows.length - r);
            const spanCols = Math.min(cell.colspan, columnCount - col);
            busyUntil.fill(r + spanRows, col, col + spanCols);
            placed.push({ cell, row: r, col, rows: spanRows, cols: spanCols });
            col += spanCols;
        }
    });
    if (dropped) report(`${dropped} table cell(s) beyond the column grid are not drawn`);
    return placed;
}

/** Running offsets of `sizes`: `sizes.length + 1` grid lines from 0. */
function gridLines(sizes: readonly number[]): number[] {
    const lines = [0];
    for (const size of sizes) lines.push((lines.at(-1) ?? 0) + size);
    return lines;
}

/** Distance between grid lines `index` and `index + count`. */
function span(lines: readonly number[], index: number, count: number): number {
    return (lines[index + count] ?? 0) - (lines[index] ?? 0);
}

/** Grows `heights` (the rows' minimums) until each cell fits: single-row cells first, then a spanning cell adds what its rows still lack to its last row. */
function growRows(heights: number[], placed: readonly Placed[]): void {
    const need = ({ cell, layout }: Placed) => (layout?.height ?? 0) + (cell.text ? cell.text.padding[0] + cell.text.padding[2] : 0);
    for (const cell of placed) if (cell.rows === 1) heights[cell.row] = Math.max(heights[cell.row] ?? 0, need(cell));
    // shortcut: the shortfall of a spanning cell goes to its last row, as in pdf-core; spread it if a reference shows otherwise.
    for (const cell of placed) {
        if (cell.rows === 1) continue;
        const spanned = heights.slice(cell.row, cell.row + cell.rows).reduce((sum, height) => sum + height, 0);
        const last = cell.row + cell.rows - 1;
        if (need(cell) > spanned) heights[last] = (heights[last] ?? 0) + need(cell) - spanned;
    }
}

/**
 * Which cell side draws each grid edge: horizontal edges line by line (`rows + 1` lines of `columns` edges), vertical
 * edges line by line (`columns + 1` lines of `rows` edges). An edge is drawn once, however many cells share it: the
 * wider side wins, as in CSS's collapsing border model, and on a tie the first cell in document order keeps it.
 */
function resolveEdges(placed: readonly Placed[], rowCount: number, columnCount: number): { horizontal: (Border | undefined)[]; vertical: (Border | undefined)[] } {
    const horizontal: (Border | undefined)[] = new Array((rowCount + 1) * columnCount).fill(undefined);
    const vertical: (Border | undefined)[] = new Array((columnCount + 1) * rowCount).fill(undefined);
    const claim = (edges: (Border | undefined)[], slot: number, border: Border | undefined) => {
        const held = edges[slot];
        if (border && (!held || border.width > held.width)) edges[slot] = border;
    };
    for (const { cell, row, col, rows, cols } of placed) {
        const [top, right, bottom, left] = cell.borders;
        for (let c = col; c < col + cols; c++) {
            claim(horizontal, row * columnCount + c, top);
            claim(horizontal, (row + rows) * columnCount + c, bottom);
        }
        for (let r = row; r < row + rows; r++) {
            claim(vertical, col * rowCount + r, left);
            claim(vertical, (col + cols) * rowCount + r, right);
        }
    }
    return { horizontal, vertical };
}

function sameLine(a: Border, b: Border): boolean {
    return a.width === b.width && a.dashArray === b.dashArray && a.color.alpha === b.color.alpha && a.color.rgb.every((channel, index) => channel === b.color.rgb[index]);
}

/**
 * Strokes one grid line: each run of neighbouring edges with the same border is one line from grid offset `along[start]`
 * to `along[end]`, centred on the grid line as DrawingML table borders are (`algn="ctr"`), with square caps when solid
 * so it closes the corners it shares with the lines across it, butt caps when dashed.
 */
function strokeGridLine(paint: Paint, edges: readonly (Border | undefined)[], along: readonly number[], point: (offset: number) => [number, number]): void {
    let run: { start: number; border: Border } | undefined;
    for (let index = 0; index <= edges.length; index++) {
        const border = edges[index];
        if (run && border && sameLine(run.border, border)) continue;
        if (run) {
            const doc = paint.doc;
            doc.save();
            stroke(paint, run.border.color, run.border.width);
            doc.lineCap(run.border.dashArray ? "butt" : "square");
            const visible = run.border.dashArray ? dash(doc, run.border.dashArray.split(/[\s,]+/).map(Number)) : true;
            if (visible)
                doc.moveTo(...point(along[run.start] ?? 0))
                    .lineTo(...point(along[index] ?? 0))
                    .stroke();
            doc.restore();
        }
        run = border ? { start: index, border } : undefined;
    }
}

/** Draws the `table.slide-table` of a `.slide-table-container` with its top-left grid corner at the object's corner. */
export function drawTable(container: Element, paint: Paint, box: Frame): void {
    const [element, ...extra] = children(container);
    if (!element || element.tagName !== "table" || !hasClass(element, "slide-table")) throw invalid("a table container has no table.slide-table");
    for (const child of extra) paint.report(`<${child.tagName}> beside the table is not drawn`);
    const { columns, rows } = readTable(element, paint.report);
    const colX = gridLines(columns);
    const placed: Placed[] = placeCells(rows, columns.length, paint.report).map(cell => (cell.cell.text ? { ...cell, layout: measureBox(paint, cell.cell.text, span(colX, cell.col, cell.cols)) } : cell));
    const heights = rows.map(row => row.height);
    growRows(heights, placed);
    const rowY = gridLines(heights);
    const frame = ({ row, col, rows: spanRows, cols }: Placed): Frame => ({ x: box.x + (colX[col] ?? 0), y: box.y + (rowY[row] ?? 0), width: span(colX, col, cols), height: span(rowY, row, spanRows) });

    // Every fill, then every text, then every border, so a neighbour's fill never covers a border.
    for (const cell of placed) {
        if (!cell.cell.fill) continue;
        const { x, y, width, height } = frame(cell);
        fill(paint, cell.cell.fill);
        paint.doc.rect(x, y, width, height).fill();
    }
    for (const cell of placed) {
        const { text } = cell.cell;
        if (!text || !cell.layout) continue;
        const cellFrame = frame(cell);
        drawLayout(paint, cell.layout, cellFrame.x + text.padding[3], anchorTop(text, cell.layout, cellFrame));
    }
    const { horizontal, vertical } = resolveEdges(placed, rows.length, columns.length);
    for (let line = 0; line <= rows.length; line++) {
        const y = box.y + (rowY[line] ?? 0);
        strokeGridLine(paint, horizontal.slice(line * columns.length, (line + 1) * columns.length), colX, along => [box.x + along, y]);
    }
    for (let line = 0; line <= columns.length; line++) {
        const x = box.x + (colX[line] ?? 0);
        strokeGridLine(paint, vertical.slice(line * rows.length, (line + 1) * rows.length), rowY, along => [x, box.y + along]);
    }
}
