//! Text box layout: runs to parley layouts, shrink-to-fit, bullets.

use std::ops::Range;

use parley::{
    Alignment, AlignmentOptions, BaseDirection, FontStyle, FontWeight, Layout, OverflowWrap, PositionedLayoutItem, StyleProperty, TextWrapMode,
    WhiteSpaceCollapse,
};

use crate::Renderer;
use crate::color::{Rgba, parse_color};
use crate::model::{LineBox, TextBox};
use crate::text::font::family_stack;
use crate::text::tabs::{TAB_PLACEHOLDER, place_tabs, tab_box};

/// Per-run paint data that parley does not carry; the parley brush is the index.
#[derive(Clone)]
pub(crate) struct RunPaint {
    pub(crate) color: Rgba,
    pub(crate) highlight: Option<Rgba>,
    pub(crate) outline: Option<(Rgba, f32)>,
    pub(crate) underline: bool,
    pub(crate) underline_color: Option<Rgba>,
    pub(crate) strike: bool,
    pub(crate) double_strike: bool,
    pub(crate) baseline_offset: f32,
    /// (paragraph, run) of the run's `link` in its `TextBox`.
    pub(crate) link: Option<(u32, u32)>,
}

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub(crate) struct Brush(pub(crate) u32);

pub(crate) struct ParaLayout {
    pub(crate) text: String,
    pub(crate) layout: Layout<Brush>,
    pub(crate) x: f32,
    pub(crate) y: f32,
    /// This paragraph's line baselines in `BoxLayout::baselines`, below `y`.
    pub(crate) baselines: Range<usize>,
    pub(crate) marker: Option<(String, Layout<Brush>, f32)>,
}

#[derive(Default)]
pub(crate) struct BoxLayout {
    pub(crate) paras: Vec<ParaLayout>,
    pub(crate) paints: Vec<RunPaint>,
    /// Every paragraph's line baselines, one flat buffer so it keeps its capacity across boxes.
    pub(crate) baselines: Vec<f32>,
    pub(crate) width: f32,
    pub(crate) height: f32,
}

impl Renderer {
    /// Lays the box out, applying the current renderer's shrink-to-fit rule:
    /// scale fonts (and px line heights) by 0.95 up to 20 times while the
    /// content overflows the inset box. Fills `layout`, reusing its buffers.
    pub(crate) fn fit_text(&mut self, text: &TextBox, w: f32, h: f32, layout: &mut BoxLayout) {
        let [top, right, bottom, left] = text.margin;
        let vertical = text.direction == "vertical" || text.direction == "vertical270";
        let (inner_w, inner_h) = if vertical {
            (h - top - bottom, w - left - right)
        } else {
            (w - left - right, h - top - bottom)
        };
        let mut scale = 1.0;
        self.layout_text(text, inner_w, scale, layout);
        if text.fit == "shrink" {
            for _ in 0..20 {
                if layout.height <= inner_h + 0.5 && layout.width <= inner_w + 0.5 {
                    break;
                }
                scale *= 0.95;
                self.layout_text(text, inner_w, scale, layout);
            }
        }
    }

