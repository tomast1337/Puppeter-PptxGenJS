//! Tab stops: each tab is a zero-height inline box whose width carries the pen to the next stop.

use parley::{Alignment, BreakReason, Cluster, InlineBox, InlineBoxKind, Layout, Line, VerticalAlign};

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

/// A tab that ends text on a stop (a right stop) sits on it: positions within this many px before a
/// stop count as on it, so float rounding cannot send the next tab back to the same stop.
const ON_STOP: f32 = 0.01;

/// Where a tab at `pos` (px from the text area's left edge) jumps to: the first explicit stop past it,
/// else the next multiple of `default_stop`, as LibreOffice and PowerPoint do after the last stop.
fn next_stop(stops: &[TabStop], default_stop: f32, pos: f32) -> Option<TabStop> {
    let pos = pos + ON_STOP;
    if let Some(stop) = stops.iter().find(|s| s.position > pos) {
        return Some(*stop);
    }
    (default_stop > 0.0).then(|| TabStop {
        position: ((pos / default_stop).floor() + 1.0) * default_stop,
        alignment: TabAlign::Left,
    })
}

/// Bytes of paragraph text that tab placement may re-break, summed over its re-breaks, per layout
/// pass. Past it the remaining tabs are placed on the lines as last broken, and the caller warns. A
/// 1 KB paragraph keeps 1,024 re-breaks, far more than it has lines; a hostile 100 KB one keeps 10,
/// where re-breaking after every tab took minutes (#161).
pub(crate) const MAX_TAB_REBREAK_BYTES: usize = 1 << 20;

/// How close (px) a widened line may come to the wrap width before the lines are re-broken: margin
/// for float sums that differ from parley's own by rounding.
const OVERFLOW_SLACK: f32 = 0.01;

/// Byte offset, line-relative x and advance of one cluster of a line.
pub(crate) type ClusterX = (usize, f32, f32);

/// Where the stops are and how wide the lines are, for `place_tabs`.
pub(crate) struct TabRuler<'a> {
    pub(crate) stops: &'a [TabStop],
    pub(crate) default_stop: f32,
    /// The layout's left edge in the text area, where stop positions start.
    pub(crate) indent: f32,
    pub(crate) max_w: Option<f32>,
}

/// What `place_tabs` did besides setting the widths.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct TabPlacement {
    /// Times the lines were re-broken because a widened tab moved text across lines or respaced it.
    pub(crate) rebreaks: usize,
    /// `MAX_TAB_REBREAK_BYTES` ran out: later tabs were placed on the lines as last broken.
    pub(crate) capped: bool,
}

/// Fills `out` with the clusters of `line` sorted by byte offset, their x summed in visual order with
/// the float operations of parley's `Cluster::visual_offset` (so the same x to the last bit), but once
/// per line instead of once per cluster. Returns whether the line has RTL runs.
fn measure_line(line: &Line<'_, Brush>, out: &mut Vec<ClusterX>) -> bool {
    out.clear();
    let metrics = line.metrics();
    let (mut x, mut rtl) = (metrics.offset + metrics.inline_min_coord, false);
    for run in line.runs() {
        rtl |= run.is_rtl();
        let mut cluster_x = x;
        for cluster in run.visual_clusters() {
            out.push((
                cluster.text_range().start,
                cluster_x - metrics.offset - metrics.inline_min_coord,
                cluster.advance(),
            ));
            cluster_x += cluster.advance();
        }
        x += run.advance();
    }
    out.sort_unstable_by_key(|c| c.0);
    rtl
}

/// Line-relative x, plus `shift`, and advance of the cluster at byte `index` in `measure_line`'s output.
fn x_at(clusters: &[ClusterX], shift: f32, index: usize) -> Option<(f32, f32)> {
    let i = clusters.binary_search_by_key(&index, |c| c.0).ok()?;
    clusters.get(i).map(|&(_, x, advance)| (x + shift, advance))
}

