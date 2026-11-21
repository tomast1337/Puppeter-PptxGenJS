//! Filled paths, and the rectangle, rounded-rectangle and ellipse paths most objects are made of.
//!
//! Paths are kurbo paths until they are drawn, so the silhouette of a shadow or glow (effect/) can
//! read the same geometry krilla draws.

use krilla::geom::{Path, PathBuilder};
use krilla::paint::{Fill, FillRule, Stroke};
use krilla::surface::Surface;
use kurbo::{Affine, BezPath, PathEl, Point, Rect, Shape as _};

use crate::Renderer;
use crate::color::{Rgba, fill_of};

/// Control-point distance of a cubic quarter circle, per unit radius.
const KAPPA: f64 = 0.552_284_8;
/// Smallest side of a rectangle, so a zero-size box still makes a path (px).
const MIN_SIDE: f32 = 0.01;
/// Largest coordinate a drawn path's box may reach under the current transform: far past any page,
/// and far enough below f32::MAX that krilla's own box arithmetic stays finite.
pub(crate) const MAX_PLACED: f64 = 1e30;

impl Renderer {
    /// Fills `path` (current user space) and adds it to the silhouettes being captured.
    pub(crate) fn fill(&mut self, surface: &mut Surface, path: &BezPath, color: Rgba) {
        self.fill_with_rule(surface, path, color, FillRule::NonZero);
    }

    /// `fill` with an SVG `fill-rule`.
    pub(crate) fn fill_with_rule(&mut self, surface: &mut Surface, path: &BezPath, color: Rgba, rule: FillRule) {
        if color.3 <= 0.0 {
            return;
        }
        let Some(pdf) = to_path(path) else { return };
        if !self.placed(surface, path, None) {
            return;
        }
        self.effects.capture(surface.ctm(), path, color.3, None);
        surface.set_stroke(None);
        surface.set_fill(Some(Fill { rule, ..fill_of(color) }));
        surface.draw_path(&pdf);
    }

    /// Whether krilla can place `path` (current user space), stroked with `stroke`, on the page:
    /// it unwraps the box of what it draws under the current transform, which fails once that box
    /// overflows f32 (GHSA-fmx3-qwqc-h37c). A path past MAX_PLACED is reported and not drawn.
    pub(crate) fn placed(&mut self, surface: &Surface, path: &BezPath, stroke: Option<&Stroke>) -> bool {
        // A miter can reach `miter_limit` half-widths past the path.
        let reach = stroke.map_or(0.0, |s| f64::from(s.width * s.miter_limit.max(1.0)));
        self.placed_box(surface, path.bounding_box().inflate(reach, reach), "path")
    }

    /// `placed` for the box (current user space) of anything krilla draws or clips with: a glyph
    /// run, an image or a clip path. `what` names it in the warning.
    pub(crate) fn placed_box(&mut self, surface: &Surface, bbox: Rect, what: &str) -> bool {
        let t = surface.ctm();
        let ctm = Affine::new([t.sx(), t.ky(), t.kx(), t.sy(), t.tx(), t.ty()].map(f64::from));
        let b = ctm.transform_rect_bbox(bbox);
        // In f64, so the check cannot overflow; NaN fails it.
        let placed = [b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.abs() <= MAX_PLACED);
        if !placed {
            self.warn(format!("{what} past the page's coordinate range not rendered"));
        }
        placed
    }

    /// Pushes `clip` (current user space, its box `bbox`) as a clip path, unless it is past
    /// MAX_PLACED: krilla unwraps the clip path under the current transform (GHSA-fmx3-qwqc-h37c).
    /// Returns whether it pushed; when not, the caller draws nothing of what it would clip.
    pub(crate) fn push_clip(&mut self, surface: &mut Surface, clip: &Path, bbox: Rect, rule: FillRule) -> bool {
        let placed = self.placed_box(surface, bbox, "clip path");
        if placed {
            surface.push_clip_path(clip, &rule);
        }
        placed
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
        corners(&mut pb, (x, y, w, h), (r, r));
    }
    pb
}

/// A rectangle with elliptical corners of radii `(rx, ry)`, each at most half its side (SVG's
/// `rect` with `rx`/`ry`).
pub(crate) fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, (rx, ry): (f32, f32)) -> BezPath {
    let mut pb = BezPath::new();
    let side = |v: f32| f64::from(v);
    corners(&mut pb, (side(x), side(y), side(w), side(h)), (side(rx), side(ry)));
    pb
}

/// The outline of a rectangle with elliptical corners, as cubic quarter arcs.
fn corners(pb: &mut BezPath, (x, y, w, h): (f64, f64, f64, f64), (rx, ry): (f64, f64)) {
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    pb.move_to((x + rx, y));
    pb.line_to((x + w - rx, y));
    pb.curve_to((x + w - rx + kx, y), (x + w, y + ry - ky), (x + w, y + ry));
    pb.line_to((x + w, y + h - ry));
    pb.curve_to((x + w, y + h - ry + ky), (x + w - rx + kx, y + h), (x + w - rx, y + h));
    pb.line_to((x + rx, y + h));
    pb.curve_to((x + rx - kx, y + h), (x, y + h - ry + ky), (x, y + h - ry));
    pb.line_to((x, y + ry));
    pb.curve_to((x, y + ry - ky), (x + rx - kx, y), (x + rx, y));
    pb.close_path();
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

/// A stroke width pdf-writer accepts: it asserts `w >= 0`, a panic that aborts the wasm instance
/// (GHSA-fmx3-qwqc-h37c), and a non-finite width is no PDF number. The profile parser rejects a
/// negative width; this also stops a computed one, such as the synthetic-bold stroke of a huge font.
pub(crate) fn stroke_width(width: f32) -> Option<f32> {
    (width.is_finite() && width >= 0.0).then_some(width)
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
