//! Text boxes, paragraphs, bullets and runs (`render/text.ts`), for text objects and table cells.

use super::allow;

use super::dom::{Dom, Element, Node, decode};
use super::object::link;
use super::style::{Style, font_families, integer, keyword, number, px, shadow, split_top_level};
use crate::color::parse_color;
use crate::model::{
    Bullet, Decoration, LineBox, Outline, Paragraph, ParagraphAlign, Run, Shadow, ShadowKind, Shrink, Synthesis, TabAlign, TabStop, TextBox, TextDirection,
    TextFit, UnderlineStyle, VerticalAlign, WordSpacing,
};

/// Attributes of the element that holds a text box.
pub(crate) const BOX_ATTRS: &[&str] = &[
    "data-text-fit",
    "data-text-fit-step",
    "data-text-fit-max-steps",
    "data-text-fit-tolerance",
    "data-text-direction",
];
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
    "data-mark-baseline",
    "data-break-baseline",
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
    "text-justify",
    "direction",
    "margin-top",
    "margin-bottom",
    "line-height",
    "tab-size",
    "padding-left",
    "text-indent",
];
/// U+002D, which the face has, then U+2060 WORD JOINER: a U+2011 in a run with `data-non-breaking-hyphen`.
const HYPHEN_MINUS_NO_BREAK: &str = "-\u{2060}";
const BULLET_CSS: &[&str] = &["display", "width", "font-family", "font-size", "color"];
const RUN_ATTRS: &[&str] = &[
    "lang",
    "href",
    "title",
    "data-slide",
    "data-double-strike",
    "data-underline-style",
    "data-underline-heavy",
    "data-vertical-align",
    "data-synthetic-bold",
    "data-synthetic-italic",
    "data-non-breaking-hyphen",
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
    "text-decoration-thickness",
    "text-underline-position",
    "text-decoration-skip-ink",
    "position",
    "top",
    "letter-spacing",
    "font-kerning",
    "background-color",
    "-webkit-text-stroke",
    "text-shadow",
];
/// The only value each underline geometry property takes: the one `draw_decorations` draws.
const UNDERLINE_FROM_FONT: [(&str, &str); 3] = [
    ("text-decoration-thickness", "from-font"),
    ("text-underline-position", "from-font"),
    ("text-decoration-skip-ink", "none"),
];
/// CSS of a word span inside a run (`wordCharacterSpacing`).
const WORD_CSS: &[&str] = &["letter-spacing"];
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
    let vertical_align = keyword(
        "CSS property 'align-items'",
        style.require("align-items")?,
        &[
            ("flex-start", VerticalAlign::Top),
            ("center", VerticalAlign::Middle),
            ("flex-end", VerticalAlign::Bottom),
        ],
    )?;
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
        vertical_align,
        wrap,
        fit: match &*fit {
            "shrink" => TextFit::Shrink(shrink(element)?),
            _ => keyword("attribute 'data-text-fit'", &fit, &[("none", TextFit::None), ("resize", TextFit::Resize)])?,
        },
        direction: keyword(
            "attribute 'data-text-direction'",
            &direction,
            &[
                ("horizontal", TextDirection::Horizontal),
                ("vertical", TextDirection::Vertical),
                ("vertical270", TextDirection::Vertical270),
                ("stacked", TextDirection::Stacked),
            ],
        )?,
    })
}

