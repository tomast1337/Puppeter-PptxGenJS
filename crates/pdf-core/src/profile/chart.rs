//! Chart objects (`render/chart.ts`): the common box and its SVG, read once into `crate::chart`.
//!
//! The SVG is read as the subset that ECharts (`renderEChartsSvg`), the 3D bar renderer
//! (`render/chart3d.ts`) and `addChartExtension()` callers produce for every chart the PptxGenJS
//! options reach: `g`, `defs` with `clipPath` and `linearGradient`, `path`, `rect`, `polygon`,
//! `polyline`, `line`, `ellipse` and single-line `text`, painted with colors, gradients, opacity,
//! strokes and fonts. Any other element, attribute or value is an error, never skipped.

use krilla::paint::{LineCap, LineJoin};
use kurbo::{Affine, BezPath, PathEl};

use super::allow;
use super::dom::{Dom, Element};
use super::object::{BOX_ATTRS, BOX_CSS, object_style};
use super::style::{Style, number};
use crate::chart::{Anchor, ChartSvg, Gradient, Item, Paint, Shape, Text, stop, stroke};
use crate::color::{Rgba, parse_color};
use crate::model::ChartObject;
use crate::path::{ellipse_path, rect_path, to_path};
use crate::shape::SVG_MITER_LIMIT;
use crate::text::layout::TextStroke;

const CHART_ATTRS: &[&str] = &["role", "aria-label"];
const SVG_ATTRS: &[&str] = &[
    "width",
    "height",
    "viewBox",
    "xmlns",
    "xmlns:xlink",
    "version",
    "baseProfile",
    "data-chart-type",
    "data-bar3d-shape",
];
/// Metadata that does not change the drawing: zrender's hit testing and series markers, the 3D
/// renderer's data attributes.
const INERT_ATTRS: &[&str] = &[
    "pointer-events",
    "ecmeta_series_index",
    "ecmeta_data_index",
    "ecmeta_ssr_type",
    "ecmeta_silent",
    "data-series",
    "data-category",
];
const FILL_ATTRS: &[&str] = &["fill", "fill-opacity"];
const STROKE_ATTRS: &[&str] = &["stroke", "stroke-width", "stroke-opacity", "stroke-miterlimit"];
/// Stroke properties a glyph outline does not take.
const LINE_ATTRS: &[&str] = &["stroke-linecap", "stroke-linejoin", "stroke-dasharray"];
/// As attributes, and as `style` properties of `<text>`.
const FONT_PROPERTIES: &[&str] = &["font-family", "font-size", "font-weight", "font-style"];
const TEXT_ATTRS: &[&str] = &["x", "y", "transform", "text-anchor", "dominant-baseline", "paint-order", "xml:space"];
const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
/// Deepest `<g>` nesting read (the renderers nest two levels): deeper input is an error rather
/// than a deep recursion.
const MAX_DEPTH: usize = 32;
const ELEMENTS: &str = "g, defs, path, rect, polygon, polyline, line, ellipse, text";

/// A `.slide-chart` object: the common box (`overflow: hidden`) around one `<svg>`.
pub(crate) fn object(dom: &Dom<'_>, element: &Element<'_>) -> Result<ChartObject, String> {
    let style = Style::of(element)?;
    allow(element, &style, &[BOX_ATTRS, CHART_ATTRS], &[BOX_CSS, &["overflow"]])?;
    if style.get("overflow") != Some("hidden") {
        return Err("a chart object must have 'overflow: hidden'".into());
    }
    let [svg] = dom.elements_of(&element.children)?[..] else {
        return Err("a chart object must hold one <svg>".into());
    };
    Ok(ChartObject {
        style: object_style(element, &style, true)?,
        svg: read_svg(dom, svg)?,
    })
}

fn read_svg(dom: &Dom<'_>, svg: &Element<'_>) -> Result<ChartSvg, String> {
    if svg.name != "svg" {
        return Err(format!("a chart object must hold one <svg>, found <{}>", svg.name));
    }
    let css = Style::of(svg)?;
    allow(svg, &css, &[SVG_ATTRS], &[])?;
    for size in ["width", "height"] {
        if svg.attr(size)?.as_deref() != Some("100%") {
            return Err(format!("attribute '{size}' on the chart <svg> must be '100%'"));
        }
    }
    if let Some(namespace) = svg.attr("xmlns")?
        && namespace != SVG_NAMESPACE
    {
        return Err(format!("attribute 'xmlns': '{namespace}' is not the SVG namespace"));
    }
    let mut reader = Reader {
        dom,
        chart: ChartSvg {
            view_box: svg.attr("viewBox")?.map(|v| view_box(&v)).transpose()?,
            items: Vec::new(),
            gradients: Vec::new(),
            clips: Vec::new(),
        },
        gradient_ids: Vec::new(),
        clip_ids: Vec::new(),
    };
    // References may point forward (ECharts writes its <defs> last), so definitions go first.
    reader.definitions(svg, 0)?;
    reader.children(svg, &Inherited::default(), 0)?;
    Ok(reader.chart)
}

struct Reader<'d, 'a> {
    dom: &'d Dom<'a>,
    chart: ChartSvg,
    /// The `id` of each entry of `chart.gradients` / `chart.clips`.
    gradient_ids: Vec<String>,
    clip_ids: Vec<String>,
}

