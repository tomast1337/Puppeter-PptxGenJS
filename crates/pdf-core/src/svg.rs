//! The SVG display list `profile::svg` reads (a chart's SVG or an SVG image) and its drawing.
//!
//! Every value is resolved at parse time: inherited paint and font, transforms, path data and
//! gradient stops. Drawing maps the viewBox onto the box and replays the list.

use std::slice;

use krilla::geom::{Path, Transform};
use krilla::num::NormalizedF32;
use krilla::paint::{Fill, FillRule, LinearGradient, SpreadMethod, Stop, Stroke};
use krilla::surface::Surface;
use kurbo::{Affine, BezPath, Shape as _};
use parley::{FontStyle, FontWeight};

use crate::Renderer;
use crate::color::{Rgba, fill_of, unit};
use crate::model::UnderlineStyle;
use crate::path::{rect_path, to_path};
use crate::text::layout::{RunPaint, TextStroke};

pub(crate) struct Svg {
    /// `viewBox` (min x, min y, width, height), fitted into the box as `fit` says; without it
    /// user units are px from the box corner.
    pub(crate) view_box: Option<[f32; 4]>,
    pub(crate) fit: Fit,
    pub(crate) items: Vec<Item>,
    pub(crate) gradients: Vec<Gradient>,
    pub(crate) clips: Vec<Path>,
}

/// `preserveAspectRatio`: how the viewBox maps onto the box.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Fit {
    /// `none`: each axis scaled to the box.
    Stretch,
    /// One scale for both axes, the smaller (`meet`) or the larger (`slice`); `align` places the
    /// viewBox in the box per axis: 0 at the start (`Min`), 0.5 centred (`Mid`), 1 at the end (`Max`).
    Uniform { align: (f32, f32), slice: bool },
}

impl Fit {
    /// SVG's initial value, `xMidYMid meet`.
    pub(crate) const CENTER_MEET: Fit = Fit::Uniform {
        align: (0.5, 0.5),
        slice: false,
    };
}

/// One entry of the display list, in paint order.
pub(crate) enum Item {
    /// A `<g>` opens (or a shape or text with an opacity): its transform, its opacity below 1 and
    /// its clip path (index into `Svg::clips`), pushed in that order.
    Group {
        transform: Option<Affine>,
        opacity: Option<f32>,
        clip: Option<usize>,
    },
    /// The innermost open group closes; `pops` is how many layers it pushed.
    End {
        pops: u8,
    },
    Shape(Shape),
    Text(Text),
}

pub(crate) struct Shape {
    /// In the element's own user space; `transform` maps it to its parent's.
    pub(crate) path: BezPath,
    pub(crate) transform: Option<Affine>,
    pub(crate) fill: Option<Paint>,
    pub(crate) rule: FillRule,
    pub(crate) stroke: Option<Stroke>,
}

#[derive(Clone, Copy)]
pub(crate) enum Paint {
    /// Opacity (`fill-opacity`) already folded into the alpha.
    Color(Rgba),
    /// A `linearGradient` (index into `Svg::gradients`) and the fill opacity.
    Gradient(usize, f32),
}

/// A `linearGradient` in `objectBoundingBox` units, `spreadMethod="pad"`.
pub(crate) struct Gradient {
    pub(crate) from: (f32, f32),
    pub(crate) to: (f32, f32),
    pub(crate) stops: Vec<Stop>,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Anchor {
    Start,
    Middle,
    End,
}

/// One `<text>`: a single unwrapped line.
pub(crate) struct Text {
    pub(crate) text: String,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) transform: Option<Affine>,
    pub(crate) anchor: Anchor,
    /// `dominant-baseline: central`: `y` is the middle of the font's ascent and descent, not the
    /// alphabetic baseline.
    pub(crate) central: bool,
    pub(crate) font_family: String,
    pub(crate) font_size: f32,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) fill: Rgba,
    pub(crate) stroke: Option<TextStroke>,
}

fn transform_of(a: Affine) -> Transform {
    let [sx, ky, kx, sy, tx, ty] = a.as_coeffs().map(|c| c as f32);
    Transform::from_row(sx, ky, kx, sy, tx, ty)
}

impl Renderer {
    /// Draws `svg` over the box `x, y, w, h` (px), clipped to it (`overflow: hidden`).
    pub(crate) fn draw_svg(&mut self, surface: &mut Surface, svg: &Svg, x: f32, y: f32, w: f32, h: f32) {
        let Some(clip) = to_path(&rect_path(x, y, w, h, 0.0)) else { return };
        let view = match svg.view_box {
            Some([min_x, min_y, view_w, view_h]) => {
                let ((sx, sy), (ax, ay)) = match svg.fit {
                    Fit::Stretch => ((w / view_w, h / view_h), (0.0, 0.0)),
                    Fit::Uniform { align, slice } => {
                        let (fit_w, fit_h) = (w / view_w, h / view_h);
                        let scale = if slice { fit_w.max(fit_h) } else { fit_w.min(fit_h) };
                        ((scale, scale), align)
                    }
                };
                let (dx, dy) = ((w - view_w * sx) * ax, (h - view_h * sy) * ay);
                Transform::from_row(sx, 0.0, 0.0, sy, x + dx - min_x * sx, y + dy - min_y * sy)
            }
            None => Transform::from_translate(x, y),
        };
        surface.push_clip_path(&clip, &FillRule::NonZero);
        surface.push_transform(&view);
        for item in &svg.items {
            match item {
                Item::Group { transform, opacity, clip } => {
                    if let Some(t) = transform {
                        surface.push_transform(&transform_of(*t));
                    }
                    if let Some(opacity) = opacity {
                        surface.push_opacity(unit(*opacity));
                    }
                    if let Some(path) = clip.and_then(|c| svg.clips.get(c)) {
                        surface.push_clip_path(path, &FillRule::NonZero);
                    }
                }
                Item::End { pops } => (0..*pops).for_each(|_| surface.pop()),
                Item::Shape(shape) => self.draw_svg_shape(surface, svg, shape),
                Item::Text(text) => self.draw_svg_text(surface, text),
            }
        }
        surface.pop();
        surface.pop();
    }

