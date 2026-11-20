//! Drawing laid-out text boxes: glyph runs, outlines, highlights and decorations.

use std::sync::Arc;

use krilla::Data;
use krilla::color::rgb;
use krilla::geom::Quadrilateral;
use krilla::geom::{Point, Transform};
use krilla::paint::Stroke;
use krilla::surface::Surface;
use krilla::text::{Font, GlyphId, KrillaGlyph};
use kurbo::BezPath;
use parley::{FontMetrics, GlyphRun, Layout, Line, PositionedLayoutItem};

use crate::Renderer;
use crate::color::{Rgba, fill_of, unit};
use crate::effect::Effect;
use crate::effect::EffectSource;
use crate::link::page_quad;
use crate::model::{TextBox, TextDirection, UnderlineStyle, VerticalAlign};
use crate::path::{rect_path, stroke_width};
use crate::text::layout::{BoxLayout, Brush, BulletMarker, RunPaint, RunRef, TextStroke};
use crate::text::outline::glyph_outlines;

/// Most distinct glows drawn under one text box.
const MAX_GLOWS_PER_BOX: usize = 16;

// Underline patterns in units of the font's underline thickness, read from LibreOffice's PDF export of the
// visual fixture's "Underline styles" slide (Liberation Sans 20pt, a 1.95px thickness): dashes 6px with 3px
// gaps, a wave about 11px long and 2px high, a double line of two 1px lines 2px apart; dots are one
// thickness long, as in Chromium.
const DOT_ON: f32 = 1.0;
const DOT_OFF: f32 = 1.0;
const DASH_ON: f32 = 3.0;
const DASH_OFF: f32 = 1.5;
const DOUBLE_LINE: f32 = 0.5;
const DOUBLE_GAP: f32 = 1.0;
const WAVE_PERIOD: f32 = 6.0;
const WAVE_HEIGHT: f32 = 1.0;
/// LibreOffice draws its wave thinner than the straight line.
const WAVE_THICKNESS: f32 = 0.5;

// PowerPoint's underline shapes around the face's `post` band (top P below the baseline, thickness T), measured
// against its PDF export of a synthetic deck (Arial, Calibri and Times New Roman at 8 to 24pt), each within about one
// 1/600 in step, its device grid. Double: two T/2 lines, the first from P - T, the second ending at P + T (12pt Arial
// 0.48pt lines 0.72pt apart from 0.43pt below the baseline, T 0.84). Heavy: one band 1.5T tall from P - T (12pt Arial
// 1.32pt from 0.48pt, 24pt 2.76pt from 0.70pt). Wavy: a zigzag of 45-degree slopes, one grid step tall, filling the
// 2T from P - T/2, with whole half-waves (it runs past the text to finish the last one).
const PPT_DOUBLE_LINE: f32 = 0.5;
const PPT_HEAVY: f32 = 1.5;
const PPT_WAVE_BAND: f32 = 2.0;
/// PowerPoint's device grid in its PDF export, steps per inch (the PowerPoint target's advance and baseline grid).
const PPT_GRID_PER_IN: f32 = 600.0;
/// The wave's vertical thickness: one grid step.
const PPT_WAVE_LINE: f32 = crate::PX_PER_IN / PPT_GRID_PER_IN;

/// PowerPoint's underline of `style` (heavy when `heavy`) around the `post` band `t` px tall from `top`, over
/// `advance` px from `start` (y down).
fn powerpoint_underline_path(style: UnderlineStyle, heavy: bool, start: f32, top: f32, advance: f32, t: f32) -> BezPath {
    match style {
        UnderlineStyle::Solid if heavy => rect_path(start, top - t, advance, PPT_HEAVY * t, 0.0),
        UnderlineStyle::Double => {
            let line = PPT_DOUBLE_LINE * t;
            let mut path = rect_path(start, top - t, advance, line, 0.0);
            path.extend(rect_path(start, top + t - line, advance, line, 0.0));
            path
        }
        UnderlineStyle::Wavy => zigzag(start, top - t / 2.0, advance, PPT_WAVE_BAND * t),
        // shortcut: PowerPoint's dotted and dashed underlines were not measured, so they keep LibreOffice's patterns
        // around the band; measure them when a deck needs them (#397).
        _ => underline_path(style, start, top, advance, t),
    }
}

