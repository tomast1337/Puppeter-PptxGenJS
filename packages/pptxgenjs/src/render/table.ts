import type { NormalizedTable, NormalizedTableBorder, NormalizedTableCell, NormalizedTextBox } from "@pdflapas/model";
import { cssPx } from "@pdflapas/model";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, type Html, voidElement } from "./markup";
import { renderText } from "./text";

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

/** A hidden cell border. */
export const HIDDEN_BORDER_CSS = "0px none transparent";

function borderCSS(border: NormalizedTableBorder): string {
    return border.visible ? `${border.width}px ${border.style} ${border.color}` : HIDDEN_BORDER_CSS;
}

/** `fixed` when the row or the table sets a height, `auto` when the row sizes to its content. */
type RowHeight = "fixed" | "auto";

/**
 * The text area of a cell in a row sized to its content: `slack` taller than the text (NormalizedTable.contentRowSlack).
 * The anchor places the text in that free space, so it goes on the inset away from the anchor, half on each side for
 * middle; the padding carries it, so the row grows by it and the text sits where the target puts it.
 */
function slackMargin({ margin, verticalAlign }: NormalizedTextBox, slack: number): NormalizedTextBox["margin"] {
    const [top, right, bottom, left] = margin;
    const above = { top: 0, middle: slack / 2, bottom: slack }[verticalAlign];
    return [top + above, right, bottom + slack - above, left];
}

/**
 * The rows a merged cell ends in. PowerPoint gives such a row what the merged cell lacks and keeps the other rows at
 * their own height (measured against its PDF export of a synthetic deck: merged in pairs and threes, 2 to 5 lines),
 * but Chromium spreads it over the spanned rows that have a height, in proportion to them; it gives it to the one row
 * without a height when the others have one. So such a row carries its height as its cells' text `min-height`
 * instead: the printed text box spans the row, half borders included (printWorkarounds cellInset).
 * shortcut: a merged cell's rows that it does not end, without a height, still share the shortfall in Chromium
 * (the WASM renderer gives it to the last); fix when such a row is measured.
 */
function mergedCellEnds(table: NormalizedTable): ReadonlySet<number> {
    const ends = new Set<number>();
    table.rows.forEach((row, index) => {
        for (const cell of row.cells) if (cell.rowspan > 1) ends.add(Math.min(index + cell.rowspan, table.rows.length) - 1);
    });
    return ends;
}

function renderCell(cell: NormalizedTableCell, rowHeight: RowHeight, slack: number, minHeight?: number): Html {
    const css: InlineStyle = new Map([
        ["padding", "0px"],
        ["overflow", "hidden"],
        ["position", "relative"],
        ["vertical-align", cell.text.verticalAlign],
    ]);
    if (cell.fill?.visible) css.set("background-color", cell.fill.color);
    const [top, right, bottom, left] = cell.borders;
    css.set("border-top", borderCSS(top));
    css.set("border-right", borderCSS(right));
    css.set("border-bottom", borderCSS(bottom));
    css.set("border-left", borderCSS(left));
    // CSS borders have no dash pattern, only `dashed`.
    const dashArrays = BORDER_SIDES.map((side, index): Attribute => [`data-border-${side}-dash-array`, cell.borders[index]?.dashArray || undefined]);

    const textCss: InlineStyle = new Map([
        ["display", "flex"],
        ["box-sizing", "border-box"],
    ]);
    // A row height is a minimum: PowerPoint and LibreOffice grow the row until its text fits, so the text box stays
    // in flow and the HTML table grows the row. shortcut: vertical text needs a definite height and fills the cell
    // instead, so its row does not grow; lay it out in flow once a fixture needs it.
    if (rowHeight === "fixed" && cell.text.direction !== "horizontal") {
        textCss.set("position", "absolute");
        textCss.set("inset", "0px");
    } else {
        textCss.set("width", "100%");
    }
    if (minHeight !== undefined) textCss.set("min-height", `${minHeight}px`);
    textCss.set("overflow", "hidden");
    // shortcut: a row whose height is shorter than its text grows without the slack; add it once a fixture shows it.
    const text = renderText(textCss, rowHeight === "auto" && slack ? { ...cell.text, margin: slackMargin(cell.text, slack) } : cell.text);
    const textElement = element("div", [["class", "table-cell-text"], ...text.attributes, styleAttribute(textCss)], text.content);
    return element("td", [["colspan", String(cell.colspan)], ["rowspan", String(cell.rowspan)], ...dashArrays, styleAttribute(css)], textElement);
}

export function renderTable(table: NormalizedTable): Html {
    const css: InlineStyle = new Map([["width", cssPx(table.width)]]);
    if (table.height !== undefined) css.set("height", cssPx(table.height));
    css.set("table-layout", "fixed");
    css.set("border-collapse", "collapse");
    css.set("border-spacing", "0");

    const columns = element(
        "colgroup",
        [],
        table.columns.map(width => voidElement("col", [styleAttribute(new Map([["width", cssPx(width)]]))])),
    );
    const ends = mergedCellEnds(table);
    const rows = table.rows.map((row, index) => {
        // Vertical text needs a definite row height (renderCell), so its row keeps it.
        const { height } = row;
        if (height !== undefined && ends.has(index) && row.cells.every(cell => cell.text.direction === "horizontal")) {
            return element(
                "tr",
                [],
                row.cells.map(cell => renderCell(cell, "auto", 0, height)),
            );
        }
        const rowHeight: RowHeight = height !== undefined ? "fixed" : "auto";
        const cells = row.cells.map(cell => renderCell(cell, rowHeight, table.contentRowSlack ?? 0));
        return element("tr", [styleAttribute(new Map(height !== undefined ? [["height", cssPx(height)]] : []))], cells);
    });
    return element("table", [["class", "slide-table"], styleAttribute(css)], [columns, ...rows]);
}
