//! Tab stops: each tab is a zero-height inline box whose width carries the pen to the next stop.

use parley::{Cluster, InlineBox, InlineBoxKind, Layout, VerticalAlign};

use crate::model::{TabAlign, TabStop};
use crate::text::layout::Brush;

/// Stands in for a tab in the laid-out text: parley sizes an in-flow inline box at each one.
pub(crate) const TAB_PLACEHOLDER: char = '\u{FFFC}';

/// The zero-width box for the tab at byte `index`; `place_tabs` widens it.
pub(crate) fn tab_box(id: usize, index: usize) -> InlineBox {
    InlineBox {
        id: id as u64,
        kind: InlineBoxKind::InFlow,
        index,
        width: 0.0,
        height: 0.0,
        baseline: None,
        vertical_align: VerticalAlign::default(),
    }
}

/// Where a tab at `pos` (px from the text area's left edge) jumps to: the first explicit stop past it,
/// else the next multiple of `default_stop`, as LibreOffice and PowerPoint do after the last stop.
fn next_stop(stops: &[TabStop], default_stop: f32, pos: f32) -> Option<TabStop> {
    if let Some(stop) = stops.iter().find(|s| s.position > pos) {
        return Some(*stop);
    }
    (default_stop > 0.0).then(|| TabStop {
        position: ((pos / default_stop).floor() + 1.0) * default_stop,
        alignment: TabAlign::Left,
    })
}

/// Line-relative x of the cluster at byte `index`.
fn x_at(layout: &Layout<Brush>, index: usize) -> Option<(f32, f32)> {
    let cluster = Cluster::from_byte_index(layout, index)?;
    let metrics = cluster.line().metrics();
    Some((cluster.visual_offset()? - metrics.offset - metrics.inline_min_coord, cluster.advance()))
}

/// Widens the tab boxes at byte offsets `tabs` (in `text`, pushed with `tab_box` in this order) so
/// each tab ends at its stop: a left stop starts the following text there, a right stop ends it there,
/// a center stop centres it, a decimal stop puts its first '.' there (or ends it, without one). The
/// following text runs to the next tab on the line or the line end. `indent` is the layout's left edge
/// in the text area, where stop positions start. Re-breaks the lines after each tab, since a wider tab
/// moves everything after it.
pub(crate) fn place_tabs(layout: &mut Layout<Brush>, text: &str, tabs: &[usize], stops: &[TabStop], default_stop: f32, indent: f32, max_w: Option<f32>) {
    for (k, &index) in tabs.iter().enumerate() {
        let Some((start, current)) = x_at(layout, index) else { continue };
        let Some((line_end, end_x)) = Cluster::from_byte_index(layout, index).map(|c| {
            let line = c.line();
            (line.text_range().end, line.metrics().advance - line.metrics().hanging_advance)
        }) else {
            continue;
        };
        let pos = indent + start;
        let Some(stop) = next_stop(stops, default_stop, pos) else { continue };
        // The text the stop aligns: up to the next tab on this line, or the line end.
        let after = index + TAB_PLACEHOLDER.len_utf8();
        let next = tabs.get(k + 1).copied().filter(|&n| n < line_end);
        let segment_end = next.and_then(|n| x_at(layout, n)).map_or(end_x, |(x, _)| x);
        let segment = (segment_end - start - current).max(0.0);
        let lead = match stop.alignment {
            TabAlign::Left => 0.0,
            TabAlign::Right => segment,
            TabAlign::Center => segment / 2.0,
            TabAlign::Decimal => text
                .get(after..next.unwrap_or(line_end))
                .and_then(|s| s.find('.'))
                .and_then(|dot| x_at(layout, after + dot))
                .map_or(segment, |(x, _)| x - start - current),
        };
        let width = (stop.position - pos - lead).max(0.0);
        layout.edit_inline_box(k, |b| b.width = width);
        layout.break_all_lines(max_w);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jumps_to_the_next_explicit_stop_then_to_default_multiples() {
        let stops = [
            TabStop {
                position: 100.0,
                alignment: TabAlign::Right,
            },
            TabStop {
                position: 250.0,
                alignment: TabAlign::Decimal,
            },
        ];
        assert_eq!(next_stop(&stops, 96.0, 10.0).map(|s| (s.position, s.alignment)), Some((100.0, TabAlign::Right)));
        assert_eq!(
            next_stop(&stops, 96.0, 100.0).map(|s| (s.position, s.alignment)),
            Some((250.0, TabAlign::Decimal))
        );
        assert_eq!(next_stop(&stops, 96.0, 260.0).map(|s| (s.position, s.alignment)), Some((288.0, TabAlign::Left)));
        assert_eq!(next_stop(&[], 96.0, 0.0).map(|s| s.position), Some(96.0));
        assert!(next_stop(&[], 0.0, 5.0).is_none());
    }
}
