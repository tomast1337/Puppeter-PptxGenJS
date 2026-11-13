//! Drawing laid-out text boxes: glyph runs, outlines, highlights and decorations.

use std::sync::Arc;

use krilla::Data;
use krilla::color::rgb;
use krilla::geom::{Point, Transform};
use krilla::paint::Stroke;
use krilla::surface::Surface;
use krilla::text::{Font, GlyphId, KrillaGlyph};
use parley::{Layout, PositionedLayoutItem};

use crate::Renderer;
use crate::color::{Rgba, fill_of, unit};
use crate::link::page_quad;
use crate::model::TextBox;
use crate::path::{fill_path, rect_path};
use crate::text::layout::{BoxLayout, Brush, RunPaint};

/// LibreOffice's synthetic styles for a face that lacks them, read from its PDF export of a
/// regular-only face (Droid Sans Mono, 72pt): bold fills and strokes the glyphs (`2 Tr`) with a line
/// 1/30 of the size wide (`2.39996 w`); italic shears them (`1 0 0.3462535606 1 x y Tm`).
const SYNTHETIC_BOLD_STROKE_EM: f32 = 1.0 / 30.0;
const SYNTHETIC_ITALIC_SHEAR: f32 = 0.346_253_56;

/// Shears what is drawn on `baseline` (y down) to the right above it and to the left below it.
fn oblique(baseline: f32) -> Transform {
    Transform::from_row(1.0, 0.0, -SYNTHETIC_ITALIC_SHEAR, 1.0, SYNTHETIC_ITALIC_SHEAR * baseline, 0.0)
}

fn stroke_of(Rgba(r, g, b, a): Rgba, width: f32) -> Stroke {
    Stroke {
        paint: rgb::Color::new(r, g, b).into(),
        width,
        opacity: unit(a),
        ..Stroke::default()
    }
}

impl Renderer {
    /// Draws the box and queues its runs' link annotations; a link the PDF cannot carry is an error.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn draw_text(&mut self, surface: &mut Surface, text: &TextBox, layout: &BoxLayout, x: f32, y: f32, w: f32, h: f32) -> Result<(), String> {
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
                let first = layout.baselines.get(para.baselines.start..para.baselines.start + 1).unwrap_or_default();
                self.draw_layout(surface, ml, marker, &layout.paints, (*mx, v0 + para.y), first);
            }
            let baselines = layout.baselines.get(para.baselines.clone()).unwrap_or_default();
            self.draw_layout(surface, &para.layout, &para.text, &layout.paints, (para.x, v0 + para.y), baselines);
        }
        surface.pop();
        let mut quads = std::mem::take(&mut self.link_quads);
        let linked = quads.drain(..).try_for_each(|(p, r, quad)| {
            let run = text.paragraphs.get(p as usize).and_then(|para| para.runs.get(r as usize));
            match run.and_then(|run| run.link.as_ref()) {
                Some(link) => self.add_link(link, quad),
                None => Ok(()),
            }
        });
        self.link_quads = quads;
        linked
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
    fn draw_layout(&mut self, surface: &mut Surface, layout: &Layout<Brush>, text: &str, paints: &[RunPaint], (ox, oy): (f32, f32), baselines: &[f32]) {
        let mut ranges = std::mem::take(&mut self.glyph_ranges);
        let mut positioned = std::mem::take(&mut self.positioned);
        let mut glyphs = std::mem::take(&mut self.glyphs);
        for (line, baseline) in layout.lines().zip(baselines) {
            let oy = oy + baseline - line.metrics().baseline;
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
                let run = glyph_run.run();
                let size = run.font_size();
                let metrics = *run.font_metrics();
                let paint = paints
                    .get(glyph_run.style().brush.0 as usize)
                    .expect("layout_text sets every brush to the index of the paint it pushes alongside");
                let baseline = oy + glyph_run.baseline() - paint.baseline_offset;
                let start = ox + glyph_run.offset();
                let advance = glyph_run.advance();
                if let Some((p, r)) = paint.link {
                    // One annotation per line fragment, over the run's line box, as Chromium does for an inline <a>.
                    if let Some(quad) = page_quad(surface, start, baseline - metrics.ascent, advance, metrics.ascent + metrics.descent) {
                        self.link_quads.push((p, r, quad));
                    }
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
                // fontique asks for synthesis when the face it matched lacks the requested style.
                let synthesis = run.synthesis();
                let skewed = synthesis.skew().is_some();
                if skewed {
                    surface.push_transform(&oblique(baseline));
                }
                surface.set_stroke(synthesis.embolden().then(|| stroke_of(paint.color, size * SYNTHETIC_BOLD_STROKE_EM)));
                surface.set_fill(Some(fill_of(paint.color)));
                surface.draw_glyphs(origin, &glyphs, font.clone(), text, size, false);
                if let Some((color, width)) = paint.outline {
                    surface.set_fill(None);
                    surface.set_stroke(Some(stroke_of(color, width)));
                    surface.draw_glyphs(origin, &glyphs, font, text, size, false);
                }
                surface.set_stroke(None);
                if skewed {
                    surface.pop();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obliques_lean_right_above_the_baseline_and_keep_it_in_place() {
        let t = oblique(100.0);
        let map = |x: f32, y: f32| (t.sx() * x + t.kx() * y + t.tx(), t.ky() * x + t.sy() * y + t.ty());
        let close = |(x, y): (f32, f32), (ex, ey): (f32, f32)| assert!((x - ex).abs() < 1e-4 && (y - ey).abs() < 1e-4, "({x}, {y}) != ({ex}, {ey})");
        close(map(5.0, 100.0), (5.0, 100.0));
        close(map(5.0, 90.0), (5.0 + 10.0 * SYNTHETIC_ITALIC_SHEAR, 90.0));
        close(map(5.0, 110.0), (5.0 - 10.0 * SYNTHETIC_ITALIC_SHEAR, 110.0));
    }
}
