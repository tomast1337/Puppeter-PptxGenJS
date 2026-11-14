//! Tables (`render/table.ts`): the column grid, rows, cells with their fill, borders and text box.

use super::allow;
use super::dom::{Dom, Element};
use super::style::{Style, integer};
use super::text::{self, text_box};
use crate::model::{FillModel, Table, TableBorder, TableCell, TableRow};

const TABLE_CSS: &[&str] = &["width", "height", "table-layout", "border-collapse", "border-spacing"];
const SIDES: [&str; 4] = ["top", "right", "bottom", "left"];
const CELL_ATTRS: &[&str] = &[
    "colspan",
    "rowspan",
    "data-border-top-dash-array",
    "data-border-right-dash-array",
    "data-border-bottom-dash-array",
    "data-border-left-dash-array",
];
const CELL_CSS: &[&str] = &[
    "padding",
    "overflow",
    "position",
    "vertical-align",
    "background-color",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
];
const CELL_TEXT_CSS: &[&str] = &["display", "box-sizing", "position", "inset", "width"];
/// What `borderCSS` writes for a hidden border.
const HIDDEN_BORDER: &str = "0px none transparent";

pub(crate) fn read(dom: &Dom<'_>, table: &Element<'_>) -> Result<Table, String> {
    if table.name != "table" || !table.has_class("slide-table") {
        return Err(format!("expected table.slide-table, found <{}>", table.name));
    }
    let style = Style::of(table)?;
    allow(table, &style, &[], &[TABLE_CSS])?;
    let mut children = dom.elements_of(&table.children)?.into_iter().peekable();
    let colgroup = children
        .next_if(|c| c.name == "colgroup")
        .ok_or("table.slide-table must start with <colgroup>")?;
    let columns = dom
        .elements_of(&colgroup.children)?
        .into_iter()
        .map(|col| {
            let css = Style::of(col)?;
            allow(col, &css, &[], &[&["width"]])?;
            if col.name == "col" {
                css.require_px("width")
            } else {
                Err(format!("<colgroup> may hold only <col>, found <{}>", col.name))
            }
        })
        .collect::<Result<_, _>>()?;
    // The serializer writes rows straight under <table>; hand-written HTML may wrap them in <tbody>.
    let mut rows = Vec::new();
    for child in children {
        if child.name == "tbody" && Style::of(child)?.properties().next().is_none() && child.attrs().all(|a| a == "class") {
            rows.extend(dom.elements_of(&child.children)?);
        } else {
            rows.push(child);
        }
    }
    let rows = rows
        .into_iter()
        .enumerate()
        .map(|(i, row)| read_row(dom, row).map_err(|e| format!("row {}: {e}", i + 1)))
        .collect::<Result<_, _>>()?;
    Ok(Table { columns, rows })
}

fn read_row(dom: &Dom<'_>, row: &Element<'_>) -> Result<TableRow, String> {
    if row.name != "tr" {
        return Err(format!("expected <tr>, found <{}>", row.name));
    }
    let style = Style::of(row)?;
    allow(row, &style, &[], &[&["height"]])?;
    let cells = dom
        .elements_of(&row.children)?
        .into_iter()
        .enumerate()
        .map(|(i, cell)| read_cell(dom, cell).map_err(|e| format!("cell {}: {e}", i + 1)))
        .collect::<Result<_, _>>()?;
    Ok(TableRow {
        height: style.px("height")?,
        cells,
    })
}

fn read_cell(dom: &Dom<'_>, cell: &Element<'_>) -> Result<TableCell, String> {
    if cell.name != "td" {
        return Err(format!("expected <td>, found <{}>", cell.name));
    }
    let style = Style::of(cell)?;
    allow(cell, &style, &[CELL_ATTRS], &[CELL_CSS])?;
    let span = |name: &str| -> Result<u32, String> {
        let value = cell.attr(name)?.ok_or_else(|| format!("attribute '{name}' is missing"))?;
        integer(&value).map_err(|e| format!("attribute '{name}': {e}"))
    };
    let mut borders = Vec::with_capacity(SIDES.len());
    for side in SIDES {
        borders.push(border(cell, &style, side)?);
    }
    let borders: [TableBorder; 4] = borders.try_into().map_err(|_| "internal: four borders")?;

    let [content] = dom.elements_of(&cell.children)?[..] else {
        return Err("a <td> must hold one div.table-cell-text".into());
    };
    if content.name != "div" || !content.has_class("table-cell-text") {
        return Err(format!("expected div.table-cell-text, found <{}>", content.name));
    }
    let text_style = Style::of(content)?;
    allow(content, &text_style, &[text::BOX_ATTRS], &[text::BOX_CSS, CELL_TEXT_CSS])?;
    let [text_content] = dom.elements_of(&content.children)?[..] else {
        return Err("div.table-cell-text must hold one div.text-content".into());
    };
    Ok(TableCell {
        text: text_box(dom, content, &text_style, text_content)?,
        colspan: span("colspan")?,
        rowspan: span("rowspan")?,
        fill: style.get("background-color").map(|color| FillModel {
            visible: true,
            color: color.to_owned(),
        }),
        borders,
    })
}

