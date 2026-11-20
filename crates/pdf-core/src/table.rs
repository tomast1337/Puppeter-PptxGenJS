//! Tables: origin cells placed on the column grid, rows sized to their text, then cell fills,
//! cell text (the text box layout and drawing) and borders.
//!
//! Normalization resolves what PptxGenJS decides: column widths, minimum row heights, inherited
//! cell options and pagination. What it cannot know without a text engine is how tall each row's
//! text is. PptxGenJS writes `<a:tr h>` as a minimum (0 for auto) and PowerPoint and LibreOffice
//! grow a row until its cells' text fits, so the rows are measured here with the same text layout
//! as text boxes. The Puppeteer renderer gets the same from Chromium's HTML table layout.

use krilla::color::rgb;
use krilla::geom::PathBuilder;
use krilla::paint::{LineCap, Stroke};
use krilla::surface::Surface;

use crate::Renderer;
use crate::color::unit;
use crate::model::{Table, TableBorder, TableCell, TextBox};
use crate::path::rect_path;
use crate::shape::dash_of;
use crate::text::layout::BoxLayout;

/// Text measured before the row heights are known lays out against this box height (px), so a
/// cell's content decides its row's height rather than the other way round.
const UNBOUNDED: f32 = 1.0e6;

/// One origin cell on the column grid.
#[derive(Clone, Copy, Debug, PartialEq)]
struct PlacedCell {
    /// Indices into `Table.rows` and that row's `cells`.
    row: usize,
    cell: usize,
    /// First grid column and the number of grid rows and columns it covers.
    col: usize,
    rows: usize,
    cols: usize,
}

/// Per-table scratch, owned by `Renderer` and reused across tables: each field is cleared and
/// refilled by `layout_table`, so cell text layouts keep their buffers.
#[derive(Default)]
pub(crate) struct TableLayout {
    cells: Vec<PlacedCell>,
    /// Parallel to `cells`; only grows, so unused trailing layouts keep their capacity.
    texts: Vec<BoxLayout>,
    /// Per grid column: the first row index not covered by a row span placed so far.
    busy_until: Vec<usize>,
    /// Grid line offsets from the table origin (px): `columns.len() + 1` and `rows.len() + 1` entries.
    col_x: Vec<f32>,
    row_y: Vec<f32>,
    /// The cell side drawn on each grid edge: horizontal edges line by line (`rows + 1` lines of
    /// `columns` edges), then vertical edges line by line (`columns + 1` lines of `rows` edges).
    h_edges: Vec<Option<Edge>>,
    v_edges: Vec<Option<Edge>>,
}

/// A cell side: an index into `TableLayout.cells` and the side's index in `TableCell.borders`.
type Edge = (usize, usize);

impl TableLayout {
    /// The table's laid-out height (px).
    pub(crate) fn height(&self) -> f32 {
        self.row_y.last().copied().unwrap_or(0.0)
    }
}

fn is_vertical(text: &TextBox) -> bool {
    text.direction.is_vertical()
}

/// HTML's cell placement, which is also how PptxGenJS expands `colspan`/`rowspan` into
/// `hMerge`/`vMerge` slots: each origin cell takes the next grid column its row has free, and a
/// span is clipped to the grid. Returns how many cells found no free column.
fn place_cells(table: &Table, busy_until: &mut Vec<usize>, out: &mut Vec<PlacedCell>) -> usize {
    let (row_count, col_count) = (table.rows.len(), table.columns.len());
    busy_until.clear();
    busy_until.resize(col_count, 0);
    out.clear();
    let mut dropped = 0;
    for (r, row) in table.rows.iter().enumerate() {
        let mut col = 0;
        for (i, cell) in row.cells.iter().enumerate() {
            while busy_until.get(col).is_some_and(|until| *until > r) {
                col += 1;
            }
            if col >= col_count {
                dropped += 1;
                continue;
            }
            let rows = (cell.rowspan.max(1) as usize).min(row_count - r);
            let cols = (cell.colspan.max(1) as usize).min(col_count - col);
            for until in busy_until.iter_mut().skip(col).take(cols) {
                *until = r + rows;
            }
            out.push(PlacedCell {
                row: r,
                cell: i,
                col,
                rows,
                cols,
            });
            col += cols;
        }
    }
    dropped
}