    /// Lays out every paragraph into `out`, replacing what it held.
    fn layout_text(&mut self, text: &TextBox, inner_w: f32, scale: f32, out: &mut BoxLayout) {
        out.paras.clear();
        out.paints.clear();
        out.baselines.clear();
        let paints = &mut out.paints;
        let (mut y, mut width) = (0.0f32, 0.0f32);
        let stacked = text.direction == "stacked";
        for (p, paragraph) in (0u32..).zip(&text.paragraphs) {
            let (indent, marker_x) = match &paragraph.bullet {
                Some(b) => (b.indent, b.indent / (b.level as f32 + 1.0) * b.level as f32),
                None => (0.0, 0.0),
            };
            let max_w = if text.wrap { Some((inner_w - indent).max(1.0)) } else { None };

            // Runs -> one string plus one style span per run, zipped with `paragraph.runs`.
            // Empty paragraphs keep a line box: a single span styled by the first run.
            let mut s = String::new();
            let mut spans = std::mem::take(&mut self.span_ranges);
            spans.clear();
            let mut tabs = std::mem::take(&mut self.tab_indices);
            tabs.clear();
            for (i, run) in paragraph.runs.iter().enumerate() {
                // The break belongs to the run's span: parley dropped the text after a newline outside every span.
                let start = s.len();
                if run.soft_break_before && i > 0 {
                    s.push('\n');
                }
                for (i, part) in run.text.split('\t').enumerate() {
                    if i > 0 {
                        stack_break(&mut s, stacked);
                        tabs.push(s.len());
                        s.push(TAB_PLACEHOLDER);
                    }
                    if stacked {
                        for c in part.chars() {
                            stack_break(&mut s, stacked);
                            s.push(c);
                        }
                    } else {
                        s.push_str(part);
                    }
                }
                spans.push(start..s.len());
            }
            let first = paragraph.runs.first();
            if s.is_empty() {
                s.push('\u{200B}');
                spans.clear();
                spans.push(0..s.len());
            }

            // LibreOffice's font-independent line box, not parley's font metrics, places the lines (draw_layout).
            let line_box = LineBox {
                height: paragraph.line_box.height * scale,
                baseline: paragraph.line_box.baseline * scale,
            };
            let mut builder = self.layout_cx.ranged_builder(&mut self.fonts, &s, 1.0, false);
            builder.set_base_direction(if paragraph.rtl { BaseDirection::Rtl } else { BaseDirection::Ltr });
            builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
            builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
            builder.push_default(StyleProperty::TextWrapMode(if text.wrap { TextWrapMode::Wrap } else { TextWrapMode::NoWrap }));
            let mut families = std::mem::take(&mut self.span_families);
            families.clear();
            families.extend(paragraph.runs.iter().take(spans.len()).map(|run| family_stack(&run.font_face)));
            for (r, ((range, run), family)) in (0u32..).zip(spans.iter().zip(&paragraph.runs).zip(&families)) {
                let index = paints.len() as u32;
                let color = parse_color(&run.color).unwrap_or_default();
                paints.push(RunPaint {
                    color,
                    highlight: run.highlight.as_deref().and_then(parse_color),
                    outline: run.outline.as_ref().and_then(|o| parse_color(&o.color).map(|c| (c, o.width))),
                    underline: run.decoration.underline,
                    underline_color: run.decoration.underline_color.as_deref().and_then(parse_color),
                    strike: run.decoration.strike,
                    double_strike: run.decoration.double_strike,
                    baseline_offset: run.baseline_offset,
                    link: run.link.is_some().then_some((p, r)),
                });
                let r = range.clone();
                builder.push(StyleProperty::FontFamily(family.as_str().into()), r.clone());
                builder.push(StyleProperty::FontSize(run.font_size * scale), r.clone());
                builder.push(
                    StyleProperty::FontWeight(if run.bold { FontWeight::BOLD } else { FontWeight::NORMAL }),
                    r.clone(),
                );
                builder.push(
                    StyleProperty::FontStyle(if run.italic { FontStyle::Italic } else { FontStyle::Normal }),
                    r.clone(),
                );
                builder.push(StyleProperty::Brush(Brush(index)), r.clone());
                if run.character_spacing != 0.0 {
                    builder.push(StyleProperty::LetterSpacing(run.character_spacing), r.clone());
                }
            }
            // parley tries the run's own stack before the emoji family, so a text font that has
            // U+2764 wins even with VS16. Force emoji presentation: base char + U+FE0F go to the emoji font.
            // shortcut: covers only `X U+FE0F`; ZWJ/keycap sequences already resolve via parley's emoji path.
            for (i, _) in s.match_indices('\u{FE0F}') {
                if let Some((start, _)) = s[..i].char_indices().next_back() {
                    builder.push(StyleProperty::FontFamily("\"Noto Color Emoji\"".into()), start..i + 3);
                }
            }
            for (k, &index) in tabs.iter().enumerate() {
                builder.push_inline_box(tab_box(k, index));
            }
            let mut layout: Layout<Brush> = builder.build(&s);
            self.span_ranges = spans;
            self.span_families = families;
            for run in &paragraph.runs {
                if run.glow.is_some() || run.shadow.as_ref().is_some_and(|s| s.visible) {
                    self.warn("text glow/shadow not rendered");
                }
            }
            let alignment = match paragraph.align.as_str() {
                "center" => Alignment::Center,
                "right" => Alignment::Right,
                "justify" => Alignment::Justify,
                _ => Alignment::Left,
            };
            // parley applies the alignment while breaking lines, so set it first.
            layout.set_alignment(
                alignment,
                AlignmentOptions {
                    align_when_overflowing: true,
                    ..AlignmentOptions::default()
                },
            );
            layout.break_all_lines(max_w);
            if !tabs.is_empty() {
                if paragraph.rtl {
                    // shortcut: stops are measured from the left; mirror them for RTL paragraphs when a deck needs it.
                    self.warn("tab stops in right-to-left paragraphs measured from the left");
                }
                place_tabs(&mut layout, &s, &tabs, &paragraph.tab_stops, paragraph.default_tab_stop, indent, max_w);
            }
            self.tab_indices = tabs;

            // Unwrapped text: align the single line manually against the inset box.
            let x = indent
                + if max_w.is_none() {
                    let slack = inner_w - indent - layout.width();
                    match alignment {
                        Alignment::Center => slack / 2.0,
                        Alignment::Right => slack,
                        _ => 0.0,
                    }
                } else {
                    0.0
                };

            let marker = match (&paragraph.bullet, first) {
                (Some(b), Some(run)) => {
                    let mut mb = self.layout_cx.ranged_builder(&mut self.fonts, &b.marker, 1.0, false);
                    let index = paints.len() as u32;
                    paints.push(RunPaint {
                        color: parse_color(&run.color).unwrap_or_default(),
                        highlight: None,
                        outline: None,
                        underline: false,
                        underline_color: None,
                        strike: false,
                        double_strike: false,
                        baseline_offset: 0.0,
                        link: None,
                    });
                    mb.push_default(StyleProperty::FontFamily(family_stack(&run.font_face).as_str().into()));
                    mb.push_default(StyleProperty::FontSize(run.font_size * scale));
                    mb.push_default(StyleProperty::Brush(Brush(index)));
                    let mut ml: Layout<Brush> = mb.build(&b.marker);
                    ml.break_all_lines(None);
                    Some((b.marker.clone(), ml, marker_x))
                }
                _ => None,
            };

            // PowerPoint adds paragraph spacing (CSS would collapse adjacent margins).
            y += paragraph.space_before;
            width = width.max(x + layout.width());
            let first = out.baselines.len();
            let height = stack_lines(
                &layout,
                line_box,
                paragraph.runs.iter().fold(0.0, |m, r| r.font_size.max(m)) * scale,
                paints,
                &mut out.baselines,
            );
            out.paras.push(ParaLayout {
                text: s,
                layout,
                x,
                y,
                baselines: first..out.baselines.len(),
                marker,
            });
            y += height + paragraph.space_after;
        }
        out.width = width;
        out.height = y;
    }
}

