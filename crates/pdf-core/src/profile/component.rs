//! Component objects (`render/component.ts`): the common box around the markup a component
//! definition rendered.
//!
//! WASM draws that markup only when it needs no CSS layout: nested sized boxes, each at its
//! parent's top-left, which become filled rectangles of an SVG display list (`svg.rs`) clipped to
//! the component box. Text, siblings, padding and other CSS need flow layout (#69 phase 8) and are
//! errors naming the element and property.

use super::dom::{Dom, Element, Node};
use super::object::{BOX_ATTRS, BOX_CSS, object_style};
use super::style::{Style, number};
use super::svg::color_value;
use super::{PROFILE_VERSION, allow};
use crate::color::Rgba;
use crate::model::SvgObject;
use crate::path::rect_path;
use crate::svg::{Fit, Item, Paint, Shape, Svg};
use krilla::paint::FillRule;

const COMPONENT_ATTRS: &[&str] = &["data-component-type", "data-component-version"];
/// What a box may state: its size and its paint.
const BOX_CHILD_CSS: &[&str] = &["width", "height", "background", "background-color"];

/// A `.slide-component` object: the common box (`position: absolute; overflow: hidden`) around
/// its boxes.
pub(crate) fn object(dom: &Dom<'_>, element: &Element<'_>) -> Result<SvgObject, String> {
    let style = Style::of(element)?;
    allow(element, &style, &[BOX_ATTRS, COMPONENT_ATTRS], &[BOX_CSS, &["position", "overflow"]])?;
    if style.get("position") != Some("absolute") || style.get("overflow") != Some("hidden") {
        return Err("a component object must have 'position: absolute' and 'overflow: hidden'".into());
    }
    let object_style = object_style(element, &style, true)?;
    let (Some(width), Some(height)) = (object_style.geometry.width, object_style.geometry.height) else {
        return Err("a component object must have a px width and height".into());
    };
    let kind = element.attr("data-component-type")?.ok_or("attribute 'data-component-type' is missing")?;
    let version = element.attr("data-component-version")?.ok_or("attribute 'data-component-version' is missing")?;
    let items = boxes(dom, &element.children, (width, height)).map_err(|e| format!("component '{kind}' v{version}: {e}"))?;
    Ok(SvgObject {
        style: object_style,
        svg: Svg {
            view_box: None,
            fit: Fit::CENTER_MEET,
            items,
            gradients: Vec::new(),
            clips: Vec::new(),
        },
    })
}

/// The chain of boxes under `children`, outermost first: each element holds at most one `<div>`,
/// placed at its top-left, sized by `width` and `height` (px, or % of its parent's) and filled by
/// `background` or `background-color`. A loop, not recursion, so deep markup cannot overflow the stack.
fn boxes<'d>(dom: &'d Dom<'d>, mut children: &'d [Node], mut parent: (f32, f32)) -> Result<Vec<Item>, String> {
    let mut items = Vec::new();
    loop {
        let child = match dom.elements_of(children)?[..] {
            [] => return Ok(items),
            [child] => child,
            [_, second, ..] => {
                return Err(format!(
                    "a second element (<{}>) beside a box needs CSS flow layout, which WASM does not do",
                    second.name
                ));
            }
        };
        if child.name != "div" {
            return Err(format!(
                "<{}> is not in profile v{PROFILE_VERSION}: component markup is nested <div> boxes",
                child.name
            ));
        }
        if child.has_attr("class") {
            return Err(format!(
                "attribute 'class' on <div> is not in profile v{PROFILE_VERSION}: a box is styled inline"
            ));
        }
        let style = Style::of(child)?;
        allow(child, &style, &[], &[BOX_CHILD_CSS])?;
        let size = (length(&style, "width", parent.0)?, length(&style, "height", parent.1)?);
        if let Some(color) = background(&style)? {
            items.push(Item::Shape(Shape {
                path: rect_path(0.0, 0.0, size.0, size.1, 0.0),
                transform: None,
                fill: Some(Paint::Color(color)),
                rule: FillRule::NonZero,
                stroke: None,
            }));
        }
        children = &child.children;
        parent = size;
    }
}

