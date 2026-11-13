//! One `.slide-element`: its kind class, the common object box (`render/style.ts`) and links.

use super::dom::{Dom, Element};
use super::style::{Style, integer, number, shadow};
use super::{allow, image, shape, table, text};
use crate::model::{FillModel, Geometry, LineModel, Link, ObjectStyle, ShapeObject, SlideObject, TableObject, TextObject, Transform2};

/// Attributes every object box may carry.
pub(crate) const BOX_ATTRS: &[&str] = &["data-object-name", "data-line-dash-array", "data-line-begin-arrow", "data-line-end-arrow"];
/// The common box's CSS (`applyObjectStyle`).
pub(crate) const BOX_CSS: &[&str] = &[
    "left",
    "top",
    "width",
    "height",
    "transform",
    "transform-origin",
    "opacity",
    "background-color",
    "border-color",
    "border-width",
    "border-style",
    "box-shadow",
];
/// A linked shape or image is an `a`.
pub(crate) const LINK_ATTRS: &[&str] = &["href", "title", "data-slide"];
const KINDS: &str = "slide-text, slide-shape, slide-image, slide-table-container, slide-chart, slide-component";

pub(crate) fn read(dom: &Dom<'_>, element: &Element<'_>) -> Result<SlideObject, String> {
    if !element.has_class("slide-element") {
        return Err(format!("<{}> is not a .slide-element", element.name));
    }
    let linkable = matches!(element.name, "div" | "a");
    if element.has_class("slide-chart") || element.has_class("slide-component") {
        // Opaque subtrees: the HTML holds their drawing, not their model, and WASM draws neither.
        // shortcut: a chartExtension is a .slide-chart too, so it is reported as 'chart'; give it its own marker if callers need to tell them apart (#69).
        let kind = if element.has_class("slide-chart") { "chart" } else { "component" };
        return Ok(SlideObject::Unsupported(kind.to_owned()));
    }
    if element.has_class("slide-text") && element.name == "div" {
        return text_object(dom, element).map(SlideObject::Text);
    }
    if element.has_class("slide-shape") && linkable {
        return shape_object(dom, element).map(SlideObject::Shape);
    }
    if element.has_class("slide-image") && linkable {
        return image::object(dom, element).map(SlideObject::Image);
    }
    if element.has_class("slide-table-container") && element.name == "div" {
        let style = Style::of(element)?;
        allow(element, &style, &[BOX_ATTRS], &[BOX_CSS])?;
        let [inner] = dom.elements_of(&element.children)?[..] else {
            return Err("a table object must hold one table.slide-table".into());
        };
        return Ok(SlideObject::Table(TableObject {
            style: object_style(element, &style, true)?,
            table: table::read(dom, inner)?,
        }));
    }
    Err(format!("{}.slide-element has no profile kind class ({KINDS})", element.name))
}

/// The common box. `paint` reads fill, line and shadow from the box; objects with SVG geometry
/// keep them on the SVG and pass false.
pub(crate) fn object_style(element: &Element<'_>, style: &Style<'_>, paint: bool) -> Result<ObjectStyle, String> {
    let (fill, line, shadow) = if paint {
        (box_fill(style), box_line(element, style)?, box_shadow(style)?)
    } else {
        (None, None, None)
    };
    Ok(ObjectStyle {
        geometry: geometry(style)?,
        transform: transform(style)?,
        fill,
        line,
        shadow,
        object_name: element.attr("data-object-name")?.map(|n| n.into_owned()),
    })
}

/// `left`, `top`, `width`, `height`; text with `fit: resize` writes `height: auto` and its height
/// as `min-height`.
fn geometry(style: &Style<'_>) -> Result<Geometry, String> {
    let height = match style.get("height") {
        Some("auto") => style.px("min-height")?,
        _ => style.px("height")?,
    };
    Ok(Geometry {
        x: style.require_px("left")?,
        y: style.require_px("top")?,
        width: style.px("width")?,
        height,
    })
}

