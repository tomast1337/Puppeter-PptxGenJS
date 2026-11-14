//! Text boxes, paragraphs, bullets and runs (`render/text.ts`), for text objects and table cells.

use super::allow;
use super::dom::{Dom, Element};
use super::object::link;
use super::style::{Style, first_family, integer, number, px, shadow, split_top_level};
use crate::model::{Bullet, Decoration, LineBox, Outline, Paragraph, Run, Shadow, TabAlign, TabStop, TextBox};

/// Attributes of the element that holds a text box.
pub(crate) const BOX_ATTRS: &[&str] = &["data-text-fit", "data-text-direction"];
/// CSS a text box adds to its element (`renderText`).
pub(crate) const BOX_CSS: &[&str] = &[
    "padding",
    "align-items",
    "white-space",
    "overflow-wrap",
    "direction",
    "border-radius",
    "overflow",
];
const CONTENT_CSS: &[&str] = &["width", "writing-mode", "text-orientation", "height"];
const PARAGRAPH_ATTRS: &[&str] = &[
    "data-line-baseline",
    "data-tab-stops",
    "data-bullet-level",
    "data-bullet-type",
    "data-bullet-indent",
    "data-bullet-start",
    "data-bullet-number-type",
];
// `padding-left` and `text-indent` are the bullet indent, derived from the values read here.
const PARAGRAPH_CSS: &[&str] = &[
    "text-align",
    "direction",
    "margin-top",
    "margin-bottom",
    "line-height",
    "tab-size",
    "padding-left",
    "text-indent",
];
const BULLET_CSS: &[&str] = &["display", "width", "font-family", "font-size", "color"];
const RUN_ATTRS: &[&str] = &[
    "lang",
    "href",
    "title",
    "data-slide",
    "data-double-strike",
    "data-underline-style",
    "data-vertical-align",
    "data-text-shadow",
    "data-shadow-inset",
    "data-empty",
    "data-soft-break-before",
];
const RUN_CSS: &[&str] = &[
    "font-family",
    "font-size",
    "color",
    "font-weight",
    "font-style",
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-color",
    "position",
    "top",
    "letter-spacing",
    "background-color",
    "-webkit-text-stroke",
    "text-shadow",
];
/// What an empty run holds so it still owns a line box (`data-empty` marks it).
const EMPTY_RUN_TEXT: &str = "\u{200B}";
/// The no-break space after a bullet marker.
const MARKER_SPACE: char = '\u{a0}';

/// `value` if it is one of `allowed`, else an error naming `what`.
fn one_of<'v>(what: &str, value: &'v str, allowed: &[&str]) -> Result<&'v str, String> {
    if allowed.contains(&value) {
        Ok(value)
    } else {
        Err(format!("{what}: '{value}' is not one of {}", allowed.join(", ")))
    }
}

/// The text box on `element` (declarations in `style`), with its `.text-content` child `content`.
pub(crate) fn text_box(dom: &Dom<'_>, element: &Element<'_>, style: &Style<'_>, content: &Element<'_>) -> Result<TextBox, String> {
    let padding = style.require("padding")?;
    let margin: Vec<f32> = padding.split_ascii_whitespace().map(px).collect::<Result<_, _>>()?;
    let margin: [f32; 4] = margin
        .try_into()
        .map_err(|_| format!("CSS property 'padding': '{padding}' is not four px lengths"))?;
    let vertical_align = match style.require("align-items")? {
        "flex-start" => "top",
        "center" => "middle",
        "flex-end" => "bottom",
        other => return Err(format!("CSS property 'align-items': '{other}' is not flex-start, center or flex-end")),
    };
    let wrap = one_of("CSS property 'white-space'", style.require("white-space")?, &["pre-wrap", "pre"])? == "pre-wrap";
    let fit = element.attr("data-text-fit")?.ok_or("attribute 'data-text-fit' is missing")?;
    let direction = element.attr("data-text-direction")?.ok_or("attribute 'data-text-direction' is missing")?;

    if content.name != "div" || !content.has_class("text-content") {
        return Err(format!("expected div.text-content, found <{}>", content.name));
    }
    let content_style = Style::of(content)?;
    allow(content, &content_style, &[], &[CONTENT_CSS])?;
    let paragraphs = dom
        .elements_of(&content.children)?
        .into_iter()
        .enumerate()
        .map(|(i, p)| paragraph(dom, p).map_err(|e| format!("paragraph {}: {e}", i + 1)))
        .collect::<Result<_, _>>()?;
    Ok(TextBox {
        paragraphs,
        margin,
        vertical_align: vertical_align.to_owned(),
        wrap,
        fit: one_of("attribute 'data-text-fit'", &fit, &["none", "shrink", "resize"])?.to_owned(),
        direction: one_of(
            "attribute 'data-text-direction'",
            &direction,
            &["horizontal", "vertical", "vertical270", "stacked"],
        )?
        .to_owned(),
    })
}