/// Widens the tab boxes at byte offsets `tabs` (in `text`, pushed with `tab_box` in this order) so
/// each tab ends at its stop: a left stop starts the following text there, a right stop ends it there,
/// a center stop centres it, a decimal stop puts its first '.' there (or ends it, without one). The
/// following text runs to the next tab on the line or the line end. `clusters` is scratch space.
///
/// Each line is measured once: a wider tab only pushes the rest of its line right, so later tabs on
/// it read their x plus the width added so far. The lines are re-broken only where that does not
/// hold: the widened line no longer fits (text moves to the next line), it is justified, or it has
/// RTL runs. Lines that still fit keep their breaks, so one final break settles them.
pub(crate) fn place_tabs(layout: &mut Layout<Brush>, text: &str, tabs: &[usize], ruler: &TabRuler<'_>, clusters: &mut Vec<ClusterX>) -> TabPlacement {
    let budget = MAX_TAB_REBREAK_BYTES / text.len().max(1);
    let justify = layout.alignment() == Some(Alignment::Justify);
    let mut done = TabPlacement::default();
    let mut unsettled = false;
    let mut k = 0;
    while let Some(&first) = tabs.get(k) {
        let Some(line) = Cluster::from_byte_index(layout, first).map(|c| c.line()) else {
            k += 1;
            continue;
        };
        // At least past `first`, so every pass places a tab and the loop ends.
        let line_end = line.text_range().end.max(first + 1);
        let end_x = line.metrics().advance - line.metrics().hanging_advance;
        let justified = justify && !matches!(line.break_reason(), BreakReason::None | BreakReason::Explicit);
        let reshapes = measure_line(&line, clusters) || justified;
        // Width added to the tabs placed so far on this line, which moves everything after them.
        let mut shift = 0.0f32;
        while let Some(&index) = tabs.get(k).filter(|&&i| i < line_end) {
            let tab = k;
            k += 1;
            let Some((start, current)) = x_at(clusters, shift, index) else { continue };
            let pos = ruler.indent + start;
            let Some(stop) = next_stop(ruler.stops, ruler.default_stop, pos) else {
                continue;
            };
            // The text the stop aligns: up to the next tab on this line, or the line end.
            let after = index + TAB_PLACEHOLDER.len_utf8();
            let next = tabs.get(k).copied().filter(|&n| n < line_end);
            let segment_end = next.and_then(|n| x_at(clusters, shift, n)).map_or(end_x + shift, |(x, _)| x);
            let segment = (segment_end - start - current).max(0.0);
            let lead = match stop.alignment {
                TabAlign::Left => 0.0,
                TabAlign::Right => segment,
                TabAlign::Center => segment / 2.0,
                TabAlign::Decimal => text
                    .get(after..next.unwrap_or(line_end))
                    .and_then(|s| s.find('.'))
                    .and_then(|dot| x_at(clusters, shift, after + dot))
                    .map_or(segment, |(x, _)| x - start - current),
            };
            let width = (stop.position - pos - lead).max(0.0);
            layout.edit_inline_box(tab, |b| b.width = width);
            shift += width - current;
            unsettled = true;
            let overflows = ruler.max_w.is_some_and(|w| end_x + shift > w - OVERFLOW_SLACK);
            if (reshapes || overflows) && !done.capped {
                if done.rebreaks < budget {
                    layout.break_all_lines(ruler.max_w);
                    done.rebreaks += 1;
                    unsettled = false;
                    // Measure the line of the next tab again: the breaks after this tab may have moved.
                    break;
                }
                done.capped = true;
            }
        }
    }
    if unsettled {
        layout.break_all_lines(ruler.max_w);
    }
    done
}

#[cfg(test)]
mod tests {
    use super::*;
    use parley::fontique::{Blob, Collection, CollectionOptions};
    use parley::{AlignmentOptions, FontContext, LayoutContext, StyleProperty, TextWrapMode, WhiteSpaceCollapse};

