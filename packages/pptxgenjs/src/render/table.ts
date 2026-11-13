import type { NormalizedTable, NormalizedTableBorder } from "@pdfdeck/model";
import { type InlineStyle, writeStyle } from "./css";
import { renderText } from "./text";

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

function borderCSS(border: NormalizedTableBorder): string {
    return border.visible ? `${border.width}px ${border.style} ${border.color}` : "0px none transparent";
}

export function renderTable(document: Document, table: NormalizedTable): HTMLTableElement {
    const element = document.createElement("table");
    element.className = "slide-table";
    const css: InlineStyle = new Map([["width", `${table.width}px`]]);
    if (table.height !== undefined) css.set("height", `${table.height}px`);
    css.set("table-layout", "fixed");
    css.set("border-collapse", "collapse");
    css.set("border-spacing", "0");
    const outerStrokeOffset = Math.max(0, ...table.rows.flatMap(row => row.cells.flatMap(cell => cell.borders.map(border => border.width)))) / 2;
    if (outerStrokeOffset) {
        // DrawingML centers table borders on the grid. Chromium collapses the
        // outer half into the table box, so offset the grid by half a stroke.
        css.set("position", "relative");
        css.set("left", `${-outerStrokeOffset}px`);
        css.set("top", `${-outerStrokeOffset}px`);
    }
    writeStyle(element, css);

    const columns = document.createElement("colgroup");
    table.columns.forEach(width => {
        const column = document.createElement("col");
        writeStyle(column, new Map([["width", `${width}px`]]));
        columns.appendChild(column);
    });
    element.appendChild(columns);

    table.rows.forEach(row => {
        const rowElement = document.createElement("tr");
        if (row.height !== undefined) writeStyle(rowElement, new Map([["height", `${row.height}px`]]));
        row.cells.forEach(cell => {
            const cellElement = document.createElement("td");
            cellElement.colSpan = cell.colspan;
            cellElement.rowSpan = cell.rowspan;
            const cellCss: InlineStyle = new Map([
                ["padding", "0px"],
                ["overflow", "hidden"],
                ["position", "relative"],
                ["vertical-align", cell.text.verticalAlign],
            ]);
            if (cell.fill?.visible) cellCss.set("background-color", cell.fill.color);
            const [top, right, bottom, left] = cell.borders;
            cellCss.set("border-top", borderCSS(top));
            cellCss.set("border-right", borderCSS(right));
            cellCss.set("border-bottom", borderCSS(bottom));
            cellCss.set("border-left", borderCSS(left));
            // CSS borders have no dash pattern, only `dashed`.
            BORDER_SIDES.forEach((side, index) => {
                const dashArray = cell.borders[index]?.dashArray;
                if (dashArray) cellElement.setAttribute(`data-border-${side}-dash-array`, dashArray);
            });
            writeStyle(cellElement, cellCss);

            const text = document.createElement("div");
            text.className = "table-cell-text";
            const textCss: InlineStyle = new Map([
                ["display", "flex"],
                ["box-sizing", "border-box"],
            ]);
            if (row.height !== undefined || table.height !== undefined) {
                textCss.set("position", "absolute");
                textCss.set("inset", "0px");
            } else {
                textCss.set("width", "100%");
            }
            textCss.set("overflow", "hidden");
            renderText(document, text, textCss, cell.text);
            writeStyle(text, textCss);
            cellElement.appendChild(text);
            rowElement.appendChild(cellElement);
        });
        element.appendChild(rowElement);
    });
    return element;
}