/// Grows `heights` (the rows' minimums) until every cell's `(first row, row count, height)` fits.
/// Single-row cells go first; a spanning cell then adds what its rows still lack to its last row.
fn grow_rows(heights: &mut [f32], needs: impl Iterator<Item = (usize, usize, f32)> + Clone) {
    for (row, _, need) in needs.clone().filter(|(_, rows, _)| *rows == 1) {
        if let Some(h) = heights.get_mut(row) {
            *h = h.max(need);
        }
    }
    // PowerPoint puts what a merged cell lacks on its last row: measured against its PDF export of a synthetic deck
    // (merged in pairs and threes, 2 to 5 lines), the other rows keep their own height.
    for (row, rows, need) in needs.filter(|(_, rows, _)| *rows > 1) {
        let spanned = heights.get(row..row + rows).map_or(0.0, |hs| hs.iter().sum::<f32>());
        if need > spanned
            && let Some(last) = heights.get_mut(row + rows - 1)
        {
            *last += need - spanned;
        }
    }
}

fn check_length(what: &str, index: usize, value: f32) -> Result<f32, String> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(format!("table {what} {index} has invalid size {value}: expected a finite px value >= 0"))
    }
}

/// The cell `placed` refers to. `place_cells` only records indices it read from the table.
fn cell_of<'t>(table: &'t Table, placed: &PlacedCell) -> &'t TableCell {
    table
        .rows
        .get(placed.row)
        .and_then(|row| row.cells.get(placed.cell))
        .expect("place_cells records indices of existing cells")
}

impl Renderer {
    /// Places the cells, lays out their text and resolves the grid lines into `out`.
    pub(crate) fn layout_table(&mut self, table: &Table, out: &mut TableLayout) -> Result<(), String> {
        out.col_x.clear();
        out.col_x.push(0.0);
        for (i, width) in table.columns.iter().enumerate() {
            let x = out.col_x.last().copied().unwrap_or(0.0) + check_length("column", i, *width)?;
            out.col_x.push(x);
        }
        // Row heights first; `row_y` becomes the running offsets once they are final.
        out.row_y.clear();
        for (i, row) in table.rows.iter().enumerate() {
            out.row_y.push(check_length("row", i, row.height.unwrap_or(0.0))?);
        }
        if place_cells(table, &mut out.busy_until, &mut out.cells) > 0 {
            self.warn("table cells beyond the column grid not rendered");
        }
        resolve_edges(table, out);
        if out.texts.len() < out.cells.len() {
            out.texts.resize_with(out.cells.len(), BoxLayout::default);
        }

        for (placed, layout) in out.cells.iter().zip(out.texts.iter_mut()) {
            // The profile parser accepts only `data-text-fit="none"` in a cell, so fit_text never shrinks here.
            let text = &cell_of(table, placed).text;
            let width = span(&out.col_x, placed.col, placed.cols);
            let height = span_sum(&out.row_y, placed.row, placed.rows);
            // Vertical text wraps against the row height, so it is laid out again below.
            let box_height = if is_vertical(text) && height > 0.0 { height } else { UNBOUNDED };
            self.fit_text(text, width, box_height, layout);
        }
        let needs = out.cells.iter().zip(&out.texts).map(|(placed, layout)| {
            let text = &cell_of(table, placed).text;
            let [top, _, bottom, _] = text.margin;
            let extent = if is_vertical(text) { layout.width } else { layout.height };
            (placed.row, placed.rows, extent + top + bottom)
        });
        grow_rows(&mut out.row_y, needs);

        for (placed, layout) in out.cells.iter().zip(out.texts.iter_mut()) {
            let text = &cell_of(table, placed).text;
            if is_vertical(text) {
                let (width, height) = (span(&out.col_x, placed.col, placed.cols), span_sum(&out.row_y, placed.row, placed.rows));
                self.fit_text(text, width, height, layout);
            }
        }
        let mut y = 0.0;
        for offset in out.row_y.iter_mut() {
            let height = *offset;
            *offset = y;
            y += height;
        }
        out.row_y.push(y);
        Ok(())
    }

