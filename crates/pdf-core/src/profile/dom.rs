//! The element tree of a profile document: a small strict tokenizer for the markup `toHtml()`
//! serializes (`outerHTML`), not a general HTML parser.
//!
//! It accepts what the HTML serializer writes and fails on anything a browser would have to repair:
//! end tags must close the open element, every element is closed, `/>` only ends void and SVG
//! elements, attributes are not repeated and character references are the ones the serializer
//! emits plus numeric ones. Text and attribute values stay borrowed and undecoded until a reader
//! asks for them, so opaque subtrees (charts, components) are only scanned for their end.

use std::borrow::Cow;

/// Attribute names and raw (undecoded) values, in source order.
type Attrs<'a> = Vec<(&'a str, &'a str)>;

/// HTML elements without content or end tag.
const VOID_ELEMENTS: [&str; 13] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
];
/// Elements whose content is text up to their end tag (raw text and escapable raw text).
const RAW_TEXT_ELEMENTS: [&str; 9] = ["style", "script", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"];
/// Longest character reference name read before the `;` (`&#x10FFFF;` is 9 bytes after `&`).
const MAX_REFERENCE_LEN: usize = 10;

pub(crate) struct Element<'a> {
    pub(crate) name: &'a str,
    /// Names and raw (undecoded) values, in source order.
    attrs: Attrs<'a>,
    pub(crate) children: Vec<Node>,
}

#[derive(Clone, Copy)]
pub(crate) enum Node {
    /// Index into `Dom::elements`.
    Element(usize),
    /// Index into `Dom::texts`.
    Text(usize),
}

/// The parsed document. `children` are the top-level nodes (the doctype is dropped).
pub(crate) struct Dom<'a> {
    elements: Vec<Element<'a>>,
    texts: Vec<&'a str>,
    pub(crate) children: Vec<Node>,
}

impl<'a> Element<'a> {
    pub(crate) fn attrs(&self) -> impl Iterator<Item = &'a str> + '_ {
        self.attrs.iter().map(|(name, _)| *name)
    }

    /// The decoded value of attribute `name`.
    pub(crate) fn attr(&self, name: &str) -> Result<Option<Cow<'a, str>>, String> {
        self.attrs
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, raw)| decode(raw).map_err(|e| format!("attribute '{name}': {e}")))
            .transpose()
    }

    pub(crate) fn has_attr(&self, name: &str) -> bool {
        self.attrs.iter().any(|(n, _)| *n == name)
    }

    /// Whether the `class` attribute lists `class`.
    pub(crate) fn has_class(&self, class: &str) -> bool {
        self.attrs
            .iter()
            .find(|(n, _)| *n == "class")
            .is_some_and(|(_, value)| value.split_ascii_whitespace().any(|c| c == class))
    }
}

impl<'a> Dom<'a> {
    pub(crate) fn element(&self, id: usize) -> Result<&Element<'a>, String> {
        self.elements.get(id).ok_or_else(|| format!("internal: no element #{id}"))
    }

    /// The raw text of a text node.
    pub(crate) fn raw_text(&self, id: usize) -> Result<&'a str, String> {
        self.texts.get(id).copied().ok_or_else(|| format!("internal: no text #{id}"))
    }

    /// The element children of `nodes`; whitespace-only text between them is formatting and is
    /// skipped, any other text is an error.
    pub(crate) fn elements_of(&self, nodes: &[Node]) -> Result<Vec<&Element<'a>>, String> {
        let mut out = Vec::with_capacity(nodes.len());
        for node in nodes {
            match *node {
                Node::Element(id) => out.push(self.element(id)?),
                Node::Text(id) => {
                    let text = self.raw_text(id)?;
                    if !text.trim_ascii().is_empty() {
                        return Err(format!("unexpected text '{}'", preview(text)));
                    }
                }
            }
        }
        Ok(out)
    }

    /// The decoded text of an element that holds only text.
    pub(crate) fn text_of(&self, element: &Element<'a>) -> Result<String, String> {
        let mut out = String::new();
        for node in &element.children {
            match *node {
                Node::Text(id) => out += &decode(self.raw_text(id)?)?,
                Node::Element(id) => return Err(format!("unexpected <{}> inside <{}>", self.element(id)?.name, element.name)),
            }
        }
        Ok(out)
    }
}

