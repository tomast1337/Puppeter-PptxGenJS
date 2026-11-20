//! Text box layout: runs to parley layouts, shrink-to-fit, bullets.

use std::ops::Range;

use parley::setting::{FontFeature, Tag};
use parley::{
    Alignment, AlignmentOptions, BaseDirection, BreakReason, CHROMIUM_LINE_BREAK_OVERRIDE, FontStyle, FontWeight, Layout, OverflowWrap, PositionedLayoutItem,
    StyleProperty, TextWrapMode, WhiteSpaceCollapse, YieldData,
};

use krilla::paint::Stroke;

use crate::Renderer;
use crate::color::Rgba;
use crate::effect::Effect;
use crate::model::{LineBox, ParagraphAlign, Synthesis, TextBox, TextDirection, TextFit, UnderlineStyle};
use crate::text::font::family_stack;
use crate::text::tabs::{MAX_TAB_REBREAK_BYTES, TAB_PLACEHOLDER, TabRuler, place_tabs, tab_box};

/// Blink's `LayoutUnit`, the grid its line breaker measures on: 1/64 CSS px (`kFractionalBits` = 6 in
/// third_party/blink/renderer/platform/geometry/layout_unit.h).
const LAYOUT_UNIT: f32 = 1.0 / 64.0;

/// `font-kerning: none`: the OpenType `kern` feature off.
const NO_KERNING: [FontFeature; 1] = [FontFeature::new(Tag::new(b"kern"), 0)];

/// Per-run paint data that parley does not carry; the parley brush is the index.
#[derive(Clone)]
pub(crate) struct RunPaint {
    pub(crate) color: Rgba,
    pub(crate) highlight: Option<Rgba>,
    pub(crate) outline: Option<TextStroke>,
    pub(crate) underline: bool,
    pub(crate) underline_style: UnderlineStyle,
    pub(crate) underline_color: Option<Rgba>,
    pub(crate) strike: bool,
    pub(crate) double_strike: bool,
    pub(crate) baseline_offset: f32,
    /// How the glyphs are emboldened or slanted when the face lacks the run's style.
    pub(crate) synthesis: Synthesis,
    /// The run whose `link` this run carries.
    pub(crate) link: Option<RunRef>,
    /// The glow drawn under the run's glyphs.
    pub(crate) glow: Option<Effect>,
}

/// A run of a `TextBox`: its paragraph's index and its index in that paragraph.
#[derive(Clone, Copy)]
pub(crate) struct RunRef {
    pub(crate) paragraph: u32,
    pub(crate) run: u32,
}

/// A paragraph's bullet, laid out on its own.
pub(crate) struct BulletMarker {
    pub(crate) text: String,
    pub(crate) layout: Layout<Brush>,
    /// Its start, from the paragraph's left edge.
    pub(crate) x: f32,
}

/// A stroke around the glyphs: a run's outline, or a chart label's halo drawn `under` its fill
/// (SVG `paint-order: stroke`).
#[derive(Clone, Copy)]
pub(crate) struct TextStroke {
    pub(crate) color: Rgba,
    pub(crate) width: f32,
    pub(crate) miter_limit: f32,
    pub(crate) under: bool,
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
    pub(crate) marker: Option<BulletMarker>,
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
    /// Lays the box out, applying the box's shrink-to-fit rule: scale fonts and line boxes by
    /// `step` up to `max_steps` times while the content overflows the inset box by more than
    /// `tolerance`. Fills `layout`, reusing its buffers.
    pub(crate) fn fit_text(&mut self, text: &TextBox, w: f32, h: f32, layout: &mut BoxLayout) {
        let [top, right, bottom, left] = text.margin;
        let vertical = text.direction.is_vertical();
        let (inner_w, inner_h) = if vertical {
            (h - top - bottom, w - left - right)
        } else {
            (w - left - right, h - top - bottom)
        };
        let mut scale = 1.0;
        self.layout_text(text, inner_w, scale, layout);
        if let TextFit::Shrink(shrink) = text.fit {
            for _ in 0..shrink.max_steps {
                if layout.height <= inner_h + shrink.tolerance && layout.width <= inner_w + shrink.tolerance {
                    break;
                }
                scale *= shrink.step;
                self.layout_text(text, inner_w, scale, layout);
            }
        }
    }