    /// Draws a table laid out by `layout_table` with its top-left corner at `x, y` (px): every cell
    /// fill, then every cell's text, then every border, so a neighbour's fill never covers a border.
    pub(crate) fn draw_table(&mut self, surface: &mut Surface, table: &Table, layout: &TableLayout, x: f32, y: f32) -> Result<(), String> {
        let rect = |placed: &PlacedCell| {
            let (x0, y0) = (x + offset(&layout.col_x, placed.col), y + offset(&layout.row_y, placed.row));
            (
                x0,
                y0,
                span(&layout.col_x, placed.col, placed.cols),
                span(&layout.row_y, placed.row, placed.rows),
            )
        };
        for placed in &layout.cells {
            if let Some(color) = cell_of(table, placed).fill.as_ref().filter(|f| f.visible).map(|f| f.color) {
                let (cx, cy, w, h) = rect(placed);
                self.fill(surface, &rect_path(cx, cy, w, h, 0.0), color);
            }
        }
        for (placed, text_layout) in layout.cells.iter().zip(&layout.texts) {
            let (cx, cy, w, h) = rect(placed);
            self.draw_text(surface, &cell_of(table, placed).text, text_layout, cx, cy, w, h)?;
        }
        let (rows, cols) = (table.rows.len(), table.columns.len());
        for (line, edges) in layout.h_edges.chunks_exact(cols.max(1)).enumerate() {
            let at = y + offset(&layout.row_y, line);
            stroke_grid_line(surface, table, &layout.cells, edges, &layout.col_x, |along| (x + along, at));
        }
        for (line, edges) in layout.v_edges.chunks_exact(rows.max(1)).enumerate() {
            let at = x + offset(&layout.col_x, line);
            stroke_grid_line(surface, table, &layout.cells, edges, &layout.row_y, |along| (at, y + along));
        }
        Ok(())
    }
}

fn offset(lines: &[f32], index: usize) -> f32 {
    lines.get(index).copied().unwrap_or(0.0)
}

/// Distance between grid lines `index` and `index + count`.
fn span(lines: &[f32], index: usize, count: usize) -> f32 {
    offset(lines, index + count) - offset(lines, index)
}

/// Sum of `count` row heights starting at `index` (before they become offsets).
fn span_sum(heights: &[f32], index: usize, count: usize) -> f32 {
    heights.get(index..index + count).map_or(0.0, |hs| hs.iter().sum())
}

/// Which cell side draws each grid edge. An edge is drawn once, however many cells share it: the
/// wider line wins, as in CSS's collapsing border model, and on a tie the first cell in document
/// order keeps it. A hidden side never takes an edge from a visible one.
fn resolve_edges(table: &Table, out: &mut TableLayout) {
    let (rows, cols) = (table.rows.len(), table.columns.len());
    let TableLayout { cells, h_edges, v_edges, .. } = out;
    h_edges.clear();
    h_edges.resize((rows + 1) * cols, None);
    v_edges.clear();
    v_edges.resize((cols + 1) * rows, None);
    for (index, placed) in cells.iter().enumerate() {
        for col in placed.col..placed.col + placed.cols {
            claim(table, cells, h_edges, placed.row * cols + col, (index, 0));
            claim(table, cells, h_edges, (placed.row + placed.rows) * cols + col, (index, 2));
        }
        for row in placed.row..placed.row + placed.rows {
            claim(table, cells, v_edges, placed.col * rows + row, (index, 3));
            claim(table, cells, v_edges, (placed.col + placed.cols) * rows + row, (index, 1));
        }
    }
}