/// The rule of a `data-text-fit="shrink"` box: its three required `data-text-fit-*` attributes.
fn shrink(element: &Element<'_>) -> Result<Shrink, String> {
    let step = number_attr(element, "data-text-fit-step")?;
    if !(step > 0.0 && step < 1.0) {
        return Err(format!("attribute 'data-text-fit-step': '{step}' is not between 0 and 1"));
    }
    let max_steps = element
        .attr("data-text-fit-max-steps")?
        .ok_or("attribute 'data-text-fit-max-steps' is missing")?;
    let max_steps = integer(&max_steps).map_err(|e| format!("attribute 'data-text-fit-max-steps': {e}"))?;
    let tolerance = number_attr(element, "data-text-fit-tolerance")?;
    if tolerance < 0.0 {
        return Err(format!("attribute 'data-text-fit-tolerance': '{tolerance}' is negative"));
    }
    Ok(Shrink { step, max_steps, tolerance })
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
    // The layout justifies a line at its spaces only, which is `inter-word`.
    // shortcut: `auto` (absent) is drawn as `inter-word` too, where Chromium also widens Han characters; draw it so
    // when a target that needs it renders through this crate.
    if let Some(justify) = style.get("text-justify") {
        one_of("CSS property 'text-justify'", justify, &["inter-word"])?;
    }
    let baseline = number_attr(element, "data-line-baseline")?;
    let line_baseline = |name: &str| match element.attr(name)? {
        Some(value) => number(&value).map_err(|e| format!("attribute '{name}': {e}")),
        None => Ok(baseline),
    };
    Ok(Paragraph {
        runs,
        align: keyword(
            "CSS property 'text-align'",
            style.require("text-align")?,
            &[
                ("left", ParagraphAlign::Left),
                ("center", ParagraphAlign::Center),
                ("right", ParagraphAlign::Right),
                ("justify", ParagraphAlign::Justify),
            ],
        )?,
        rtl: one_of("CSS property 'direction'", style.require("direction")?, &["ltr", "rtl"])? == "rtl",
        line_box: LineBox {
            height: style.require_px("line-height")?,
            baseline,
            mark_baseline: line_baseline("data-mark-baseline")?,
            break_baseline: line_baseline("data-break-baseline")?,
        },
        space_before: style.require_px("margin-top")?,
        space_after: style.require_px("margin-bottom")?,
        tab_stops,
        default_tab_stop: style.require_px("tab-size")?,
        bullet,
    })
}

