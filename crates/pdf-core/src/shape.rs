//! Shape geometry from the model: fills (with multi-face shading), strokes and arrowheads.
//!
//! The model carries every preset already resolved to SVG path data in the shape's own
//! coordinate space (`NormalizedShape.width/height`), which the Puppeteer renderer stretches
//! over the object box (packages/pptxgenjs/src/render/shape.ts). This module draws the same
//! data: the box mapping scales the points, never the stroke (`vector-effect: non-scaling-stroke`).

use krilla::color::rgb;
use krilla::geom::{Path, PathBuilder, Rect, Transform};
use krilla::paint::{FillRule, Stroke, StrokeDash};
use krilla::surface::Surface;
use kurbo::{Affine, BezPath, ParamCurve, PathEl, PathSeg, Point, Shape, Vec2};

use crate::Renderer;
use crate::color::{Rgba, fill_of, parse_color, unit};
use crate::model::{FillModifier, LineModel, ObjectStyle, ShapeGeometry, ShapeModel};
use crate::path::{fill as fill_shape, fill_path, rect_path};

/// SVG's `stroke-miterlimit` initial value, which the Puppeteer renderer's shape strokes use
/// (krilla defaults to 10).
const SVG_MITER_LIMIT: f32 = 4.0;
/// kurbo's tolerance when it turns an ellipse into Béziers (px; marker units for the oval head).
const CURVE_TOLERANCE: f64 = 0.01;

