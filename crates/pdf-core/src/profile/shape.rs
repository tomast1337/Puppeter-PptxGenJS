//! Shape SVG (`render/shape.ts`): the shape model, and the fill, line and shadow the SVG carries
//! for shapes and text with a shape.

use super::allow;
use super::dom::{Dom, Element};
use super::object::link;
use super::style::{Style, number, shadow};
use crate::model::{FillModel, FillModifier, LineModel, ObjectStyle, ShapeFace, ShapeGeometry, ShapeModel};

const SVG_ATTRS: &[&str] = &[
    "viewBox",
    "width",
    "height",
    "preserveAspectRatio",
    "data-shape-width",
    "data-shape-height",
    "data-line-dash-array",
    "data-line-begin-arrow",
    "data-line-end-arrow",
    "data-shadow-inset",
];
// `--print-snap-offset` is the print-snap workaround (docs/HTML_PROFILE.md), derived from the box.
const SVG_CSS: &[&str] = &["overflow", "--print-snap-offset", "filter"];
// `stroke-dasharray`/`stroke-dashoffset` may be the dash rewrite; the pattern is `data-line-dash-array`.
const PAINT_ATTRS: &[&str] = &[
    "fill",
    "stroke",
    "stroke-width",
    "vector-effect",
    "stroke-dasharray",
    "stroke-dashoffset",
    "marker-start",
    "marker-end",
];
const GEOMETRY_ATTRS: &[&str] = &["x", "y", "width", "height", "rx", "ry", "cx", "cy", "d", "transform"];
const MARKER_ATTRS: &[&str] = &["id", "markerUnits", "orient", "overflow"];

/// Reads `svg`, the `svg.shape-svg` of `object` (whose `data-shape` and link it also reads), and
/// puts the fill, line and shadow it draws into `style`.
pub(crate) fn read(dom: &Dom<'_>, object: &Element<'_>, svg: &Element<'_>, style: &mut ObjectStyle) -> Result<ShapeModel, String> {
    if svg.name != "svg" || !svg.has_class("shape-svg") {
        return Err(format!("expected svg.shape-svg, found <{}>", svg.name));
    }
    let css = Style::of(svg)?;
    allow(svg, &css, &[SVG_ATTRS], &[SVG_CSS])?;
    let view_box = svg.attr("viewBox")?.ok_or("attribute 'viewBox' is missing")?;
    let [min_x, min_y, view_w, view_h] = view_box.split_ascii_whitespace().collect::<Vec<_>>()[..] else {
        return Err(format!("attribute 'viewBox': '{view_box}' is not '0 0 <width> <height>'"));
    };
    if (min_x, min_y) != ("0", "0") {
        return Err(format!("attribute 'viewBox': '{view_box}' does not start at 0 0"));
    }
    // The viewBox clamps a tiny width and a zero height; data-shape-* then keep the model values.
    let size = |data: &str, view: &str| -> Result<f32, String> {
        match svg.attr(data)? {
            Some(value) => number(&value).map_err(|e| format!("attribute '{data}': {e}")),
            None => number(view).map_err(|e| format!("attribute 'viewBox': {e}")),
        }
    };
    let (width, height) = (size("data-shape-width", view_w)?, size("data-shape-height", view_h)?);

    let children = dom.elements_of(&svg.children)?;
    let [defs, geometry] = children[..] else {
        return Err("svg.shape-svg must hold <defs> and the .shape-geometry element".into());
    };
    if defs.name != "defs" || !geometry.has_class("shape-geometry") {
        return Err("svg.shape-svg must hold <defs> and the .shape-geometry element".into());
    }
    let heads = markers(dom, defs)?;
    let (geometry, fill, stroke_target) = read_geometry(dom, geometry, width, height)?;

    style.fill = fill;
    style.line = line(svg, stroke_target, &heads)?;
    style.shadow = match css.get("filter") {
        Some(filter) => {
            let inner = filter
                .strip_prefix("drop-shadow(")
                .and_then(|f| f.strip_suffix(')'))
                .ok_or_else(|| format!("CSS property 'filter': '{filter}' is not drop-shadow(…)"))?;
            Some(shadow(inner, svg.has_attr("data-shadow-inset")).map_err(|e| format!("CSS property 'filter': {e}"))?)
        }
        None => None,
    };
    Ok(ShapeModel {
        name: object.attr("data-shape")?.ok_or("attribute 'data-shape' is missing")?.into_owned(),
        width,
        height,
        geometry,
        link: link(object)?,
    })
}

