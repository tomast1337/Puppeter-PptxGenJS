//! Reads a PdfLapas HTML profile document (docs/HTML_PROFILE.md, versions 1 and 2), the output of
//! `toHtml()`, into the `crate::model` structs the drawing code reads.
//!
//! Every value comes from the one place the profile puts it, verbatim; nothing is defaulted here
//! beyond what the profile itself says ("omitted at 0", "omitted at 1"). An element, attribute,
//! CSS property or value outside the profile is an error naming the slide, the object and the
//! property, and malformed markup is an error, never a guess. A chart's SVG is read as the subset
//! its renderers write (`svg.rs`); a component's markup as nested sized boxes (`component.rs`).

mod chart;
mod component;
mod dom;
mod image;
mod object;
mod shape;
mod style;
pub(crate) mod svg;
mod table;
mod text;

use dom::{Dom, Element};
use style::{Style, integer, number, split_top_level};

use crate::model::{Metadata, PageSize, Presentation, Slide, SlideObject, UtcDate};

/// The profile version this reader implements (`<meta name="pdflapas-profile" content="2">`). It also
/// reads version 1, whose documents have no metadata: version 2 only added `<title>` and the
/// `author`, `description`, `pdflapas-company` and `pdflapas-revision` meta tags.
const PROFILE_VERSION: &str = "2";
const PROFILE_VERSION_1: &str = "1";
/// The `<meta>` that declares the version. Version 1 is frozen with the project's former name, so its
/// documents keep `pdfdeck-profile`; version 2 is read only from `pdflapas-profile`.
const PROFILE_META: &str = "pdflapas-profile";
const PROFILE_META_1: &str = "pdfdeck-profile";

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
    let Head { page_size, metadata } = read_head(&dom, head)?;
    let slides = dom
        .elements_of(&body.children)?
        .into_iter()
        .enumerate()
        .map(|(index, slide)| read_slide(&dom, slide).map_err(|e| format!("slide {}: {e}", index + 1)))
        .collect::<Result<_, _>>()?;
    Ok(Presentation { page_size, metadata, slides })
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

/// What `<head>` says about the document.
struct Head {
    page_size: PageSize,
    metadata: Metadata,
}

