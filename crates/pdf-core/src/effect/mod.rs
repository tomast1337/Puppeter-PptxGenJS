//! Drop shadows and text glow: a blurred silhouette drawn under what casts it.
//!
//! PDF has no blur, so the effect is a raster. While the object (or text box) is drawn into a
//! sub-stream, every fill, stroke and glyph run it draws is also flattened into a silhouette; the
//! silhouette is rasterized (raster.rs), dilated for glow and blurred (filter.rs), embedded as an
//! image in the effect colour whose soft mask is the result, and drawn under the sub-stream.
//!
//! Parameters follow LibreOffice, the visual reference, read from its rendering of PptxGenJS
//! output (LibreOffice 26.2, 96 dpi, opaque black, measured across the edge of a 2in square and of
//! a 120pt bar glyph):
//! - `outerShdw blurRad` b: 50% at the edge, fading to nothing about b outside it. The profile is
//!   a Gaussian with sigma 0.46 b (b = 8 px: 3.7 px; b = 16 px: 7.0 px).
//! - `glow rad` r: the glyph grown by 0.45 r (50% there), then blurred with sigma 0.18 r
//!   (r = 10.7 px: 4.7 and 2.0 px; r = 21.3 px: 9.8 and 3.8 px).

mod filter;
mod raster;

use std::ops::Range;
use std::sync::Arc;

use krilla::geom::{Size, Transform};
use krilla::graphic::Graphic;
use krilla::image::{BitsPerComponent, CustomImage, Image, ImageColorspace};
use krilla::paint::{LineCap, LineJoin, Stroke};
use krilla::surface::Surface;
use kurbo::{Affine, BezPath, PathEl, Point};

use crate::Renderer;
use crate::color::{Rgba, parse_color};
use crate::model::Shadow;
use raster::Line;

const SHADOW_SIGMA_PER_BLUR: f32 = 0.46;
const GLOW_SPREAD_PER_RADIUS: f32 = 0.45;
const GLOW_SIGMA_PER_RADIUS: f32 = 0.18;
/// A Gaussian is below 0.5% of its peak past three standard deviations.
const SIGMAS_KEPT: f32 = 3.0;
/// Mask samples per px: viewers interpolate the image, and a blurred edge has no detail finer than a px.
const SAMPLES_PER_PX: f32 = 1.0;
/// Longest mask side; a larger silhouette is sampled more coarsely.
const MAX_SIDE: f32 = 4096.0;
/// Curve flattening tolerance (px).
const FLATTEN_TOLERANCE: f64 = 0.1;

/// A blurred silhouette: its colour, how far it grows and blurs, and its offset (px).
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct Effect {
    color: Rgba,
    spread: f32,
    sigma: f32,
    dx: f32,
    dy: f32,
}

impl Effect {
    /// The object's outer shadow; `Err` names what this backend does not draw.
    pub(crate) fn shadow(shadow: &Shadow) -> Option<Result<Self, &'static str>> {
        if !shadow.visible {
            return None;
        }
        if shadow.inset {
            // shortcut: inner shadows are not drawn; draw one inside the silhouette when a deck needs it.
            return Some(Err("inner shadow not rendered"));
        }
        let color = parse_color(&shadow.color).filter(|c| c.3 > 0.0)?;
        let finite = [shadow.blur, shadow.offset_x, shadow.offset_y].iter().all(|v| v.is_finite());
        Some(if finite {
            Ok(Effect {
                color,
                spread: 0.0,
                sigma: shadow.blur.max(0.0) * SHADOW_SIGMA_PER_BLUR,
                dx: shadow.offset_x,
                dy: shadow.offset_y,
            })
        } else {
            Err("shadow with a non-finite blur or offset not rendered")
        })
    }

    /// A run's glow (its `blur` is the glow radius).
    pub(crate) fn glow(glow: &Shadow) -> Option<Self> {
        let radius = glow.blur.max(0.0);
        let color = parse_color(&glow.color).filter(|c| c.3 > 0.0 && glow.visible && radius > 0.0 && radius.is_finite())?;
        Some(Effect {
            color,
            spread: radius * GLOW_SPREAD_PER_RADIUS,
            sigma: radius * GLOW_SIGMA_PER_RADIUS,
            dx: 0.0,
            dy: 0.0,
        })
    }
}