/// The first characters of `text`, for error messages.
pub(crate) fn preview(text: &str) -> String {
    const PREVIEW_CHARS: usize = 40;
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(PREVIEW_CHARS).collect();
    if chars.next().is_some() { format!("{head}…") } else { head }
}

/// Decodes the character references the HTML serializer writes (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
/// `&nbsp;`), `&apos;` and numeric ones. Any other `&` is an error.
pub(crate) fn decode(raw: &str) -> Result<Cow<'_, str>, String> {
    let Some(first) = raw.find('&') else { return Ok(Cow::Borrowed(raw)) };
    let (head, mut rest) = raw.split_at_checked(first).ok_or("internal: reference offset")?;
    let mut out = String::with_capacity(raw.len());
    out += head;
    while let Some(after) = rest.strip_prefix('&') {
        let end = after
            .get(..after.len().min(MAX_REFERENCE_LEN + 1))
            .and_then(|window| window.find(';'))
            .ok_or_else(|| format!("unterminated character reference '&{}'", preview(after)))?;
        let (name, tail) = after.split_at_checked(end).ok_or("internal: reference end")?;
        out.push(reference(name)?);
        rest = tail.strip_prefix(';').ok_or("internal: reference ';'")?;
        let next = rest.find('&').unwrap_or(rest.len());
        let (text, tail) = rest.split_at_checked(next).ok_or("internal: reference offset")?;
        out += text;
        rest = tail;
    }
    Ok(Cow::Owned(out))
}

fn reference(name: &str) -> Result<char, String> {
    let code = match name {
        "amp" => return Ok('&'),
        "lt" => return Ok('<'),
        "gt" => return Ok('>'),
        "quot" => return Ok('"'),
        "apos" => return Ok('\''),
        "nbsp" => return Ok('\u{a0}'),
        _ => match name.strip_prefix('#') {
            Some(hex) if hex.starts_with(['x', 'X']) => hex.get(1..).and_then(|h| u32::from_str_radix(h, 16).ok()),
            Some(decimal) => decimal.parse::<u32>().ok(),
            None => None,
        },
    };
    code.filter(|c| *c != 0)
        .and_then(char::from_u32)
        .ok_or_else(|| format!("unknown character reference '&{name};'"))
}

/// Walks the input once; `rest` is what is left to read.
struct Tokenizer<'a> {
    input: &'a str,
    rest: &'a str,
}

impl<'a> Tokenizer<'a> {
    fn error(&self, message: impl std::fmt::Display) -> String {
        format!("malformed HTML at byte {}: {message}", self.input.len() - self.rest.len())
    }

