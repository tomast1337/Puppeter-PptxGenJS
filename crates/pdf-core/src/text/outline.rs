//! Glyph outlines as paths, for the silhouettes shadows and glow are blurred from (krilla embeds
//! the font itself and never hands its outlines out).

use kurbo::BezPath;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::{FontRef, GlyphId, MetadataProvider};

/// Writes font-unit outlines (y up, origin on the pen) into a y-down path at the pen position.
struct Pen<'a> {
    path: &'a mut BezPath,
    x: f64,
    y: f64,
}

impl Pen<'_> {
    fn at(&self, x: f32, y: f32) -> (f64, f64) {
        (self.x + f64::from(x), self.y - f64::from(y))
    }
}

impl OutlinePen for Pen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        self.path.move_to(p);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        self.path.line_to(p);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let (c, p) = (self.at(cx0, cy0), self.at(x, y));
        self.path.quad_to(c, p);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (c0, c1, p) = (self.at(cx0, cy0), self.at(cx1, cy1), self.at(x, y));
        self.path.curve_to(c0, c1, p);
    }

    fn close(&mut self) {
        self.path.close_path();
    }
}

/// The outlines of `glyphs` (pen x, baseline y, glyph id; px) of `font` at `size` px. Glyphs
/// without an outline (bitmap emoji) and fonts skrifa cannot read add nothing.
// shortcut: variable fonts are outlined at their default instance; pass the run's coordinates when a deck uses one.
pub(crate) fn glyph_outlines(font: &parley::FontData, size: f32, glyphs: impl Iterator<Item = (f32, f32, u32)>) -> BezPath {
    let mut path = BezPath::new();
    let Ok(font) = FontRef::from_index(font.data.as_ref(), font.index) else {
        return path;
    };
    let outlines = font.outline_glyphs();
    for (x, y, id) in glyphs {
        let settings = DrawSettings::unhinted(Size::new(size), LocationRef::default());
        if let Some(glyph) = outlines.get(GlyphId::new(id)) {
            let mut pen = Pen {
                path: &mut path,
                x: f64::from(x),
                y: f64::from(y),
            };
            // A glyph whose outline data is malformed casts no silhouette; krilla still draws what it can.
            let _ = glyph.draw(settings, &mut pen);
        }
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use kurbo::Shape;

    #[test]
    fn outlines_glyphs_y_down_at_their_pen_positions() {
        let Some(data) = crate::tests::liberation_sans() else { return };
        let font = parley::FontData::new(parley::fontique::Blob::from(data), 0);
        let face = FontRef::from_index(font.data.as_ref(), 0).unwrap();
        let bar = face.charmap().map('|').unwrap().to_u32();
        let outline = glyph_outlines(&font, 100.0, [(10.0, 200.0, bar), (60.0, 200.0, bar)].into_iter());
        let bounds = outline.bounding_box();
        // Liberation Sans '|' rises above the baseline (y up in the font, so smaller y here) and
        // drops below it; the second copy sits 50 px further right.
        assert!(bounds.y0 < 200.0 - 70.0 && bounds.y1 > 200.0 + 15.0, "{bounds:?}");
        assert!(bounds.x0 > 10.0 && bounds.x1 > 60.0 && bounds.x1 < 80.0, "{bounds:?}");
        assert!(glyph_outlines(&font, 100.0, std::iter::once((0.0, 0.0, u32::MAX))).is_empty());
    }
}