/// SVG's inherited properties, as an element's parent resolves them.
#[derive(Clone)]
struct Inherited {
    fill: Fill,
    fill_opacity: f32,
    stroke: Option<Rgba>,
    stroke_width: f32,
    stroke_opacity: f32,
    cap: LineCap,
    join: LineJoin,
    miter_limit: f32,
    dash: Option<Vec<f32>>,
    font_family: Option<String>,
    font_size: Option<f32>,
    bold: bool,
    italic: bool,
}

#[derive(Clone, Copy)]
enum Fill {
    None,
    Color(Rgba),
    Gradient(usize),
}

/// SVG's initial values; fonts have none here (a browser's default font is not the document's).
impl Default for Inherited {
    fn default() -> Self {
        Self {
            fill: Fill::Color(Rgba(0, 0, 0, 1.0)),
            fill_opacity: 1.0,
            stroke: None,
            stroke_width: 1.0,
            stroke_opacity: 1.0,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter_limit: SVG_MITER_LIMIT,
            dash: None,
            font_family: None,
            font_size: None,
            bold: false,
            italic: false,
        }
    }
}

impl Reader<'_, '_> {
    /// Reads every `<defs>` under `parent` (in the svg or a `<g>`).
    fn definitions(&mut self, parent: &Element<'_>, depth: usize) -> Result<(), String> {
        for child in self.dom.elements_of(&parent.children)? {
            match child.name {
                "defs" => {
                    let css = Style::of(child)?;
                    allow(child, &css, &[], &[])?;
                    for definition in self.dom.elements_of(&child.children)? {
                        self.definition(definition)?;
                    }
                }
                "g" if depth < MAX_DEPTH => self.definitions(child, depth + 1)?,
                "g" => return Err(format!("chart SVG groups nest deeper than {MAX_DEPTH} levels")),
                _ => {}
            }
        }
        Ok(())
    }

    fn definition(&mut self, element: &Element<'_>) -> Result<(), String> {
        let css = Style::of(element)?;
        let id = element.attr("id")?.ok_or_else(|| format!("a <{}> must have an id", element.name))?.into_owned();
        if self.gradient_ids.contains(&id) || self.clip_ids.contains(&id) {
            return Err(format!("id '{id}' is repeated"));
        }
        match element.name {
            "clipPath" => {
                allow(element, &css, &[&["id"]], &[])?;
                let mut clip = BezPath::new();
                for shape in self.dom.elements_of(&element.children)? {
                    let css = Style::of(shape)?;
                    // A clip path's paint does not matter, only its geometry.
                    allow(shape, &css, &[&["d", "x", "y", "width", "height"], FILL_ATTRS], &[])?;
                    let path = match shape.name {
                        "path" | "rect" => self.geometry(shape)?,
                        name => return Err(format!("<{name}> in a <clipPath> is not in the chart SVG subset (path, rect)")),
                    };
                    clip.extend(path);
                }
                let path = to_path(&clip).ok_or_else(|| format!("<clipPath id=\"{id}\"> holds no finite path or rect"))?;
                self.chart.clips.push(path);
                self.clip_ids.push(id);
            }
            "linearGradient" => {
                allow(element, &css, &[&["id", "x1", "y1", "x2", "y2"]], &[])?;
                // SVG's initial gradient vector runs left to right over the bounding box.
                let coordinate = |name: &str, initial: f32| -> Result<f32, String> { Ok(optional_number(element, name)?.unwrap_or(initial)) };
                let mut stops = Vec::new();
                let mut last = 0.0f32;
                for s in self.dom.elements_of(&element.children)? {
                    let css = Style::of(s)?;
                    allow(s, &css, &[&["offset", "stop-color"]], &[])?;
                    if s.name != "stop" {
                        return Err(format!("<{}> in a <linearGradient> is not a <stop>", s.name));
                    }
                    // As in SVG, an offset below the previous one is raised to it.
                    last = required_number(s, "offset")?.clamp(last, 1.0);
                    let color = s.attr("stop-color")?.ok_or("attribute 'stop-color' is missing on <stop>")?;
                    stops.push(stop(last, color_value(&color).map_err(|e| format!("attribute 'stop-color': {e}"))?));
                }
                if stops.len() < 2 {
                    return Err(format!("<linearGradient id=\"{id}\"> must hold at least two <stop>s"));
                }
                self.chart.gradients.push(Gradient {
                    from: (coordinate("x1", 0.0)?, coordinate("y1", 0.0)?),
                    to: (coordinate("x2", 1.0)?, coordinate("y2", 0.0)?),
                    stops,
                });
                self.gradient_ids.push(id);
            }
            name => return Err(format!("<{name}> in <defs> is not in the chart SVG subset (clipPath, linearGradient)")),
        }
        Ok(())
    }

    fn children(&mut self, parent: &Element<'_>, inherited: &Inherited, depth: usize) -> Result<(), String> {
        for child in self.dom.elements_of(&parent.children)? {
            match child.name {
                // Read by `definitions`.
                "defs" => {}
                "g" => self.group(child, inherited, depth)?,
                "path" | "rect" | "polygon" | "polyline" | "line" | "ellipse" => self.shape(child, inherited)?,
                "text" => self.text(child, inherited)?,
                name => return Err(format!("<{name}> is not in the chart SVG subset ({ELEMENTS})")),
            }
        }
        Ok(())
    }