    /// Splits off the first `len` bytes of `rest`.
    fn take(&mut self, len: usize) -> Result<&'a str, String> {
        let (head, tail) = self.rest.split_at_checked(len).ok_or_else(|| self.error("split inside a character"))?;
        self.rest = tail;
        Ok(head)
    }

    fn take_while(&mut self, keep: impl Fn(char) -> bool) -> Result<&'a str, String> {
        let len = self.rest.find(|c: char| !keep(c)).unwrap_or(self.rest.len());
        self.take(len)
    }

    fn eat(&mut self, prefix: &str) -> bool {
        match self.rest.strip_prefix(prefix) {
            Some(tail) => {
                self.rest = tail;
                true
            }
            None => false,
        }
    }

    fn expect(&mut self, prefix: &str) -> Result<(), String> {
        if self.eat(prefix) {
            Ok(())
        } else {
            Err(self.error(format!("expected '{prefix}'")))
        }
    }

    /// Reads up to `end` and past it.
    fn until(&mut self, end: &str, what: &str) -> Result<&'a str, String> {
        let at = self.rest.find(end).ok_or_else(|| self.error(format!("unterminated {what}")))?;
        let body = self.take(at)?;
        self.take(end.len())?;
        Ok(body)
    }

    fn skip_space(&mut self) -> Result<(), String> {
        self.take_while(|c| c.is_ascii_whitespace()).map(drop)
    }

    fn name(&mut self, what: &str) -> Result<&'a str, String> {
        let name = self.take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))?;
        if name.is_empty() {
            Err(self.error(format!("expected {what} name")))
        } else {
            Ok(name)
        }
    }

    /// The attributes of a start tag and whether it ended with `/>`.
    fn attributes(&mut self) -> Result<(Attrs<'a>, bool), String> {
        let mut attrs: Attrs<'a> = Vec::new();
        loop {
            self.skip_space()?;
            if self.eat(">") {
                return Ok((attrs, false));
            }
            if self.eat("/>") {
                return Ok((attrs, true));
            }
            let name = self.name("attribute")?;
            let value = if self.eat("=") {
                if self.eat("\"") {
                    self.until("\"", "attribute value")?
                } else if self.eat("'") {
                    self.until("'", "attribute value")?
                } else {
                    let value = self.take_while(|c| !c.is_ascii_whitespace() && !matches!(c, '>' | '"' | '\'' | '<' | '=' | '`'))?;
                    if value.is_empty() {
                        return Err(self.error(format!("attribute '{name}' has no value")));
                    }
                    value
                }
            } else {
                ""
            };
            if attrs.iter().any(|(n, _)| n.eq_ignore_ascii_case(name)) {
                return Err(self.error(format!("repeated attribute '{name}'")));
            }
            attrs.push((name, value));
        }
    }

    /// Reads raw text up to `</name` (any case), leaving `rest` on that end tag.
    fn raw_text(&mut self, name: &str) -> Result<&'a str, String> {
        let at = self
            .rest
            .match_indices("</")
            .find(|(i, _)| {
                self.rest
                    .get(i + 2..i + 2 + name.len())
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(name))
            })
            .map(|(i, _)| i)
            .ok_or_else(|| self.error(format!("<{name}> is not closed")))?;
        self.take(at)
    }
}

/// Parses `html` into its element tree.
pub(crate) fn parse(html: &str) -> Result<Dom<'_>, String> {
    let mut t = Tokenizer { input: html, rest: html };
    let mut dom = Dom {
        elements: Vec::new(),
        texts: Vec::new(),
        children: Vec::new(),
    };
    // Open elements, innermost last.
    let mut open: Vec<usize> = Vec::new();
    // How many open elements are `svg`: `/>` closes any element inside one, as in foreign content.
    let mut svg_depth = 0usize;
    let mut doctype_allowed = true;
    while !t.rest.is_empty() {
        let text_len = t.rest.find('<').unwrap_or(t.rest.len());
        if text_len > 0 {
            let text = t.take(text_len)?;
            let node = Node::Text(dom.texts.len());
            push(&mut dom, &open, node)?;
            dom.texts.push(text);
            doctype_allowed = false;
            continue;
        }
        if t.eat("<!--") {
            t.until("-->", "comment")?;
        } else if t.rest.get(..2) == Some("<!") {
            let doctype = t.until(">", "doctype")?;
            if !doctype_allowed || !doctype.eq_ignore_ascii_case("<!DOCTYPE html") {
                return Err(t.error(format!("unexpected '{}>'", preview(doctype))));
            }
        } else if t.eat("</") {
            let name = t.name("end tag")?;
            t.skip_space()?;
            t.expect(">")?;
            let id = open.pop().ok_or_else(|| t.error(format!("</{name}> closes nothing")))?;
            let element = dom.element(id)?;
            if !element.name.eq_ignore_ascii_case(name) {
                return Err(t.error(format!("</{name}> closes <{}>", element.name)));
            }
            if element.name == "svg" {
                svg_depth = svg_depth.saturating_sub(1);
            }
        } else {
            t.expect("<")?;
            let name = t.name("tag")?;
            let (attrs, self_closing) = t.attributes()?;
            let id = dom.elements.len();
            push(&mut dom, &open, Node::Element(id))?;
            dom.elements.push(Element {
                name,
                attrs,
                children: Vec::new(),
            });
            let void = VOID_ELEMENTS.iter().any(|v| v.eq_ignore_ascii_case(name));
            if self_closing && !void && svg_depth == 0 && name != "svg" {
                return Err(t.error(format!("<{name}/>: only void and SVG elements may close themselves")));
            }
            if void || self_closing {
                // Nothing to open.
            } else if RAW_TEXT_ELEMENTS.iter().any(|r| r.eq_ignore_ascii_case(name)) && svg_depth == 0 {
                let text = t.raw_text(name)?;
                if let Some(element) = dom.elements.get_mut(id) {
                    element.children.push(Node::Text(dom.texts.len()));
                }
                dom.texts.push(text);
                open.push(id);
            } else {
                if name == "svg" {
                    svg_depth += 1;
                }
                open.push(id);
            }
        }
        doctype_allowed = false;
    }
    match open.last() {
        Some(id) => Err(t.error(format!("<{}> is not closed", dom.element(*id)?.name))),
        None => Ok(dom),
    }
}