/// A zigzag PPT_WAVE_LINE tall filling `band` px from `top`, 45-degree slopes, from `start` down first, over whole
/// half-waves covering `advance`.
// shortcut: each glyph run (a run, or a word of one with its own spacing) starts its own zigzag, where PowerPoint draws
// one per line; join them when a deck shows the seams.
fn zigzag(start: f32, top: f32, advance: f32, band: f32) -> BezPath {
    let reach = (band - PPT_WAVE_LINE).max(PPT_WAVE_LINE);
    // A finite advance over a positive reach: a whole count of at least 1.
    let halves = (advance / reach).ceil().max(1.0) as u32;
    let point = |i: u32, y: f32| (f64::from(start + reach * i as f32), f64::from(y));
    let edge = |i: u32| if i.is_multiple_of(2) { top } else { top + reach };
    let mut path = BezPath::new();
    path.move_to(point(0, top));
    for i in 0..=halves {
        path.line_to(point(i, edge(i) + PPT_WAVE_LINE));
    }
    for i in (0..=halves).rev() {
        path.line_to(point(i, edge(i)));
    }
    path.close_path();
    path
}

/// The filled outline of an underline of `style` whose straight form is the `thickness` px tall band from
/// `top`, over `advance` px from `start` (y down).
fn underline_path(style: UnderlineStyle, start: f32, top: f32, advance: f32, thickness: f32) -> BezPath {
    let t = thickness;
    match style {
        UnderlineStyle::Solid => rect_path(start, top, advance, t, 0.0),
        // Two thinner lines centred on the single line.
        UnderlineStyle::Double => {
            let (line, gap) = (DOUBLE_LINE * t, DOUBLE_GAP * t);
            let first = top + t / 2.0 - gap / 2.0 - line;
            let mut path = rect_path(start, first, advance, line, 0.0);
            path.extend(rect_path(start, first + line + gap, advance, line, 0.0));
            path
        }
        UnderlineStyle::Dotted => dashes(start, top, advance, t, DOT_ON * t, DOT_OFF * t),
        UnderlineStyle::Dashed => dashes(start, top, advance, t, DASH_ON * t, DASH_OFF * t),
        UnderlineStyle::Wavy => wave(start, top + t / 2.0, advance, t),
    }
}

/// `on`-long pieces of the band, `off` apart, from `start`; the last one is cut at the end.
fn dashes(start: f32, top: f32, advance: f32, t: f32, on: f32, off: f32) -> BezPath {
    let end = start + advance;
    let mut path = BezPath::new();
    let mut x = start;
    while x < end {
        path.extend(rect_path(x, top, on.min(end - x), t, 0.0));
        x += on + off;
    }
    path
}

/// A band WAVE_THICKNESS thicknesses tall along a wave centred on `middle`: quadratic half-waves, as many
/// whole ones as fit nearest to WAVE_PERIOD, so it starts and ends on `middle`.
fn wave(start: f32, middle: f32, advance: f32, t: f32) -> BezPath {
    let halves = (advance / (WAVE_PERIOD * t / 2.0)).round().max(1.0);
    let half = advance / halves;
    // A quadratic's control point is twice as far from the chord as the curve's peak.
    let reach = WAVE_HEIGHT * t;
    let band = WAVE_THICKNESS * t / 2.0;
    let point = |x: f32, y: f32| (f64::from(x), f64::from(y));
    // halves is a whole number of at least 1, from a finite advance in px.
    let count = halves as u32;
    let control = |i: u32| if i.is_multiple_of(2) { -reach } else { reach };
    let mut path = BezPath::new();
    path.move_to(point(start, middle - band));
    for i in 0..count {
        let x = start + half * i as f32;
        path.quad_to(point(x + half / 2.0, middle - band + control(i)), point(x + half, middle - band));
    }
    path.line_to(point(start + advance, middle + band));
    for i in (0..count).rev() {
        let x = start + half * i as f32;
        path.quad_to(point(x + half / 2.0, middle + band + control(i)), point(x, middle + band));
    }
    path.close_path();
    path
}

