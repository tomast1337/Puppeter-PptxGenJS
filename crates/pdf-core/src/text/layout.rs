//! Text box layout: runs to parley layouts, shrink-to-fit, bullets.

use parley::{
    Alignment, AlignmentOptions, BaseDirection, FontStyle, FontWeight, Layout, LineHeight, OverflowWrap, StyleProperty, TextWrapMode, VerticalAlign,
    WhiteSpaceCollapse,
};

use crate::Renderer;
use crate::color::{Rgba, parse_color};
use crate::model::TextBox;
use crate::text::font::family_stack;

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
}

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub(crate) struct Brush(pub(crate) u32);

pub(crate) struct ParaLayout {
    pub(crate) text: String,
    pub(crate) layout: Layout<Brush>,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) marker: Option<(String, Layout<Brush>, f32)>,
}

#[derive(Default)]
pub(crate) struct BoxLayout {
    pub(crate) paras: Vec<ParaLayout>,
    pub(crate) paints: Vec<RunPaint>,
    pub(crate) width: f32,
    pub(crate) height: f32,
}

/// CSS `line-height: 1.2`, as used by packages/pptxgenjs/src/render/text.ts for single spacing.
/// Measured: font-metrics line height (ascent+descent+gap) scored slightly worse
/// against LibreOffice on the text deck (page median 0.0580 vs 0.0556).
const DEFAULT_LINE_HEIGHT: f32 = 1.2;

impl Renderer {
    /// Lays the box out, applying the current renderer's shrink-to-fit rule:
    /// scale fonts (and px line heights) by 0.95 up to 20 times while the
    /// content overflows the inset box. Fills `layout`, reusing its buffers.
    pub(crate) fn fit_text(&mut self, text: &TextBox, w: f32, h: f32, layout: &mut BoxLayout) {
        let [top, right, bottom, left] = text.margin;
        let vertical = text.direction == "vertical" || text.direction == "vertical270";
        if text.direction == "stacked" {
            self.warn("stacked (wordArtVert) text direction rendered horizontally");
        }
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
        let paints = &mut out.paints;
        let (mut y, mut width) = (0.0f32, 0.0f32);
        for paragraph in &text.paragraphs {
            if !paragraph.tab_stops.is_empty() {
                self.warn("tab stops ignored");
            }
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
            for (i, run) in paragraph.runs.iter().enumerate() {
                if run.soft_break_before && i > 0 {
                    s.push('\n');
                }
                let start = s.len();
                s.push_str(&run.text);
                spans.push(start..s.len());
            }
            let first = paragraph.runs.first();
            if s.is_empty() {
                s.push('\u{200B}');
                spans.clear();
                spans.push(0..s.len());
            }

            let line_height = match paragraph.line_height {
                None => LineHeight::FontSizeRelative(DEFAULT_LINE_HEIGHT),
                Some(v) if v < 10.0 => LineHeight::FontSizeRelative(v),
                Some(v) => LineHeight::Absolute(v * scale),
            };
            let mut builder = self.layout_cx.ranged_builder(&mut self.fonts, &s, 1.0, false);
            builder.set_base_direction(if paragraph.rtl { BaseDirection::Rtl } else { BaseDirection::Ltr });
            builder.push_default(StyleProperty::LineHeight(line_height));
            builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
            builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
            builder.push_default(StyleProperty::TextWrapMode(if text.wrap { TextWrapMode::Wrap } else { TextWrapMode::NoWrap }));
            let mut families = std::mem::take(&mut self.span_families);
            families.clear();
            families.extend(paragraph.runs.iter().take(spans.len()).map(|run| family_stack(&run.font_face)));
            for ((range, run), family) in spans.iter().zip(&paragraph.runs).zip(&families) {
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
                match run.vertical_align.as_str() {
                    "super" => builder.push(StyleProperty::VerticalAlign(VerticalAlign::SUPER), r.clone()),
                    "sub" => builder.push(StyleProperty::VerticalAlign(VerticalAlign::SUB), r.clone()),
                    _ => {}
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
            let mut layout: Layout<Brush> = builder.build(&s);
            self.span_ranges = spans;
            self.span_families = families;
            for run in &paragraph.runs {
                if run.glow.is_some() || run.shadow.as_ref().is_some_and(|s| s.visible) {
                    self.warn("text glow/shadow not rendered");
                }
                if run.link.is_some() {
                    self.warn("hyperlink annotations not emitted (styling only)");
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
            let height = layout.height();
            out.paras.push(ParaLayout { text: s, layout, x, y, marker });
            y += height + paragraph.space_after;
        }
        out.width = width;
        out.height = y;
    }
}