impl Renderer {
    /// Fills and strokes the object's geometry over the box `x, y, w, h` (px). Objects without
    /// shape geometry (plain text boxes) are their own rectangle.
    #[allow(clippy::too_many_arguments)] // the box is four plain numbers, as in draw_text
    pub(crate) fn draw_geometry(
        &mut self,
        surface: &mut Surface,
        shape: Option<&ShapeModel>,
        style: &ObjectStyle,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> Result<(), String> {
        let fill = style.fill.as_ref().filter(|f| f.visible).and_then(|f| parse_color(&f.color));
        let line = style.line.as_ref().filter(|l| l.visible && l.width > 0.0);
        let Some(shape) = shape else {
            self.fill_and_stroke(surface, rect_path(x, y, w, h, 0.0), fill, line);
            return Ok(());
        };
        if shape.link.is_some() {
            self.warn("shape hyperlink annotations not emitted");
        }
        // The SVG renderer's viewBox: a zero-height line keeps a unit-high box, so it is not scaled.
        let scale = |size: f32, model: f32| f64::from(if model > 0.0 { size / model } else { 1.0 });
        let to_box = Affine::new([scale(w, shape.width), 0.0, 0.0, scale(h, shape.height), f64::from(x), f64::from(y)]);
        match &shape.geometry {
            // SVG draws no markers on <rect> or <ellipse>.
            ShapeGeometry::Rect { radius } => self.fill_and_stroke(surface, rect_path(x, y, w, h, *radius), fill, line),
            ShapeGeometry::Ellipse => {
                let ellipse = kurbo::Ellipse::from_rect(kurbo::Rect::new(f64::from(x), f64::from(y), f64::from(x + w), f64::from(y + h)));
                self.fill_and_stroke(surface, to_path(&ellipse.to_path(CURVE_TOLERANCE)), fill, line);
            }
            ShapeGeometry::Line { inverse } => {
                let (y0, y1) = if *inverse { (shape.height, 0.0) } else { (0.0, shape.height) };
                let mut path = BezPath::new();
                path.move_to((0.0, f64::from(y0)));
                path.line_to((f64::from(shape.width), f64::from(y1)));
                path.apply_affine(to_box);
                if let Some(line) = line {
                    self.stroke_with_arrows(surface, &path, line);
                }
            }
            ShapeGeometry::Path {
                data,
                transform,
                faces,
                outline_data,
            } => {
                let affine = match transform {
                    Some(matrix) => to_box * parse_matrix(matrix).ok_or_else(|| format!("shape '{}': invalid transform '{matrix}'", shape.name))?,
                    None => to_box,
                };
                let parse = |d: &str| {
                    let mut path = BezPath::from_svg(d).map_err(|e| format!("shape '{}': invalid path data: {e}", shape.name))?;
                    path.apply_affine(affine);
                    Ok::<_, String>(path)
                };
                match faces.as_deref().filter(|f| !f.is_empty()) {
                    // Multi-face presets: shaded faces without stroke, then the stroke-only outline.
                    Some(faces) => {
                        for face in faces {
                            let color = fill.map(|c| face.fill_modifier.map_or(c, |m| modify(c, m)));
                            if let Some(color) = color {
                                fill_path(surface, to_path(&parse(&face.data)?), color);
                            }
                        }
                        if let (Some(data), Some(line)) = (outline_data, line) {
                            self.stroke_with_arrows(surface, &parse(data)?, line);
                        }
                    }
                    None => {
                        let path = parse(data)?;
                        if let Some(color) = fill {
                            fill_path(surface, to_path(&path), color);
                        }
                        if let Some(line) = line {
                            self.stroke_with_arrows(surface, &path, line);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn fill_and_stroke(&mut self, surface: &mut Surface, path: Option<Path>, fill: Option<Rgba>, line: Option<&LineModel>) {
        let Some(path) = path else { return };
        if let Some(color) = fill {
            fill_shape(surface, &path, color);
        }
        if let Some(line) = line
            && let Some(stroke) = stroke_of(line)
        {
            surface.set_fill(None);
            surface.set_stroke(Some(stroke));
            surface.draw_path(&path);
            surface.set_stroke(None);
        }
    }

    /// Strokes `path` (object space) and puts the line's arrowheads on its first and last vertex.
    fn stroke_with_arrows(&mut self, surface: &mut Surface, path: &BezPath, line: &LineModel) {
        self.fill_and_stroke(surface, to_path(path), None, Some(line));
        let Some(color) = parse_color(&line.color).filter(|c| c.3 > 0.0) else {
            return;
        };
        let (Some(first), Some(last)) = (path.segments().next(), path.segments().last()) else {
            return;
        };
        let ends = [
            (line.begin_arrow.as_deref(), first.start(), -direction(first, false)),
            (line.end_arrow.as_deref(), last.end(), direction(last, true)),
        ];
        for (kind, at, toward) in ends {
            match kind.map(arrowhead) {
                None | Some(Ok(None)) => {}
                Some(Ok(Some(head))) => draw_arrowhead(surface, &head, at, toward, line.width, color),
                Some(Err(kind)) => self.warn(format!("line arrowhead '{kind}' not rendered")),
            }
        }
    }
}

/// The krilla stroke for a visible model line, centred on the geometry as in PowerPoint.
fn stroke_of(line: &LineModel) -> Option<Stroke> {
    let color = parse_color(&line.color).filter(|c| c.3 > 0.0)?;
    Some(Stroke {
        paint: rgb::Color::new(color.0, color.1, color.2).into(),
        width: line.width,
        opacity: unit(color.3),
        dash: line.dash_array.as_deref().and_then(dash_of),
        miter_limit: SVG_MITER_LIMIT,
        ..Stroke::default()
    })
}

/// SVG `stroke-dasharray` (px, space or comma separated). As in SVG, a negative or non-numeric
/// entry, or an all-zero pattern, draws the line solid.
fn dash_of(css: &str) -> Option<StrokeDash> {
    let array: Vec<f32> = css
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|v| !v.is_empty())
        .map(|v| v.parse().ok().filter(|n: &f32| n.is_finite() && *n >= 0.0))
        .collect::<Option<_>>()?;
    array.iter().any(|v| *v > 0.0).then_some(StrokeDash { array, offset: 0.0 })
}

/// DrawingML face shading as the SVG renderer applies it (`modifyColor` in
/// packages/pptxgenjs/src/render/shape.ts): lighten mixes toward white, darken scales toward black.
fn modify(c: Rgba, modifier: FillModifier) -> Rgba {
    let channel = |v: u8| {
        let v = f32::from(v);
        let out = match modifier {
            FillModifier::Lighten => v + (255.0 - v) * 0.6,
            FillModifier::LightenLess => v + (255.0 - v) * 0.2,
            FillModifier::Darken => v * 0.6,
            FillModifier::DarkenLess => v * 0.8,
        };
        out.floor() as u8
    };
    Rgba(channel(c.0), channel(c.1), channel(c.2), c.3)
}

/// SVG `matrix(a b c d e f)`, the only transform the model emits.
fn parse_matrix(css: &str) -> Option<Affine> {
    let inner = css.trim().strip_prefix("matrix(")?.strip_suffix(')')?;
    let values: Vec<f64> = inner
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|v| !v.is_empty())
        .map(|v| v.parse().ok().filter(|n: &f64| n.is_finite()))
        .collect::<Option<_>>()?;
    let coefficients: [f64; 6] = values.try_into().ok()?;
    Some(Affine::new(coefficients))
}

/// A kurbo path as a krilla path; `None` when it is empty or not finite.
fn to_path(path: &BezPath) -> Option<Path> {
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

/// Path direction leaving the segment's start (`at_end == false`) or entering its end, from
/// the nearest control point that does not coincide with that end, as SVG markers orient.
fn direction(segment: PathSeg, at_end: bool) -> Vec2 {
    let mut points = match segment {
        PathSeg::Line(l) => [l.p0, l.p1, l.p1, l.p1],
        PathSeg::Quad(q) => [q.p0, q.p1, q.p2, q.p2],
        PathSeg::Cubic(c) => [c.p0, c.p1, c.p2, c.p3],
    };
    if at_end {
        points.reverse();
    }
    let [anchor, ..] = points;
    let delta = points.iter().find(|p| **p != anchor).map_or(Vec2::ZERO, |p| *p - anchor);
    if at_end { -delta } else { delta }
}

/// An SVG marker from the renderer's `markerPath` (packages/pptxgenjs/src/render/shape.ts): drawn
/// in a 10x10 viewBox anchored at (`ref_x`, 5), `size` stroke widths wide, its +x axis along the path.
struct Arrowhead {
    path: BezPath,
    /// `arrow` is an open chevron stroked 1.5 marker units wide; the others are filled.
    stroked: bool,
    ref_x: f64,
    size: f64,
}

/// Marker units of the stroked `arrow` chevron.
const ARROW_STROKE: f32 = 1.5;

fn arrowhead(kind: &str) -> Result<Option<Arrowhead>, &str> {
    let svg = |d: &str| BezPath::from_svg(d).expect("constant marker path data parses");
    let head = |path, stroked, ref_x, size| Some(Arrowhead { path, stroked, ref_x, size });
    Ok(match kind {
        "none" => None,
        "oval" => head(kurbo::Ellipse::new((5.0, 5.0), (4.0, 3.0), 0.0).to_path(CURVE_TOLERANCE), false, 5.0, 4.0),
        "diamond" => head(svg("M 0 5 L 5 1 L 10 5 L 5 9 Z"), false, 5.0, 4.0),
        "arrow" => head(svg("M 10 1 L 2 5 L 10 9"), true, 5.0, 4.0),
        "stealth" => head(svg("M 0 0 L 10 5 L 0 10 L 3 5 Z"), false, 5.0, 4.0),
        "triangle" => head(svg("M 0 0 L 10 5 L 0 10 Z"), false, 9.0, 3.0),
        other => return Err(other),
    })
}

fn draw_arrowhead(surface: &mut Surface, head: &Arrowhead, at: Point, toward: Vec2, line_width: f32, color: Rgba) {
    let scale = head.size * f64::from(line_width) / 10.0;
    let marker = Affine::translate(at.to_vec2()) * Affine::rotate(toward.y.atan2(toward.x)) * Affine::scale(scale) * Affine::translate((-head.ref_x, -5.0));
    let [a, b, c, d, e, f] = marker.as_coeffs().map(|v| v as f32);
    surface.push_transform(&Transform::from_row(a, b, c, d, e, f));
    // Markers clip to their viewBox (SVG `overflow: hidden` on <marker>).
    let mut clip = PathBuilder::new();
    if let Some(viewbox) = Rect::from_xywh(0.0, 0.0, 10.0, 10.0) {
        clip.push_rect(viewbox);
    }
    let clip = clip.finish().expect("the marker viewBox is a finite rectangle");
    surface.push_clip_path(&clip, &FillRule::NonZero);
    if let Some(path) = to_path(&head.path) {
        if head.stroked {
            surface.set_fill(None);
            surface.set_stroke(Some(Stroke {
                paint: rgb::Color::new(color.0, color.1, color.2).into(),
                width: ARROW_STROKE,
                opacity: unit(color.3),
                miter_limit: SVG_MITER_LIMIT,
                ..Stroke::default()
            }));
        } else {
            surface.set_stroke(None);
            surface.set_fill(Some(fill_of(color)));
        }
        surface.draw_path(&path);
        surface.set_stroke(None);
    }
    surface.pop();
    surface.pop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_svg_dash_arrays() {
        assert_eq!(dash_of("6 4.5").map(|d| d.array), Some(vec![6.0, 4.5]));
        assert_eq!(dash_of("3,2, 1").map(|d| d.array), Some(vec![3.0, 2.0, 1.0]));
        // SVG renders these solid.
        for solid in ["0 0", "4 -1", "4 x", ""] {
            assert!(dash_of(solid).is_none(), "{solid}");
        }
    }

    #[test]
    fn parses_only_finite_matrix_transforms() {
        assert_eq!(parse_matrix("matrix(1 0 0 -1 0 100)"), Some(Affine::new([1.0, 0.0, 0.0, -1.0, 0.0, 100.0])));
        assert_eq!(parse_matrix("matrix(0,1,1,0,0,0)"), Some(Affine::new([0.0, 1.0, 1.0, 0.0, 0.0, 0.0])));
        for bad in ["rotate(90)", "matrix(1 0 0 1 0)", "matrix(1 0 0 1 0 1e999)", "matrix(1 0 0 1 0 0"] {
            assert_eq!(parse_matrix(bad), None, "{bad}");
        }
    }

    #[test]
    fn shades_faces_like_the_svg_renderer() {
        let c = Rgba(100, 200, 50, 0.5);
        assert_eq!(modify(c, FillModifier::Lighten), Rgba(193, 233, 173, 0.5));
        assert_eq!(modify(c, FillModifier::LightenLess), Rgba(131, 211, 91, 0.5));
        assert_eq!(modify(c, FillModifier::Darken), Rgba(60, 120, 30, 0.5));
        assert_eq!(modify(c, FillModifier::DarkenLess), Rgba(80, 160, 40, 0.5));
    }

    #[test]
    fn orients_markers_along_the_path_ends() {
        let path = BezPath::from_svg("M 0 0 C 0 0 10 0 10 10 L 20 10 Q 30 10 30 10").unwrap();
        let first = path.segments().next().unwrap();
        let last = path.segments().last().unwrap();
        // A control point on the anchor is skipped, as in SVG.
        assert_eq!(direction(first, false), Vec2::new(10.0, 0.0));
        assert_eq!(direction(last, true), Vec2::new(10.0, 0.0));
        let line = PathSeg::Line(kurbo::Line::new((0.0, 0.0), (0.0, 0.0)));
        assert_eq!(direction(line, true), Vec2::ZERO);
    }

    #[test]
    fn knows_every_model_arrowhead() {
        for kind in ["oval", "diamond", "arrow", "stealth", "triangle"] {
            let head = arrowhead(kind).unwrap().unwrap();
            assert!(to_path(&head.path).is_some(), "{kind}");
        }
        assert!(arrowhead("none").unwrap().is_none());
        assert_eq!(arrowhead("hook").err(), Some("hook"));
    }

    #[test]
    fn converts_curves_and_rejects_non_finite_paths() {
        let path = BezPath::from_svg("M 0 0 L 10 0 Q 10 10 0 10 C -5 10 -5 0 0 0 Z").unwrap();
        assert!(to_path(&path).is_some());
        assert!(to_path(&BezPath::from_svg("M 0 0 L 1e999 0").unwrap()).is_none());
        assert!(to_path(&BezPath::new()).is_none());
    }
}