/// `width` or `height`: `<n>px`, `<n>%` of the parent's, or `0`; required, since WASM does not size
/// a box from its content.
fn length(style: &Style<'_>, property: &str, parent: f32) -> Result<f32, String> {
    let value = style.require(property)?;
    let length = match (value.strip_suffix("px"), value.strip_suffix('%')) {
        (Some(px), _) => number(px),
        (_, Some(percent)) => number(percent).map(|p| p / 100.0 * parent),
        _ if value == "0" => Ok(0.0),
        _ => Err(format!("'{value}' is not a px or % length")),
    }
    .map_err(|e| format!("CSS property '{property}': {e}"))?;
    if length < 0.0 {
        return Err(format!("CSS property '{property}': '{value}' is negative"));
    }
    Ok(length)
}

/// The fill color: `background` (a color alone) or `background-color`, not both.
fn background(style: &Style<'_>) -> Result<Option<Rgba>, String> {
    let (property, value) = match (style.get("background"), style.get("background-color")) {
        (Some(_), Some(_)) => return Err("CSS properties 'background' and 'background-color' are both set".into()),
        (Some(value), None) => ("background", value),
        (None, Some(value)) => ("background-color", value),
        (None, None) => return Ok(None),
    };
    color_value(value).map(Some).map_err(|e| format!("CSS property '{property}': {e}"))
}

#[cfg(test)]
mod tests {
    use crate::color::Rgba;
    use crate::model::SlideObject;
    use crate::profile::parse;
    use crate::profile::tests::{PROGRESS, document};
    use crate::svg::{Item, Paint, Svg};
    use kurbo::Shape as _;