/// Checks the profile version, reads the page size from the stylesheet's `@page` rule and, in
/// version 2, the metadata.
fn read_head(dom: &Dom<'_>, head: &Element<'_>) -> Result<Head, String> {
    let mut version = None;
    let mut version_1 = None;
    let mut page_size = None;
    let mut metadata = Metadata::default();
    for element in dom.elements_of(&head.children)? {
        match element.name {
            "meta" => {
                let style = Style::of(element)?;
                allow(element, &style, &[&["name", "content", "charset"]], &[])?;
                let content = || element.attr("content").map(|c| c.unwrap_or_default().into_owned());
                match element.attr("name")?.as_deref() {
                    Some(PROFILE_META) => version = Some(content()?),
                    Some(PROFILE_META_1) => version_1 = Some(content()?),
                    Some("author") => set_once(&mut metadata.author, r#"<meta name="author">"#, content()?)?,
                    Some("description") => set_once(&mut metadata.subject, r#"<meta name="description">"#, content()?)?,
                    Some("pdflapas-company") => set_once(&mut metadata.company, r#"<meta name="pdflapas-company">"#, content()?)?,
                    Some("pdflapas-revision") => set_once(&mut metadata.revision, r#"<meta name="pdflapas-revision">"#, content()?)?,
                    Some("keywords") => set_once(&mut metadata.keywords, r#"<meta name="keywords">"#, content()?)?,
                    Some("pdflapas-creator") => set_once(&mut metadata.creator, r#"<meta name="pdflapas-creator">"#, content()?)?,
                    Some("pdflapas-producer") => set_once(&mut metadata.producer, r#"<meta name="pdflapas-producer">"#, content()?)?,
                    Some("pdflapas-creation-date") => set_date_once(&mut metadata.creation_date, r#"<meta name="pdflapas-creation-date">"#, &content()?)?,
                    Some("pdflapas-modification-date") => {
                        set_date_once(&mut metadata.modification_date, r#"<meta name="pdflapas-modification-date">"#, &content()?)?
                    }
                    _ => {}
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
            // As `document.title`: ASCII whitespace stripped and collapsed.
            "title" => {
                let title = dom.text_of(element)?.split_ascii_whitespace().collect::<Vec<_>>().join(" ");
                set_once(&mut metadata.title, "<title>", title)?;
            }
            name => return Err(format!("<{name}> in <head> is not in profile v{PROFILE_VERSION}")),
        }
    }
    let unsupported = match (version.as_deref(), version_1.as_deref()) {
        (Some(PROFILE_VERSION), _) => None,
        // Version 1 gave <title> and other meta tags no meaning, so its PDFs stay without metadata.
        (None, Some(PROFILE_VERSION_1)) => {
            metadata = Metadata::default();
            None
        }
        (Some(other), _) => Some((PROFILE_META, other)),
        (None, Some(other)) => Some((PROFILE_META_1, other)),
        (None, None) => {
            return Err(format!(
                r#"not a PdfLapas profile document: <meta name="{PROFILE_META}" content="{PROFILE_VERSION}"> is missing"#
            ));
        }
    };
    if let Some((name, other)) = unsupported {
        return Err(format!(
            r#"profile version '{other}' in <meta name="{name}"> is not supported (this renderer reads <meta name="{PROFILE_META_1}" content="{PROFILE_VERSION_1}"> and <meta name="{PROFILE_META}" content="{PROFILE_VERSION}">)"#
        ));
    }
    let page_size = page_size.ok_or("the stylesheet has no '@page { size: <width>in <height>in }' rule")?;
    Ok(Head { page_size, metadata })
}

/// Stores a metadata value, empty as absent; a second element for the same field is an error.
fn set_once(field: &mut Option<String>, element: &str, value: String) -> Result<(), String> {
    if field.is_some() {
        return Err(format!("<head> has more than one {element}"));
    }
    *field = Some(value).filter(|v| !v.is_empty());
    Ok(())
}

/// Stores a date read from `element`; a second element for the same date is an error.
fn set_date_once(field: &mut Option<UtcDate>, element: &str, value: &str) -> Result<(), String> {
    if field.is_some() {
        return Err(format!("<head> has more than one {element}"));
    }
    *field = Some(utc_date(value).map_err(|e| format!("{element}: {e}"))?);
    Ok(())
}

/// A profile date: UTC as `Date.prototype.toISOString()` writes it, `YYYY-MM-DDTHH:mm:ss.sssZ`, the
/// milliseconds optional and dropped (a PDF date stops at the second).
fn utc_date(text: &str) -> Result<UtcDate, String> {
    let fail = || format!("'{text}' is not a UTC date such as 2026-11-19T12:34:56.000Z");
    let (main, fraction) = text.strip_suffix('Z').and_then(|t| t.split_at_checked(19)).ok_or_else(fail)?;
    let fraction_ok = fraction.is_empty()
        || fraction
            .strip_prefix('.')
            .is_some_and(|digits| (1..=3).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()));
    let separators_ok = [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')]
        .iter()
        .all(|&(at, separator)| main.as_bytes().get(at) == Some(&separator));
    if !fraction_ok || !separators_ok {
        return Err(fail());
    }
    let field = |from: usize, to: usize, min: u8, max: u8| {
        main.get(from..to)
            .filter(|digits| digits.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|digits| digits.parse::<u8>().ok())
            .filter(|value| (min..=max).contains(value))
            .ok_or_else(fail)
    };
    let year = main
        .get(..4)
        .filter(|digits| digits.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|digits| digits.parse::<u16>().ok())
        .ok_or_else(fail)?;
    let month = field(5, 7, 1, 12)?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    Ok(UtcDate {
        year,
        month,
        day: field(8, 10, 1, days)?,
        hour: field(11, 13, 0, 23)?,
        minute: field(14, 16, 0, 59)?,
        second: field(17, 19, 0, 59)?,
    })
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
    let number = slide
        .attr("id")?
        .map(|id| {
            id.strip_prefix("slide-")
                .ok_or_else(|| format!("id '{id}' is not 'slide-<n>'"))
                .and_then(|n| integer(n).map_err(|e| format!("id '{id}': {e}")))
        })
        .transpose()?;
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
        number,
        background: style.require_color("background-color")?,
        objects,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A one-slide profile document around `objects`.
    pub(crate) fn document(objects: &str) -> String {
        format!(
            r#"<!DOCTYPE html><html><head><meta name="pdflapas-profile" content="2"><meta name="pdflapas-page-size" content="T"><style id="s">@page {{
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
        assert_eq!(slide.background, crate::color::Rgba(255, 255, 255, 1.0));
        assert!(slide.objects.is_empty());
        // The number slide links name; a hidden slide before it is not in the document.
        assert_eq!(slide.number, Some(1));
        let renumbered = parse(&document("").replace(r#"id="slide-1""#, r#"id="slide-3""#)).unwrap();
        assert_eq!(renumbered.slides.first().and_then(|s| s.number), Some(3));
        let unnamed = parse(&document("").replace(r#" id="slide-1""#, "")).unwrap();
        assert_eq!(unnamed.slides.first().and_then(|s| s.number), None);
    }

    #[test]
    fn requires_a_known_profile_version() {
        let html = document("");
        let missing = parse(&html.replace(r#"<meta name="pdflapas-profile" content="2">"#, ""))
            .err()
            .unwrap_or_default();
        assert!(missing.contains("not a PdfLapas profile document"), "{missing}");
        let unknown = parse(&html.replace(r#"content="2""#, r#"content="3""#)).err().unwrap_or_default();
        let reads = r#"(this renderer reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)"#;
        assert_eq!(
            unknown,
            format!(r#"profile version '3' in <meta name="pdflapas-profile"> is not supported {reads}"#)
        );
        // Each version has one spelling: version 1 the former name's, version 2 the current one.
        let renamed_1 = parse(&with_head("1", "").replace("pdfdeck-profile", "pdflapas-profile"))
            .err()
            .unwrap_or_default();
        assert_eq!(
            renamed_1,
            format!(r#"profile version '1' in <meta name="pdflapas-profile"> is not supported {reads}"#)
        );
        let old_name_2 = parse(&html.replace("pdflapas-profile", "pdfdeck-profile")).err().unwrap_or_default();
        assert_eq!(
            old_name_2,
            format!(r#"profile version '2' in <meta name="pdfdeck-profile"> is not supported {reads}"#)
        );
    }

    /// `document("")` with `head` written after the version and page-size meta tags; version 1 under its
    /// own meta name.
    fn with_head(version: &str, head: &str) -> String {
        let meta = if version == PROFILE_VERSION_1 { PROFILE_META_1 } else { PROFILE_META };
        document("").replace(
            r#"<meta name="pdflapas-profile" content="2">"#,
            &format!(r#"<meta name="{meta}" content="{version}">{head}"#),
        )
    }

    #[test]
    fn reads_the_metadata_of_version_2() {
        let head = r#"<title>  Q3 &amp;
 plan </title><meta name="author" content="Ana &quot;A&quot;"><meta name="description" content="Sales"><meta name="pdflapas-company" content="Co"><meta name="pdflapas-revision" content="4"><meta name="keywords" content="q3, é"><meta name="pdflapas-creator" content="App"><meta name="pdflapas-producer" content="Lib"><meta name="pdflapas-creation-date" content="2024-02-29T23:59:58.123Z"><meta name="pdflapas-modification-date" content="2026-11-19T00:00:00Z">"#;
        let Metadata {
            title,
            author,
            subject,
            company,
            revision,
            keywords,
            creator,
            producer,
            creation_date,
            modification_date,
        } = parse(&with_head("2", head)).map(|p| p.metadata).unwrap();
        assert_eq!(title.as_deref(), Some("Q3 & plan"));
        assert_eq!(author.as_deref(), Some(r#"Ana "A""#));
        assert_eq!((company.as_deref(), revision.as_deref()), (Some("Co"), Some("4")));
        assert_eq!(subject.as_deref(), Some("Sales"));
        assert_eq!(
            (keywords.as_deref(), creator.as_deref(), producer.as_deref()),
            (Some("q3, é"), Some("App"), Some("Lib"))
        );
        let date = |year, month, day, hour, minute, second| UtcDate {
            year,
            month,
            day,
            hour,
            minute,
            second,
        };
        assert_eq!(creation_date, Some(date(2024, 2, 29, 23, 59, 58)));
        assert_eq!(modification_date, Some(date(2026, 11, 19, 0, 0, 0)));
        for bad in [
            "2026-11-19",
            "2026-11-19T00:00:00",
            "2026-11-19T00:00:00+01:00",
            "2026-11-19T00:00:00.1234Z",
            "2025-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-11-19T24:00:00Z",
            "+12026-11-19T00:00:00Z",
            "2026-11-19T00:00:0éZ",
        ] {
            let error = parse(&with_head("2", &format!(r#"<meta name="pdflapas-creation-date" content="{bad}">"#)))
                .err()
                .unwrap_or_default();
            assert_eq!(
                error,
                format!(r#"<meta name="pdflapas-creation-date">: '{bad}' is not a UTC date such as 2026-11-19T12:34:56.000Z"#)
            );
        }

        let empty = parse(&with_head("2", r#"<title></title><meta name="author" content="">"#)).unwrap().metadata;
        assert!(empty.title.is_none() && empty.author.is_none() && empty.subject.is_none());
        let twice = parse(&with_head("2", "<title>a</title><title>b</title>")).err().unwrap_or_default();
        assert_eq!(twice, "<head> has more than one <title>");
    }

    #[test]
    fn reads_version_1_without_metadata() {
        let old = parse(&with_head("1", r#"<title>T</title><meta name="author" content="A">"#)).unwrap();
        assert!(old.metadata.title.is_none() && old.metadata.author.is_none());
        assert_eq!(old.slides.len(), 1);
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
            (r#"id="slide-1""#, r#"id="intro""#),
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
        let html = document(&format!(r#"{PROGRESS}<div class="slide-element slide-wobble" data-object-name="Odd"></div>"#));
        let error = parse(&html).err().unwrap_or_default();
        assert_eq!(
            error,
            "slide 1: object 'Odd': div.slide-element has no profile kind class (slide-text, slide-shape, slide-image, slide-table-container, slide-chart, slide-component)"
        );
    }

    /// The shared fixture's `fixture/progress` component, as `toHtml()` writes it.
    pub(crate) const PROGRESS: &str = r#"<div class="slide-element slide-component" data-component-type="fixture/progress" data-component-version="1" data-object-name="Component 0" style="left: 96px; top: 96px; width: 384px; height: 48px; transform-origin: center; border-style: none; position: absolute; overflow: hidden;"><div style="width:100%;height:100%;background:#E0E0E0"><div style="width:75%;height:200%;background:#4472C4"></div></div></div>"#;

    /// A text object, as `toHtml()` writes it.
    pub(crate) const TEXT: &str = r#"<div class="slide-element slide-text" data-object-name="Title" data-text-fit="none" data-text-direction="horizontal" style="left: 96px; top: 96px; width: 288px; height: 96px; transform-origin: center; background-color: transparent; border-style: none; padding: 4.800000000000001px 9.600000000000001px 4.800000000000001px 9.600000000000001px; align-items: center; white-space: pre-wrap; overflow-wrap: break-word; direction: ltr; border-radius: 0%;"><div class="text-content" style="width: 100%;"><div class="text-paragraph" data-line-baseline="23.999999999999996" style="text-align: left; direction: ltr; margin-top: 0px; margin-bottom: 0px; line-height: 28.799999999999997px; tab-size: 96px;"><span class="text-run" style="font-family: &quot;Arial&quot;; font-size: 24px; color: #000000; font-weight: normal; font-style: normal; text-decoration-style: solid;" lang="en-US">Hi &amp; bye</span></div></div></div>"#;

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