/// The arrow-head markers in `<defs>`: id and head path.
fn markers(dom: &Dom<'_>, defs: &Element<'_>) -> Result<Vec<(String, String)>, String> {
    let mut heads = Vec::new();
    for marker in dom.elements_of(&defs.children)? {
        let css = Style::of(marker)?;
        allow(marker, &css, &[MARKER_ATTRS], &[])?;
        let [head] = dom.elements_of(&marker.children)?[..] else {
            return Err("a <marker> must hold one <path>".into());
        };
        let head_css = Style::of(head)?;
        allow(head, &head_css, &[&["d", "fill"]], &[])?;
        if marker.name != "marker" || head.name != "path" {
            return Err("<defs> may hold only <marker><path></marker>".into());
        }
        let id = marker.attr("id")?.ok_or("a <marker> must have an id")?.into_owned();
        heads.push((id, head.attr("d")?.ok_or("a marker <path> must have d")?.into_owned()));
    }
    Ok(heads)
}

/// The geometry, its fill (`None` when `fill="none"`) and the element that carries the stroke.
fn read_geometry<'e, 'a>(
    dom: &'e Dom<'a>,
    element: &'e Element<'a>,
    width: f32,
    height: f32,
) -> Result<(ShapeGeometry, Option<FillModel>, &'e Element<'a>), String> {
    let css = Style::of(element)?;
    allow(element, &css, &[GEOMETRY_ATTRS, PAINT_ATTRS], &[])?;
    if element.name == "g" {
        return faces(dom, element);
    }
    let fill = paint(element, "fill")?;
    let geometry = match element.name {
        "rect" => ShapeGeometry::Rect {
            radius: number_attr(element, "rx")?,
        },
        "ellipse" => ShapeGeometry::Ellipse,
        "path" => {
            let data = element.attr("d")?.ok_or("attribute 'd' is missing")?.into_owned();
            let transform = element.attr("transform")?.map(|t| t.into_owned());
            match line_inverse(&data, width, height) {
                Some(inverse) if fill.is_none() && transform.is_none() => ShapeGeometry::Line { inverse },
                _ => ShapeGeometry::Path {
                    data,
                    transform,
                    faces: None,
                    outline_data: None,
                },
            }
        }
        name => return Err(format!("<{name}> is not a profile shape geometry (rect, ellipse, path, g)")),
    };
    Ok((geometry, fill, element))
}

/// A multi-face preset: `path.shape-face` children with their final fills, then an optional
/// stroke-only `path.shape-outline`.
fn faces<'e, 'a>(dom: &'e Dom<'a>, group: &'e Element<'a>) -> Result<(ShapeGeometry, Option<FillModel>, &'e Element<'a>), String> {
    let mut faces = Vec::new();
    let mut fills = Vec::new();
    let mut outline = None;
    for child in dom.elements_of(&group.children)? {
        let css = Style::of(child)?;
        allow(child, &css, &[GEOMETRY_ATTRS, PAINT_ATTRS, &["data-fill-modifier"]], &[])?;
        let data = child.attr("d")?.ok_or("attribute 'd' is missing")?.into_owned();
        if child.name == "path" && child.has_class("shape-face") && outline.is_none() {
            let modifier = match child.attr("data-fill-modifier")?.as_deref() {
                None => None,
                Some("darken") => Some(FillModifier::Darken),
                Some("darkenLess") => Some(FillModifier::DarkenLess),
                Some("lighten") => Some(FillModifier::Lighten),
                Some("lightenLess") => Some(FillModifier::LightenLess),
                Some(other) => {
                    return Err(format!(
                        "attribute 'data-fill-modifier': '{other}' is not darken, darkenLess, lighten or lightenLess"
                    ));
                }
            };
            fills.push((modifier.is_none(), paint(child, "fill")?));
            faces.push(ShapeFace { data, fill_modifier: modifier });
        } else if child.name == "path" && child.has_class("shape-outline") && outline.is_none() {
            outline = Some((data, child));
        } else {
            return Err("g.shape-geometry may hold only path.shape-face elements and one path.shape-outline after them".into());
        }
    }
    if faces.is_empty() {
        return Err("g.shape-geometry must hold at least one path.shape-face".into());
    }
    // Faces carry the shaded fill; the renderer shades the base fill itself, which an unshaded face holds.
    // shortcut: a preset whose every face is shaded has no base fill in the HTML; read the face fills directly once #43 lands.
    let fill = if fills.iter().all(|(_, fill)| fill.is_none()) {
        None
    } else {
        let base = fills
            .into_iter()
            .find_map(|(plain, fill)| plain.then_some(fill).flatten())
            .ok_or("every path.shape-face has a data-fill-modifier, so the base fill is not in the HTML (#43)")?;
        Some(base)
    };
    let (outline_data, stroke_target) = match outline {
        Some((data, element)) => (Some(data), element),
        None => (None, group),
    };
    let geometry = ShapeGeometry::Path {
        // Not drawn when there are faces.
        data: String::new(),
        transform: group.attr("transform")?.map(|t| t.into_owned()),
        faces: Some(faces),
        outline_data,
    };
    Ok((geometry, fill, stroke_target))
}