    fn group(&mut self, g: &Element<'_>, parent: &Inherited, depth: usize) -> Result<(), String> {
        if depth >= MAX_DEPTH {
            return Err(format!("chart SVG groups nest deeper than {MAX_DEPTH} levels"));
        }
        let css = Style::of(g)?;
        allow(
            g,
            &css,
            &[&["clip-path", "opacity"], FILL_ATTRS, STROKE_ATTRS, LINE_ATTRS, FONT_PROPERTIES, INERT_ATTRS],
            &[],
        )?;
        let inherited = self.inherit(g, None, parent)?;
        let opacity = optional_number(g, "opacity")?.map(|o| o.clamp(0.0, 1.0)).filter(|o| *o < 1.0);
        let clip = match g.attr("clip-path")? {
            Some(value) => Some(self.reference(&value, "clip-path", &self.clip_ids)?),
            None => None,
        };
        let pops = u8::from(opacity.is_some()) + u8::from(clip.is_some());
        if pops > 0 {
            self.chart.items.push(Item::Group { opacity, clip });
        }
        self.children(g, &inherited, depth + 1)?;
        if pops > 0 {
            self.chart.items.push(Item::End { pops });
        }
        Ok(())
    }

    fn shape(&mut self, element: &Element<'_>, parent: &Inherited) -> Result<(), String> {
        let css = Style::of(element)?;
        let geometry: &[&str] = match element.name {
            "path" => &["d"],
            "rect" => &["x", "y", "width", "height"],
            "polygon" | "polyline" => &["points"],
            "line" => &["x1", "y1", "x2", "y2"],
            _ => &["cx", "cy", "rx", "ry"],
        };
        allow(
            element,
            &css,
            &[geometry, &["transform"], FILL_ATTRS, STROKE_ATTRS, LINE_ATTRS, INERT_ATTRS],
            &[],
        )?;
        if let Some(child) = self.dom.elements_of(&element.children)?.first() {
            return Err(format!("<{}> inside <{}> is not in the chart SVG subset", child.name, element.name));
        }
        let paint = self.inherit(element, None, parent)?;
        let fill = match paint.fill {
            // A line has no inside.
            _ if element.name == "line" => None,
            // A transparent paint draws nothing (zrender's legend hit boxes).
            _ if paint.fill_opacity == 0.0 => None,
            Fill::None | Fill::Color(Rgba(_, _, _, 0.0)) => None,
            Fill::Color(Rgba(r, g, b, a)) => Some(Paint::Color(Rgba(r, g, b, a * paint.fill_opacity))),
            Fill::Gradient(index) => Some(Paint::Gradient(index, paint.fill_opacity)),
        };
        let stroke = match paint.stroke {
            Some(Rgba(r, g, b, a)) if paint.stroke_width > 0.0 && a * paint.stroke_opacity > 0.0 => Some(stroke(
                Rgba(r, g, b, a * paint.stroke_opacity),
                paint.stroke_width,
                paint.cap,
                paint.join,
                paint.miter_limit,
                paint.dash,
            )),
            _ => None,
        };
        if fill.is_none() && stroke.is_none() {
            return Ok(());
        }
        self.chart.items.push(Item::Shape(Shape {
            path: self.geometry(element)?,
            transform: transform_attr(element)?,
            fill,
            stroke,
        }));
        Ok(())
    }

    fn text(&mut self, element: &Element<'_>, parent: &Inherited) -> Result<(), String> {
        let css = Style::of(element)?;
        allow(
            element,
            &css,
            &[TEXT_ATTRS, FILL_ATTRS, STROKE_ATTRS, FONT_PROPERTIES, INERT_ATTRS],
            &[FONT_PROPERTIES],
        )?;
        let paint = self.inherit(element, Some(&css), parent)?;
        let fill = match paint.fill {
            Fill::Color(Rgba(r, g, b, a)) => Rgba(r, g, b, a * paint.fill_opacity),
            Fill::None | Fill::Gradient(_) => return Err("the fill of a <text> must be a color".into()),
        };
        // Inherited from a <g>: a glyph outline is drawn with SVG's initial cap and join, undashed.
        if paint.stroke.is_some() && (paint.dash.is_some() || paint.cap != LineCap::Butt || paint.join != LineJoin::Miter) {
            return Err("a stroked <text> takes no stroke-dasharray, stroke-linecap or stroke-linejoin".into());
        }
        let under = match element.attr("paint-order")?.as_deref() {
            None | Some("normal") => false,
            Some("stroke") => true,
            Some(other) => return Err(format!("attribute 'paint-order': '{other}' is not normal or stroke")),
        };
        let stroke = match paint.stroke {
            Some(Rgba(r, g, b, a)) if paint.stroke_width > 0.0 => Some(TextStroke {
                color: Rgba(r, g, b, a * paint.stroke_opacity),
                width: paint.stroke_width,
                miter_limit: paint.miter_limit,
                under,
            }),
            _ => None,
        };
        let anchor = match element.attr("text-anchor")?.as_deref() {
            None | Some("start") => Anchor::Start,
            Some("middle") => Anchor::Middle,
            Some("end") => Anchor::End,
            Some(other) => return Err(format!("attribute 'text-anchor': '{other}' is not start, middle or end")),
        };
        let central = match element.attr("dominant-baseline")?.as_deref() {
            None | Some("auto" | "alphabetic") => false,
            Some("central") => true,
            Some(other) => return Err(format!("attribute 'dominant-baseline': '{other}' is not auto, alphabetic or central")),
        };
        let raw = self.dom.text_of(element)?;
        // CSS white space: `preserve` keeps every space (a newline or tab is one), the default collapses runs.
        let text = match element.attr("xml:space")?.as_deref() {
            Some("preserve") => raw.replace(['\n', '\r', '\t'], " "),
            None | Some("default") => raw.split_ascii_whitespace().collect::<Vec<_>>().join(" "),
            Some(other) => return Err(format!("attribute 'xml:space': '{other}' is not default or preserve")),
        };
        self.chart.items.push(Item::Text(Text {
            text,
            x: optional_number(element, "x")?.unwrap_or(0.0),
            y: optional_number(element, "y")?.unwrap_or(0.0),
            transform: transform_attr(element)?,
            anchor,
            central,
            font_family: paint.font_family.ok_or("a <text> has no font-family")?,
            font_size: paint.font_size.ok_or("a <text> has no font-size")?,
            bold: paint.bold,
            italic: paint.italic,
            fill,
            stroke,
        }));
        Ok(())
    }