/// The silhouette of what is drawn while a capture is active, in the user space it began in (px).
struct Capture {
    /// Glow captures take only the glyph runs with this glow; shadow captures (`None`) take everything.
    glow: Option<Effect>,
    /// From device space back to the capture's user space.
    inverse: Affine,
    lines: Vec<Line>,
    /// Each drawn outline: its lines and its opacity.
    shapes: Vec<(Range<usize>, f32)>,
}

/// Captures in progress (innermost last) and the buffers the masks are made in. Owned by the
/// renderer so the buffers keep their capacity from one effect to the next.
#[derive(Default)]
pub(crate) struct Effects {
    active: Vec<Capture>,
    spare: Vec<Capture>,
    cells: Vec<f32>,
    mask: Vec<f32>,
    scratch: filter::Scratch,
}

fn affine_of(t: Transform) -> Affine {
    Affine::new([t.sx(), t.ky(), t.kx(), t.sy(), t.tx(), t.ty()].map(f64::from))
}

impl Effects {
    pub(crate) fn capturing(&self) -> bool {
        !self.active.is_empty()
    }

    /// Adds `path`, filled with `alpha` under the device transform `ctm`, to the active captures
    /// that take it: all of them, except glow captures of another glow (or of no glow).
    pub(crate) fn capture(&mut self, ctm: Transform, path: &BezPath, alpha: f32, glow: Option<&Effect>) {
        let ctm = affine_of(ctm);
        for capture in &mut self.active {
            if capture.glow.is_some() && capture.glow.as_ref() != glow {
                continue;
            }
            let start = capture.lines.len();
            let affine = capture.inverse * ctm;
            let (mut first, mut last) = (Point::ZERO, Point::ZERO);
            let lines = &mut capture.lines;
            let mut edge = |a: Point, b: Point| {
                if a != b {
                    lines.push(Line {
                        x0: a.x as f32,
                        y0: a.y as f32,
                        x1: b.x as f32,
                        y1: b.y as f32,
                    });
                }
            };
            // Every subpath is closed, as a fill closes it.
            kurbo::flatten(path.iter().map(|el| affine * el), FLATTEN_TOLERANCE, |el| match el {
                PathEl::MoveTo(p) => {
                    edge(last, first);
                    (first, last) = (p, p);
                }
                PathEl::LineTo(p) => {
                    edge(last, p);
                    last = p;
                }
                PathEl::ClosePath => {
                    edge(last, first);
                    last = first;
                }
                PathEl::QuadTo(..) | PathEl::CurveTo(..) => {}
            });
            edge(last, first);
            if capture.lines.len() > start {
                capture.shapes.push((start..capture.lines.len(), alpha.clamp(0.0, 1.0)));
            }
        }
    }

    /// Adds the outline of `path` stroked with `stroke` (dashes included), as `capture` does.
    pub(crate) fn capture_stroke(&mut self, ctm: Transform, path: &BezPath, stroke: &Stroke) {
        if !self.capturing() {
            return;
        }
        if let Some(outline) = stroke_outline(path, stroke) {
            self.capture(ctm, &outline, stroke.opacity.get(), None);
        }
    }

    fn begin(&mut self, glow: Option<Effect>, inverse: Affine) {
        let mut capture = self.spare.pop().unwrap_or(Capture {
            glow: None,
            inverse: Affine::IDENTITY,
            lines: Vec::new(),
            shapes: Vec::new(),
        });
        capture.glow = glow;
        capture.inverse = inverse;
        capture.lines.clear();
        capture.shapes.clear();
        self.active.push(capture);
    }

