//! Filled rectangle, rounded-rectangle and ellipse paths.

use krilla::geom::{Path, PathBuilder, Rect};
use krilla::surface::Surface;

use crate::color::{Rgba, fill_of};

/// Control-point distance of a cubic quarter circle, per unit radius.
const KAPPA: f32 = 0.552_284_8;

pub(crate) fn fill_path(surface: &mut Surface, path: Option<Path>, color: Rgba) {
    if let Some(path) = path {
        fill(surface, &path, color);
    }
}

pub(crate) fn fill(surface: &mut Surface, path: &Path, color: Rgba) {
    if color.3 <= 0.0 {
        return;
    }
    surface.set_stroke(None);
    surface.set_fill(Some(fill_of(color)));
    surface.draw_path(path);
}

pub(crate) fn rect_path(x: f32, y: f32, w: f32, h: f32, radius: f32) -> Option<Path> {
    let mut pb = PathBuilder::new();
    let r = radius.min(w / 2.0).min(h / 2.0).max(0.0);
    if r == 0.0 {
        pb.push_rect(Rect::from_xywh(x, y, w.max(0.01), h.max(0.01))?);
    } else {
        let k = r * KAPPA;
        pb.move_to(x + r, y);
        pb.line_to(x + w - r, y);
        pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        pb.line_to(x + w, y + h - r);
        pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        pb.line_to(x + r, y + h);
        pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        pb.line_to(x, y + r);
        pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
        pb.close();
    }
    pb.finish()
}

/// The ellipse inscribed in the box, as four cubic quarter arcs (the `rect_path` constant).
pub(crate) fn ellipse_path(x: f32, y: f32, w: f32, h: f32) -> Option<Path> {
    let (rx, ry) = (w / 2.0, h / 2.0);
    let (cx, cy) = (x + rx, y + ry);
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    let mut pb = PathBuilder::new();
    pb.move_to(cx + rx, cy);
    pb.cubic_to(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    pb.cubic_to(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    pb.cubic_to(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    pb.cubic_to(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    pb.close();
    pb.finish()
}