fn number_attr(element: &Element<'_>, name: &str) -> Result<f32, String> {
    let value = element.attr(name)?.ok_or_else(|| format!("attribute '{name}' is missing"))?;
    number(&value).map_err(|e| format!("attribute '{name}': {e}"))
}

/// A `fill` or `stroke` color; `none` is `None`.
fn paint(element: &Element<'_>, name: &str) -> Result<Option<FillModel>, String> {
    let value = element
        .attr(name)?
        .ok_or_else(|| format!("attribute '{name}' is missing on <{}>", element.name))?;
    Ok((value != "none").then(|| FillModel {
        visible: true,
        color: value.into_owned(),
    }))
}

/// `Some(inverse)` when `d` is the line the renderer writes for this size: `M 0 0 L W H`, or
/// `M 0 H L W 0` when inverse.
fn line_inverse(d: &str, width: f32, height: f32) -> Option<bool> {
    let [m, x0, y0, l, x1, y1] = d.split_ascii_whitespace().collect::<Vec<_>>()[..] else {
        return None;
    };
    let [x0, y0, x1, y1] = [x0, y0, x1, y1].map(|v| number(v).ok());
    if (m, l, x0, x1) != ("M", "L", Some(0.0), Some(width)) {
        return None;
    }
    match (y0, y1) {
        (Some(a), Some(b)) if a == 0.0 && b == height => Some(false),
        (Some(a), Some(b)) if a == height && b == 0.0 => Some(true),
        _ => None,
    }
}

/// The line from the stroke target's paint and the svg's `data-line-*` values; head paths come from
/// the markers its `marker-start`/`marker-end` point at.
fn line(svg: &Element<'_>, target: &Element<'_>, heads: &[(String, String)]) -> Result<Option<LineModel>, String> {
    let Some(stroke) = paint(target, "stroke")? else { return Ok(None) };
    let head = |attr: &str| -> Result<Option<String>, String> {
        let Some(url) = target.attr(attr)? else { return Ok(None) };
        let id = url
            .strip_prefix("url(#")
            .and_then(|u| u.strip_suffix(')'))
            .ok_or_else(|| format!("attribute '{attr}': '{url}' is not url(#id)"))?;
        heads
            .iter()
            .find(|(marker, _)| marker == id)
            .map(|(_, d)| Some(d.clone()))
            .ok_or_else(|| format!("attribute '{attr}': no <marker id=\"{id}\">"))
    };
    Ok(Some(LineModel {
        visible: true,
        color: stroke.color,
        width: number_attr(target, "stroke-width")?,
        dash_array: svg.attr("data-line-dash-array")?.map(|d| d.into_owned()),
        begin_arrow: svg.attr("data-line-begin-arrow")?.map(|d| d.into_owned()),
        end_arrow: svg.attr("data-line-end-arrow")?.map(|d| d.into_owned()),
        begin_head_path: head("marker-start")?,
        end_head_path: head("marker-end")?,
    }))
}

#[cfg(test)]
mod tests {
    use crate::model::{FillModifier, ShapeGeometry, ShapeObject, SlideObject};
    use crate::profile::parse;
    use crate::profile::tests::document;