    /// Ends the innermost capture and renders `effect` from it: the image and its box (px, in the
    /// capture's user space). `None` when nothing was captured.
    fn end(&mut self, effect: &Effect) -> Option<(Image, kurbo::Rect)> {
        let mut capture = self.active.pop()?;
        let image = self.render(&mut capture, effect);
        self.spare.push(capture);
        image
    }

    fn render(&mut self, capture: &mut Capture, effect: &Effect) -> Option<(Image, kurbo::Rect)> {
        let bounds = capture.lines.iter().fold(None, |b: Option<kurbo::Rect>, l| {
            let r = kurbo::Rect::new(f64::from(l.x0), f64::from(l.y0), f64::from(l.x1), f64::from(l.y1)).abs();
            Some(b.map_or(r, |b| b.union(r)))
        })?;
        let margin = f64::from(effect.spread + SIGMAS_KEPT * effect.sigma + 1.0);
        let area = bounds.inflate(margin, margin);
        if !(area.is_finite() && area.width() > 0.0 && area.height() > 0.0) {
            return None;
        }
        let scale = SAMPLES_PER_PX.min(MAX_SIDE / area.width().max(area.height()) as f32);
        let (w, h) = ((area.width() as f32 * scale).ceil() as usize, (area.height() as f32 * scale).ceil() as usize);
        let (ox, oy) = (area.x0 as f32, area.y0 as f32);
        for l in &mut capture.lines {
            *l = Line {
                x0: (l.x0 - ox) * scale,
                y0: (l.y0 - oy) * scale,
                x1: (l.x1 - ox) * scale,
                y1: (l.y1 - oy) * scale,
            };
        }
        self.cells.clear();
        self.cells.resize(w * h + 2, 0.0);
        self.mask.clear();
        self.mask.resize(w * h, 0.0);
        for (range, alpha) in &capture.shapes {
            if let Some(lines) = capture.lines.get(range.clone()) {
                raster::composite(lines, *alpha, w, h, &mut self.cells, &mut self.mask);
            }
        }
        filter::dilate(&mut self.mask, w, h, effect.spread * scale, &mut self.scratch);
        filter::gaussian_blur(&mut self.mask, w, h, effect.sigma * scale, &mut self.scratch);
        let alpha: Vec<u8> = self.mask.iter().map(|a| (a * effect.color.3 * 255.0).round() as u8).collect();
        if alpha.iter().all(|a| *a == 0) {
            return None;
        }
        let Rgba(r, g, b, _) = effect.color;
        let matte = Matte {
            size: (u32::try_from(w).ok()?, u32::try_from(h).ok()?),
            color: [r, g, b].repeat(w * h).into(),
            alpha: alpha.into(),
        };
        let image = Image::from_custom(matte, true).ok()?;
        let at = kurbo::Rect::new(
            area.x0 + f64::from(effect.dx),
            area.y0 + f64::from(effect.dy),
            area.x0 + f64::from(effect.dx) + w as f64 / f64::from(scale),
            area.y0 + f64::from(effect.dy) + h as f64 / f64::from(scale),
        );
        Some((image, at))
    }
}

