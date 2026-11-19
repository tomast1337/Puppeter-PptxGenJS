//! Font family fallback stacks, and the run faces a render could not use.

use std::collections::BTreeSet;

use crate::Renderer;
use crate::model::{ObjectStyle, Presentation, SlideObject, TextBox};

/// The faces tried after the requested one and its metric alias: DejaVu Sans, the docker image's
/// default sans-serif, which also covers Arabic/Greek/Cyrillic, then Liberation Sans, so Latin text
/// keeps a Latin face on systems without DejaVu Sans (or Carlito/Caladea) instead of falling to the
/// CJK face, and only then Noto Sans CJK JP for Han/Kana/Hangul.
const FALLBACK_FAMILIES: [&str; 3] = ["DejaVu Sans", "Liberation Sans", "Noto Sans CJK JP"];

/// The metric-compatible face the docker image's fontconfig (30-metric-aliases.conf) would pick for
/// `face`, or `face` itself.
fn metric_alias(face: &str) -> &str {
    match face.to_ascii_lowercase().as_str() {
        "calibri" | "calibri light" => "Carlito",
        "cambria" => "Caladea",
        "arial" | "helvetica" | "segoe ui" => "Liberation Sans",
        "arial narrow" => "Liberation Sans Narrow",
        "times new roman" | "times" => "Liberation Serif",
        "courier new" | "courier" => "Liberation Mono",
        _ => face,
    }
}

/// Requested face first, then its metric alias, then `FALLBACK_FAMILIES`. Emoji clusters
/// additionally fall through to the registered `emoji` generic family (see `add_font`).
pub(crate) fn family_stack(face: &str) -> String {
    let quote = |s: &str| format!("\"{}\"", s.replace('"', ""));
    // shortcut: serif and monospace faces without their alias fall back to sans faces, where
    // fontconfig would pick a serif/mono default; add per-class fallbacks when a deck needs them.
    let [dejavu, liberation, cjk] = FALLBACK_FAMILIES.map(quote);
    format!("{}, {}, {dejavu}, {liberation}, {cjk}", quote(face), quote(metric_alias(face)))
}

/// A run face the renderer had no font for, neither the face nor its metric alias: its text was
/// drawn in a fallback face, so it can wrap differently from the deck's own font.
#[derive(Debug, PartialEq)]
pub struct MissingFont {
    pub face: String,
    /// The first registered face of `FALLBACK_FAMILIES`, the one Latin text was drawn in; `None`
    /// when no fallback is registered either (another registered face was used).
    pub used: Option<String>,
    /// `slide <n> '<object name>'` (or `#<index>` for an unnamed object) of each object asking for it.
    pub objects: BTreeSet<String>,
}

impl Renderer {
    /// Records the faces of `model`'s text runs (text boxes, shapes, table cells) that no
    /// registered font provides: a lookup or two per run, once per document before drawing.
    /// shortcut: chart SVG `<text>` faces are not checked; check them when charts leave the
    /// unimplemented list (AGENTS.md priorities).
    pub(crate) fn find_missing_fonts(&mut self, model: &Presentation) {
        for (slide, position) in model.slides.iter().zip(1..) {
            let number = slide.number.unwrap_or(position);
            for (index, object) in slide.objects.iter().enumerate() {
                match object {
                    SlideObject::Text(o) => {
                        if let Some(text) = &o.text {
                            self.find_missing_in(text, number, index, &o.style);
                        }
                    }
                    SlideObject::Table(o) => {
                        for cell in o.table.rows.iter().flat_map(|row| &row.cells) {
                            self.find_missing_in(&cell.text, number, index, &o.style);
                        }
                    }
                    SlideObject::Shape(_) | SlideObject::Image(_) | SlideObject::Svg(_) => {}
                }
            }
        }
    }

    /// `find_missing_fonts` for one text box of object `index` on slide `slide`.
    fn find_missing_in(&mut self, text: &TextBox, slide: u32, index: usize, style: &ObjectStyle) {
        for run in text.paragraphs.iter().flat_map(|paragraph| &paragraph.runs) {
            // Segoe UI's alias keeps it in a sans face but is not metric-compatible: Chromium does not take Liberation
            // Sans for it either, so it is still reported.
            let face = &run.font_face;
            if self.has_family(face) || (!face.eq_ignore_ascii_case("segoe ui") && self.has_family(metric_alias(face))) {
                continue;
            }
            let object = match &style.object_name {
                Some(name) => format!("slide {slide} '{name}'"),
                None => format!("slide {slide} #{index}"),
            };
            if let Some(missing) = self.missing_fonts.iter_mut().find(|missing| missing.face == run.font_face) {
                missing.objects.insert(object);
                continue;
            }
            let used = FALLBACK_FAMILIES.into_iter().find(|family| self.has_family(family)).map(String::from);
            self.missing_fonts.push(MissingFont {
                face: run.font_face.clone(),
                used,
                objects: BTreeSet::from([object]),
            });
        }
    }

    /// Whether a registered font has the family `name` (case-insensitive, as parley matches it).
    fn has_family(&mut self, name: &str) -> bool {
        self.fonts.collection.family_id(&name.replace('"', "")).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::build;
    use crate::tests::liberation_sans;

    #[test]
    fn maps_office_fonts_to_metric_aliases_then_latin_then_cjk() {
        for (face, alias) in [
            ("Arial", "Liberation Sans"),
            ("Times New Roman", "Liberation Serif"),
            ("Courier New", "Liberation Mono"),
            ("Calibri", "Carlito"),
            ("calibri light", "Carlito"),
            ("Cambria", "Caladea"),
            ("Georgia", "Georgia"),
        ] {
            assert_eq!(
                family_stack(face),
                format!("\"{face}\", \"{alias}\", \"DejaVu Sans\", \"Liberation Sans\", \"Noto Sans CJK JP\"")
            );
        }
    }

    #[test]
    fn strips_quotes_from_face_names() {
        assert!(family_stack("A\"rial").starts_with("\"Arial\", "));
    }

    #[test]
    fn reports_faces_without_a_font_or_alias_by_object() {
        let Some(font) = liberation_sans() else {
            return eprintln!("Liberation Sans not installed: missing fonts not checked");
        };
        let mut r = Renderer::new();
        r.add_font(font);
        let text = |face: &str| build::text_box(vec![build::paragraph(vec![build::run("x", face, 30.0)], 36.0, 30.0)]);
        let named = |name: &str| {
            let mut style = build::style(0.0, 0.0, 100.0, 50.0);
            style.object_name = Some(name.into());
            style
        };
        let deck = build::deck(vec![
            build::text_object(named("Title"), text("NoSuchFont")),
            build::text_object(build::style(0.0, 0.0, 100.0, 50.0), text("NoSuchFont")),
            // Arial resolves to its metric alias, Liberation Sans itself is registered.
            build::text_object(named("Body"), text("Arial")),
            build::text_object(named("Body"), text("liberation sans")),
            // Drawn in Liberation Sans, but not metric-compatible: reported, as Chromium's fallback is.
            build::text_object(named("Note"), text("Segoe UI")),
        ]);
        r.find_missing_fonts(&deck);
        assert_eq!(
            r.missing_fonts,
            vec![
                MissingFont {
                    face: "NoSuchFont".into(),
                    used: Some("Liberation Sans".into()),
                    objects: BTreeSet::from(["slide 1 #1".into(), "slide 1 'Title'".into()]),
                },
                MissingFont {
                    face: "Segoe UI".into(),
                    used: Some("Liberation Sans".into()),
                    objects: BTreeSet::from(["slide 1 'Note'".into()]),
                }
            ]
        );
    }
}