    fn draw_svg_shape(&mut self, surface: &mut Surface, svg: &Svg, shape: &Shape) {
        if let Some(t) = shape.transform {
            surface.push_transform(&transform_of(t));
        }
        match shape.fill {
            Some(Paint::Color(color)) => self.fill_with_rule(surface, &shape.path, color, shape.rule),
            Some(Paint::Gradient(index, opacity)) => {
                // objectBoundingBox units: an element without area has no box and is not filled.
                let bbox = shape.path.bounding_box();
                if let (Some(gradient), Some(pdf), true) = (svg.gradients.get(index), to_path(&shape.path), bbox.area() > 0.0) {
                    self.effects.capture(surface.ctm(), &shape.path, opacity, None);
                    let paint = LinearGradient {
                        x1: gradient.from.0,
                        y1: gradient.from.1,
                        x2: gradient.to.0,
                        y2: gradient.to.1,
                        transform: transform_of(Affine::new([bbox.width(), 0.0, 0.0, bbox.height(), bbox.x0, bbox.y0])),
                        spread_method: SpreadMethod::Pad,
                        stops: gradient.stops.clone(),
                        anti_alias: false,
                    };
                    surface.set_stroke(None);
                    surface.set_fill(Some(Fill {
                        paint: paint.into(),
                        opacity: unit(opacity),
                        rule: shape.rule,
                    }));
                    surface.draw_path(&pdf);
                }
            }
            None => {}
        }
        if let (Some(stroke), Some(pdf)) = (&shape.stroke, to_path(&shape.path)) {
            self.effects.capture_stroke(surface.ctm(), &shape.path, stroke);
            surface.set_fill(None);
            surface.set_stroke(Some(stroke.clone()));
            surface.draw_path(&pdf);
            surface.set_stroke(None);
        }
        if shape.transform.is_some() {
            surface.pop();
        }
    }

    fn draw_svg_text(&mut self, surface: &mut Surface, text: &Text) {
        if text.text.is_empty() || text.font_size <= 0.0 {
            return;
        }
        let weight = if text.bold { FontWeight::BOLD } else { FontWeight::NORMAL };
        let style = if text.italic { FontStyle::Italic } else { FontStyle::Normal };
        let layout = self.layout_line(&text.text, &text.font_family, text.font_size, weight, style);
        let width = layout.width();
        let x = match text.anchor {
            Anchor::Start => text.x,
            Anchor::Middle => text.x - width / 2.0,
            Anchor::End => text.x - width,
        };
        // Chromium's central baseline: half the primary font's ascent + descent below its top.
        let metrics = layout
            .lines()
            .next()
            .and_then(|line| line.runs().next())
            .map(|run| (run.font_metrics().ascent, run.font_metrics().descent));
        let y = match metrics {
            Some((ascent, descent)) if text.central => text.y + (ascent - descent) / 2.0,
            _ => text.y,
        };
        let paint = RunPaint {
            color: text.fill,
            highlight: None,
            outline: text.stroke,
            underline: false,
            underline_style: UnderlineStyle::Solid,
            underline_color: None,
            strike: false,
            double_strike: false,
            baseline_offset: 0.0,
            link: None,
            glow: None,
        };
        if let Some(t) = text.transform {
            surface.push_transform(&transform_of(t));
        }
        self.draw_layout(surface, &layout, &text.text, slice::from_ref(&paint), (x, y), &[0.0]);
        if text.transform.is_some() {
            surface.pop();
        }
    }
}

/// A gradient stop: `offset` in [0, 1] and an opaque `stop-color`.
pub(crate) fn stop(offset: f32, color: Rgba) -> Stop {
    Stop {
        offset: NormalizedF32::new(offset.clamp(0.0, 1.0)).unwrap_or(NormalizedF32::ZERO),
        color: krilla::color::rgb::Color::new(color.0, color.1, color.2).into(),
        opacity: unit(color.3),
    }
}

/// The krilla stroke of an SVG path or line.
pub(crate) fn stroke(color: Rgba, width: f32, cap: krilla::paint::LineCap, join: krilla::paint::LineJoin, miter_limit: f32, dash: Option<Vec<f32>>) -> Stroke {
    let Fill { paint, opacity, .. } = fill_of(color);
    Stroke {
        paint,
        width,
        opacity,
        miter_limit,
        line_cap: cap,
        line_join: join,
        dash: dash.map(|array| krilla::paint::StrokeDash { array, offset: 0.0 }),
    }
}