/// Appends `node` to the innermost open element, or to the document.
fn push(dom: &mut Dom<'_>, open: &[usize], node: Node) -> Result<(), String> {
    match open.last() {
        Some(id) => dom
            .elements
            .get_mut(*id)
            .map(|parent| parent.children.push(node))
            .ok_or_else(|| format!("internal: no element #{id}")),
        None => {
            dom.children.push(node);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(dom: &Dom<'_>, nodes: &[Node]) -> Vec<String> {
        nodes
            .iter()
            .map(|node| match *node {
                Node::Element(id) => dom.element(id).map(|e| e.name.to_owned()).unwrap_or_default(),
                Node::Text(id) => format!("#{}", dom.raw_text(id).unwrap_or_default()),
            })
            .collect()
    }

    #[test]
    fn builds_the_tree_of_serialized_markup() {
        let html = r#"<!DOCTYPE html><html><head><style>a > b { x: "</b>" }</style></head><body><div class="a b" data-x="1 &amp; 2"><br>t<svg viewBox="0 0 1 1"><path d="M 0 0"/></svg></div></body></html>"#;
        let dom = parse(html).unwrap();
        assert_eq!(names(&dom, &dom.children), ["html"]);
        let Some(Node::Element(html)) = dom.children.first().copied() else {
            panic!("no html")
        };
        let html = dom.element(html).unwrap();
        assert_eq!(names(&dom, &html.children), ["head", "body"]);
        let body = dom.elements_of(&html.children).unwrap()[1];
        let div = dom.elements_of(&body.children).unwrap()[0];
        assert!(div.has_class("b") && !div.has_class("c"));
        assert_eq!(div.attr("data-x").unwrap().as_deref(), Some("1 & 2"));
        assert_eq!(names(&dom, &div.children), ["br", "#t", "svg"]);
        let head = dom.elements_of(&html.children).unwrap()[0];
        let style = dom.elements_of(&head.children).unwrap()[0];
        assert_eq!(dom.text_of(style).unwrap(), r#"a > b { x: "</b>" }"#);
    }

    #[test]
    fn decodes_the_serializers_references_and_rejects_others() {
        assert_eq!(decode("a&nbsp;&lt;b&gt;&quot;&#39;&#x1F600;&apos;").unwrap(), "a\u{a0}<b>\"'\u{1F600}'");
        for bad in ["&copy;", "&#0;", "&#xD800;", "&#99999999999;", "& ", "&amp", "&#x;"] {
            assert!(decode(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rejects_markup_a_browser_would_repair() {
        for html in [
            "<div>",
            "<div></span>",
            "</div>",
            "<div/>",
            "<div a=1 a=2></div>",
            "<div a=></div>",
            "<div",
            "<div a=\"x></div>",
            "<!-- open",
            "<style>never closed",
            "<!DOCTYPE html><!DOCTYPE html>",
            "x<!DOCTYPE html>",
            "<!ENTITY x>",
            "< div></div>",
            "<div></div  x>",
        ] {
            assert!(parse(html).is_err(), "{html}");
        }
    }

    #[test]
    fn deep_nesting_does_not_recurse() {
        let depth = 100_000;
        let html = format!("{}{}", "<div>".repeat(depth), "</div>".repeat(depth));
        assert!(parse(&html).is_ok());
        assert!(parse(&"<div>".repeat(depth)).is_err());
    }
}