/// A required number attribute.
fn number_attr(element: &Element<'_>, name: &str) -> Result<f32, String> {
    let value = element.attr(name)?.ok_or_else(|| format!("attribute '{name}' is missing"))?;
    number(&value).map_err(|e| format!("attribute '{name}': {e}"))
}

fn paragraph(dom: &Dom<'_>, element: &Element<'_>) -> Result<Paragraph, String> {
    if element.name != "div" || !element.has_class("text-paragraph") {
        return Err(format!("expected div.text-paragraph, found <{}>", element.name));
    }
    let style = Style::of(element)?;
    allow(element, &style, &[PARAGRAPH_ATTRS], &[PARAGRAPH_CSS])?;
    let mut children = dom.elements_of(&element.children)?.into_iter().peekable();
    let bullet = match element.attr("data-bullet-type")? {
        Some(kind) => {
            one_of("attribute 'data-bullet-type'", &kind, &["bullet", "number"])?;
            let marker = children
                .next_if(|c| c.has_class("text-bullet"))
                .ok_or("a paragraph with data-bullet-type must start with span.text-bullet")?;
            Some(bullet(dom, element, marker)?)
        }
        None => None,
    };
    let runs = children
        .filter(|c| c.name != "br")
        .enumerate()
        .map(|(i, r)| run(dom, r).map_err(|e| format!("run {}: {e}", i + 1)))
        .collect::<Result<_, _>>()?;
    let tab_stops = match element.attr("data-tab-stops")? {
        Some(stops) => stops.split(',').map(tab_stop).collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    Ok(Paragraph {
        runs,
        align: one_of(
            "CSS property 'text-align'",
            style.require("text-align")?,
            &["left", "center", "right", "justify"],
        )?
        .to_owned(),
        rtl: one_of("CSS property 'direction'", style.require("direction")?, &["ltr", "rtl"])? == "rtl",
        line_box: LineBox {
            height: style.require_px("line-height")?,
            baseline: number_attr(element, "data-line-baseline")?,
        },
        space_before: style.require_px("margin-top")?,
        space_after: style.require_px("margin-bottom")?,
        tab_stops,
        default_tab_stop: style.require_px("tab-size")?,
        bullet,
    })
}

/// `<position>:<alignment>` in `data-tab-stops`.
fn tab_stop(stop: &str) -> Result<TabStop, String> {
    let invalid = || format!("attribute 'data-tab-stops': '{stop}' is not '<position>:<left|right|center|decimal>'");
    let (position, alignment) = stop.split_once(':').ok_or_else(invalid)?;
    Ok(TabStop {
        position: number(position).map_err(|e| format!("attribute 'data-tab-stops': {e}"))?,
        alignment: match alignment {
            "left" => TabAlign::Left,
            "right" => TabAlign::Right,
            "center" => TabAlign::Center,
            "decimal" => TabAlign::Decimal,
            _ => return Err(invalid()),
        },
    })
}

/// The marker is the `.text-bullet` text before its no-break space; indent and level are the
/// paragraph's `data-bullet-*`.
fn bullet(dom: &Dom<'_>, paragraph: &Element<'_>, marker: &Element<'_>) -> Result<Bullet, String> {
    let style = Style::of(marker)?;
    allow(marker, &style, &[], &[BULLET_CSS])?;
    let text = dom.text_of(marker)?;
    let level = paragraph.attr("data-bullet-level")?.ok_or("attribute 'data-bullet-level' is missing")?;
    Ok(Bullet {
        marker: text
            .strip_suffix(MARKER_SPACE)
            .ok_or("span.text-bullet must end with a no-break space")?
            .to_owned(),
        indent: number_attr(paragraph, "data-bullet-indent")?,
        level: integer(&level).map_err(|e| format!("attribute 'data-bullet-level': {e}"))?,
    })
}

fn run(dom: &Dom<'_>, element: &Element<'_>) -> Result<Run, String> {
    if !matches!(element.name, "span" | "a") || !element.has_class("text-run") {
        return Err(format!("expected span.text-run or a.text-run, found <{}>", element.name));
    }
    let style = Style::of(element)?;
    allow(element, &style, &[RUN_ATTRS], &[RUN_CSS])?;
    let content = dom.text_of(element)?;
    let text = if element.has_attr("data-empty") {
        if content != EMPTY_RUN_TEXT {
            return Err("a run with data-empty must hold only U+200B".into());
        }
        String::new()
    } else {
        content
    };
    let lines = style.get("text-decoration-line").unwrap_or_default();
    if let Some(line) = lines.split_ascii_whitespace().find(|l| !matches!(*l, "underline" | "line-through")) {
        return Err(format!("CSS property 'text-decoration-line': '{line}' is not underline or line-through"));
    }
    let outline = match style.get("-webkit-text-stroke") {
        Some(stroke) => {
            let (width, color) = stroke
                .split_once(' ')
                .ok_or_else(|| format!("CSS property '-webkit-text-stroke': '{stroke}' is not '<width>px <color>'"))?;
            Some(Outline {
                width: px(width)?,
                color: color.trim_ascii().to_owned(),
            })
        }
        None => None,
    };
    let font_family = style.require("font-family")?;
    Ok(Run {
        text,
        font_face: first_family(font_family).map_err(|e| format!("CSS property 'font-family': {e}"))?,
        font_size: style.require_px("font-size")?,
        color: style.require("color")?.to_owned(),
        bold: one_of("CSS property 'font-weight'", style.require("font-weight")?, &["bold", "normal"])? == "bold",
        italic: one_of("CSS property 'font-style'", style.require("font-style")?, &["italic", "normal"])? == "italic",
        decoration: Decoration {
            underline: lines.split_ascii_whitespace().any(|l| l == "underline"),
            underline_color: style.get("text-decoration-color").map(str::to_owned),
            strike: lines.split_ascii_whitespace().any(|l| l == "line-through"),
            double_strike: element.has_attr("data-double-strike"),
        },
        // `top` is the negated offset, omitted at 0.
        baseline_offset: style.px("top")?.map_or(0.0, |top| -top),
        character_spacing: style.px("letter-spacing")?.unwrap_or(0.0),
        highlight: style.get("background-color").map(str::to_owned),
        outline,
        glow: glow(element, &style)?,
        link: link(element)?,
        soft_break_before: element.has_attr("data-soft-break-before"),
    })
}

/// The `text-shadow` entry that `data-text-shadow` names `glow`. The run's shadow entry is not
/// read: the renderer draws only the object's shadow (`model::Run`).
fn glow(element: &Element<'_>, style: &Style<'_>) -> Result<Option<Shadow>, String> {
    let entries = style.get("text-shadow").map(|s| split_top_level(s, ',')).unwrap_or_default();
    let names = element.attr("data-text-shadow")?.unwrap_or_default();
    let names: Vec<&str> = names.split_ascii_whitespace().collect();
    if names.len() != entries.len() || names.iter().any(|n| !matches!(*n, "glow" | "shadow")) {
        return Err(format!(
            "data-text-shadow '{}' must name each text-shadow entry 'glow' or 'shadow'",
            names.join(" ")
        ));
    }
    names
        .iter()
        .zip(entries)
        .find(|(name, _)| **name == "glow")
        .map(|(_, entry)| shadow(entry, false).map_err(|e| format!("CSS property 'text-shadow': {e}")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use crate::model::{SlideObject, TabAlign, TextObject};
    use crate::profile::parse;
    use crate::profile::tests::document;

    const RUN_STYLE: &str =
        "font-family: &quot;Calibri&quot;, Arial; font-size: 16px; color: #000000; font-weight: normal; font-style: normal; text-decoration-style: solid;";
    const PARAGRAPH_STYLE: &str = "text-align: left; direction: ltr; margin-top: 1px; margin-bottom: 2px; line-height: 19.2px; tab-size: 96px;";

    fn text_object(paragraphs: &str) -> Result<TextObject, String> {
        let html = document(&format!(
            r#"<div class="slide-element slide-text" data-object-name="T" data-text-fit="none" data-text-direction="horizontal" style="left: 0px; top: 0px; width: 100px; height: 50px; padding: 0px 0px 0px 0px; align-items: flex-end; white-space: pre-wrap; overflow-wrap: break-word; direction: ltr; border-radius: 0%;"><div class="text-content" style="width: 100%;">{paragraphs}</div></div>"#
        ));
        match parse(&html)?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Text(object)) => Ok(object),
            _ => Err("not a text object".into()),
        }
    }

    #[test]
    fn reads_paragraphs_bullets_and_runs() {
        let html = format!(
            r#"<div class="text-paragraph" data-line-baseline="16" data-tab-stops="96:left,192.5:decimal" data-bullet-level="1" data-bullet-type="number" data-bullet-indent="27" data-bullet-start="3" style="{PARAGRAPH_STYLE} padding-left: 13.5px; text-indent: 0px;"><span class="text-bullet" style="display: inline-block; width: 13.5px;">3.&nbsp;</span><span class="text-run" lang="en-US" data-vertical-align="super" data-text-shadow="glow shadow" data-double-strike="" data-underline-style="wavy" style="{RUN_STYLE} text-decoration-line: underline line-through; text-decoration-color: #00FF00; position: relative; top: -4.5px; letter-spacing: 1.5px; background-color: #FFFF00; -webkit-text-stroke: 0.75px rgba(1, 2, 3, 0.5); text-shadow: 0px 0px 6px rgba(255, 0, 0, 0.6), 2px 2px 3px #000000;">a &amp; b</span><br><a class="text-run" href="https://x.test/?a=1&amp;b=2" title="Tip" data-slide="2" data-soft-break-before="" style="{RUN_STYLE}">c</a><span class="text-run" data-empty="" style="{RUN_STYLE}">&#8203;</span></div>"#
        );
        let object = text_object(&html).unwrap();
        let text = object.text.expect("text");
        assert_eq!(text.vertical_align, "bottom");
        let [p] = &text.paragraphs[..] else { panic!("one paragraph") };
        assert_eq!(
            (p.line_box.height, p.line_box.baseline, p.space_before, p.space_after, p.default_tab_stop),
            (19.2, 16.0, 1.0, 2.0, 96.0)
        );
        assert_eq!(
            p.tab_stops.iter().map(|t| (t.position, t.alignment)).collect::<Vec<_>>(),
            [(96.0, TabAlign::Left), (192.5, TabAlign::Decimal)]
        );
        let bullet = p.bullet.as_ref().expect("bullet");
        assert_eq!((bullet.marker.as_str(), bullet.indent, bullet.level), ("3.", 27.0, 1));
        let [a, c, empty] = &p.runs[..] else { panic!("three runs") };
        assert_eq!(
            (a.text.as_str(), a.font_face.as_str(), a.baseline_offset, a.character_spacing),
            ("a & b", "Calibri", 4.5, 1.5)
        );
        assert!(a.decoration.underline && a.decoration.strike && a.decoration.double_strike);
        assert_eq!(
            (a.decoration.underline_color.as_deref(), a.highlight.as_deref()),
            (Some("#00FF00"), Some("#FFFF00"))
        );
        assert_eq!(a.outline.as_ref().map(|o| (o.width, o.color.as_str())), Some((0.75, "rgba(1, 2, 3, 0.5)")));
        let glow = a.glow.as_ref().expect("glow");
        assert_eq!((glow.blur, glow.color.as_str()), (6.0, "rgba(255, 0, 0, 0.6)"));
        assert!(c.soft_break_before && !a.soft_break_before);
        let link = c.link.as_ref().expect("link");
        assert_eq!(
            (link.href.as_str(), link.tooltip.as_deref(), link.slide),
            ("https://x.test/?a=1&b=2", Some("Tip"), Some(2))
        );
        assert_eq!(empty.text, "");
    }

    #[test]
    fn rejects_out_of_profile_text() {
        let run = |attrs: &str, style: &str, text: &str| {
            format!(
                r#"<div class="text-paragraph" data-line-baseline="16" style="{PARAGRAPH_STYLE}"><span class="text-run"{attrs} style="{RUN_STYLE}{style}">{text}</span></div>"#
            )
        };
        for (html, wants) in [
            (run("", " font-variant: small-caps;", "x"), "CSS property 'font-variant'"),
            // The line-box strut is the stylesheet's, not the profile's.
            (run("", " line-height: 0;", "x"), "CSS property 'line-height'"),
            (run(" data-empty=\"\"", "", "x"), "U+200B"),
            (run(" data-text-shadow=\"glow\"", "", "x"), "data-text-shadow"),
            (run("", " text-shadow: 1px 1px 1px red;", "x"), "data-text-shadow"),
            (run("", " text-decoration-line: overline;", "x"), "overline"),
            (run("", "", "<b>x</b>"), "unexpected <b>"),
            (run("", "", "a &copy; b"), "character reference"),
            (run(" onclick=\"x\"", "", "x"), "attribute 'onclick'"),
            (run("", " font-size: NaNpx;", "x").replace("font-size: 16px; ", ""), "font-size"),
            (run("", "", "x").replace("data-line-baseline=\"16\"", ""), "data-line-baseline"),
            (
                run("", "", "x").replace("data-line-baseline=\"16\"", "data-tab-stops=\"9:middle\" data-line-baseline=\"16\""),
                "data-tab-stops",
            ),
            (
                run("", "", "x").replace("data-line-baseline=\"16\"", "data-bullet-type=\"bullet\" data-line-baseline=\"16\""),
                "text-bullet",
            ),
            (run("", "", "x").replace("&quot;Calibri&quot;", "Calibri"), "font-family"),
            ("<div class=\"text-paragraph\">text</div>".into(), "unexpected text"),
        ] {
            let error = text_object(&html).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'T': ") && error.contains(wants), "{wants}: {error}");
        }
    }
}