    /// The element's path in its own user space.
    fn geometry(&self, element: &Element<'_>) -> Result<BezPath, String> {
        let number = |name: &str| -> Result<f32, String> { Ok(optional_number(element, name)?.unwrap_or(0.0)) };
        let point = |x: &str, y: &str| -> Result<kurbo::Point, String> { Ok((f64::from(number(x)?), f64::from(number(y)?)).into()) };
        let length = |name: &str| -> Result<f32, String> {
            let value = optional_number(element, name)?.unwrap_or(0.0);
            if value < 0.0 {
                return Err(format!("attribute '{name}': {value} is negative"));
            }
            Ok(value)
        };
        Ok(match element.name {
            "path" => {
                let d = element.attr("d")?.unwrap_or_default();
                BezPath::from_svg(&d).map_err(|e| format!("attribute 'd': invalid path data: {e}"))?
            }
            "rect" => match (length("width")?, length("height")?) {
                (w, h) if w > 0.0 && h > 0.0 => rect_path(number("x")?, number("y")?, w, h, 0.0),
                // Zero width or height disables the rect.
                _ => BezPath::new(),
            },
            "ellipse" => match (length("rx")?, length("ry")?) {
                (rx, ry) if rx > 0.0 && ry > 0.0 => ellipse_path(number("cx")? - rx, number("cy")? - ry, rx * 2.0, ry * 2.0),
                _ => BezPath::new(),
            },
            "line" => BezPath::from_vec(vec![PathEl::MoveTo(point("x1", "y1")?), PathEl::LineTo(point("x2", "y2")?)]),
            name => {
                let points = element.attr("points")?.unwrap_or_default();
                let values = numbers(&points).map_err(|e| format!("attribute 'points': {e}"))?;
                if values.len() % 2 != 0 {
                    return Err(format!("attribute 'points': '{points}' has an odd number of coordinates"));
                }
                let mut path = BezPath::new();
                for (i, pair) in values.chunks_exact(2).enumerate() {
                    if let [x, y] = *pair {
                        let point = (f64::from(x), f64::from(y));
                        if i == 0 { path.move_to(point) } else { path.line_to(point) }
                    }
                }
                if name == "polygon" && !values.is_empty() {
                    path.close_path();
                }
                path
            }
        })
    }

    /// `url(#id)` in `attribute`, as the index of its definition among `ids`.
    fn reference(&self, value: &str, attribute: &str, ids: &[String]) -> Result<usize, String> {
        let id = value
            .strip_prefix("url(#")
            .and_then(|v| v.strip_suffix(')'))
            .ok_or_else(|| format!("attribute '{attribute}': '{value}' is not url(#id)"))?;
        ids.iter()
            .position(|known| known == id)
            .ok_or_else(|| format!("attribute '{attribute}': no definition with id '{id}' for it"))
    }

    /// `parent`'s properties with the element's own: presentation attributes, then `style`
    /// properties, which take precedence as in CSS.
    fn inherit(&self, element: &Element<'_>, css: Option<&Style<'_>>, parent: &Inherited) -> Result<Inherited, String> {
        let mut out = parent.clone();
        let attr = |name: &str| element.attr(name).map(|v| v.map(|v| v.into_owned()));
        if let Some(fill) = attr("fill")? {
            out.fill = match fill.as_str() {
                "none" => Fill::None,
                value if value.starts_with("url(") => Fill::Gradient(self.reference(value, "fill", &self.gradient_ids)?),
                value => Fill::Color(color_value(value).map_err(|e| format!("attribute 'fill': {e}"))?),
            };
        }
        if let Some(stroke) = attr("stroke")? {
            out.stroke = match stroke.as_str() {
                "none" => None,
                value => Some(color_value(value).map_err(|e| format!("attribute 'stroke': {e}"))?),
            };
        }
        for (name, target) in [("fill-opacity", &mut out.fill_opacity), ("stroke-opacity", &mut out.stroke_opacity)] {
            if let Some(value) = optional_number(element, name)? {
                *target = value.clamp(0.0, 1.0);
            }
        }
        if let Some(width) = optional_number(element, "stroke-width")? {
            if width < 0.0 {
                return Err(format!("attribute 'stroke-width': {width} is negative"));
            }
            out.stroke_width = width;
        }
        if let Some(limit) = optional_number(element, "stroke-miterlimit")? {
            if limit < 1.0 {
                return Err(format!("attribute 'stroke-miterlimit': {limit} is below 1"));
            }
            out.miter_limit = limit;
        }
        if let Some(cap) = attr("stroke-linecap")? {
            out.cap = match cap.as_str() {
                "butt" => LineCap::Butt,
                "round" => LineCap::Round,
                "square" => LineCap::Square,
                other => return Err(format!("attribute 'stroke-linecap': '{other}' is not butt, round or square")),
            };
        }
        if let Some(join) = attr("stroke-linejoin")? {
            out.join = match join.as_str() {
                "miter" => LineJoin::Miter,
                "round" => LineJoin::Round,
                "bevel" => LineJoin::Bevel,
                other => return Err(format!("attribute 'stroke-linejoin': '{other}' is not miter, round or bevel")),
            };
        }
        if let Some(dash) = attr("stroke-dasharray")? {
            out.dash = match dash.as_str() {
                "none" => None,
                value => {
                    let array = numbers(value).map_err(|e| format!("attribute 'stroke-dasharray': {e}"))?;
                    if array.iter().any(|v| *v < 0.0) {
                        return Err(format!("attribute 'stroke-dasharray': '{value}' has a negative length"));
                    }
                    // As in SVG, an all-zero pattern draws the line solid.
                    array.iter().any(|v| *v > 0.0).then_some(array)
                }
            };
        }
        for property in FONT_PROPERTIES {
            let from_css = css.and_then(|css| css.get(property));
            let value = match from_css {
                Some(value) => Some(value.to_owned()),
                None => attr(property)?,
            };
            let Some(value) = value else { continue };
            let place = if from_css.is_some() { "CSS property" } else { "attribute" };
            font_property(&mut out, property, &value).map_err(|e| format!("{place} '{property}': {e}"))?;
        }
        Ok(out)
    }
}