/// `transform: rotate(<deg>deg) scaleX(-1) scaleY(-1)` (the parts that apply) and `opacity`
/// (omitted at 1).
fn transform(style: &Style<'_>) -> Result<Transform2, String> {
    let mut out = Transform2 {
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
        opacity: style
            .get("opacity")
            .map(number)
            .transpose()
            .map_err(|e| format!("CSS property 'opacity': {e}"))?
            .unwrap_or(1.0),
    };
    for part in style.get("transform").unwrap_or_default().split_ascii_whitespace() {
        match part {
            "scaleX(-1)" => out.flip_h = true,
            "scaleY(-1)" => out.flip_v = true,
            _ => {
                let degrees = part
                    .strip_prefix("rotate(")
                    .and_then(|p| p.strip_suffix("deg)"))
                    .ok_or_else(|| format!("CSS property 'transform': '{part}' is not rotate(<n>deg), scaleX(-1) or scaleY(-1)"))?;
                out.rotation = number(degrees).map_err(|e| format!("CSS property 'transform': {e}"))?;
            }
        }
    }
    Ok(out)
}

/// `background-color`: the fill color, `transparent` when the fill is hidden.
fn box_fill(style: &Style<'_>) -> Option<FillModel> {
    style.get("background-color").map(|color| FillModel {
        visible: color != "transparent",
        color: color.to_owned(),
    })
}

/// `border-color`, `border-width`, `border-style` (`none` without a visible line) and the line's
/// `data-line-*` values.
fn box_line(element: &Element<'_>, style: &Style<'_>) -> Result<Option<LineModel>, String> {
    if style.get("border-style").is_none_or(|s| s == "none") {
        return Ok(None);
    }
    Ok(Some(LineModel {
        visible: true,
        color: style.require("border-color")?.to_owned(),
        width: style.require_px("border-width")?,
        dash_array: element.attr("data-line-dash-array")?.map(|d| d.into_owned()),
        begin_arrow: element.attr("data-line-begin-arrow")?.map(|d| d.into_owned()),
        end_arrow: element.attr("data-line-end-arrow")?.map(|d| d.into_owned()),
        begin_head_path: None,
        end_head_path: None,
    }))
}

/// `box-shadow: [inset ]<x>px <y>px <blur>px <color>`.
fn box_shadow(style: &Style<'_>) -> Result<Option<crate::model::Shadow>, String> {
    let Some(value) = style.get("box-shadow") else { return Ok(None) };
    let (value, inset) = match value.strip_prefix("inset ") {
        Some(rest) => (rest, true),
        None => (value, false),
    };
    shadow(value, inset).map(Some).map_err(|e| format!("CSS property 'box-shadow': {e}"))
}

/// The link an `a` element carries: `href`, `title` and `data-slide`. Other elements have none.
pub(crate) fn link(element: &Element<'_>) -> Result<Option<Link>, String> {
    if element.name != "a" {
        return Ok(None);
    }
    Ok(Some(Link {
        href: element.attr("href")?.ok_or("a link must have an href")?.into_owned(),
        tooltip: element.attr("title")?.map(|t| t.into_owned()),
        slide: element
            .attr("data-slide")?
            .map(|s| integer(&s).map_err(|e| format!("attribute 'data-slide': {e}")))
            .transpose()?,
    }))
}

/// A shape object: its box (geometry and transform only) and its SVG.
pub(crate) fn shape_object(dom: &Dom<'_>, element: &Element<'_>) -> Result<ShapeObject, String> {
    let style = Style::of(element)?;
    allow(element, &style, &[BOX_ATTRS, LINK_ATTRS, &["data-shape"]], &[BOX_CSS])?;
    let [svg] = dom.elements_of(&element.children)?[..] else {
        return Err("a shape object must hold one svg.shape-svg".into());
    };
    let mut object_style = object_style(element, &style, false)?;
    let shape = shape::read(dom, element, svg, &mut object_style)?;
    Ok(ShapeObject {
        style: object_style,
        shape: Some(shape),
    })
}

/// A text object: a text box, behind it the SVG of its shape when it has one.
pub(crate) fn text_object(dom: &Dom<'_>, element: &Element<'_>) -> Result<TextObject, String> {
    let style = Style::of(element)?;
    allow(
        element,
        &style,
        &[BOX_ATTRS, text::BOX_ATTRS, &["data-shape"]],
        &[BOX_CSS, text::BOX_CSS, &["min-height"]],
    )?;
    let children = dom.elements_of(&element.children)?;
    let (svg, content) = match children[..] {
        [svg, content] if element.has_attr("data-shape") => (Some(svg), content),
        [content] if !element.has_attr("data-shape") => (None, content),
        _ => return Err("a text object must hold .text-content, after an svg.shape-svg when it has data-shape".into()),
    };
    let mut object_style = object_style(element, &style, svg.is_none())?;
    let shape = svg.map(|svg| shape::read(dom, element, svg, &mut object_style)).transpose()?;
    Ok(TextObject {
        text: Some(text::text_box(dom, element, &style, content)?),
        style: object_style,
        shape,
    })
}

