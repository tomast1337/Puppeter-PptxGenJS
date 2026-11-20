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

/// The Noto Sans CJK face Chromium on Linux takes, ahead of `FALLBACK_FAMILIES`, for a character the run's face
/// lacks, by the run's `lang`. Blink asks fontconfig once per character with the run's locale:
/// `FontCache::PlatformFallbackFontForCharacter` (blink/renderer/platform/fonts/linux/font_cache_linux.cc) passes
/// `FontDescription::LocaleOrDefault()` to `gfx::GetFallbackFontForChar` (ui/gfx/font_fallback_linux.cc), which
/// sets `FC_LANG`, runs `FcConfigSubstitute` and takes the first face of `FcFontSort` that has the character.
/// The run's own family is not in that pattern, so the fallback is sans-serif whatever the face. The docker
/// image's fonts-noto-cjk rules (/etc/fonts/conf.d/70-fonts-noto-cjk.conf) prepend one face per `lang`, compared
/// whole and case-insensitively, so `ko-KR`, `ja-JP` or `zh-Hant` match none. Measured with chrome-headless-shell
/// in that image (pdffonts): a listed `lang` draws Han, Kana, Hangul and even `☆` (which DejaVu Sans has) in its
/// face; any other `lang` keeps the default order, where Han, Kana and Hangul land on Noto Sans CJK JP.
const CJK_FALLBACK_BY_LANG: [(&str, &str); 5] = [
    ("ja", "Noto Sans CJK JP"),
    ("ko", "Noto Sans CJK KR"),
    ("zh-cn", "Noto Sans CJK SC"),
    ("zh-tw", "Noto Sans CJK TC"),
    ("zh-hk", "Noto Sans CJK HK"),
];

/// Requested face first, then its metric alias, then the CJK face of the run's `lang` (`CJK_FALLBACK_BY_LANG`),
/// then `FALLBACK_FAMILIES`. Emoji clusters additionally fall through to the registered `emoji` generic family
/// (see `add_font`).
pub(crate) fn family_stack(face: &str, lang: Option<&str>) -> String {
    let quote = |s: &str| format!("\"{}\"", s.replace('"', ""));
    // shortcut: serif and monospace faces without their alias fall back to sans faces, where
    // fontconfig would pick a serif/mono default; add per-class fallbacks when a deck needs them.
    // shortcut: HarfBuzz draws U+2011 with the face's U+2010 glyph when the face lacks it (hb-ot-shape-normalize.cc,
    // harfrust's normalize.rs), so Chromium keeps an Arial run's U+2011 in Liberation Sans; parley picks a face by
    // cmap coverage first and takes DejaVu Sans. Map it before font selection when parley lets a caller steer it (#289).
    let [dejavu, liberation, cjk] = FALLBACK_FAMILIES.map(quote);
    let by_lang = lang
        .and_then(|lang| CJK_FALLBACK_BY_LANG.iter().find(|(tag, _)| tag.eq_ignore_ascii_case(lang)))
        .map_or(String::new(), |(_, family)| format!("{}, ", quote(family)));
    format!("{}, {}, {by_lang}{dejavu}, {liberation}, {cjk}", quote(face), quote(metric_alias(face)))
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
    use crate::model::{Run, build};
    use crate::tests::{liberation_sans, noto_sans_cjk};
    use crate::text::layout::BoxLayout;
    use skrifa::{FontRef, MetadataProvider, string::StringId};

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
                family_stack(face, None),
                format!("\"{face}\", \"{alias}\", \"DejaVu Sans\", \"Liberation Sans\", \"Noto Sans CJK JP\"")
            );
        }
    }

    #[test]
    fn strips_quotes_from_face_names() {
        assert!(family_stack("A\"rial", None).starts_with("\"Arial\", "));
    }

    #[test]
    fn puts_the_cjk_face_of_the_run_lang_before_the_latin_fallbacks() {
        let tail = "\"DejaVu Sans\", \"Liberation Sans\", \"Noto Sans CJK JP\"";
        for (lang, cjk) in [
            (Some("zh-CN"), "\"Noto Sans CJK SC\", "),
            (Some("zh-tw"), "\"Noto Sans CJK TC\", "),
            (Some("ZH-HK"), "\"Noto Sans CJK HK\", "),
            (Some("ja"), "\"Noto Sans CJK JP\", "),
            (Some("ko"), "\"Noto Sans CJK KR\", "),
            // No fontconfig rule names these: Chromium keeps the default order.
            (Some("ko-KR"), ""),
            (Some("zh-Hant"), ""),
            (Some("en-US"), ""),
            (None, ""),
        ] {
            assert_eq!(family_stack("Arial", lang), format!("\"Arial\", \"Liberation Sans\", {cjk}{tail}"), "{lang:?}");
        }
    }

    #[test]
    fn draws_han_in_the_face_of_the_run_lang() {
        let (Some(sans), Some(cjk)) = (liberation_sans(), noto_sans_cjk()) else {
            return eprintln!("Liberation Sans or Noto Sans CJK not installed: lang fallback not checked");
        };
        let mut r = Renderer::new();
        r.add_font(sans);
        r.add_font(cjk);
        for (lang, family) in [
            (Some("zh-CN"), "Noto Sans CJK SC"),
            (Some("zh-TW"), "Noto Sans CJK TC"),
            (Some("ko"), "Noto Sans CJK KR"),
            (None, "Noto Sans CJK JP"),
        ] {
            let run = Run {
                language: lang.map(String::from),
                ..build::run("中", "Arial", 30.0)
            };
            let mut layout = BoxLayout::default();
            r.fit_text(&build::text_box(vec![build::paragraph(vec![run], 36.0, 30.0)]), 400.0, 100.0, &mut layout);
            let line = layout.paras[0].layout.lines().next().expect("one line");
            let Some(parley::PositionedLayoutItem::GlyphRun(glyph_run)) = line.items().next() else {
                panic!("the line starts with a glyph run");
            };
            let font = glyph_run.run().font();
            let name = FontRef::from_index(font.data.as_ref(), font.index)
                .ok()
                .and_then(|f| f.localized_strings(StringId::FAMILY_NAME).english_or_first())
                .map(|name| name.to_string());
            assert_eq!(name.as_deref(), Some(family), "{lang:?}");
        }
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