fn claim(table: &Table, cells: &[PlacedCell], edges: &mut [Option<Edge>], slot: usize, side: Edge) {
    let Some(border) = edge_border(table, cells, side).filter(|b| drawable(b)) else {
        return;
    };
    let Some(edge) = edges.get_mut(slot) else { return };
    if edge
        .and_then(|held| edge_border(table, cells, held))
        .is_none_or(|held| border.width > held.width)
    {
        *edge = Some(side);
    }
}

fn edge_border<'t>(table: &'t Table, cells: &[PlacedCell], (cell, side): Edge) -> Option<&'t TableBorder> {
    cells.get(cell).and_then(|placed| cell_of(table, placed).borders.get(side))
}

fn drawable(border: &TableBorder) -> bool {
    border.visible && border.width > 0.0 && border.width.is_finite() && border.color.3 > 0.0
}

/// Strokes one grid line: each run of neighbouring edges with the same border is one line, from
/// grid offset `along[start]` to `along[end]`, which `point` places on the page. PowerPoint and
/// LibreOffice also draw a run of cell sides as one line.
fn stroke_grid_line(surface: &mut Surface, table: &Table, cells: &[PlacedCell], edges: &[Option<Edge>], along: &[f32], point: impl Fn(f32) -> (f32, f32)) {
    let mut run: Option<(usize, &TableBorder)> = None;
    for i in 0..=edges.len() {
        let border = edges.get(i).copied().flatten().and_then(|edge| edge_border(table, cells, edge));
        if let Some((start, current)) = run {
            if border.is_some_and(|b| b.width == current.width && b.color == current.color && b.dash_array == current.dash_array) {
                continue;
            }
            stroke_border(surface, current, point(offset(along, start)), point(offset(along, i)));
        }
        run = border.map(|b| (i, b));
    }
}