/// `border-<side>: <width>px <style> <color>`, or `0px none transparent` when hidden, and the
/// side's `data-border-<side>-dash-array`.
fn border(cell: &Element<'_>, style: &Style<'_>, side: &str) -> Result<TableBorder, String> {
    let property = format!("border-{side}");
    let value = style.require(&property)?;
    let dash_array = cell.attr(&format!("data-border-{side}-dash-array"))?.map(|d| d.into_owned());
    if value == HIDDEN_BORDER {
        return Ok(TableBorder {
            visible: false,
            color: "transparent".to_owned(),
            width: 0.0,
            dash_array,
        });
    }
    let invalid = || format!("CSS property '{property}': '{value}' is not '<width>px <solid|dashed> <color>' or '{HIDDEN_BORDER}'");
    let (width, rest) = value.split_once(' ').ok_or_else(invalid)?;
    let (line_style, color) = rest.split_once(' ').ok_or_else(invalid)?;
    if !matches!(line_style, "solid" | "dashed") {
        return Err(invalid());
    }
    Ok(TableBorder {
        visible: true,
        color: color.trim_ascii().to_owned(),
        width: super::style::px(width).map_err(|e| format!("CSS property '{property}': {e}"))?,
        dash_array,
    })
}

#[cfg(test)]
mod tests {
    use crate::model::{SlideObject, TableObject};
    use crate::profile::parse;
    use crate::profile::tests::document;

    const TEXT: &str = r#"<div class="table-cell-text" data-text-fit="none" data-text-direction="vertical" style="display: flex; box-sizing: border-box; width: 100%; overflow: hidden; padding: 1px 2px 3px 4px; align-items: center; white-space: pre-wrap; overflow-wrap: break-word; direction: ltr; border-radius: 0%;"><div class="text-content" style="width: 100%; writing-mode: vertical-lr; text-orientation: mixed; height: 100%;"></div></div>"#;

    fn table(rows: &str) -> Result<TableObject, String> {
        let html = document(&format!(
            r#"<div class="slide-element slide-table-container" data-object-name="Tb" style="left: 48px; top: 96px; width: 200px; transform-origin: center; border-style: none;"><table class="slide-table" style="width: 200px; table-layout: fixed; border-collapse: collapse; border-spacing: 0;"><colgroup><col style="width: 100px"><col style="width: 100px"></colgroup>{rows}</table></div>"#
        ));
        match parse(&html)?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Table(object)) => Ok(object),
            _ => Err("not a table".into()),
        }
    }

    fn cell(span: &str, borders: &str) -> String {
        format!(r#"<td {span} style="padding: 0px; overflow: hidden; position: relative; vertical-align: middle; {borders}">{TEXT}</td>"#)
    }

    const BORDERS: &str =
        "border-top: 2px dashed #C00000; border-right: 0px none transparent; border-bottom: 1px solid rgba(0, 0, 0, 0.5); border-left: 0px none transparent;";

    #[test]
    fn reads_grid_rows_cells_and_borders() {
        let rows = format!(
            r#"<tr style="height: 40px">{}</tr><tbody><tr>{}{}</tr></tbody>"#,
            cell(
                r#"colspan="2" rowspan="1" data-border-top-dash-array="8 2.67""#,
                &format!("background-color: #F2F2F2; {BORDERS}")
            ),
            cell(r#"colspan="1" rowspan="1""#, BORDERS),
            cell(r#"colspan="1" rowspan="1""#, BORDERS),
        );
        let object = table(&rows).unwrap();
        assert_eq!(object.table.columns, [100.0, 100.0]);
        let [first, second] = &object.table.rows[..] else { panic!("two rows") };
        assert_eq!((first.height, second.height, second.cells.len()), (Some(40.0), None, 2));
        let c = first.cells.first().expect("cell");
        assert_eq!((c.colspan, c.rowspan, c.fill.as_ref().map(|f| f.color.as_str())), (2, 1, Some("#F2F2F2")));
        let [top, right, bottom, _] = &c.borders;
        assert_eq!(
            (top.visible, top.width, top.color.as_str(), top.dash_array.as_deref()),
            (true, 2.0, "#C00000", Some("8 2.67"))
        );
        assert!(!right.visible);
        assert_eq!(bottom.color, "rgba(0, 0, 0, 0.5)");
        assert_eq!(
            (c.text.margin, c.text.direction.as_str(), c.text.vertical_align.as_str()),
            ([1.0, 2.0, 3.0, 4.0], "vertical", "middle")
        );
    }

    #[test]
    fn rejects_out_of_profile_tables() {
        for rows in [
            format!("<tr>{}</tr>", cell(r#"colspan="1""#, BORDERS)),
            format!("<tr>{}</tr>", cell(r#"colspan="x" rowspan="1""#, BORDERS)),
            format!("<tr>{}</tr>", cell(r#"colspan="1" rowspan="1""#, &BORDERS.replace("2px dashed", "2px double"))),
            format!(
                "<tr>{}</tr>",
                cell(r#"colspan="1" rowspan="1""#, &BORDERS.replace("border-left: 0px none transparent;", ""))
            ),
            format!("<tr>{}</tr>", cell(r#"colspan="1" rowspan="1" headers="x""#, BORDERS)),
            format!(
                "<tr>{}</tr>",
                cell(r#"colspan="1" rowspan="1""#, BORDERS).replace("<td", "<th").replace("</td>", "</th>")
            ),
            "<caption></caption>".to_owned(),
        ] {
            let error = table(&rows).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'Tb': "), "{rows}: {error}");
        }
    }
}