fn font_property(out: &mut Inherited, property: &str, value: &str) -> Result<(), String> {
    match property {
        "font-family" => {
            let family = ['"', '\'']
                .iter()
                .find_map(|q| value.strip_prefix(*q).and_then(|v| v.strip_suffix(*q)))
                .unwrap_or(value);
            if family.is_empty() || family.contains([',', '"', '\'']) {
                return Err(format!("'{value}' is not one font family"));
            }
            out.font_family = Some(family.to_owned());
        }
        "font-size" => {
            let size = number(value.strip_suffix("px").unwrap_or(value))?;
            if size < 0.0 {
                return Err(format!("'{value}' is negative"));
            }
            out.font_size = Some(size);
        }
        "font-weight" => {
            out.bold = match value {
                "normal" | "400" => false,
                "bold" | "700" => true,
                other => return Err(format!("'{other}' is not normal or bold")),
            }
        }
        _ => {
            out.italic = match value {
                "normal" => false,
                "italic" => true,
                other => return Err(format!("'{other}' is not normal or italic")),
            }
        }
    }
    Ok(())
}

/// `#rgb`, `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)`.
fn color_value(value: &str) -> Result<Rgba, String> {
    let color = match value.strip_prefix('#') {
        Some(hex) if hex.len() == 3 && hex.bytes().all(|b| b.is_ascii_hexdigit()) => {
            let doubled: String = hex.chars().flat_map(|c| [c, c]).collect();
            parse_color(&format!("#{doubled}"))
        }
        Some(hex) if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) => parse_color(value),
        Some(_) => None,
        None => value
            .strip_prefix("rgba(")
            .or_else(|| value.strip_prefix("rgb("))
            .and_then(|v| v.strip_suffix(')'))
            .filter(|inner| inner.split(',').all(|part| number(part.trim_ascii()).is_ok()))
            .and_then(|_| parse_color(value)),
    };
    color.ok_or_else(|| format!("'{value}' is not a #rgb, #rrggbb, rgb() or rgba() color"))
}

/// Numbers separated by commas and/or whitespace.
fn numbers(value: &str) -> Result<Vec<f32>, String> {
    value
        .split(|c: char| c == ',' || c.is_ascii_whitespace())
        .filter(|v| !v.is_empty())
        .map(number)
        .collect()
}

fn optional_number(element: &Element<'_>, name: &str) -> Result<Option<f32>, String> {
    element
        .attr(name)?
        .map(|v| number(&v).map_err(|e| format!("attribute '{name}': {e}")))
        .transpose()
}

fn required_number(element: &Element<'_>, name: &str) -> Result<f32, String> {
    optional_number(element, name)?.ok_or_else(|| format!("attribute '{name}' is missing on <{}>", element.name))
}

/// `viewBox`: four numbers, with a positive width and height.
fn view_box(value: &str) -> Result<[f32; 4], String> {
    match numbers(value).map_err(|e| format!("attribute 'viewBox': {e}"))?[..] {
        [x, y, w, h] if w > 0.0 && h > 0.0 => Ok([x, y, w, h]),
        _ => Err(format!("attribute 'viewBox': '{value}' is not '<x> <y> <width> <height>' with a positive size")),
    }
}