/// Strokes a border line centred on the grid line, as DrawingML table borders are (`algn="ctr"`).
/// Solid lines get square caps so they close the corners they share with the lines across them.
fn stroke_border(surface: &mut Surface, border: &TableBorder, from: (f32, f32), to: (f32, f32)) {
    let color = border.color;
    let dash = border.dash_array.as_deref().and_then(dash_of);
    let mut pb = PathBuilder::new();
    pb.move_to(from.0, from.1);
    pb.line_to(to.0, to.1);
    let Some(path) = pb.finish() else { return };
    surface.set_fill(None);
    surface.set_stroke(Some(Stroke {
        paint: rgb::Color::new(color.0, color.1, color.2).into(),
        width: border.width,
        opacity: unit(color.3),
        line_cap: if dash.is_some() { LineCap::Butt } else { LineCap::Square },
        dash,
        ..Stroke::default()
    }));
    surface.draw_path(&path);
    surface.set_stroke(None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{TableRow, build};

    /// A test row: its minimum height and its cells' `(colspan, rowspan)`.
    type RowSpec<'a> = (Option<f32>, &'a [(u32, u32)]);

    /// A table model from `columns` and `rows`.
    fn table(columns: &[f32], rows: &[RowSpec]) -> Table {
        let border = || TableBorder {
            visible: true,
            color: build::css("#000000"),
            width: 1.0,
            dash_array: None,
        };
        let cell = |&(colspan, rowspan): &(u32, u32)| TableCell {
            text: build::text_box(Vec::new()),
            colspan,
            rowspan,
            fill: None,
            borders: [border(), border(), border(), border()],
        };
        let row = |&(height, cells): &RowSpec| TableRow {
            height,
            cells: cells.iter().map(cell).collect(),
        };
        Table {
            columns: columns.to_vec(),
            rows: rows.iter().map(row).collect(),
        }
    }

    fn placed(t: &Table) -> (Vec<(usize, usize, usize, usize)>, usize) {
        let (mut busy, mut out) = (Vec::new(), Vec::new());
        let dropped = place_cells(t, &mut busy, &mut out);
        (out.iter().map(|p| (p.row, p.col, p.rows, p.cols)).collect(), dropped)
    }

    #[test]
    fn places_merged_cells_like_html() {
        // The fixture's sizing table: a rowspan in column 0 and colspans beside it.
        let t = table(
            &[144.0, 240.0, 192.0, 288.0],
            &[
                (None, &[(1, 1), (1, 1), (1, 1), (1, 1)]),
                (None, &[(1, 2), (2, 1), (1, 1)]),
                (None, &[(2, 1), (1, 1)]),
                (None, &[(1, 1), (1, 1), (1, 1), (1, 1)]),
            ],
        );
        let (cells, dropped) = placed(&t);
        assert_eq!(dropped, 0);
        assert_eq!(&cells[4..9], &[(1, 0, 2, 1), (1, 1, 1, 2), (1, 3, 1, 1), (2, 1, 1, 2), (2, 3, 1, 1)]);
    }

    #[test]
    fn clips_spans_to_the_grid_and_counts_cells_without_a_column() {
        let t = table(&[10.0, 10.0], &[(None, &[(5, 9)]), (None, &[(1, 1)])]);
        assert_eq!(placed(&t), (vec![(0, 0, 2, 2)], 1));
    }

    #[test]
    fn grows_rows_to_their_cells_and_spans_into_the_last_row() {
        let mut heights = [10.0, 0.0, 5.0];
        let needs = [(0, 1, 4.0), (1, 1, 12.0), (0, 3, 40.0), (2, 1, 8.0)];
        grow_rows(&mut heights, needs.iter().copied());
        // Row minimums 10, 12, 8 (sum 30); the 3-row cell needs 40, so the last row gets 10 more.
        assert_eq!(heights, [10.0, 12.0, 18.0]);
    }

    #[test]
    fn lays_out_rows_from_minimums_and_text() {
        let mut r = Renderer::new();
        let t = table(&[50.0, 30.0], &[(Some(20.0), &[(2, 1)]), (None, &[(1, 1), (1, 1)])]);
        let mut layout = TableLayout::default();
        r.layout_table(&t, &mut layout).unwrap();
        assert_eq!(layout.col_x, [0.0, 50.0, 80.0]);
        // Row 0 keeps its 20 px minimum; row 1 has no text and no minimum.
        assert_eq!(layout.row_y, [0.0, 20.0, 20.0]);
        assert_eq!(layout.height(), 20.0);
    }

    #[test]
    fn draws_each_shared_edge_once_and_the_wider_side_wins() {
        // Two rows; the second row's first cell spans both columns.
        let mut t = table(&[10.0, 10.0], &[(None, &[(1, 1), (1, 1)]), (None, &[(2, 1)])]);
        t.rows[1].cells[0].borders[0].width = 2.0;
        t.rows[0].cells[1].borders[1].visible = false;
        let mut layout = TableLayout::default();
        Renderer::new().layout_table(&t, &mut layout).unwrap();
        // Row line 1 (cells 0 and 1 above, cell 2 below): the spanning cell's wider top wins both edges.
        assert_eq!(
            layout.h_edges,
            [Some((0, 0)), Some((1, 0)), Some((2, 0)), Some((2, 0)), Some((2, 2)), Some((2, 2))]
        );
        // Column line 1 is shared by cells 0 and 1: the first keeps it. Cell 1's hidden right side leaves line 2's row 0 to nobody.
        assert_eq!(layout.v_edges, [Some((0, 3)), Some((2, 3)), Some((0, 1)), None, None, Some((2, 1))]);
    }

    #[test]
    fn rejects_invalid_sizes() {
        let mut r = Renderer::new();
        for (columns, height) in [(&[-1.0f32][..], None), (&[f32::INFINITY][..], None), (&[10.0][..], Some(-5.0))] {
            let mut t = table(&[10.0], &[(height, &[(1, 1)])]);
            t.columns = columns.to_vec();
            assert!(r.layout_table(&t, &mut TableLayout::default()).is_err(), "{columns:?} {height:?}");
        }
    }
}
