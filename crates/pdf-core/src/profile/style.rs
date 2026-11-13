//! An element's inline `style` declarations and the profile's value forms (numbers, px lengths,
//! shadows), read exactly as `render/css.ts` writes them.

use std::borrow::Cow;
use std::ops::Range;

use super::dom::Element;
use crate::model::Shadow;

/// The declarations of one `style` attribute, in source order.
pub(crate) struct Style<'a> {
    text: Cow<'a, str>,
    declarations: Vec<(Range<usize>, Range<usize>)>,
}

impl<'a> Style<'a> {
    /// Parses `element`'s `style` attribute; a property may appear once.
    pub(crate) fn of(element: &Element<'a>) -> Result<Self, String> {
        let text = element.attr("style")?.unwrap_or(Cow::Borrowed(""));
        let mut declarations: Vec<(Range<usize>, Range<usize>)> = Vec::new();
        let mut start = 0;
        for end in top_level(&text, ';').chain(std::iter::once(text.len())) {
            let declaration = text.get(start..end).ok_or("internal: declaration bounds")?;
            let offset = start;
            start = end + 1;
            if declaration.trim_ascii().is_empty() {
                continue;
            }
            let colon = declaration
                .find(':')
                .ok_or_else(|| format!("style: '{}' is not a 'property: value' declaration", declaration.trim_ascii()))?;
            let name = trimmed(declaration, 0..colon, offset);
            let value = trimmed(declaration, colon + 1..declaration.len(), offset);
            let (Some(property), Some(v)) = (text.get(name.clone()), text.get(value.clone())) else {
                return Err("internal: declaration bounds".into());
            };
            if property.is_empty() || v.is_empty() {
                return Err(format!("style: '{}' has no property or no value", declaration.trim_ascii()));
            }
            if declarations.iter().any(|(n, _)| text.get(n.clone()) == Some(property)) {
                return Err(format!("CSS property '{property}' is repeated"));
            }
            declarations.push((name, value));
        }
        Ok(Self { text, declarations })
    }

    pub(crate) fn properties(&self) -> impl Iterator<Item = &str> {
        self.declarations.iter().filter_map(|(name, _)| self.text.get(name.clone()))
    }

    pub(crate) fn get(&self, property: &str) -> Option<&str> {
        self.declarations
            .iter()
            .find(|(name, _)| self.text.get(name.clone()) == Some(property))
            .and_then(|(_, value)| self.text.get(value.clone()))
    }

    pub(crate) fn require(&self, property: &str) -> Result<&str, String> {
        self.get(property).ok_or_else(|| format!("CSS property '{property}' is missing"))
    }

    /// A px length property, if present.
    pub(crate) fn px(&self, property: &str) -> Result<Option<f32>, String> {
        self.get(property)
            .map(|v| px(v).map_err(|e| format!("CSS property '{property}': {e}")))
            .transpose()
    }

    pub(crate) fn require_px(&self, property: &str) -> Result<f32, String> {
        self.px(property)?.ok_or_else(|| format!("CSS property '{property}' is missing"))
    }
}

/// The byte range of `part` (relative to a declaration at `offset`) without surrounding whitespace.
fn trimmed(declaration: &str, part: Range<usize>, offset: usize) -> Range<usize> {
    let text = declaration.get(part.clone()).unwrap_or_default();
    let lead = text.len() - text.trim_ascii_start().len();
    let trail = text.len() - text.trim_ascii_end().len();
    offset + part.start + lead..offset + part.end.saturating_sub(trail).max(part.start + lead)
}

/// Byte offsets of `separator` outside quotes and parentheses (`font-family` strings and
/// `rgba(…)` hold `;` and `,`).
pub(crate) fn top_level(text: &str, separator: char) -> impl Iterator<Item = usize> + '_ {
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    text.char_indices().filter_map(move |(i, c)| {
        if let Some(q) = quote {
            match c {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                _ if c == q => quote = None,
                _ => {}
            }
            return None;
        }
        match c {
            '"' | '\'' => quote = Some(c),
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if c == separator && depth == 0 => return Some(i),
            _ => {}
        }
        None
    })
}

/// `text` split at top-level `separator`s, each part trimmed.
pub(crate) fn split_top_level(text: &str, separator: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for end in top_level(text, separator).chain(std::iter::once(text.len())) {
        parts.push(text.get(start..end).unwrap_or_default().trim_ascii());
        start = end + separator.len_utf8();
    }
    parts
}

/// A number as JavaScript's `String(number)` writes it, at full precision, in JSON number syntax.
/// Parsed to the f64 JavaScript held, then rounded to f32, as the removed JSON model reader did
/// (#69), so PDFs keep their bytes. Non-finite results are an error.
pub(crate) fn number(text: &str) -> Result<f32, String> {
    if !is_json_number(text) {
        return Err(format!("'{text}' is not a number"));
    }
    let value = text.parse::<f64>().map_err(|_| format!("'{text}' is not a number"))? as f32;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!("'{text}' is out of range"))
    }
}

/// `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`: what `str::parse` accepts beyond it (`+1`,
/// `.5`, `1.`, `01`, `inf`, `NaN`) is not something `String(number)` writes.
fn is_json_number(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut at = 0;
    let digits = |at: &mut usize| {
        let start = *at;
        while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
            *at += 1;
        }
        *at > start
    };
    if bytes.get(at) == Some(&b'-') {
        at += 1;
    }
    if bytes.get(at) == Some(&b'0') {
        at += 1;
    } else if !digits(&mut at) {
        return false;
    }
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        if !digits(&mut at) {
            return false;
        }
    }
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        at += 1;
        if matches!(bytes.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        if !digits(&mut at) {
            return false;
        }
    }
    at == bytes.len()
}

