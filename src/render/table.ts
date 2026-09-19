import type { NormalizedTable, NormalizedTableBorder } from "../model/types";
import { renderText } from "./text";

function borderCSS(border: NormalizedTableBorder): string {
    return border.visible ? `${border.width}px ${border.style} ${border.color}` : "0px none transparent";
}

export function renderTable(document: Document, table: NormalizedTable): HTMLTableElement {
    const element = document.createElement("table");
    element.className = "slide-table";
    element.style.width = `${table.width}px`;
    if (table.height !== undefined) element.style.height = `${table.height}px`;
    element.style.tableLayout = "fixed";
    element.style.borderCollapse = "collapse";
    element.style.borderSpacing = "0";
    const outerStrokeOffset = Math.max(0, ...table.rows.flatMap(row => row.cells.flatMap(cell => cell.borders.map(border => border.width)))) / 2;
    if (outerStrokeOffset) {
        // DrawingML centers table borders on the grid. Chromium collapses the
        // outer half into the table box, so offset the grid by half a stroke.
        element.style.position = "relative";
        element.style.left = `${-outerStrokeOffset}px`;
        element.style.top = `${-outerStrokeOffset}px`;
    }

    const columns = document.createElement("colgroup");
    table.columns.forEach(width => {
        const column = document.createElement("col");
        column.style.width = `${width}px`;
        columns.appendChild(column);
    });
    element.appendChild(columns);

    table.rows.forEach(row => {
        const rowElement = document.createElement("tr");
        if (row.height !== undefined) rowElement.style.height = `${row.height}px`;
        row.cells.forEach(cell => {
            const cellElement = document.createElement("td");
            cellElement.colSpan = cell.colspan;
            cellElement.rowSpan = cell.rowspan;
            cellElement.style.padding = "0px";
            cellElement.style.overflow = "hidden";
            cellElement.style.position = "relative";
            cellElement.style.verticalAlign = cell.text.verticalAlign;
            if (cell.fill?.visible) cellElement.style.backgroundColor = cell.fill.color;
            const [top, right, bottom, left] = cell.borders;
            cellElement.style.borderTop = borderCSS(top);
            cellElement.style.borderRight = borderCSS(right);
            cellElement.style.borderBottom = borderCSS(bottom);
            cellElement.style.borderLeft = borderCSS(left);

            const text = document.createElement("div");
            text.className = "table-cell-text";
            text.style.display = "flex";
            text.style.boxSizing = "border-box";
            if (row.height !== undefined || table.height !== undefined) {
                text.style.position = "absolute";
                text.style.inset = "0px";
            } else {
                text.style.width = "100%";
            }
            text.style.overflow = "hidden";
            renderText(document, text, cell.text);
            cellElement.appendChild(text);
            rowElement.appendChild(cellElement);
        });
        element.appendChild(rowElement);
    });
    return element;
}
