//! Drawing laid-out text boxes: glyph runs, outlines, highlights and decorations.

use std::sync::Arc;

use krilla::Data;
use krilla::color::rgb;
use krilla::geom::{Point, Transform};
use krilla::paint::Stroke;
use krilla::surface::Surface;
use krilla::text::{Font, GlyphId, KrillaGlyph};
use parley::{Layout, Line, LineHeight, PositionedLayoutItem};

use crate::Renderer;
use crate::color::{fill_of, unit};
use crate::model::TextBox;
use crate::path::{fill_path, rect_path};
use crate::text::layout::{BoxLayout, Brush, RunPaint};

/// LibreOffice's font-independent line box (PPTX_DEFAULTS.text.lineDescentEm): the baseline sits
/// this many ems of the line's largest font above the line's bottom, with all extra leading above it.
const LINE_DESCENT_EM: f32 = 0.2;

/// How far LibreOffice's baseline sits below parley's on `line`. parley splits the leading above
/// and below the baseline, as CSS does; LibreOffice puts all of it above, so the baseline sits
/// `LINE_DESCENT_EM` of the line's largest font above the bottom of its nominal line box. The
/// nominal box comes from the paragraph's line height, not parley's line box, which a raised or
/// lowered (super/sub) run makes taller in CSS but not in LibreOffice.
fn baseline_shift(line: &Line<Brush>, line_height: LineHeight) -> f32 {
    let m = line.metrics();
    let largest = line.runs().map(|run| run.font_size()).fold(0.0f32, f32::max);
    let nominal = match line_height {
        LineHeight::FontSizeRelative(factor) => factor * largest,
        LineHeight::Absolute(height) => height,
        // layout_text sets only the two above.
        _ => m.line_height,
    };
    m.block_min_coord + nominal - LINE_DESCENT_EM * largest - m.baseline
}

impl Renderer {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn draw_text(&mut self, surface: &mut Surface, text: &TextBox, layout: &BoxLayout, x: f32, y: f32, w: f32, h: f32) {
        let [top, right, bottom, left] = text.margin;
        let (ix, iy, iw, ih) = (x + left, y + top, w - left - right, h - top - bottom);
        // Local frame: u along the line, v along the block axis.
        let (frame, block) = match text.direction.as_str() {
            "vertical" => (Transform::from_row(0.0, 1.0, -1.0, 0.0, ix + iw, iy), iw),
            "vertical270" => (Transform::from_row(0.0, -1.0, 1.0, 0.0, ix, iy + ih), iw),
            _ => (Transform::from_translate(ix, iy), ih),
        };
        let v0 = match text.vertical_align.as_str() {
            "middle" => (block - layout.height) / 2.0,
            "bottom" => block - layout.height,
            _ => 0.0,
        };
        surface.push_transform(&frame);
        for para in &layout.paras {
            if let Some((marker, ml, mx)) = &para.marker {
                // Marker shares the first line's baseline.
                let first_baseline = para
                    .layout
                    .lines()
                    .next()
                    .map(|l| l.metrics().baseline + baseline_shift(&l, para.line_height))
                    .unwrap_or(0.0);
                let marker_baseline = ml.lines().next().map(|l| l.metrics().baseline).unwrap_or(0.0);
                self.draw_layout(surface, ml, marker, &layout.paints, *mx, v0 + para.y + first_baseline - marker_baseline, None);
            }
            self.draw_layout(surface, &para.layout, &para.text, &layout.paints, para.x, v0 + para.y, Some(para.line_height));
        }
        surface.pop();
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

    /// Draws `layout` with its top-left at `ox, oy`. With the paragraph's `line_height`, each line's
    /// baseline moves to LibreOffice's position (`baseline_shift`); a bullet marker passes `None`.
    #[allow(clippy::too_many_arguments)] // the origin is two plain numbers, as in draw_text
    fn draw_layout(
        &mut self,
        surface: &mut Surface,
        layout: &Layout<Brush>,
        text: &str,
        paints: &[RunPaint],
        ox: f32,
        oy: f32,
        line_height: Option<LineHeight>,
    ) {
        let mut ranges = std::mem::take(&mut self.glyph_ranges);
        let mut positioned = std::mem::take(&mut self.positioned);
        let mut glyphs = std::mem::take(&mut self.glyphs);
        for line in layout.lines() {
            let shift = line_height.map_or(0.0, |lh| baseline_shift(&line, lh));
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
                let run = glyph_run.run();
                let size = run.font_size();
                let metrics = *run.font_metrics();
                let paint = paints
                    .get(glyph_run.style().brush.0 as usize)
                    .expect("layout_text sets every brush to the index of the paint it pushes alongside");
                let baseline = oy + glyph_run.baseline() + shift - paint.baseline_offset;
                let start = ox + glyph_run.offset();
                let advance = glyph_run.advance();
                if run.synthesis().embolden() || run.synthesis().skew().is_some() {
                    self.warn("synthetic bold/italic requested but not applied");
                }

                if let Some(hl) = paint.highlight {
                    fill_path(
                        surface,
                        rect_path(start, baseline - metrics.ascent, advance, metrics.ascent + metrics.descent, 0.0),
                        hl,
                    );
                }

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
                let Some(font) = self.pdf_font(run.font()) else {
                    self.warn("font could not be embedded");
                    continue;
                };
                let origin = Point::from_xy(start, baseline);
                surface.set_stroke(None);
                surface.set_fill(Some(fill_of(paint.color)));
                surface.draw_glyphs(origin, &glyphs, font.clone(), text, size, false);
                if let Some((color, width)) = paint.outline {
                    surface.set_fill(None);
                    surface.set_stroke(Some(Stroke {
                        paint: rgb::Color::new(color.0, color.1, color.2).into(),
                        width,
                        opacity: unit(color.3),
                        ..Stroke::default()
                    }));
                    surface.draw_glyphs(origin, &glyphs, font, text, size, false);
                    surface.set_stroke(None);
                }

                let deco = paint.underline_color.unwrap_or(paint.color);
                if paint.underline {
                    fill_path(
                        surface,
                        rect_path(start, baseline - metrics.underline_offset, advance, metrics.underline_size.max(0.5), 0.0),
                        deco,
                    );
                }
                if paint.strike || paint.double_strike {
                    let t = metrics.strikethrough_size.max(0.5);
                    let y = baseline - metrics.strikethrough_offset;
                    if paint.double_strike {
                        fill_path(surface, rect_path(start, y - t, advance, t, 0.0), paint.color);
                        fill_path(surface, rect_path(start, y + t, advance, t, 0.0), paint.color);
                    } else {
                        fill_path(surface, rect_path(start, y, advance, t, 0.0), paint.color);
                    }
                }
            }
        }
        self.glyph_ranges = ranges;
        self.positioned = positioned;
        self.glyphs = glyphs;
    }
}
