//! Reads a pdfdeck HTML profile document (docs/HTML_PROFILE.md, version 1), the output of
//! `toHtml()`, into the `crate::model` structs the drawing code reads.
//!
//! Every value comes from the one place the profile puts it, verbatim; nothing is defaulted here
//! beyond what the profile itself says ("omitted at 0", "omitted at 1"). An element, attribute,
//! CSS property or value outside the profile is an error naming the slide, the object and the
//! property, and malformed markup is an error, never a guess. Charts and components are opaque
//! subtrees: they become `SlideObject::Unsupported`, reported through `warnings()`.

mod dom;
mod image;
mod object;
mod shape;
mod style;
mod table;
mod text;

use dom::{Dom, Element};
use style::{Style, number, split_top_level};

use crate::model::{PageSize, Presentation, Slide, SlideObject};

/// The profile version this reader implements (`<meta name="pdfdeck-profile" content="1">`).
const PROFILE_VERSION: &str = "1";

/// Parses a profile document into the presentation it describes.
pub(crate) fn parse(html: &str) -> Result<Presentation, String> {
    let dom = dom::parse(html)?;
    let [root] = dom.elements_of(&dom.children)?[..] else {
        return Err("the document must hold exactly one <html> element".into());
    };
    expect_name(root, "html")?;
    let [head, body] = dom.elements_of(&root.children)?[..] else {
        return Err("<html> must hold <head> and <body>".into());
    };
    expect_name(head, "head")?;
    expect_name(body, "body")?;
    let page_size = read_head(&dom, head)?;
    let slides = dom
        .elements_of(&body.children)?
        .into_iter()
        .enumerate()
        .map(|(index, slide)| read_slide(&dom, slide).map_err(|e| format!("slide {}: {e}", index + 1)))
        .collect::<Result<_, _>>()?;
    Ok(Presentation { page_size, slides })
}

fn expect_name(element: &Element<'_>, name: &str) -> Result<(), String> {
    if element.name == name {
        Ok(())
    } else {
        Err(format!("expected <{name}>, found <{}>", element.name))
    }
}

/// Fails on an attribute or CSS property of `element` that `attrs` and `css` do not list
/// (`class` and `style` are always allowed).
pub(crate) fn allow(element: &Element<'_>, style: &Style<'_>, attrs: &[&[&str]], css: &[&[&str]]) -> Result<(), String> {
    if let Some(attr) = element
        .attrs()
        .find(|a| *a != "class" && *a != "style" && !attrs.iter().any(|list| list.contains(a)))
    {
        return Err(format!("attribute '{attr}' on <{}> is not in profile v{PROFILE_VERSION}", element.name));
    }
    if let Some(property) = style.properties().find(|p| !css.iter().any(|list| list.contains(p))) {
        return Err(format!("CSS property '{property}' on <{}> is not in profile v{PROFILE_VERSION}", element.name));
    }
    Ok(())
}