#[cfg(test)]
mod tests {
    use crate::model::SlideObject;
    use crate::profile::parse;
    use crate::profile::tests::document;

    fn first(objects: &str) -> Result<SlideObject, String> {
        let mut model = parse(&document(objects))?;
        model.slides.pop().and_then(|mut s| s.objects.pop()).ok_or_else(|| "no object".into())
    }

    const TEXT: &str = r#"<div class="text-content" style="width: 100%;"></div>"#;

    #[test]
    fn reads_the_common_box() {
        let html = format!(
            r#"<div class="slide-element slide-text" data-object-name="T" data-text-fit="resize" data-text-direction="horizontal" data-line-dash-array="4 2" style="left: 14.399999999999999px; top: -2px; width: 100px; height: auto; transform: rotate(-12.5deg) scaleY(-1); transform-origin: center; opacity: 0.25; background-color: transparent; border-color: #FF0000; border-width: 2px; border-style: dashed; box-shadow: inset 1px 2px 3px rgba(0, 0, 0, 0.5); padding: 1px 2px 3px 4px; align-items: center; white-space: pre; overflow-wrap: normal; direction: ltr; border-radius: 0%; min-height: 40px; overflow: visible;">{TEXT}</div>"#
        );
        let Ok(SlideObject::Text(object)) = first(&html) else {
            panic!("{:?}", first(&html).err())
        };
        let s = &object.style;
        assert_eq!(
            (s.geometry.x, s.geometry.y, s.geometry.width, s.geometry.height),
            (14.4, -2.0, Some(100.0), Some(40.0))
        );
        assert_eq!(
            (s.transform.rotation, s.transform.flip_h, s.transform.flip_v, s.transform.opacity),
            (-12.5, false, true, 0.25)
        );
        assert!(s.fill.as_ref().is_some_and(|f| !f.visible));
        let line = s.line.as_ref().expect("line");
        assert_eq!((line.color.as_str(), line.width, line.dash_array.as_deref()), ("#FF0000", 2.0, Some("4 2")));
        let shadow = s.shadow.as_ref().expect("shadow");
        assert_eq!((shadow.offset_x, shadow.offset_y, shadow.blur, shadow.inset), (1.0, 2.0, 3.0, true));
        assert_eq!(s.object_name.as_deref(), Some("T"));
        let text = object.text.expect("text");
        assert_eq!(
            (text.margin, text.wrap, text.fit.as_str(), text.vertical_align.as_str()),
            ([1.0, 2.0, 3.0, 4.0], false, "resize", "middle")
        );
    }

    #[test]
    fn charts_and_components_are_opaque_and_unsupported() {
        let html = r#"<div class="slide-element slide-component" data-object-name="C" style="whatever: 1"><script>if (a < b) document.write("</div>")</script><p>free <b>markup</div></div>"#;
        let error = first(html).err().unwrap_or_default();
        assert!(error.contains("malformed HTML"), "a component must still be well-formed markup: {error}");
        for (html, kind) in [
            (
                r#"<div class="slide-element slide-component" style="whatever: 1"><script>if (a < b) x("</div>")</script><p>free <b>markup</b></p></div>"#,
                "component",
            ),
            (
                r#"<div class="slide-element slide-chart" role="img"><svg viewBox="0 0 1 1"><g><text>1 &lt; 2</text><rect/></g></svg></div>"#,
                "chart",
            ),
        ] {
            assert!(matches!(first(html), Ok(SlideObject::Unsupported(k)) if k == kind), "{kind}");
        }
    }

    #[test]
    fn rejects_out_of_profile_boxes() {
        for style in [
            "left: 1px; top: 1px; transform: skewX(10deg);",
            "left: 1px; top: 1px; transform: rotate(10rad);",
            "left: 1px; top: 1px; opacity: half;",
            "left: 1px; top: 1px; border-style: solid;",
            "left: 1px; top: 1px; box-shadow: 1px 2px red;",
            "left: 1px;",
            "left: 1em; top: 1px;",
            "left: 1px; top: 1px; color: red;",
        ] {
            let html = format!(
                r#"<div class="slide-element slide-text" data-object-name="T" data-text-fit="none" data-text-direction="horizontal" style="{style} padding: 0px 0px 0px 0px; align-items: center; white-space: pre-wrap; direction: ltr;">{TEXT}</div>"#
            );
            let error = first(&html).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'T': "), "{style}: {error}");
        }
    }
}