    fn svg(objects: &str) -> Result<Svg, String> {
        match parse(&document(objects))?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Svg(object)) => Ok(object.svg),
            _ => Err("no component".into()),
        }
    }

    /// Each filled box: its rectangle (x, y, width, height) and color.
    fn boxes(svg: &Svg) -> Vec<([f64; 4], Rgba)> {
        svg.items
            .iter()
            .filter_map(|item| match item {
                Item::Shape(shape) => {
                    let b = shape.path.bounding_box();
                    let Some(Paint::Color(color)) = shape.fill else { return None };
                    Some(([b.x0, b.y0, b.width(), b.height()], color))
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn reads_the_fixture_progress_bars_as_boxes_at_their_parents_corner() {
        let progress = svg(PROGRESS).unwrap();
        assert!(progress.view_box.is_none());
        let grey = Rgba(0xE0, 0xE0, 0xE0, 1.0);
        let blue = Rgba(0x44, 0x72, 0xC4, 1.0);
        // The inner box is 200% of its parent's height: drawn past the component box, which clips it.
        assert_eq!(boxes(&progress), vec![([0.0, 0.0, 384.0, 48.0], grey), ([0.0, 0.0, 288.0, 96.0], blue)]);
        let sized = PROGRESS
            .replace(
                "width:100%;height:100%;background:#E0E0E0",
                "width:10px;height:2px;background-color:rgba(0, 0, 255, 0.5)",
            )
            .replace("width:75%;height:200%;background:#4472C4", "width:0;height:50%");
        assert_eq!(boxes(&svg(&sized).unwrap()), vec![([0.0, 0.0, 10.0, 2.0], Rgba(0, 0, 255, 0.5))]);
        let empty = PROGRESS.replace(
            r#"<div style="width:100%;height:100%;background:#E0E0E0"><div style="width:75%;height:200%;background:#4472C4"></div></div>"#,
            " ",
        );
        assert!(svg(&empty).unwrap().items.is_empty());
    }

    #[test]
    fn rejects_markup_that_needs_layout_naming_component_element_and_property() {
        let inner = r#"<div style="width:100%;height:100%;background:#E0E0E0"><div style="width:75%;height:200%;background:#4472C4"></div></div>"#;
        for (markup, expected) in [
            // The repo's other components: tests/crossRuntimeDeck.ts, docs/COMPONENTS.md, examples/react-component.ts.
            (
                r#"<strong style="color: #17365D">Badge</strong>"#,
                "<strong> is not in profile v1: component markup is nested <div> boxes",
            ),
            (
                r#"<div style="height:100%;padding:16px;box-sizing:border-box;background:#eef2ff;font-family:Arial"><strong>Revenue</strong><div style="font-size:32px">42</div></div>"#,
                "CSS property 'padding' on <div> is not in profile v1",
            ),
            ("Badge", "unexpected text 'Badge'"),
            (
                r#"<div style="width:1px;height:1px"></div><div style="width:1px;height:1px"></div>"#,
                "a second element (<div>) beside a box needs CSS flow layout",
            ),
            (r#"<div style="width:1px;height:1px">text</div>"#, "unexpected text 'text'"),
            (
                r#"<div class="bar" style="width:1px;height:1px"></div>"#,
                "attribute 'class' on <div> is not in profile v1",
            ),
            (
                r#"<div id="bar" style="width:1px;height:1px"></div>"#,
                "attribute 'id' on <div> is not in profile v1",
            ),
            (r#"<div style="height:1px"></div>"#, "CSS property 'width' is missing"),
            (
                r#"<div style="width:auto;height:1px"></div>"#,
                "CSS property 'width': 'auto' is not a px or % length",
            ),
            (
                r#"<div style="width:1em;height:1px"></div>"#,
                "CSS property 'width': '1em' is not a px or % length",
            ),
            (r#"<div style="width:-1px;height:1px"></div>"#, "CSS property 'width': '-1px' is negative"),
            (r#"<div style="width:1px;height:NaN%"></div>"#, "CSS property 'height': "),
            (
                r#"<div style="width:1px;height:1px;background:url(x.png)"></div>"#,
                "CSS property 'background': 'url(x.png)' is not a #rgb",
            ),
            (
                r#"<div style="width:1px;height:1px;background:red;background-color:red"></div>"#,
                "'background' and 'background-color' are both set",
            ),
            (r#"<svg width="100%" height="100%"></svg>"#, "<svg> is not in profile v1"),
            (r#"<img src="data:image/png;base64,">"#, "<img> is not in profile v1"),
            (r#"<script>x()</script>"#, "<script> is not in profile v1"),
        ] {
            let html = PROGRESS.replace(inner, markup);
            let error = svg(&html).err().unwrap_or_default();
            let prefix = "slide 1: object 'Component 0': component 'fixture/progress' v1: ";
            assert!(error.starts_with(prefix) && error.contains(expected), "{markup}: {error}");
        }
        // Deep markup is read in a loop, not by recursion.
        let deep = format!("{}{}", r#"<div style="width:1px;height:1px">"#.repeat(10_000), "</div>".repeat(10_000));
        assert_eq!(boxes(&svg(&PROGRESS.replace(inner, &deep)).unwrap()).len(), 0);
    }

    #[test]
    fn rejects_component_boxes_outside_the_profile() {
        for (from, to) in [
            ("position: absolute; ", ""),
            ("overflow: hidden;", "overflow: visible;"),
            ("height: 48px; ", ""),
            (r#" data-component-type="fixture/progress""#, ""),
            ("transform-origin: center;", "transform-origin: center; padding: 1px;"),
            ("data-object-name", "data-props"),
        ] {
            assert!(PROGRESS.contains(from), "{from}");
            let error = svg(&PROGRESS.replacen(from, to, 1)).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object "), "{to}: {error}");
        }
    }
}