/// Checks the profile version and reads the page size from the stylesheet's `@page` rule.
fn read_head(dom: &Dom<'_>, head: &Element<'_>) -> Result<PageSize, String> {
    let mut version = None;
    let mut page_size = None;
    for element in dom.elements_of(&head.children)? {
        match element.name {
            "meta" => {
                let style = Style::of(element)?;
                allow(element, &style, &[&["name", "content", "charset"]], &[])?;
                if element.attr("name")?.as_deref() == Some("pdfdeck-profile") {
                    version = Some(element.attr("content")?.unwrap_or_default().into_owned());
                }
            }
            "style" => {
                if let Some(size) = page_rule(&dom.text_of(element)?)? {
                    if page_size.is_some() {
                        return Err("the stylesheet has more than one @page size".into());
                    }
                    page_size = Some(size);
                }
            }
            "title" => {}
            name => return Err(format!("<{name}> in <head> is not in profile v{PROFILE_VERSION}")),
        }
    }
    match version.as_deref() {
        Some(PROFILE_VERSION) => {}
        Some(other) => {
            return Err(format!(
                "pdfdeck profile version '{other}' is not supported (this renderer reads version {PROFILE_VERSION})"
            ));
        }
        None => return Err(r#"not a pdfdeck profile document: <meta name="pdfdeck-profile" content="1"> is missing"#.into()),
    }
    page_size.ok_or_else(|| "the stylesheet has no '@page { size: <width>in <height>in }' rule".into())
}

/// The `size` of a stylesheet's `@page` rule, in inches.
fn page_rule(css: &str) -> Result<Option<PageSize>, String> {
    let Some((_, after)) = css.split_once("@page") else { return Ok(None) };
    let block = after
        .trim_ascii_start()
        .strip_prefix('{')
        .and_then(|b| b.split_once('}'))
        .map(|(block, _)| block)
        .ok_or("@page: expected '{ … }'")?;
    let size = split_top_level(block, ';')
        .into_iter()
        .find_map(|d| {
            d.split_once(':')
                .filter(|(name, _)| name.trim_ascii() == "size")
                .map(|(_, value)| value.trim_ascii())
        })
        .ok_or("@page has no size")?;
    let inches = |v: &str| {
        v.strip_suffix("in")
            .ok_or_else(|| format!("@page size '{size}' is not '<width>in <height>in'"))
            .and_then(number)
    };
    match size.split_ascii_whitespace().collect::<Vec<_>>()[..] {
        [width, height] => Ok(Some(PageSize {
            width: inches(width)?,
            height: inches(height)?,
        })),
        _ => Err(format!("@page size '{size}' is not '<width>in <height>in'")),
    }
}

fn read_slide(dom: &Dom<'_>, slide: &Element<'_>) -> Result<Slide, String> {
    if slide.name != "div" || !slide.has_class("slide-container") {
        return Err(format!("expected div.slide-container, found <{}>", slide.name));
    }
    let style = Style::of(slide)?;
    allow(slide, &style, &[&["id", "data-hidden"]], &[&["background-color", "--slide-text-color"]])?;
    let objects = dom
        .elements_of(&slide.children)?
        .into_iter()
        .enumerate()
        .map(|(index, element)| {
            object::read(dom, element).map_err(|e| {
                let name = element.attr("data-object-name").ok().flatten();
                let label = name.map_or_else(|| format!("#{index}"), |name| format!("'{name}'"));
                format!("object {label}: {e}")
            })
        })
        .collect::<Result<Vec<SlideObject>, String>>()?;
    Ok(Slide {
        background: style.require("background-color")?.to_owned(),
        objects,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A one-slide profile document around `objects`.
    pub(crate) fn document(objects: &str) -> String {
        format!(
            r#"<!DOCTYPE html><html><head><meta name="pdfdeck-profile" content="1"><meta name="pdfdeck-page-size" content="T"><style id="s">@page {{
    size: 10in 5.625in;
    margin: 0;
}}
.slide-container {{ width: 960px; }}</style></head><body><div class="slide-container" id="slide-1" style="background-color: #FFFFFF; --slide-text-color: #000000;" data-hidden="false">{objects}</div></body></html>"#
        )
    }

    #[test]
    fn reads_the_page_size_and_slides() {
        let model = parse(&document("")).unwrap();
        assert_eq!((model.page_size.width, model.page_size.height), (10.0, 5.625));
        let [slide] = &model.slides[..] else { panic!("one slide") };
        assert_eq!(slide.background, "#FFFFFF");
        assert!(slide.objects.is_empty());
    }

    #[test]
    fn requires_a_known_profile_version() {
        let html = document("");
        let missing = parse(&html.replace(r#"<meta name="pdfdeck-profile" content="1">"#, ""))
            .err()
            .unwrap_or_default();
        assert!(missing.contains("not a pdfdeck profile document"), "{missing}");
        let unknown = parse(&html.replace(r#"content="1""#, r#"content="2""#)).err().unwrap_or_default();
        assert!(unknown.contains("version '2' is not supported"), "{unknown}");
    }

    #[test]
    fn rejects_documents_outside_the_profile() {
        let html = document("");
        for (from, to) in [
            ("size: 10in 5.625in", "size: 10px 5.625in"),
            ("size: 10in 5.625in", "size: NaNin 5.625in"),
            ("size: 10in 5.625in", "size: 1e999in 5.625in"),
            ("@page {", "@media {"),
            ("<style", "<script></script><style"),
            ("data-hidden", "onclick"),
            ("background-color: #FFFFFF;", "background-color: #FFFFFF; float: left;"),
            ("<div class=\"slide-container\"", "<p class=\"slide-container\""),
            ("</div></body>", "<span></span></div></body>"),
            ("<body>", "<body>text"),
        ] {
            let changed = html.replace(from, to).replace("</p></body>", "</div></body>");
            assert!(parse(&changed).is_err(), "{to}");
        }
    }

    #[test]
    fn names_slide_object_and_property_in_errors() {
        let html = document(
            r#"<div class="slide-element slide-chart" data-object-name="Chart 1"></div><div class="slide-element slide-wobble" data-object-name="Odd"></div>"#,
        );
        let error = parse(&html).err().unwrap_or_default();
        assert_eq!(
            error,
            "slide 1: object 'Odd': div.slide-element has no profile kind class (slide-text, slide-shape, slide-image, slide-table-container, slide-chart, slide-component)"
        );
    }

    /// A text object, as `toHtml()` writes it.
    pub(crate) const TEXT: &str = r#"<div class="slide-element slide-text" data-object-name="Title" data-text-fit="none" data-text-direction="horizontal" style="left: 96px; top: 96px; width: 288px; height: 96px; transform-origin: center; background-color: transparent; border-style: none; padding: 4.800000000000001px 9.600000000000001px 4.800000000000001px 9.600000000000001px; align-items: center; white-space: pre-wrap; overflow-wrap: break-word; direction: ltr; border-radius: 0%;"><div class="text-content" style="width: 100%;"><div class="text-paragraph" data-line-baseline="23.999999999999996" style="text-align: left; direction: ltr; margin-top: 0px; margin-bottom: 0px; line-height: 28.799999999999997px; tab-size: 96px;"><span class="text-run" style="font-family: &quot;Arial&quot;, sans-serif; font-size: 24px; color: #000000; font-weight: normal; font-style: normal; text-decoration-style: solid;" lang="en-US">Hi &amp; bye</span></div></div></div>"#;

    #[test]
    fn every_truncation_and_garbage_input_is_an_error_not_a_panic() {
        let html = document(TEXT);
        assert!(parse(&html).is_ok());
        // Cutting the document anywhere leaves an unclosed element, tag, attribute or reference.
        for end in (0..html.len()).filter(|&end| html.is_char_boundary(end)) {
            assert!(parse(&html[..end]).is_err(), "truncated at {end}");
        }
        for (from, to) in [
            ("font-size: 24px", "font-size: 1e40px"),
            ("font-size: 24px", "font-size: NaNpx"),
            ("font-size: 24px", "font-size: infinitypx"),
            ("font-size: 24px", "font-size: -0x10px"),
            ("top: 96px", "top: 99999999999999999999999999999999999999999px"),
            ("tab-size: 96px", "tab-size: 96px; tab-size: 96px"),
            ("lang=\"en-US\"", "lang=\"en-US\" onclick=\"x\""),
            ("Hi &amp; bye", "Hi &bogus; bye"),
            ("Hi &amp; bye", "Hi <b>bold</b> bye"),
            ("Hi &amp; bye", "<div><div><span></div></span></div>"),
            ("Hi &amp; bye", "<!-- unterminated"),
            ("<div class=\"text-content\"", "<div class=\"text-content\" class=\"x\""),
        ] {
            assert!(html.contains(from), "{from}");
            assert!(parse(&html.replacen(from, to, 1)).is_err(), "{to}");
        }
        let deep = "<div>".repeat(100_000);
        for garbage in [
            "",
            "<",
            "<html",
            "\u{0}",
            "<html><html><html>",
            "</html>",
            "<!DOCTYPE html><!DOCTYPE html>",
            "\u{feff}<html></html>",
            &deep,
        ] {
            assert!(parse(garbage).is_err(), "{}", garbage.len());
        }
    }
}