    /// One unwrapped line of `text` in one face, every glyph with brush 0: a chart SVG `<text>`.
    pub(crate) fn layout_line(&mut self, text: &str, face: &str, size: f32, weight: FontWeight, style: FontStyle) -> Layout<Brush> {
        let mut builder = self.layout_cx.ranged_builder(&mut self.fonts, text, 1.0, false);
        builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
        builder.push_default(StyleProperty::FontFamily(family_stack(face).as_str().into()));
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontWeight(weight));
        builder.push_default(StyleProperty::FontStyle(style));
        builder.push_default(StyleProperty::Brush(Brush(0)));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.break_all_lines(None);
        layout
    }

    /// Lays out every paragraph into `out`, replacing what it held.
    fn layout_text(&mut self, text: &TextBox, inner_w: f32, scale: f32, out: &mut BoxLayout) {
        out.paras.clear();
        out.paints.clear();
        out.baselines.clear();
        let paints = &mut out.paints;
        let (mut y, mut width) = (0.0f32, 0.0f32);
        let stacked = text.direction == TextDirection::Stacked;
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
            let empty = s.is_empty();
            if empty {
                s.push('\u{200B}');
                spans.clear();
                spans.push(0..s.len());
            }

            // LibreOffice's font-independent line box, not parley's font metrics, places the lines (draw_layout).
            let LineBox {
                height,
                baseline,
                mark_baseline,
                break_baseline,
            } = paragraph.line_box;
            // shortcut: vertical text keeps one baseline on every line, as in the Puppeteer print step (stacked text
            // breaks after every character); give it the mark and break baselines once vertical text is measured.
            let horizontal = text.direction == TextDirection::Horizontal;
            let line_box = LineBox {
                height: height * scale,
                baseline: baseline * scale,
                mark_baseline: if horizontal { mark_baseline } else { baseline } * scale,
                break_baseline: if horizontal { break_baseline } else { baseline } * scale,
            };
            let mut builder = self.layout_cx.ranged_builder(&mut self.fonts, &s, 1.0, false);
            builder.set_base_direction(if paragraph.rtl { BaseDirection::Rtl } else { BaseDirection::Ltr });
            // Break where Chromium does (PowerPoint agrees): after every space run, even before "." or a closing
            // guillemet where UAX #14 LB13/LB15b forbid it, and by Blink's ASCII pair table, so no break around "/"
            // inside "amet/consectetur" or a URL (text_break_iterator.cc, character_property_data_generator.cc).
            // shortcut: Blink's fast table also covers pairs up to U+00FF (ICU on the two characters alone) and keeps
            // U+2019 to its neighbours; here those pairs take ICU on the whole text, which can differ where a UAX #14
            // rule reads past the pair. Port that table when a deck shows a difference.
            builder.set_line_break_override(Some(CHROMIUM_LINE_BREAK_OVERRIDE));
            builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
            builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
            builder.push_default(StyleProperty::TextWrapMode(if text.wrap { TextWrapMode::Wrap } else { TextWrapMode::NoWrap }));
            let mut families = std::mem::take(&mut self.span_families);
            families.clear();
            families.extend(paragraph.runs.iter().take(spans.len()).map(|run| family_stack(&run.font_face)));
            for (r, ((range, run), family)) in (0u32..).zip(spans.iter().zip(&paragraph.runs).zip(&families)) {
                let index = paints.len() as u32;
                paints.push(RunPaint {
                    color: run.color,
                    highlight: run.highlight,
                    outline: run.outline.as_ref().map(|o| TextStroke {
                        color: o.color,
                        width: o.width,
                        // krilla's default, which run outlines have always been drawn with.
                        miter_limit: Stroke::default().miter_limit,
                        under: false,
                    }),
                    underline: run.decoration.underline,
                    underline_style: run.decoration.underline_style,
                    underline_color: run.decoration.underline_color,
                    strike: run.decoration.strike,
                    double_strike: run.decoration.double_strike,
                    baseline_offset: run.baseline_offset,
                    synthesis: run.synthesis,
                    link: run.link.is_some().then_some(RunRef { paragraph: p, run: r }),
                    glow: run.glow.as_ref().and_then(Effect::glow),
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
                if !run.kerning {
                    builder.push(StyleProperty::FontFeatures((&NO_KERNING).into()), r.clone());
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
            let alignment = match paragraph.align {
                ParagraphAlign::Left => Alignment::Left,
                ParagraphAlign::Center => Alignment::Center,
                ParagraphAlign::Right => Alignment::Right,
                ParagraphAlign::Justify => Alignment::Justify,
            };
            // parley applies the alignment while breaking lines, so set it first.
            layout.set_alignment(
                alignment,
                AlignmentOptions {
                    align_when_overflowing: true,
                    ..AlignmentOptions::default()
                },
            );
            break_lines(&mut layout, max_w);
            if !tabs.is_empty() {
                if paragraph.rtl {
                    // shortcut: stops are measured from the left; mirror them for RTL paragraphs when a deck needs it.
                    self.warn("tab stops in right-to-left paragraphs measured from the left");
                }
                let ruler = TabRuler {
                    stops: &paragraph.tab_stops,
                    default_stop: paragraph.default_tab_stop,
                    indent,
                    max_w,
                };
                let mut clusters = std::mem::take(&mut self.tab_clusters);
                if place_tabs(&mut layout, &s, &tabs, &ruler, &mut clusters).capped {
                    // shortcut: past the budget a tab that should wrap is measured on its old line; raise it if a real deck needs more.
                    self.warn(format!(
                        "tab stops past {MAX_TAB_REBREAK_BYTES} bytes of re-broken text in one paragraph measured before their lines wrapped"
                    ));
                }
                self.tab_clusters = clusters;
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
                        color: run.color,
                        highlight: None,
                        outline: None,
                        underline: false,
                        underline_style: UnderlineStyle::Solid,
                        underline_color: None,
                        strike: false,
                        double_strike: false,
                        baseline_offset: 0.0,
                        synthesis: run.synthesis,
                        link: None,
                        glow: None,
                    });
                    mb.push_default(StyleProperty::FontFamily(family_stack(&run.font_face).as_str().into()));
                    mb.push_default(StyleProperty::FontSize(run.font_size * scale));
                    mb.push_default(StyleProperty::Brush(Brush(index)));
                    let mut ml: Layout<Brush> = mb.build(&b.marker);
                    ml.break_all_lines(None);
                    Some(BulletMarker {
                        text: b.marker.clone(),
                        layout: ml,
                        x: marker_x,
                    })
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
                // An empty paragraph's line is its mark's alone: no glyph to raise, as in Chromium and the profile.
                if empty { &[] } else { paints },
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

/// Breaks `layout` into lines no wider than `max_w` (unwrapped when None) by Blink's fit test, and aligns
/// them in `max_w`. Blink truncates the available width to a `LayoutUnit` (`LayoutUnit(float)`), rounds
/// the text's width up to one (`ShapeResult::SnappedWidth`, shape_result.h) and keeps it on the line while
/// `position_ <= AvailableWidth().AddEpsilon()` (`LineBreaker::CanFitOnLine`, core/layout/inline/
/// line_breaker.h): one `LayoutUnit` of slack. The limit is on the grid, so parley's float position
/// passes it exactly when its rounded-up value does, and a line as wide as its box stays one line
/// whatever float noise the box width or the advances carry.
/// shortcut: Blink rounds up each inline item (style run) on its own, so a line of many runs can take
/// up to one `LayoutUnit` per run less here; sum snapped run widths if a deck shows that.
pub(crate) fn break_lines(layout: &mut Layout<Brush>, max_w: Option<f32>) {
    let Some(max_w) = max_w else {
        return layout.break_all_lines(None);
    };
    let fit = (max_w / LAYOUT_UNIT).floor() * LAYOUT_UNIT + LAYOUT_UNIT;
    let mut lines = layout.break_lines();
    lines.state_mut().set_layout_max_advance(fit);
    lines.state_mut().set_line_max_advance(fit);
    while let Some(data) = lines.break_next() {
        match data {
            // As `break_remaining` does: no box here is out of flow, but place one at zero size so the loop ends.
            YieldData::InlineBoxBreak(b) => lines.state_mut().append_inline_box_to_line(b.advance, 0.0, 0.0),
            // Align in the box, as Blink does, not in the box plus the fit slack.
            _ => lines.set_prior_line_width(max_w),
        }
    }
    lines.finish();
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
/// that box sticks out, as LibreOffice's escapement does (a 13pt subscript under 20pt text adds ~5 px). The last line
/// takes `line_box.mark_baseline` and a line ending in a soft break `line_box.break_baseline`. A run with
/// no paint in `paints` keeps its `baseline_offset` out of the line box.
fn stack_lines(layout: &Layout<Brush>, line_box: LineBox, max_size: f32, paints: &[RunPaint], baselines: &mut Vec<f32>) -> f32 {
    let mut top = 0.0;
    for (index, line) in layout.lines().enumerate() {
        let baseline = if index + 1 == layout.len() {
            line_box.mark_baseline
        } else if line.break_reason() == BreakReason::Explicit {
            line_box.break_baseline
        } else {
            line_box.baseline
        };
        let (ascent, descent) = (baseline, line_box.height - baseline);
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

#[cfg(test)]
mod tests {
    use super::*;
    use parley::fontique::{Blob, Collection, CollectionOptions};
    use parley::{FontContext, LayoutContext};

    /// "mmmm mmmm" in 32px Liberation Sans (Arial's metrics), `letter_spacing` px apart, aligned
    /// `alignment` and not yet broken; None when the font is not installed.
    fn mmmm(letter_spacing: f32, alignment: Alignment) -> Option<Layout<Brush>> {
        let mut fonts = FontContext {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: false,
            }),
            ..FontContext::default()
        };
        fonts.collection.register_fonts(Blob::from(crate::tests::liberation_sans()?), None);
        let text = "mmmm mmmm";
        let mut layout_cx = LayoutContext::new();
        let mut builder = layout_cx.ranged_builder(&mut fonts, text, 1.0, false);
        builder.push_default(StyleProperty::TextWrapMode(TextWrapMode::Wrap));
        builder.push_default(StyleProperty::FontFamily("Liberation Sans".into()));
        builder.push_default(StyleProperty::FontSize(32.0));
        builder.push_default(StyleProperty::LetterSpacing(letter_spacing));
        let mut layout: Layout<Brush> = builder.build(text);
        layout.set_alignment(
            alignment,
            AlignmentOptions {
                align_when_overflowing: true,
                ..AlignmentOptions::default()
            },
        );
        Some(layout)
    }

    #[test]
    fn keeps_a_line_as_wide_as_its_box_on_one_line() {
        for spacing in [0.0, 0.3] {
            let Some(mut layout) = mmmm(spacing, Alignment::Left) else { return };
            layout.break_all_lines(None);
            let width = layout.width();
            // Exactly as wide, and a float hair narrower, as a box width computed in f32 can come out.
            for max_w in [width, width - 1e-4] {
                break_lines(&mut layout, Some(max_w));
                assert_eq!(layout.len(), 1, "letter spacing {spacing}: {width} in {max_w}");
            }
            // Two LayoutUnits narrower does not fit in Chromium either.
            break_lines(&mut layout, Some(width - 2.0 * LAYOUT_UNIT));
            assert_eq!(layout.len(), 2, "letter spacing {spacing}");
        }
    }

    #[test]
    fn aligns_in_the_box_not_in_the_fit_slack() {
        let Some(mut layout) = mmmm(0.0, Alignment::Right) else { return };
        layout.break_all_lines(None);
        let width = layout.width();
        break_lines(&mut layout, Some(width + 10.0));
        let offset = layout.lines().next().map(|line| line.metrics().offset);
        assert_eq!(offset, Some(10.0));
    }
}