/// Stacked (`wordArtVert`) text, as LibreOffice draws it: every character on a line of its own (a
/// space is an empty line), aligned and anchored like horizontal text. Breaks before the next
/// character unless it starts the paragraph or follows a break already.
/// shortcut: breaks between chars, not grapheme clusters, so combining marks and emoji sequences
/// split; segment clusters when a deck stacks them.
fn stack_break(s: &mut String, stacked: bool) {
    if stacked && !s.is_empty() && !s.ends_with('\n') {
        s.push('\n');
    }
}

/// Stacks the lines of `layout` on LibreOffice's font-independent line box and pushes each line's
/// baseline (below the paragraph top) onto `baselines`; returns the paragraph height. `line_box` is
/// sized for the paragraph's largest font, `max_size`. A run raised or lowered off the baseline
/// (super/subscript) carries its own box, `line_box` scaled to its font size, and grows its line where
/// that box sticks out, as LibreOffice's escapement does (a 13pt subscript under 20pt text adds ~5 px).
fn stack_lines(layout: &Layout<Brush>, line_box: LineBox, max_size: f32, paints: &[RunPaint], baselines: &mut Vec<f32>) -> f32 {
    let (ascent, descent) = (line_box.baseline, line_box.height - line_box.baseline);
    let mut top = 0.0;
    for line in layout.lines() {
        let (mut above, mut below) = (ascent, descent);
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
            let paint = paints.get(glyph_run.style().brush.0 as usize);
            let raise = line.metrics().baseline - glyph_run.baseline() + paint.map_or(0.0, |p| p.baseline_offset);
            let ratio = if max_size > 0.0 { glyph_run.run().font_size() / max_size } else { 1.0 };
            above = above.max(ascent * ratio + raise);
            below = below.max(descent * ratio - raise);
        }
        baselines.push(top + above);
        top += above + below;
    }
    top
}