/// The run's `text-decoration-style` (solid when omitted), or `data-underline-style` when a double strike
/// took the CSS property.
fn underline_style(element: &Element<'_>, style: &Style<'_>) -> Result<UnderlineStyle, String> {
    let attr = element.attr("data-underline-style")?;
    let (what, value) = match attr.as_deref() {
        Some(value) => ("attribute 'data-underline-style'", value),
        None => ("CSS property 'text-decoration-style'", style.get("text-decoration-style").unwrap_or("solid")),
    };
    keyword(
        what,
        value,
        &[
            ("solid", UnderlineStyle::Solid),
            ("double", UnderlineStyle::Double),
            ("dotted", UnderlineStyle::Dotted),
            ("dashed", UnderlineStyle::Dashed),
            ("wavy", UnderlineStyle::Wavy),
        ],
    )
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
    // A copy of the first run's face: checked like the run's, not read.
    if let Some(family) = style.get("font-family") {
        font_families(family).map_err(|e| format!("span.text-bullet: CSS property 'font-family': {e}"))?;
    }
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
    // U+2011 drawn with the face's U+002D glyph: parley picks a face by the character, so it would draw U+2011 in a
    // fallback face where the run's face lacks it. The word joiner keeps its no-break.
    let hyphen_minus = match element.attr("data-non-breaking-hyphen")?.as_deref() {
        None => false,
        Some("hyphen-minus") => true,
        Some(other) => return Err(format!("attribute 'data-non-breaking-hyphen': '{other}' is not hyphen-minus")),
    };
    let (content, word_spacing) = run_text(dom, element, hyphen_minus)?;
    let mut families = font_families(style.require("font-family")?)
        .map_err(|e| format!("CSS property 'font-family': {e}"))?
        .into_iter();
    let font_face = families.next().ok_or("CSS property 'font-family' names no family")?;
    let text = if element.has_attr("data-empty") {
        if content != EMPTY_RUN_TEXT || !word_spacing.is_empty() {
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
    // The underline is always drawn from the face's post table, over the descenders; these say so for Chromium.
    for (property, value) in UNDERLINE_FROM_FONT {
        if let Some(given) = style.get(property) {
            one_of(&format!("CSS property '{property}'"), given, &[value])?;
        }
    }
    let underline_from_font = style.get("text-decoration-thickness").is_some();
    let underline_heavy = element.has_attr("data-underline-heavy");
    if underline_heavy && !underline_from_font {
        return Err(
            "attribute 'data-underline-heavy' needs 'text-decoration-thickness: from-font': the heavy band is PowerPoint's, around the face's post band".into(),
        );
    }
    let outline = match style.get("-webkit-text-stroke") {
        Some(stroke) => {
            let (width, color) = stroke
                .split_once(' ')
                .ok_or_else(|| format!("CSS property '-webkit-text-stroke': '{stroke}' is not '<width>px <color>'"))?;
            Some(Outline {
                width: px(width)?,
                color: parse_color(color).map_err(|e| format!("CSS property '-webkit-text-stroke': {e}"))?,
            })
        }
        None => None,
    };
    Ok(Run {
        text,
        font_face,
        fallback_faces: families.collect(),
        language: element.attr("lang")?.map(String::from),
        font_size: style.require_px("font-size")?,
        color: style.require_color("color")?,
        bold: one_of("CSS property 'font-weight'", style.require("font-weight")?, &["bold", "normal"])? == "bold",
        italic: one_of("CSS property 'font-style'", style.require("font-style")?, &["italic", "normal"])? == "italic",
        decoration: Decoration {
            underline: lines.split_ascii_whitespace().any(|l| l == "underline"),
            underline_style: underline_style(element, &style)?,
            underline_color: style.color("text-decoration-color")?,
            underline_from_font,
            underline_heavy,
            strike: lines.split_ascii_whitespace().any(|l| l == "line-through"),
            double_strike: element.has_attr("data-double-strike"),
        },
        // `top` is the negated offset, omitted at 0.
        baseline_offset: style.px("top")?.map_or(0.0, |top| -top),
        character_spacing: style.px("letter-spacing")?.unwrap_or(0.0),
        word_spacing,
        // Omitted when kerned; the profile writes only `none`, CSS's other keywords kern.
        kerning: style
            .get("font-kerning")
            .map(|k| one_of("CSS property 'font-kerning'", k, &["none", "normal", "auto"]))
            .transpose()?
            != Some("none"),
        synthesis: synthesis(element)?,
        highlight: style.color("background-color")?,
        outline,
        glow: glow(element, &style)?,
        link: link(element)?,
        soft_break_before: element.has_attr("data-soft-break-before"),
    })
}

/// A run's text and the byte range of each word wrapped in a `<span>` of its own `letter-spacing`
/// (`wordCharacterSpacing`), with that spacing. A word span holds text only and has no other attribute or CSS.
fn run_text(dom: &Dom<'_>, run: &Element<'_>, hyphen_minus: bool) -> Result<(String, Vec<WordSpacing>), String> {
    let mut text = String::new();
    let mut words = Vec::new();
    let push = |text: &mut String, piece: &str| match hyphen_minus {
        true => text.push_str(&piece.replace('\u{2011}', HYPHEN_MINUS_NO_BREAK)),
        false => text.push_str(piece),
    };
    for node in &run.children {
        match *node {
            Node::Text(id) => push(&mut text, &decode(dom.raw_text(id)?)?),
            Node::Element(id) => {
                let word = dom.element(id)?;
                if word.name != "span" {
                    return Err(format!("unexpected <{}> inside <{}>: a run holds text and word spans", word.name, run.name));
                }
                let style = Style::of(word)?;
                allow(word, &style, &[], &[WORD_CSS]).map_err(|e| format!("word span: {e}"))?;
                if word.has_attr("class") {
                    return Err("word span: attribute 'class' is not in the profile; a word span has only a letter-spacing style".into());
                }
                let spacing = style.px("letter-spacing")?.ok_or("word span: CSS property 'letter-spacing' is missing")?;
                let start = text.len();
                push(&mut text, &dom.text_of(word).map_err(|e| format!("word span: {e}"))?);
                words.push((start..text.len(), spacing));
            }
        }
    }
    Ok((text, words))
}

/// `data-synthetic-bold` and `data-synthetic-italic`, each the browser's when omitted.
fn synthesis(element: &Element<'_>) -> Result<Synthesis, String> {
    let attr = |name: &str| -> Result<Option<f32>, String> {
        element
            .attr(name)?
            .map(|v| number(&v).map_err(|e| format!("attribute '{name}': {e}")))
            .transpose()
    };
    let browser = Synthesis::default();
    let bold_stroke_em = attr("data-synthetic-bold")?.unwrap_or(browser.bold_stroke_em);
    if bold_stroke_em < 0.0 {
        return Err(format!("attribute 'data-synthetic-bold': {bold_stroke_em} is negative"));
    }
    Ok(Synthesis {
        bold_stroke_em,
        italic_shear: attr("data-synthetic-italic")?.unwrap_or(browser.italic_shear),
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
        .map(|(_, entry)| shadow(entry, ShadowKind::Outer).map_err(|e| format!("CSS property 'text-shadow': {e}")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use crate::color::Rgba;
    use crate::model::{ParagraphAlign, Shrink, SlideObject, Synthesis, TabAlign, TextFit, TextObject, UnderlineStyle, VerticalAlign};
    use crate::profile::parse;
    use crate::profile::tests::document;

    const RUN_STYLE: &str =
        "font-family: &quot;Calibri&quot;; font-size: 16px; color: #000000; font-weight: normal; font-style: normal; text-decoration-style: solid;";
    const PARAGRAPH_STYLE: &str = "text-align: left; direction: ltr; margin-top: 1px; margin-bottom: 2px; line-height: 19.2px; tab-size: 96px;";

    fn text_object(paragraphs: &str) -> Result<TextObject, String> {
        fitted_object(r#"data-text-fit="none""#, paragraphs)
    }

    fn fitted_object(fit: &str, paragraphs: &str) -> Result<TextObject, String> {
        let html = document(&format!(
            r#"<div class="slide-element slide-text" data-object-name="T" {fit} data-text-direction="horizontal" style="left: 0px; top: 0px; width: 100px; height: 50px; padding: 0px 0px 0px 0px; align-items: flex-end; white-space: pre-wrap; overflow-wrap: break-word; direction: ltr; border-radius: 0%;"><div class="text-content" style="width: 100%;">{paragraphs}</div></div>"#
        ));
        match parse(&html)?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Text(object)) => Ok(object),
            _ => Err("not a text object".into()),
        }
    }

    #[test]
    fn reads_paragraphs_bullets_and_runs() {
        let html = format!(
            r#"<div class="text-paragraph" data-line-baseline="16" data-tab-stops="96:left,192.5:decimal" data-bullet-level="1" data-bullet-type="number" data-bullet-indent="27" data-bullet-start="3" style="{PARAGRAPH_STYLE} padding-left: 13.5px; text-indent: 0px;"><span class="text-bullet" style="display: inline-block; width: 13.5px;">3.&nbsp;</span><span class="text-run" lang="en-US" data-vertical-align="super" data-text-shadow="glow shadow" data-double-strike="" data-underline-style="wavy" data-underline-heavy="" style="{RUN_STYLE} text-decoration-line: underline line-through; text-decoration-color: #00FF00; text-decoration-thickness: from-font; text-underline-position: from-font; text-decoration-skip-ink: none; position: relative; top: -4.5px; letter-spacing: 1.5px; font-kerning: none; background-color: #FFFF00; -webkit-text-stroke: 0.75px rgba(1, 2, 3, 0.5); text-shadow: 0px 0px 6px rgba(255, 0, 0, 0.6), 2px 2px 3px #000000;">a &amp; b</span><br><a class="text-run" href="https://x.test/?a=1&amp;b=2" title="Tip" data-slide="2" data-soft-break-before="" style="{RUN_STYLE}">c</a><span class="text-run" data-empty="" style="{RUN_STYLE}">&#8203;</span></div>"#
        );
        let object = text_object(&html).unwrap();
        let text = object.text.expect("text");
        assert_eq!(text.vertical_align, VerticalAlign::Bottom);
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
        assert!(a.decoration.underline_from_font && a.decoration.underline_heavy);
        // The double strike took text-decoration-style; the underline keeps data-underline-style.
        assert_eq!(
            (a.decoration.underline_style, c.decoration.underline_style),
            (UnderlineStyle::Wavy, UnderlineStyle::Solid)
        );
        assert_eq!(
            (a.decoration.underline_color, a.highlight),
            (Some(Rgba(0, 255, 0, 1.0)), Some(Rgba(255, 255, 0, 1.0)))
        );
        assert_eq!(a.outline.as_ref().map(|o| (o.width, o.color)), Some((0.75, Rgba(1, 2, 3, 0.5))));
        let glow = a.glow.as_ref().expect("glow");
        assert_eq!((glow.blur, glow.color), (6.0, Rgba(255, 0, 0, 0.6)));
        assert!(c.soft_break_before && !a.soft_break_before);
        assert!(!a.kerning && c.kerning, "font-kerning: none turns kerning off; omitted, the run is kerned");
        let link = c.link.as_ref().expect("link");
        assert_eq!(
            (link.href.as_str(), link.tooltip.as_deref(), link.slide),
            ("https://x.test/?a=1&b=2", Some("Tip"), Some(2))
        );
        assert_eq!(empty.text, "");
    }

    #[test]
    fn reads_the_mark_and_break_baselines_or_falls_back_to_the_line_baseline() {
        let line_box = |attrs: &str| {
            let html = format!(r#"<div class="text-paragraph" data-line-baseline="16"{attrs} style="{PARAGRAPH_STYLE}"></div>"#);
            text_object(&html).map(|o| {
                o.text
                    .and_then(|t| t.paragraphs.first().map(|p| (p.line_box.mark_baseline, p.line_box.break_baseline)))
            })
        };
        assert_eq!(line_box(r#" data-mark-baseline="15.5" data-break-baseline="15.75""#), Ok(Some((15.5, 15.75))));
        assert_eq!(line_box(""), Ok(Some((16.0, 16.0))));
        let error = line_box(r#" data-mark-baseline="high""#).err().unwrap_or_default();
        assert!(error.contains("attribute 'data-mark-baseline'"), "{error}");
    }

    #[test]
    fn reads_each_underline_style() {
        for (css, wants) in [
            ("solid", UnderlineStyle::Solid),
            ("double", UnderlineStyle::Double),
            ("dotted", UnderlineStyle::Dotted),
            ("dashed", UnderlineStyle::Dashed),
            ("wavy", UnderlineStyle::Wavy),
        ] {
            let style = RUN_STYLE.replace("text-decoration-style: solid", &format!("text-decoration-style: {css}"));
            let html = format!(
                r#"<div class="text-paragraph" data-line-baseline="16" style="{PARAGRAPH_STYLE}"><span class="text-run" style="{style} text-decoration-line: underline;">x</span></div>"#
            );
            let text = text_object(&html).unwrap().text.expect("text");
            let style = text.paragraphs.first().and_then(|p| p.runs.first()).map(|r| r.decoration.underline_style);
            assert_eq!(style, Some(wants), "{css}");
        }
    }

    #[test]
    fn reads_the_fallback_faces_and_draws_u2011_as_hyphen_minus() {
        let style = RUN_STYLE.replace("&quot;Calibri&quot;", "&quot;Calibri&quot;, &quot;Arial&quot;, &quot;Cambria Math&quot;");
        let html = format!(
            r#"<div class="text-paragraph" data-line-baseline="16" style="{PARAGRAPH_STYLE}"><span class="text-run" data-non-breaking-hyphen="hyphen-minus" style="{style}">a&#8209;b <span style="letter-spacing: 1px;">c‑d</span></span><span class="text-run" style="{RUN_STYLE}">e‑f</span></div>"#
        );
        let text = text_object(&html).unwrap().text.expect("text");
        let [a, b] = &text.paragraphs[0].runs[..] else { panic!("two runs") };
        assert_eq!(
            (a.font_face.as_str(), &a.fallback_faces[..]),
            ("Calibri", &["Arial".to_string(), "Cambria Math".to_string()][..])
        );
        // The word span's range covers its text as drawn.
        assert_eq!(a.text, "a-\u{2060}b c-\u{2060}d");
        assert_eq!(a.word_spacing, [(7..13, 1.0)]);
        assert_eq!((b.text.as_str(), b.fallback_faces.is_empty()), ("e\u{2011}f", true));
    }

    #[test]
    fn reads_the_synthetic_styles_and_falls_back_to_the_browsers() {
        let html = format!(
            r#"<div class="text-paragraph" data-line-baseline="16" style="{PARAGRAPH_STYLE}"><span class="text-run" data-synthetic-bold="0.03333333333333333" data-synthetic-italic="0.3462535606" style="{RUN_STYLE}">a</span><span class="text-run" style="{RUN_STYLE}">b</span></div>"#
        );
        let text = text_object(&html).unwrap().text.expect("text");
        let synthesis: Vec<Synthesis> = text.paragraphs.iter().flat_map(|p| &p.runs).map(|r| r.synthesis).collect();
        let libreoffice = Synthesis {
            bold_stroke_em: 1.0 / 30.0,
            italic_shear: 0.346_253_56,
        };
        // Omitted, the run takes Chromium's: a 1/32 em stroke and a 0.25 shear.
        let chromium = Synthesis {
            bold_stroke_em: 1.0 / 32.0,
            italic_shear: 0.25,
        };
        assert_eq!(synthesis, [libreoffice, chromium]);
        assert_eq!(Synthesis::default(), chromium);
    }

    #[test]
    fn reads_each_word_span_as_a_byte_range_of_the_run_with_its_letter_spacing() {
        let html = format!(
            r#"<div class="text-paragraph" data-line-baseline="16" style="{PARAGRAPH_STYLE}"><span class="text-run" style="{RUN_STYLE} letter-spacing: 0.5px;"> <span style="letter-spacing: 1.25px;">a&amp;b</span>	 <span style="letter-spacing: -0.75px;">çd</span></span></div>"#
        );
        let text = text_object(&html).unwrap().text.expect("text");
        let run = text.paragraphs.first().and_then(|p| p.runs.first()).expect("run");
        assert_eq!((run.text.as_str(), run.character_spacing), (" a&b\t çd", 0.5));
        assert_eq!(run.word_spacing, [(1..4, 1.25), (6..9, -0.75)]);
    }

    #[test]
    fn reads_inter_word_justification() {
        let style = PARAGRAPH_STYLE.replace("text-align: left;", "text-align: justify; text-justify: inter-word;");
        let html = format!(r#"<div class="text-paragraph" data-line-baseline="16" style="{style}"><span class="text-run" style="{RUN_STYLE}">x</span></div>"#);
        let text = text_object(&html).unwrap().text.expect("text");
        assert!(matches!(text.paragraphs[..], [ref p] if p.align == ParagraphAlign::Justify));
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
            (run("", " font-kerning: off;", "x"), "font-kerning"),
            (
                run("", " text-decoration-thickness: 2px;", "x"),
                "CSS property 'text-decoration-thickness': '2px'",
            ),
            (
                run("", " text-underline-position: under;", "x"),
                "CSS property 'text-underline-position': 'under'",
            ),
            (
                run("", " text-decoration-skip-ink: auto;", "x"),
                "CSS property 'text-decoration-skip-ink': 'auto'",
            ),
            (
                run("", "", "x").replace("text-align: left;", "text-align: justify; text-justify: auto;"),
                "CSS property 'text-justify': 'auto'",
            ),
            (
                run(" data-synthetic-bold=\"-0.1\"", "", "x"),
                "attribute 'data-synthetic-bold': -0.1 is negative",
            ),
            (run(" data-synthetic-italic=\"slanted\"", "", "x"), "attribute 'data-synthetic-italic'"),
            (
                run(" data-underline-heavy=\"\"", " text-decoration-line: underline;", "x"),
                "attribute 'data-underline-heavy' needs 'text-decoration-thickness: from-font'",
            ),
            (
                run(" data-non-breaking-hyphen=\"en-dash\"", "", "x"),
                "attribute 'data-non-breaking-hyphen': 'en-dash' is not hyphen-minus",
            ),
            (
                run("", "", "x").replace("text-decoration-style: solid", "text-decoration-style: groove"),
                "CSS property 'text-decoration-style': 'groove'",
            ),
            (run(" data-underline-style=\"thick\"", "", "x"), "attribute 'data-underline-style': 'thick'"),
            (run("", "", "<b>x</b>"), "unexpected <b>"),
            (run("", "", "<span>x</span>"), "word span: CSS property 'letter-spacing' is missing"),
            (run("", "", r#"<span style="letter-spacing: 1px; color: red;">x</span>"#), "word span: "),
            (
                run("", "", r#"<span class="w" style="letter-spacing: 1px;">x</span>"#),
                "word span: attribute 'class'",
            ),
            (run("", "", r#"<span style="letter-spacing: 1px;"><b>x</b></span>"#), "word span: "),
            (run(" data-empty=\"\"", "", r#"<span style="letter-spacing: 1px;">&#8203;</span>"#), "U+200B"),
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
            (
                run("", "", "x").replace("&quot;Calibri&quot;", "&quot;Calibri&quot;, Arial"),
                "not a list of quoted families",
            ),
            ("<div class=\"text-paragraph\">text</div>".into(), "unexpected text"),
        ] {
            let error = text_object(&html).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'T': ") && error.contains(wants), "{wants}: {error}");
        }
    }

    #[test]
    fn reads_the_shrink_rule_and_rejects_a_missing_or_invalid_one() {
        let shrink = |attrs: &str| fitted_object(&format!(r#"data-text-fit="shrink"{attrs}"#), "");
        let text = shrink(r#" data-text-fit-step="0.9" data-text-fit-max-steps="7" data-text-fit-tolerance="0.25""#)
            .unwrap()
            .text
            .expect("text");
        assert_eq!(
            text.fit,
            TextFit::Shrink(Shrink {
                step: 0.9,
                max_steps: 7,
                tolerance: 0.25
            })
        );
        for (attrs, wants) in [
            (
                r#" data-text-fit-max-steps="7" data-text-fit-tolerance="0.25""#,
                "attribute 'data-text-fit-step' is missing",
            ),
            (
                r#" data-text-fit-step="1" data-text-fit-max-steps="7" data-text-fit-tolerance="0.25""#,
                "'1' is not between 0 and 1",
            ),
            (
                r#" data-text-fit-step="0.9" data-text-fit-tolerance="0.25""#,
                "attribute 'data-text-fit-max-steps' is missing",
            ),
            (
                r#" data-text-fit-step="0.9" data-text-fit-max-steps="2.5" data-text-fit-tolerance="0.25""#,
                "'2.5' is not a whole number",
            ),
            (
                r#" data-text-fit-step="0.9" data-text-fit-max-steps="7""#,
                "attribute 'data-text-fit-tolerance' is missing",
            ),
            (
                r#" data-text-fit-step="0.9" data-text-fit-max-steps="7" data-text-fit-tolerance="-1""#,
                "'-1' is negative",
            ),
        ] {
            let error = shrink(attrs).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'T': ") && error.contains(wants), "{wants}: {error}");
        }
    }
}