/// A non-negative integer (spans, slide numbers, levels).
pub(crate) fn integer(text: &str) -> Result<u32, String> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("'{text}' is not a whole number"));
    }
    text.parse().map_err(|_| format!("'{text}' is out of range"))
}

/// `<n>px`.
pub(crate) fn px(text: &str) -> Result<f32, String> {
    number(text.strip_suffix("px").ok_or_else(|| format!("'{text}' is not a px length"))?)
}

/// `<x>px <y>px <blur>px <color>`, the CSS shadow forms `render/style.ts` writes (`box-shadow`
/// without `inset`, `drop-shadow()`, a `text-shadow` entry).
pub(crate) fn shadow(text: &str, inset: bool) -> Result<Shadow, String> {
    let mut rest = text.trim_ascii();
    let mut lengths = [0.0f32; 3];
    for length in &mut lengths {
        let (head, tail) = rest
            .split_once(|c: char| c.is_ascii_whitespace())
            .ok_or_else(|| format!("shadow '{text}' is not '<x>px <y>px <blur>px <color>'"))?;
        *length = px(head)?;
        rest = tail.trim_ascii_start();
    }
    let [offset_x, offset_y, blur] = lengths;
    Ok(Shadow {
        visible: true,
        color: rest.to_owned(),
        blur,
        offset_x,
        offset_y,
        inset,
    })
}

/// The first family of a `font-family` list: a CSS string with `\\` and `\"` escapes.
pub(crate) fn first_family(text: &str) -> Result<String, String> {
    let invalid = || format!("font-family '{text}' does not start with a quoted family");
    let mut chars = text.strip_prefix('"').ok_or_else(invalid)?.chars();
    let mut family = String::new();
    loop {
        match chars.next().ok_or_else(invalid)? {
            '"' => break,
            '\\' => family.push(chars.next().ok_or_else(invalid)?),
            c => family.push(c),
        }
    }
    let rest = chars.as_str().trim_ascii_start();
    if rest.is_empty() || rest.starts_with(',') {
        Ok(family)
    } else {
        Err(invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::dom;

    fn style_of(attr: &str) -> Result<Vec<(String, String)>, String> {
        let html = format!("<div style=\"{attr}\"></div>");
        let dom = dom::parse(&html)?;
        let elements = dom.elements_of(&dom.children)?;
        let element = elements.first().ok_or("no element")?;
        let style = Style::of(element)?;
        Ok(style
            .properties()
            .map(|p| (p.to_owned(), style.get(p).unwrap_or_default().to_owned()))
            .collect())
    }

    #[test]
    fn reads_declarations_in_order_with_quoted_and_nested_values() {
        let got = style_of("font-family: &quot;a;b&quot;, Arial; color: rgba(1, 2, 3, 0.5);  top:-1.5px ;").unwrap();
        let want = [("font-family", "\"a;b\", Arial"), ("color", "rgba(1, 2, 3, 0.5)"), ("top", "-1.5px")];
        assert_eq!(got, want.map(|(a, b)| (a.to_owned(), b.to_owned())));
    }

    #[test]
    fn rejects_malformed_and_repeated_declarations() {
        for bad in ["color", "color:", ": red", "color: red; color: blue", "top: 1px; &bogus;"] {
            assert!(style_of(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn parses_numbers_exactly_and_rejects_non_numbers() {
        // As JavaScript holds it: to f64, then to f32.
        assert_eq!(px("110.39999999999999px").unwrap(), 110.399_999_999_999_99_f64 as f32);
        assert_eq!(number("1e-7").unwrap(), 1e-7);
        assert_eq!(number("-0").unwrap(), 0.0);
        for bad in [
            "NaN", "Infinity", "inf", "1e999", "1e39", " 1", "1 ", "", ".5", "1.", "0x10", "1px", "--1", "+1", "01", "1e", "1e+", "-",
        ] {
            assert!(number(bad).is_err(), "{bad}");
        }
        assert!(px("12").is_err() && px("12em").is_err());
        assert_eq!(integer("42").unwrap(), 42);
        for bad in ["-1", "1.0", "", "99999999999", "+1"] {
            assert!(integer(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_shadows_and_font_families() {
        let s = shadow("3px -2.5px 4px rgba(0, 0, 0, 0.35)", true).unwrap();
        assert_eq!(
            (s.offset_x, s.offset_y, s.blur, s.color.as_str(), s.inset),
            (3.0, -2.5, 4.0, "rgba(0, 0, 0, 0.35)", true)
        );
        assert!(shadow("3px 4px rgba(0,0,0,1)", false).is_err());
        assert_eq!(first_family(r#""Calibri", "Noto Sans", Arial"#).unwrap(), "Calibri");
        assert_eq!(first_family(r#""a\"b\\c""#).unwrap(), r#"a"b\c"#);
        for bad in ["Arial", r#""open"#, r#""a" b"#, r#""a\"#] {
            assert!(first_family(bad).is_err(), "{bad}");
        }
        assert_eq!(
            split_top_level("1px 1px 1px rgba(0, 0, 0, 1), 0px 0px 2px #FFF", ','),
            ["1px 1px 1px rgba(0, 0, 0, 1)", "0px 0px 2px #FFF"]
        );
    }
}