    /// `text` (tabs as '\t') in 14pt (18.67px) Liberation Sans, broken at `max_w` with its tabs not yet placed:
    /// the layout, its text with placeholders and the tab offsets. None when the font is not installed.
    fn unplaced(text: &str, alignment: Alignment, max_w: Option<f32>) -> Option<(Layout<Brush>, String, Vec<usize>)> {
        let mut fonts = FontContext {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: false,
            }),
            ..FontContext::default()
        };
        fonts.collection.register_fonts(Blob::from(crate::tests::liberation_sans()?), None);
        let s = text.replace('\t', &TAB_PLACEHOLDER.to_string());
        let tabs: Vec<usize> = s.match_indices(TAB_PLACEHOLDER).map(|(i, _)| i).collect();
        let mut layout_cx = LayoutContext::new();
        let mut builder = layout_cx.ranged_builder(&mut fonts, &s, 1.0, false);
        builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
        builder.push_default(StyleProperty::TextWrapMode(TextWrapMode::Wrap));
        builder.push_default(StyleProperty::FontFamily("Liberation Sans".into()));
        builder.push_default(StyleProperty::FontSize(18.666666));
        for (k, &index) in tabs.iter().enumerate() {
            builder.push_inline_box(tab_box(k, index));
        }
        let mut layout: Layout<Brush> = builder.build(&s);
        layout.set_alignment(
            alignment,
            AlignmentOptions {
                align_when_overflowing: true,
                ..AlignmentOptions::default()
            },
        );
        layout.break_all_lines(max_w);
        Some((layout, s, tabs))
    }

    /// The placement before #161, kept as the reference: re-break every line after every tab and read
    /// each x from the re-broken layout.
    fn place_tabs_rebreaking_each(layout: &mut Layout<Brush>, text: &str, tabs: &[usize], ruler: &TabRuler<'_>) {
        let x_at = |layout: &Layout<Brush>, index| {
            let cluster = Cluster::from_byte_index(layout, index)?;
            let metrics = cluster.line().metrics();
            Some((cluster.visual_offset()? - metrics.offset - metrics.inline_min_coord, cluster.advance()))
        };
        for (k, &index) in tabs.iter().enumerate() {
            let Some((start, current)) = x_at(layout, index) else { continue };
            let Some((line_end, end_x)) = Cluster::from_byte_index(layout, index).map(|c| {
                let line = c.line();
                (line.text_range().end, line.metrics().advance - line.metrics().hanging_advance)
            }) else {
                continue;
            };
            let pos = ruler.indent + start;
            let Some(stop) = next_stop(ruler.stops, ruler.default_stop, pos) else {
                continue;
            };
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
            layout.break_all_lines(ruler.max_w);
        }
    }

    /// Every line's text range and alignment offset, then every cluster's line-relative x.
    fn geometry(layout: &Layout<Brush>) -> (Vec<(std::ops::Range<usize>, f32)>, Vec<ClusterX>) {
        let (mut all, mut clusters) = (Vec::new(), Vec::new());
        let lines = layout
            .lines()
            .map(|line| {
                measure_line(&line, &mut clusters);
                all.extend_from_slice(&clusters);
                (line.text_range(), line.metrics().offset)
            })
            .collect();
        (lines, all)
    }

    #[test]
    fn places_tabs_where_rebreaking_after_every_tab_did() {
        let stop = |position, alignment| TabStop { position, alignment };
        let custom = [
            stop(144.0, TabAlign::Left),
            stop(288.0, TabAlign::Right),
            stop(432.0, TabAlign::Decimal),
            stop(576.0, TabAlign::Center),
        ];
        let columns = "Item\tQty\t12.50\tNote\tx\nSecond row\t7\t1.5\tlonger note that wraps onto the next line\tend";
        let rtl = "abc\t\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{5E2}\u{5D5}\u{5DC}\u{5DD}\tdef\tg";
        let many = "word\t".repeat(200);
        fn ruler(stops: &[TabStop], max_w: Option<f32>) -> TabRuler<'_> {
            TabRuler {
                stops,
                default_stop: 96.0,
                indent: 0.0,
                max_w,
            }
        }
        let cases = [
            ("default stops, unwrapped", "a\tbb\tccc\t\td", Alignment::Left, ruler(&[], None)),
            ("custom stops, unwrapped", "a\tLeft\tEnd\t12.50\tMid\tx", Alignment::Left, ruler(&custom, None)),
            (
                "custom stops, tabs wrap the line",
                "a\tLeft\tEnd\t12.50\tMid\tx",
                Alignment::Left,
                ruler(&custom, Some(320.0)),
            ),
            ("columns, left", columns, Alignment::Left, ruler(&custom, Some(700.0))),
            ("columns, centered", columns, Alignment::Center, ruler(&custom, Some(700.0))),
            ("columns, right", columns, Alignment::Right, ruler(&custom, Some(700.0))),
            ("columns, justified", columns, Alignment::Justify, ruler(&custom, Some(700.0))),
            ("a right-to-left run", rtl, Alignment::Left, ruler(&custom, Some(700.0))),
            ("200 tabs over many lines", &many, Alignment::Left, ruler(&[], Some(500.0))),
            ("200 tabs, justified", &many, Alignment::Justify, ruler(&custom, Some(500.0))),
        ];
        // Every width where a widened tab may or may not push text to the next line.
        let mixed = "a\tbb\tccc\t\td and some more words\tafter tabs";
        let sweep = (150..900).step_by(2).flat_map(|w| {
            [Alignment::Left, Alignment::Right, Alignment::Center, Alignment::Justify]
                .map(|alignment| ("width sweep", mixed, alignment, ruler(&custom, Some(w as f32))))
        });
        for (name, text, alignment, ruler) in cases.into_iter().chain(sweep) {
            let max_w = ruler.max_w;
            let (Some((mut reference, s, tabs)), Some((mut layout, ..))) = (unplaced(text, alignment, max_w), unplaced(text, alignment, max_w)) else {
                return eprintln!("Liberation Sans not installed: tab placement not checked");
            };
            place_tabs_rebreaking_each(&mut reference, &s, &tabs, &ruler);
            place_tabs(&mut layout, &s, &tabs, &ruler, &mut Vec::new());

            let close = |a: f32, b: f32| (a - b).abs() < 1e-3;
            let widths = |layout: &Layout<Brush>| layout.inline_boxes().map(|b| b.width).collect::<Vec<_>>();
            let (want, got) = (widths(&reference), widths(&layout));
            assert!(
                want.iter().zip(&got).all(|(a, b)| close(*a, *b)),
                "{name} at {max_w:?}, {alignment:?}: tab widths {got:?} != {want:?}"
            );
            let ((want_lines, want_x), (got_lines, got_x)) = (geometry(&reference), geometry(&layout));
            assert_eq!(got_lines.len(), want_lines.len(), "{name}: line count");
            for ((want_range, want_offset), (got_range, got_offset)) in want_lines.iter().zip(&got_lines) {
                assert!(
                    want_range == got_range && close(*want_offset, *got_offset),
                    "{name}: line {got_range:?} at {got_offset} != {want_range:?} at {want_offset}"
                );
            }
            assert_eq!(got_x.len(), want_x.len(), "{name}: cluster count");
            for (want, got) in want_x.iter().zip(&got_x) {
                assert!(want.0 == got.0 && close(want.1, got.1), "{name}: cluster {got:?} != {want:?}");
            }
        }
    }

    #[test]
    fn many_tabs_break_the_lines_a_bounded_number_of_times() {
        // 100 KB of text: 10 re-breaks in the budget, where re-breaking after every tab did 20,000.
        let text = "word\t".repeat(20_000);
        let ruler = |max_w| TabRuler {
            stops: &[],
            default_stop: 96.0,
            indent: 0.0,
            max_w,
        };
        let (Some((mut unwrapped, s, tabs)), Some((mut wrapped, ..))) = (unplaced(&text, Alignment::Left, None), unplaced(&text, Alignment::Left, Some(500.0)))
        else {
            return eprintln!("Liberation Sans not installed: tab re-breaks not checked");
        };
        // Unwrapped, no tab moves text to another line: the one final break only.
        assert_eq!(place_tabs(&mut unwrapped, &s, &tabs, &ruler(None), &mut Vec::new()), TabPlacement::default());
        let last = unwrapped.inline_boxes().last().map(|b| b.width);
        assert!(last.is_some_and(|w| w > 0.0), "{last:?}");

        // Wrapped at 500px every line overflows once its tabs widen: the budget stops the re-breaks.
        let placed = place_tabs(&mut wrapped, &s, &tabs, &ruler(Some(500.0)), &mut Vec::new());
        let budget = MAX_TAB_REBREAK_BYTES / s.len();
        assert_eq!(
            placed,
            TabPlacement {
                rebreaks: budget,
                capped: true
            }
        );
    }

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
        // Text right-aligned to a stop ends a hair before it in float: the next tab still moves on.
        assert_eq!(next_stop(&stops, 96.0, 99.9999).map(|s| s.position), Some(250.0));
        assert_eq!(next_stop(&stops, 96.0, 260.0).map(|s| (s.position, s.alignment)), Some((288.0, TabAlign::Left)));
        assert_eq!(next_stop(&[], 96.0, 0.0).map(|s| s.position), Some(96.0));
        assert!(next_stop(&[], 0.0, 5.0).is_none());
    }
}