/// A `post` underline band: its top `offset` px above the baseline (below it when negative), `size` px tall.
#[derive(Clone, Copy)]
pub(crate) struct UnderlineBand {
    pub(crate) offset: f32,
    pub(crate) size: f32,
}

/// A from-font run's own band at `font_size` px: the HTML's (`underline_band`, in em), else the face's `post` band.
fn run_underline_band(paint: &RunPaint, metrics: &FontMetrics, font_size: f32) -> UnderlineBand {
    match paint.underline_band {
        Some(band) => UnderlineBand {
            offset: band.offset * font_size,
            size: band.size * font_size,
        },
        None => UnderlineBand {
            offset: metrics.underline_offset,
            size: metrics.underline_size,
        },
    }
}

/// The band PowerPoint underlines a line's from-font runs with: their `post` bands averaged by width (a 12pt then a
/// 24pt Arial run: 1.44pt thick, its top 2.06pt below the baseline, where 12pt alone is 0.84/1.27 and 24pt alone
/// 1.80/2.42, measured against its PDF export of a synthetic deck). None when the line has no such run.
pub(crate) fn line_underline_band(line: &Line<'_, Brush>, paints: &[RunPaint]) -> Option<UnderlineBand> {
    let (mut width, mut offset, mut size) = (0.0, 0.0, 0.0);
    for item in line.items() {
        let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
        let paint = paints.get(glyph_run.style().brush.0 as usize);
        if let Some(paint) = paint.filter(|paint| paint.underline && paint.underline_from_font) {
            let run = glyph_run.run();
            let (advance, band) = (glyph_run.advance(), run_underline_band(paint, run.font_metrics(), run.font_size()));
            width += advance;
            offset += advance * band.offset;
            size += advance * band.size;
        }
    }
    (width > 0.0).then(|| UnderlineBand {
        offset: offset / width,
        size: size / width,
    })
}

/// Shears what is drawn on `baseline` (y down) by `shear` to the right above it and to the left below it.
fn oblique(baseline: f32, shear: f32) -> Transform {
    Transform::from_row(1.0, 0.0, -shear, 1.0, shear * baseline, 0.0)
}

/// A text link's clickable area on one line, and the run whose link it is.
pub(crate) struct LinkQuad {
    pub(crate) run: RunRef,
    pub(crate) quad: Quadrilateral,
}

/// `None` for a width pdf-writer cannot write (stroke_width).
fn stroke_of(Rgba(r, g, b, a): Rgba, width: f32) -> Option<Stroke> {
    Some(Stroke {
        paint: rgb::Color::new(r, g, b).into(),
        width: stroke_width(width)?,
        opacity: unit(a),
        ..Stroke::default()
    })
}

fn outline_stroke(outline: TextStroke) -> Option<Stroke> {
    Some(Stroke {
        miter_limit: outline.miter_limit,
        ..stroke_of(outline.color, outline.width)?
    })
}

