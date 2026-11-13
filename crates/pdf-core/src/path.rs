//! Filled paths, and the rectangle, rounded-rectangle and ellipse paths most objects are made of.
//!
//! Paths are kurbo paths until they are drawn, so the silhouette of a shadow or glow (effect/) can
//! read the same geometry krilla draws.

use krilla::geom::{Path, PathBuilder};
use krilla::surface::Surface;
use kurbo::{BezPath, PathEl, Point};

use crate::Renderer;
use crate::color::{Rgba, fill_of};

/// Control-point distance of a cubic quarter circle, per unit radius.
const KAPPA: f64 = 0.552_284_8;
/// Smallest side of a rectangle, so a zero-size box still makes a path (px).
const MIN_SIDE: f32 = 0.01;

impl Renderer {
    /// Fills `path` (current user space) and adds it to the silhouettes being captured.
    pub(crate) fn fill(&mut self, surface: &mut Surface, path: &BezPath, color: Rgba) {
        if color.3 <= 0.0 {
            return;
        }
        let Some(pdf) = to_path(path) else { return };
        self.effects.capture(surface.ctm(), path, color.3, None);
        surface.set_stroke(None);
        surface.set_fill(Some(fill_of(color)));
        surface.draw_path(&pdf);
    }
}

pub(crate) fn rect_path(x: f32, y: f32, w: f32, h: f32, radius: f32) -> BezPath {
    let (x, y, w, h) = (f64::from(x), f64::from(y), f64::from(w.max(MIN_SIDE)), f64::from(h.max(MIN_SIDE)));
    let r = f64::from(radius).min(w / 2.0).min(h / 2.0).max(0.0);
    let mut pb = BezPath::new();
    if r == 0.0 {
        pb.move_to((x, y));
        pb.line_to((x + w, y));
        pb.line_to((x + w, y + h));
        pb.line_to((x, y + h));
        pb.close_path();
    } else {
        let k = r * KAPPA;
        pb.move_to((x + r, y));
        pb.line_to((x + w - r, y));
        pb.curve_to((x + w - r + k, y), (x + w, y + r - k), (x + w, y + r));
        pb.line_to((x + w, y + h - r));
        pb.curve_to((x + w, y + h - r + k), (x + w - r + k, y + h), (x + w - r, y + h));
        pb.line_to((x + r, y + h));
        pb.curve_to((x + r - k, y + h), (x, y + h - r + k), (x, y + h - r));
        pb.line_to((x, y + r));
        pb.curve_to((x, y + r - k), (x + r - k, y), (x + r, y));
        pb.close_path();
    }
    pb
}

/// The ellipse inscribed in the box, as four cubic quarter arcs (the `rect_path` constant).
pub(crate) fn ellipse_path(x: f32, y: f32, w: f32, h: f32) -> BezPath {
    let (rx, ry) = (f64::from(w) / 2.0, f64::from(h) / 2.0);
    let (cx, cy) = (f64::from(x) + rx, f64::from(y) + ry);
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    let mut pb = BezPath::new();
    pb.move_to((cx + rx, cy));
    pb.curve_to((cx + rx, cy + ky), (cx + kx, cy + ry), (cx, cy + ry));
    pb.curve_to((cx - kx, cy + ry), (cx - rx, cy + ky), (cx - rx, cy));
    pb.curve_to((cx - rx, cy - ky), (cx - kx, cy - ry), (cx, cy - ry));
    pb.curve_to((cx + kx, cy - ry), (cx + rx, cy - ky), (cx + rx, cy));
    pb.close_path();
    pb
}

/// A kurbo path as a krilla path; `None` when it is empty or not finite.
pub(crate) fn to_path(path: &BezPath) -> Option<Path> {
    let mut pb = PathBuilder::new();
    let p = |p: Point| (p.x as f32, p.y as f32);
    for element in path.iter() {
        match element {
            PathEl::MoveTo(a) => pb.move_to(p(a).0, p(a).1),
            PathEl::LineTo(a) => pb.line_to(p(a).0, p(a).1),
            PathEl::QuadTo(a, b) => pb.quad_to(p(a).0, p(a).1, p(b).0, p(b).1),
            PathEl::CurveTo(a, b, c) => pb.cubic_to(p(a).0, p(a).1, p(b).0, p(b).1, p(c).0, p(c).1),
            PathEl::ClosePath => pb.close(),
        }
    }
    pb.finish()
}