/// `transform`: one `translate(x [y])` or `matrix(a b c d e f)`, the functions zrender writes.
fn transform_attr(element: &Element<'_>) -> Result<Option<Affine>, String> {
    let Some(value) = element.attr("transform")? else { return Ok(None) };
    let parsed = value
        .trim_ascii()
        .strip_suffix(')')
        .and_then(|v| v.split_once('('))
        .and_then(|(name, args)| Some((name.trim_ascii(), numbers(args).ok()?)));
    let affine = match parsed
        .as_ref()
        .map(|(name, args)| (*name, args.iter().map(|v| f64::from(*v)).collect::<Vec<_>>()))
    {
        Some(("translate", args)) => match args[..] {
            [x] => Some(Affine::translate((x, 0.0))),
            [x, y] => Some(Affine::translate((x, y))),
            _ => None,
        },
        Some(("matrix", args)) => match args[..] {
            [a, b, c, d, e, f] => Some(Affine::new([a, b, c, d, e, f])),
            _ => None,
        },
        _ => None,
    };
    affine
        .map(Some)
        .ok_or_else(|| format!("attribute 'transform': '{value}' is not translate(<x> <y>) or matrix(<a> <b> <c> <d> <e> <f>)"))
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::chart::{Anchor, ChartSvg, Item, Paint};
    use crate::color::Rgba;
    use crate::model::SlideObject;
    use crate::profile::parse;
    use crate::profile::tests::document;

    /// A chart object around `svg_body`, as `toHtml()` writes it.
    pub(crate) fn chart(svg_body: &str) -> String {
        format!(
            r#"<div class="slide-element slide-chart" data-object-name="Chart 0" style="left: 38.4px; top: 86.4px; width: 422.4px; height: 393.6px; transform-origin: center; border-style: none; overflow: hidden;" role="img" aria-label="Sales"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" baseProfile="full" viewBox="0 0 422.4 393.6">
{svg_body}
</svg></div>"#
        )
    }

    /// ECharts output (`renderEChartsSvg`): grid, axis labels, bar, clipped line, symbol, legend and
    /// a haloed label, with its <defs> last.
    pub(crate) const ECHARTS: &str = r##"<rect width="422.4" height="393.6" x="0" y="0" fill="none"></rect>
<path d="M25.3 326.5L414 326.5" fill="none" pointer-events="visible" stroke="#888888" stroke-width="1.3333333333333333" stroke-dasharray="1.3333333333333333"></path>
<path d="M25.5 326.7L25.5 15.7" fill="none" pointer-events="visible" stroke="#888888" stroke-width="1.3333333333333333" stroke-linecap="round"></path>
<text dominant-baseline="central" text-anchor="end" style="font-size:14.666666666666666px;font-family:Arial;" transform="translate(17.344 326.688)" fill="#000000">0</text>
<text dominant-baseline="central" text-anchor="middle" style="font-size:16px;font-family:Arial;font-weight:bold;font-style:italic;" xml:space="preserve" y="-8" transform="matrix(0,-1,1,0,33.5,137.808)" fill="#000000">Log  scale</text>
<path d="M46.2 326.7l27.8 0l0 -116.6l-27.8 0Z" fill="#4472C4" fill-opacity="0.5" ecmeta_series_index="0" ecmeta_data_index="0" ecmeta_ssr_type="chart"></path>
<g clip-path="url(#slide-54-object-2-c0)">
<path d="M73.9 210.1L171.1 132.3L268.2 171.2L365.4 54.6" fill="none" pointer-events="visible" stroke="#4472C4" stroke-width="2.6666666666666665" stroke-linejoin="bevel"></path>
</g>
<path d="M1 0A1 1 0 1 1 1 -0.1A1 1 0 0 1 1 0" transform="matrix(3,0,0,3,73.92,210.084)" fill="#4472C4"></path>
<path d="M-5 -5l145.7 0l0 24l-145.7 0Z" transform="translate(143.3333 374.6)" fill="rgb(0,0,0)" fill-opacity="0" stroke="#b7b9be" stroke-width="0"></path>
<polyline points="296 64.6 303.1 51.4 333.1 51.4" fill="none" pointer-events="visible" stroke="#5DA5DA"></polyline>
<polygon points="240 122.2 163.6 168 240 218.9 316.4 168 240 122.2" fill="#C0504D" fill-opacity="0.7"></polygon>
<text dominant-baseline="central" text-anchor="start" style="font-size:16px;font-family:Calibri;" transform="translate(338.1106 51.3818)" fill="#333" fill-opacity="0.5" stroke="rgb(255,255,255)" stroke-width="2" paint-order="stroke" stroke-opacity="0.5" stroke-miterlimit="2">Q1 &amp; Q2</text>
<defs>
<clipPath id="slide-54-object-2-c0">
<path d="M24 14.4l393 0l0 313.6l-393 0Z" fill="#000"></path>
</clipPath>
</defs>"##;

    /// The 3D bar renderer (`renderBar3DSvg`): inherited font and fill, a gradient, an ellipse and a
    /// group opacity.
    pub(crate) const BAR3D: &str = r##"<g font-family="Arial" font-size="14.67" fill="#000000">
<defs>
<linearGradient id="slide-55-object-1-bar3d-front-0" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#5c84cc"></stop>
<stop offset="1" stop-color="#3f69b4"></stop></linearGradient></defs>
<polyline class="bar3d-frame" points="74.88,161.57 414.72,281.95 501.12,205.92" fill="none" stroke="#888888" stroke-width="1.33"></polyline>
<line x1="161.28" y1="85.54" x2="501.12" y2="205.92" stroke="#888888" stroke-width="1.33"></line>
<text x="66.88" y="165.57" text-anchor="end">0</text>
<g class="bar3d-mark bar3d-cylinder" data-series="0" data-category="0" opacity="0.5">
<path class="bar3d-front" d="M 113.39 154.95 L 154.17 169.39 L 154.17 139.69 Z" fill="url(#slide-55-object-1-bar3d-front-0)"></path>
<ellipse class="bar3d-top" cx="133.78" cy="132.47" rx="20.39" ry="7.22" fill="#668bcf"></ellipse></g>
<rect x="204" y="296.8" width="12" height="8" fill="#4472C4"></rect>
<text class="bar3d-title" x="288" y="20" text-anchor="middle" font-family="Calibri Light" font-size="24" font-weight="bold" fill="#17365D">T &lt;&amp;&gt;</text></g>"##;

    fn read(svg_body: &str) -> Result<ChartSvg, String> {
        match parse(&document(&chart(svg_body)))?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Chart(object)) => Ok(object.svg),
            _ => Err("not a chart".into()),
        }
    }

    fn kinds(chart: &ChartSvg) -> Vec<&'static str> {
        chart
            .items
            .iter()
            .map(|item| match item {
                Item::Group { .. } => "group",
                Item::End { .. } => "end",
                Item::Shape(_) => "shape",
                Item::Text(_) => "text",
            })
            .collect()
    }

    #[test]
    fn reads_echarts_output_once_into_a_display_list() {
        let chart = read(ECHARTS).unwrap();
        assert_eq!(chart.view_box, Some([0.0, 0.0, 422.4, 393.6]));
        assert_eq!(chart.clips.len(), 1, "the forward clip-path reference resolves");
        // The fill="none" rect and the transparent legend box with a zero-width stroke draw nothing.
        assert_eq!(
            kinds(&chart),
            [
                "shape", "shape", "text", "text", "shape", "group", "shape", "end", "shape", "shape", "shape", "text"
            ]
        );
        let Some(Item::Shape(grid)) = chart.items.first() else { panic!("grid") };
        let stroke = grid.stroke.as_ref().expect("grid stroke");
        assert_eq!((stroke.width, stroke.miter_limit), (1.333_333_4, 4.0));
        assert_eq!(stroke.dash.as_ref().map(|d| d.array.clone()), Some(vec![1.333_333_4]));
        let Some(Item::Shape(bar)) = chart.items.get(4) else { panic!("bar") };
        assert!(matches!(bar.fill, Some(Paint::Color(Rgba(0x44, 0x72, 0xC4, a))) if a == 0.5));
        assert!(bar.stroke.is_none());
        assert!(matches!(chart.items.get(5), Some(Item::Group { opacity: None, clip: Some(0) })));
        assert!(matches!(chart.items.get(7), Some(Item::End { pops: 1 })));

        let Some(Item::Text(title)) = chart.items.get(3) else { panic!("axis title") };
        assert_eq!(
            (title.text.as_str(), title.font_family.as_str(), title.font_size),
            ("Log  scale", "Arial", 16.0)
        );
        assert_eq!(
            (title.anchor, title.central, title.bold, title.italic, title.y),
            (Anchor::Middle, true, true, true, -8.0)
        );
        assert!(title.transform.is_some());
        let Some(Item::Text(label)) = chart.items.last() else { panic!("label") };
        assert_eq!((label.text.as_str(), label.fill), ("Q1 & Q2", Rgba(0x33, 0x33, 0x33, 0.5)));
        let halo = label.stroke.expect("halo");
        assert_eq!(
            (halo.color, halo.width, halo.miter_limit, halo.under),
            (Rgba(255, 255, 255, 0.5), 2.0, 2.0, true)
        );
    }

    #[test]
    fn reads_the_3d_bar_renderer_with_inherited_fonts_and_gradients() {
        let chart = read(BAR3D).unwrap();
        let [gradient] = &chart.gradients[..] else { panic!("one gradient") };
        assert_eq!((gradient.from, gradient.to, gradient.stops.len()), ((0.0, 0.0), (0.0, 1.0), 2));
        assert_eq!(kinds(&chart), ["shape", "shape", "text", "group", "shape", "shape", "end", "shape", "text"]);
        let Some(Item::Shape(line)) = chart.items.get(1) else { panic!("line") };
        assert!(line.fill.is_none(), "a <line> has no inside even under fill=\"#000000\"");
        let Some(Item::Text(tick)) = chart.items.get(2) else { panic!("tick") };
        assert_eq!(
            (tick.font_family.as_str(), tick.font_size, tick.fill, tick.anchor, tick.central),
            ("Arial", 14.67, Rgba(0, 0, 0, 1.0), Anchor::End, false)
        );
        assert!(matches!(chart.items.get(3), Some(Item::Group { opacity: Some(o), clip: None }) if *o == 0.5));
        let Some(Item::Shape(front)) = chart.items.get(4) else { panic!("front") };
        assert!(matches!(front.fill, Some(Paint::Gradient(0, o)) if o == 1.0));
        let Some(Item::Text(title)) = chart.items.last() else { panic!("title") };
        assert_eq!(
            (title.text.as_str(), title.font_family.as_str(), title.font_size, title.bold),
            ("T <&>", "Calibri Light", 24.0, true)
        );
    }

    #[test]
    fn reads_a_caller_svg_without_a_view_box() {
        let html = document(&chart(r##"<path d="M0 0L10 10" stroke="#000"></path>"##).replace(r#" viewBox="0 0 422.4 393.6""#, ""));
        let Some(SlideObject::Chart(object)) = parse(&html).unwrap().slides.pop().and_then(|mut s| s.objects.pop()) else {
            panic!("chart")
        };
        assert_eq!(object.svg.view_box, None);
        assert_eq!(object.svg.items.len(), 1);
    }

    #[test]
    fn rejects_svg_outside_the_subset_naming_the_place() {
        for (body, message) in [
            (r#"<circle cx="1" cy="1" r="1"></circle>"#, "<circle> is not in the chart SVG subset"),
            (r#"<image href="data:image/png;base64,AA=="></image>"#, "<image> is not in the chart SVG subset"),
            (r#"<style>path { fill: red }</style>"#, "<style> is not in the chart SVG subset"),
            (
                r#"<text font-family="Arial" font-size="12">a<tspan>b</tspan></text>"#,
                "unexpected <tspan> inside <text>",
            ),
            (
                r#"<path d="M0 0" filter="url(#f)"></path>"#,
                "attribute 'filter' on <path> is not in profile v1",
            ),
            (r#"<path d="M0 0" style="fill: red"></path>"#, "CSS property 'fill' on <path>"),
            (r#"<path d="M0 0" fill="red"></path>"#, "attribute 'fill': 'red' is not a #rgb"),
            (r##"<path d="M0 0" fill="#12345"></path>"##, "attribute 'fill': '#12345' is not"),
            (r#"<path d="M0 0" fill="rgb(1,x,2)"></path>"#, "is not a #rgb"),
            (r#"<path d="M0 0" stroke="url(#g)"></path>"#, "attribute 'stroke': 'url(#g)' is not"),
            (r#"<path d="M0 0" fill="url(#missing)"></path>"#, "no definition with id 'missing'"),
            (r##"<path d="M0 0 X 1" fill="#000"></path>"##, "attribute 'd': invalid path data"),
            (r#"<path d="M0 0" transform="rotate(45)"></path>"#, "attribute 'transform': 'rotate(45)'"),
            (r#"<path d="M0 0" transform="translate(1 2) scale(2)"></path>"#, "attribute 'transform'"),
            (r#"<path d="M0 0" stroke-linejoin="arcs"></path>"#, "'arcs' is not miter, round or bevel"),
            (r#"<path d="M0 0" stroke-dasharray="4 -1"></path>"#, "has a negative length"),
            (r#"<polygon points="1 2 3"></polygon>"#, "odd number of coordinates"),
            (r#"<rect width="-1" height="2"></rect>"#, "attribute 'width': -1 is negative"),
            (r#"<path d="M0 0"><title>t</title></path>"#, "<title> inside <path>"),
            (r#"<text font-size="12">x</text>"#, "a <text> has no font-family"),
            (r#"<text font-family="Arial">x</text>"#, "a <text> has no font-size"),
            (
                r#"<text font-family="Arial, sans-serif" font-size="12">x</text>"#,
                "'Arial, sans-serif' is not one font family",
            ),
            (
                r#"<text style="font-family:Arial;font-size:1em;">x</text>"#,
                "CSS property 'font-size': '1em' is not a number",
            ),
            (
                r#"<text font-family="Arial" font-size="12" font-weight="600">x</text>"#,
                "'600' is not normal or bold",
            ),
            (
                r#"<text font-family="Arial" font-size="12" text-anchor="left">x</text>"#,
                "'left' is not start, middle or end",
            ),
            (
                r#"<text font-family="Arial" font-size="12" dominant-baseline="hanging">x</text>"#,
                "'hanging' is not auto",
            ),
            (
                r#"<text font-family="Arial" font-size="12" fill="none">x</text>"#,
                "the fill of a <text> must be a color",
            ),
            (
                r#"<text font-family="Arial" font-size="12" x="1 2">x</text>"#,
                "attribute 'x': '1 2' is not a number",
            ),
            (r#"<g transform="translate(1 2)"></g>"#, "attribute 'transform' on <g> is not in profile v1"),
            (r#"<g clip-path="url(#c)"></g>"#, "attribute 'clip-path': no definition with id 'c'"),
            (r#"<defs><filter id="f"></filter></defs>"#, "<filter> in <defs> is not in the chart SVG subset"),
            (r#"<defs><clipPath id="c"></clipPath></defs>"#, "holds no finite path or rect"),
            (
                r#"<defs><clipPath id="c"><circle r="1"></circle></clipPath></defs>"#,
                "attribute 'r' on <circle>",
            ),
            (
                r##"<defs><linearGradient id="g"><stop offset="0" stop-color="#000"></stop></linearGradient></defs>"##,
                "at least two <stop>s",
            ),
            (
                r#"<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"></linearGradient></defs>"#,
                "attribute 'gradientUnits' on <linearGradient>",
            ),
            (
                r#"<defs><clipPath id="a"><rect width="1" height="1"></rect></clipPath><clipPath id="a"><rect width="1" height="1"></rect></clipPath></defs>"#,
                "id 'a' is repeated",
            ),
        ] {
            let error = read(body).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'Chart 0': "), "{body}: {error}");
            assert!(error.contains(message), "{body}: {error}");
        }
        let deep = format!("{}{}", "<g>".repeat(40), "</g>".repeat(40));
        assert!(read(&deep).err().unwrap_or_default().contains("nest deeper than 32 levels"));
    }

    #[test]
    fn rejects_chart_boxes_outside_the_profile() {
        let html = document(&chart(""));
        for (from, to, message) in [
            (" overflow: hidden;", "", "must have 'overflow: hidden'"),
            ("role=\"img\"", "role=\"img\" onclick=\"x\"", "attribute 'onclick' on <div>"),
            ("width=\"100%\" height", "width=\"422\" height", "'width' on the chart <svg> must be '100%'"),
            ("viewBox=\"0 0 422.4 393.6\"", "viewBox=\"0 0 0 393.6\"", "attribute 'viewBox'"),
            ("xmlns=\"http://www.w3.org/2000/svg\"", "xmlns=\"urn:x\"", "is not the SVG namespace"),
            ("<svg ", "<svg preserveAspectRatio=\"none\" ", "attribute 'preserveAspectRatio' on <svg>"),
            ("</svg></div>", "</svg><svg width=\"100%\" height=\"100%\"></svg></div>", "must hold one <svg>"),
        ] {
            assert!(html.contains(from), "{from}");
            let error = parse(&html.replacen(from, to, 1)).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'Chart 0': "), "{to}: {error}");
            assert!(error.contains(message), "{to}: {error}");
        }
    }
}