impl Renderer {
    /// Draws the box and queues its runs' link annotations; a link the PDF cannot carry is an error.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn draw_text(&mut self, surface: &mut Surface, text: &TextBox, layout: &BoxLayout, x: f32, y: f32, w: f32, h: f32) -> Result<(), String> {
        let [top, right, bottom, left] = text.margin;
        let (ix, iy, iw, ih) = (x + left, y + top, w - left - right, h - top - bottom);
        // Local frame: u along the line, v along the block axis.
        let (frame, block) = match text.direction {
            TextDirection::Vertical => (Transform::from_row(0.0, 1.0, -1.0, 0.0, ix + iw, iy), iw),
            TextDirection::Vertical270 => (Transform::from_row(0.0, -1.0, 1.0, 0.0, ix, iy + ih), iw),
            TextDirection::Horizontal | TextDirection::Stacked => (Transform::from_translate(ix, iy), ih),
        };
        let v0 = match text.vertical_align {
            VerticalAlign::Top => 0.0,
            VerticalAlign::Middle => (block - layout.height) / 2.0,
            VerticalAlign::Bottom => block - layout.height,
        };
        let mut lines = |r: &mut Self, surface: &mut Surface| {
            surface.push_transform(&frame);
            for para in &layout.paras {
                if let Some(BulletMarker { text, layout: marker, x }) = &para.marker {
                    let first = layout.baselines.get(para.baselines.start..para.baselines.start + 1).unwrap_or_default();
                    r.draw_layout(surface, marker, text, &layout.paints, (*x, v0 + para.y), first);
                }
                let baselines = layout.baselines.get(para.baselines.clone()).unwrap_or_default();
                r.draw_layout(surface, &para.layout, &para.text, &layout.paints, (para.x, v0 + para.y), baselines);
            }
            surface.pop();
            Ok(())
        };
        // Each distinct glow of the box goes under all of its text, as LibreOffice draws it.
        let mut glows: Vec<Effect> = Vec::new();
        for glow in layout.paints.iter().filter_map(|p| p.glow) {
            if !glows.contains(&glow) {
                glows.push(glow);
            }
        }
        // Each glow nests one more sub-stream (and call frame) and holds its own mask, so the
        // count is bounded: a box with thousands of distinct glows overflowed the wasm stack.
        // shortcut: glows past the limit are left out, not merged; capture them in one pass when
        // a real deck needs more distinct glows in one box.
        if glows.len() > MAX_GLOWS_PER_BOX {
            glows.truncate(MAX_GLOWS_PER_BOX);
            self.warn(format!(
                "text glows past the first {MAX_GLOWS_PER_BOX} distinct ones in a text box not rendered"
            ));
        }
        self.under_glows(surface, &glows, &mut lines)?;
        let mut quads = std::mem::take(&mut self.link_quads);
        let linked = quads.drain(..).try_for_each(|LinkQuad { run, quad }| {
            let run = text.paragraphs.get(run.paragraph as usize).and_then(|para| para.runs.get(run.run as usize));
            match run.and_then(|run| run.link.as_ref()) {
                Some(link) => self.add_link(link, quad),
                None => Ok(()),
            }
        });
        self.link_quads = quads;
        linked
    }

    fn under_glows(
        &mut self,
        surface: &mut Surface,
        glows: &[Effect],
        draw: &mut dyn FnMut(&mut Self, &mut Surface) -> Result<(), String>,
    ) -> Result<(), String> {
        match glows.split_first() {
            Some((glow, rest)) => self.under_effect(surface, glow, EffectSource::GlowingRuns, |r, surface| r.under_glows(surface, rest, draw)),
            None => draw(self, surface),
        }
    }

    fn pdf_font(&mut self, font: &parley::FontData) -> Option<Font> {
        let key = (font.data.id(), font.index);
        if let Some(f) = self.pdf_fonts.get(&key) {
            return Some(f.clone());
        }
        let bytes: Arc<dyn AsRef<[u8]> + Send + Sync> = Arc::new(font.data.clone());
        let f = Font::new(Data::from(bytes), font.index)?;
        self.pdf_fonts.insert(key, f.clone());
        Some(f)
    }

    /// Draws `layout` at `(ox, oy)` with line `i`'s baseline `baselines[i]` below `oy` (from
    /// `stack_lines`, where LibreOffice puts it), instead of where parley's font metrics would.
    pub(crate) fn draw_layout(
        &mut self,
        surface: &mut Surface,
        layout: &Layout<Brush>,
        text: &str,
        paints: &[RunPaint],
        (ox, oy): (f32, f32),
        baselines: &[f32],
    ) {
        for (line, baseline) in layout.lines().zip(baselines) {
            let oy = oy + baseline - line.metrics().baseline;
            let band = line_underline_band(&line, paints);
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
                let paint = paints
                    .get(glyph_run.style().brush.0 as usize)
                    .expect("layout_text sets every brush to the index of the paint it pushes alongside");
                self.draw_glyph_run(surface, &glyph_run, paint, text, (ox, oy), band);
            }
        }
    }

    /// One glyph run of a line whose top is `oy`: its link area and highlight, glyphs and decorations.
    fn draw_glyph_run(
        &mut self,
        surface: &mut Surface,
        glyph_run: &GlyphRun<'_, Brush>,
        paint: &RunPaint,
        text: &str,
        (ox, oy): (f32, f32),
        line_band: Option<UnderlineBand>,
    ) {
        let run = glyph_run.run();
        let metrics = *run.font_metrics();
        let baseline = oy + glyph_run.baseline() - paint.baseline_offset;
        let start = ox + glyph_run.offset();
        let advance = glyph_run.advance();
        if let Some(link) = paint.link {
            // One annotation per line fragment, over the run's line box, as Chromium does for an inline <a>.
            if let Some(quad) = page_quad(surface, start, baseline - metrics.ascent, advance, metrics.ascent + metrics.descent) {
                self.link_quads.push(LinkQuad { run: link, quad });
            }
        }
        if let Some(hl) = paint.highlight {
            self.fill(
                surface,
                &rect_path(start, baseline - metrics.ascent, advance, metrics.ascent + metrics.descent, 0.0),
                hl,
            );
        }
        let Some(font) = self.pdf_font(run.font()) else {
            self.warn("font could not be embedded");
            return;
        };
        self.draw_glyphs(surface, glyph_run, paint, font, text, (ox, oy));
        // A from-font underline takes the line's band; every other the face's.
        let band = if paint.underline_from_font {
            line_band.unwrap_or_else(|| run_underline_band(paint, &metrics, run.font_size()))
        } else {
            UnderlineBand {
                offset: metrics.underline_offset,
                size: metrics.underline_size,
            }
        };
        self.draw_decorations(surface, paint, &metrics, start, baseline, advance, band);
    }

    /// The run's glyphs in `font`: an outline under them, the fill (synthetic bold and italic
    /// as the run's `synthesis` says), their silhouette for a capture, an outline over them.
    fn draw_glyphs(&mut self, surface: &mut Surface, glyph_run: &GlyphRun<'_, Brush>, paint: &RunPaint, font: Font, text: &str, (ox, oy): (f32, f32)) {
        let run = glyph_run.run();
        let size = run.font_size();
        let baseline = oy + glyph_run.baseline() - paint.baseline_offset;
        let mut ranges = std::mem::take(&mut self.glyph_ranges);
        let mut positioned = std::mem::take(&mut self.positioned);
        let mut glyphs = std::mem::take(&mut self.glyphs);

        // Glyph -> source text cluster ranges, for the PDF ToUnicode map.
        ranges.clear();
        for cluster in run.visual_clusters() {
            if cluster.style_index() == glyph_run.style_index() {
                for _ in cluster.glyphs() {
                    ranges.push(cluster.text_range());
                }
            }
        }
        positioned.clear();
        positioned.extend(glyph_run.positioned_glyphs());
        if ranges.len() != positioned.len() {
            // shortcut: a run whose style repeats non-contiguously maps all glyphs to the run's text; fix if text extraction matters.
            ranges.clear();
            ranges.resize(positioned.len(), run.text_range());
        }
        let mut pen = glyph_run.offset();
        glyphs.clear();
        glyphs.extend(positioned.iter().zip(ranges.drain(..)).map(|(g, range)| {
            let glyph = KrillaGlyph::new(
                GlyphId::new(g.id),
                g.advance / size,
                (g.x - pen) / size,
                -(g.y - glyph_run.baseline()) / size,
                0.0,
                range,
                None,
            );
            pen += g.advance;
            glyph
        }));
        let origin = Point::from_xy(ox + glyph_run.offset(), baseline);
        // fontique asks for synthesis when the face it matched lacks the requested style.
        let synthesis = run.synthesis();
        let skewed = synthesis.skew().is_some();
        if skewed {
            surface.push_transform(&oblique(baseline, paint.synthesis.italic_shear));
        }
        if let Some(outline) = paint.outline.filter(|o| o.under) {
            surface.set_fill(None);
            surface.set_stroke(outline_stroke(outline));
            surface.draw_glyphs(origin, &glyphs, font.clone(), text, size, false);
        }
        surface.set_stroke(
            synthesis
                .embolden()
                .then(|| stroke_of(paint.color, size * paint.synthesis.bold_stroke_em))
                .flatten(),
        );
        surface.set_fill(Some(fill_of(paint.color)));
        surface.draw_glyphs(origin, &glyphs, font.clone(), text, size, false);
        if self.effects.capturing() {
            // Pen positions as krilla places them: x from the line start, y from the line's top.
            let at = positioned.iter().map(|g| (ox + g.x, oy + g.y - paint.baseline_offset, g.id));
            let outline = glyph_outlines(run.font(), size, at);
            self.effects.capture(surface.ctm(), &outline, paint.color.3, paint.glow.as_ref());
        }
        if let Some(outline) = paint.outline.filter(|o| !o.under) {
            surface.set_fill(None);
            surface.set_stroke(outline_stroke(outline));
            surface.draw_glyphs(origin, &glyphs, font, text, size, false);
        }
        surface.set_stroke(None);
        if skewed {
            surface.pop();
        }
        self.glyph_ranges = ranges;
        self.positioned = positioned;
        self.glyphs = glyphs;
    }

    /// Underline and strikethrough over `advance` px from `start`; the underline around `band`.
    #[allow(clippy::too_many_arguments)] // the run's place on its line, as draw_glyph_run has it
    fn draw_decorations(
        &mut self,
        surface: &mut Surface,
        paint: &RunPaint,
        metrics: &FontMetrics,
        start: f32,
        baseline: f32,
        advance: f32,
        band: UnderlineBand,
    ) {
        let deco = paint.underline_color.unwrap_or(paint.color);
        if paint.underline {
            let (top, t) = (baseline - band.offset, band.size.max(0.5));
            let path = if paint.underline_from_font {
                powerpoint_underline_path(paint.underline_style, paint.underline_heavy, start, top, advance, t)
            } else {
                underline_path(paint.underline_style, start, top, advance, t)
            };
            self.fill(surface, &path, deco);
        }
        if paint.strike || paint.double_strike {
            let t = metrics.strikethrough_size.max(0.5);
            let y = baseline - metrics.strikethrough_offset;
            if paint.double_strike {
                self.fill(surface, &rect_path(start, y - t, advance, t, 0.0), paint.color);
                self.fill(surface, &rect_path(start, y + t, advance, t, 0.0), paint.color);
            } else {
                self.fill(surface, &rect_path(start, y, advance, t, 0.0), paint.color);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obliques_lean_right_above_the_baseline_and_keep_it_in_place() {
        let t = oblique(100.0, 0.25);
        let map = |x: f32, y: f32| (t.sx() * x + t.kx() * y + t.tx(), t.ky() * x + t.sy() * y + t.ty());
        let close = |(x, y): (f32, f32), (ex, ey): (f32, f32)| assert!((x - ex).abs() < 1e-4 && (y - ey).abs() < 1e-4, "({x}, {y}) != ({ex}, {ey})");
        close(map(5.0, 100.0), (5.0, 100.0));
        close(map(5.0, 90.0), (7.5, 90.0));
        close(map(5.0, 110.0), (2.5, 110.0));
    }

    /// The path's subpaths as (min x, min y, max x, max y) boxes.
    fn pieces(path: &BezPath) -> Vec<(f64, f64, f64, f64)> {
        use kurbo::Shape as _;
        let mut boxes = Vec::new();
        let mut current = BezPath::new();
        for el in path.elements() {
            if matches!(el, kurbo::PathEl::MoveTo(_)) && !current.elements().is_empty() {
                let b = current.bounding_box();
                boxes.push((b.x0, b.y0, b.x1, b.y1));
                current = BezPath::new();
            }
            current.push(*el);
        }
        let b = current.bounding_box();
        boxes.push((b.x0, b.y0, b.x1, b.y1));
        boxes
    }

    #[test]
    fn solid_and_double_underlines_are_one_and_two_bands() {
        assert_eq!(
            pieces(&underline_path(UnderlineStyle::Solid, 10.0, 20.0, 100.0, 2.0)),
            [(10.0, 20.0, 110.0, 22.0)]
        );
        // Half as thick, a thickness apart, centred on the single band's middle (21).
        assert_eq!(
            pieces(&underline_path(UnderlineStyle::Double, 10.0, 20.0, 100.0, 2.0)),
            [(10.0, 19.0, 110.0, 20.0), (10.0, 22.0, 110.0, 23.0)]
        );
    }

    #[test]
    fn dotted_and_dashed_underlines_repeat_and_cut_the_last_piece() {
        let dots = pieces(&underline_path(UnderlineStyle::Dotted, 0.0, 0.0, 9.0, 2.0));
        assert_eq!(dots, [(0.0, 0.0, 2.0, 2.0), (4.0, 0.0, 6.0, 2.0), (8.0, 0.0, 9.0, 2.0)]);
        let dashes = pieces(&underline_path(UnderlineStyle::Dashed, 0.0, 0.0, 15.0, 2.0));
        assert_eq!(dashes, [(0.0, 0.0, 6.0, 2.0), (9.0, 0.0, 15.0, 2.0)]);
    }

    #[test]
    fn powerpoint_double_and_heavy_underlines_fill_around_the_post_band() {
        // The band is 20..22: double is two 1px lines from 18 to the band's bottom, heavy 3px from 18.
        assert_eq!(
            pieces(&powerpoint_underline_path(UnderlineStyle::Double, false, 10.0, 20.0, 100.0, 2.0)),
            [(10.0, 18.0, 110.0, 19.0), (10.0, 21.0, 110.0, 22.0)]
        );
        assert_eq!(
            pieces(&powerpoint_underline_path(UnderlineStyle::Solid, true, 10.0, 20.0, 100.0, 2.0)),
            [(10.0, 18.0, 110.0, 21.0)]
        );
        assert_eq!(
            pieces(&powerpoint_underline_path(UnderlineStyle::Solid, false, 10.0, 20.0, 100.0, 2.0)),
            [(10.0, 20.0, 110.0, 22.0)]
        );
    }

    #[test]
    fn powerpoint_wavy_underline_is_a_thin_zigzag_over_twice_the_band() {
        let [(x0, y0, x1, y1)] = pieces(&powerpoint_underline_path(UnderlineStyle::Wavy, false, 10.0, 20.0, 100.0, 2.0))[..] else {
            panic!("one zigzag")
        };
        // From half a thickness above the band, 2 thicknesses tall; whole half-waves, so it may run past the text.
        let reach = f64::from(4.0 - PPT_WAVE_LINE);
        assert!((y0 - 19.0).abs() < 1e-4 && (y1 - 23.0).abs() < 1e-4, "{y0}..{y1}");
        assert!(x0 == 10.0 && (x1 - (10.0 + reach * (100.0 / reach).ceil())).abs() < 1e-3, "{x0}..{x1}");
    }

    #[test]
    fn wavy_underlines_span_the_run_around_the_single_line() {
        let [(x0, y0, x1, y1)] = pieces(&underline_path(UnderlineStyle::Wavy, 10.0, 20.0, 100.0, 2.0))[..] else {
            panic!("one band")
        };
        assert!((x0, x1) == (10.0, 110.0), "{x0}..{x1}");
        // Centred on 21: half the WAVE_HEIGHT plus half the band either side.
        let reach = f64::from(WAVE_HEIGHT * 2.0 / 2.0 + WAVE_THICKNESS * 2.0 / 2.0);
        assert!((y0 - (21.0 - reach)).abs() < 1e-4 && (y1 - (21.0 + reach)).abs() < 1e-4, "{y0}..{y1}");
        // A run shorter than half a wave still draws one half-wave.
        assert_eq!(pieces(&underline_path(UnderlineStyle::Wavy, 0.0, 0.0, 1.0, 2.0)).len(), 1);
    }
}
