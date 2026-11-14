import type { NormalizedTable, NormalizedTableBorder, NormalizedTableCell } from "@pdfdeck/model";
import { type InlineStyle, styleAttribute } from "./css";
import { type Attribute, element, voidElement } from "./markup";
import { renderText } from "./text";

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

function borderCSS(border: NormalizedTableBorder): string {
    return border.visible ? `${border.width}px ${border.style} ${border.color}` : "0px none transparent";
}

function renderCell(cell: NormalizedTableCell, fixedHeight: boolean): string {
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
    if (fixedHeight) {
        textCss.set("position", "absolute");
        textCss.set("inset", "0px");
    } else {
        textCss.set("width", "100%");
    }
    textCss.set("overflow", "hidden");
    const text = renderText(textCss, cell.text);
    const textElement = element("div", [["class", "table-cell-text"], ...text.attributes, styleAttribute(textCss)], text.content);
    return element("td", [["colspan", String(cell.colspan)], ["rowspan", String(cell.rowspan)], ...dashArrays, styleAttribute(css)], textElement);
}

export function renderTable(table: NormalizedTable): string {
    const css: InlineStyle = new Map([["width", `${table.width}px`]]);
    if (table.height !== undefined) css.set("height", `${table.height}px`);
    css.set("table-layout", "fixed");
    css.set("border-collapse", "collapse");
    css.set("border-spacing", "0");

    const columns = element("colgroup", [], table.columns.map(width => voidElement("col", [styleAttribute(new Map([["width", `${width}px`]]))])).join(""));
    const rows = table.rows.map(row => {
        const fixedHeight = row.height !== undefined || table.height !== undefined;
        const cells = row.cells.map(cell => renderCell(cell, fixedHeight)).join("");
        return element("tr", [styleAttribute(new Map(row.height !== undefined ? [["height", `${row.height}px`]] : []))], cells);
    });
    return element("table", [["class", "slide-table"], styleAttribute(css)], `${columns}${rows.join("")}`);
}