    fn shape(svg_attrs: &str, svg_style: &str, body: &str) -> Result<ShapeObject, String> {
        let html = document(&format!(
            r#"<a class="slide-element slide-shape" href="https://x.test" data-object-name="S" data-shape="can" style="left: 1px; top: 2px; width: 100px; height: 50px; transform-origin: center;"><svg class="shape-svg" viewBox="0 0 96 48" width="100%" height="100%" preserveAspectRatio="none"{svg_attrs} style="overflow: visible;{svg_style}">{body}</svg></a>"#
        ));
        match parse(&html)?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Shape(object)) => Ok(object),
            _ => Err("not a shape".into()),
        }
    }

    const PAINT: &str = r##"stroke="#17365D" stroke-width="1.5" vector-effect="non-scaling-stroke""##;

    #[test]
    fn reads_each_geometry_with_its_paint() {
        let rect = shape(
            "",
            "",
            &format!(r##"<defs></defs><rect x="0" y="0" width="96" height="48" rx="8" ry="8" class="shape-geometry" fill="#FF0000" {PAINT}></rect>"##),
        )
        .unwrap();
        let s = rect.shape.as_ref().expect("shape");
        assert!(matches!(s.geometry, ShapeGeometry::Rect { radius } if radius == 8.0));
        assert_eq!(
            (s.name.as_str(), s.width, s.height, s.link.as_ref().map(|l| l.href.as_str())),
            ("can", 96.0, 48.0, Some("https://x.test"))
        );
        assert_eq!(rect.style.fill.as_ref().map(|f| f.color.as_str()), Some("#FF0000"));
        assert_eq!(rect.style.line.as_ref().map(|l| (l.color.as_str(), l.width)), Some(("#17365D", 1.5)));

        let svg = r#" data-line-dash-array="0 4 8" data-line-end-arrow="triangle" data-shadow-inset="""#;
        let body = format!(
            r##"<defs><marker id="h" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M 0 0 L -8 4 Z" fill="#17365D"></path></marker></defs><path d="M 0 48 L 96 0" class="shape-geometry" fill="none" {PAINT} stroke-dasharray="8 4" stroke-dashoffset="8" marker-end="url(#h)"></path>"##
        );
        let line = shape(svg, " filter: drop-shadow(1px 2px 3px rgba(0, 0, 0, 0.5));", &body).unwrap();
        assert!(matches!(line.shape.as_ref().map(|s| &s.geometry), Some(ShapeGeometry::Line { inverse: true })));
        let l = line.style.line.as_ref().expect("line");
        assert_eq!(
            (
                l.dash_array.as_deref(),
                l.end_arrow.as_deref(),
                l.end_head_path.as_deref(),
                l.begin_head_path.as_deref()
            ),
            (Some("0 4 8"), Some("triangle"), Some("M 0 0 L -8 4 Z"), None)
        );
        assert!(line.style.shadow.as_ref().is_some_and(|s| s.inset && s.blur == 3.0));

        let faces = r##"<defs></defs><g transform="matrix(1 0 0 1 0 0)" class="shape-geometry"><path class="shape-face" d="M 0 0 Z" data-fill-modifier="lighten" stroke="none" fill="#FF9999"></path><path class="shape-face" d="M 1 1 Z" stroke="none" fill="#FF0000"></path><path class="shape-outline" d="M 2 2 Z" fill="none" stroke="#000000" stroke-width="2"></path></g>"##;
        let can = shape("", "", faces).unwrap();
        let Some(ShapeGeometry::Path {
            faces: Some(f),
            outline_data,
            transform,
            ..
        }) = can.shape.as_ref().map(|s| &s.geometry)
        else {
            panic!("faces")
        };
        assert!(matches!(f[..], [ref a, ref b] if a.fill_modifier.is_some_and(|m| matches!(m, FillModifier::Lighten)) && b.fill_modifier.is_none()));
        assert_eq!((outline_data.as_deref(), transform.as_deref()), (Some("M 2 2 Z"), Some("matrix(1 0 0 1 0 0)")));
        assert_eq!(
            can.style.fill.as_ref().map(|f| f.color.as_str()),
            Some("#FF0000"),
            "the unshaded face holds the base fill"
        );
        assert_eq!(can.style.line.as_ref().map(|l| l.width), Some(2.0));
    }

    #[test]
    fn rejects_out_of_profile_svg() {
        let rect = |extra: &str| format!(r##"<defs></defs><rect rx="0" class="shape-geometry" fill="#FF0000" {PAINT}{extra}></rect>"##);
        for (svg, style, body) in [
            ("", "", "<defs></defs><polygon class=\"shape-geometry\" fill=\"none\" stroke=\"none\"></polygon>".to_owned()),
            ("", "", rect(" onload=\"x\"")),
            ("", "", rect(" marker-end=\"url(#missing)\"")),
            ("", "", rect(" style=\"fill: red\"")),
            ("", " filter: blur(2px);", rect("")),
            ("", " mix-blend-mode: multiply;", rect("")),
            (" data-shape-height=\"x\"", "", rect("")),
            ("", "", "<rect class=\"shape-geometry\"></rect>".to_owned()),
            ("", "", r##"<defs></defs><g class="shape-geometry"><path class="shape-face" d="M 0 0" data-fill-modifier="darken" fill="#FF0000" stroke="none"></path></g>"##.to_owned()),
            ("", "", r##"<defs></defs><g class="shape-geometry"><path class="shape-face" d="M 0 0" data-fill-modifier="shade" fill="#FF0000" stroke="none"></path></g>"##.to_owned()),
        ] {
            let error = shape(svg, style, &body).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'S': "), "{body}: {error}");
        }
    }
}