/// The area `stroke` paints along `path`, from tiny-skia's stroker (krilla's, for stroke bounds).
fn stroke_outline(path: &BezPath, stroke: &Stroke) -> Option<BezPath> {
    let mut pb = tiny_skia_path::PathBuilder::new();
    let p = |p: Point| (p.x as f32, p.y as f32);
    for el in path.iter() {
        match el {
            PathEl::MoveTo(a) => pb.move_to(p(a).0, p(a).1),
            PathEl::LineTo(a) => pb.line_to(p(a).0, p(a).1),
            PathEl::QuadTo(a, b) => pb.quad_to(p(a).0, p(a).1, p(b).0, p(b).1),
            PathEl::CurveTo(a, b, c) => pb.cubic_to(p(a).0, p(a).1, p(b).0, p(b).1, p(c).0, p(c).1),
            PathEl::ClosePath => pb.close(),
        }
    }
    let mut source = pb.finish()?;
    if let Some(dash) = stroke.dash.as_ref().and_then(|d| tiny_skia_path::StrokeDash::new(d.array.clone(), d.offset)) {
        source = source.dash(&dash, 1.0)?;
    }
    let tsp = tiny_skia_path::Stroke {
        width: stroke.width,
        miter_limit: stroke.miter_limit,
        line_cap: match stroke.line_cap {
            LineCap::Butt => tiny_skia_path::LineCap::Butt,
            LineCap::Round => tiny_skia_path::LineCap::Round,
            LineCap::Square => tiny_skia_path::LineCap::Square,
        },
        line_join: match stroke.line_join {
            LineJoin::Miter => tiny_skia_path::LineJoin::Miter,
            LineJoin::Round => tiny_skia_path::LineJoin::Round,
            LineJoin::Bevel => tiny_skia_path::LineJoin::Bevel,
        },
        dash: None,
    };
    let outline = source.stroke(&tsp, 1.0)?;
    let k = |p: tiny_skia_path::Point| Point::new(f64::from(p.x), f64::from(p.y));
    let mut out = BezPath::new();
    for segment in outline.segments() {
        match segment {
            tiny_skia_path::PathSegment::MoveTo(a) => out.move_to(k(a)),
            tiny_skia_path::PathSegment::LineTo(a) => out.line_to(k(a)),
            tiny_skia_path::PathSegment::QuadTo(a, b) => out.quad_to(k(a), k(b)),
            tiny_skia_path::PathSegment::CubicTo(a, b, c) => out.curve_to(k(a), k(b), k(c)),
            tiny_skia_path::PathSegment::Close => out.close_path(),
        }
    }
    Some(out)
}

/// A flat colour with a per-pixel alpha: the blurred silhouette as a krilla image.
#[derive(Clone, Hash)]
struct Matte {
    size: (u32, u32),
    color: Arc<[u8]>,
    alpha: Arc<[u8]>,
}

impl CustomImage for Matte {
    fn color_channel(&self) -> &[u8] {
        &self.color
    }

    fn alpha_channel(&self) -> Option<&[u8]> {
        Some(&self.alpha)
    }

    fn bits_per_component(&self) -> BitsPerComponent {
        BitsPerComponent::Eight
    }

    fn size(&self) -> (u32, u32) {
        self.size
    }

    fn icc_profile(&self) -> Option<&[u8]> {
        None
    }

    fn color_space(&self) -> ImageColorspace {
        ImageColorspace::Rgb
    }
}

impl Renderer {
    /// Runs `draw` into a sub-stream while capturing its silhouette (only the runs glowing with
    /// `effect` for a glow), draws `effect` from the silhouette, then the sub-stream over it.
    pub(crate) fn under_effect(
        &mut self,
        surface: &mut Surface,
        effect: &Effect,
        glow: bool,
        draw: impl FnOnce(&mut Self, &mut Surface) -> Result<(), String>,
    ) -> Result<(), String> {
        let base = surface.ctm();
        let Some(inverse) = base.invert() else {
            self.warn("effect on a degenerate transform not rendered");
            return draw(self, surface);
        };
        self.effects.begin(glow.then_some(*effect), affine_of(inverse));
        let mut builder = surface.stream_builder();
        let mut sub = builder.surface();
        // The sub-stream starts at the identity: give it the page's transform so link areas and
        // captured outlines see the same device space as on the page.
        sub.push_transform(&base);
        let drawn = draw(self, &mut sub);
        sub.pop();
        sub.finish();
        let stream = builder.finish();
        if let Some((image, at)) = self.effects.end(effect)
            && let Some(size) = Size::from_wh(at.width() as f32, at.height() as f32)
        {
            surface.push_transform(&Transform::from_translate(at.x0 as f32, at.y0 as f32));
            surface.draw_image(image, size);
            surface.pop();
        }
        surface.push_transform(&inverse);
        surface.draw_graphic(Graphic::new(stream, false));
        surface.pop();
        drawn
    }
}
