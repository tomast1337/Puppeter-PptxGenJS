//! Font family fallback stacks.

/// Requested face first, then the metric-compatible alias the docker image's
/// fontconfig (30-metric-aliases.conf) would pick, then DejaVu Sans, the
/// image's default sans-serif, which also covers Arabic/Greek/Cyrillic, then
/// Liberation Sans, so Latin text keeps a Latin face on systems without DejaVu
/// Sans (or Carlito/Caladea) instead of falling to the CJK face, and only then
/// Noto Sans CJK JP for Han/Kana/Hangul. Emoji clusters additionally fall
/// through to the registered `emoji` generic family (see `add_font`).
pub(crate) fn family_stack(face: &str) -> String {
    let alias = match face.to_ascii_lowercase().as_str() {
        "calibri" | "calibri light" => "Carlito",
        "cambria" => "Caladea",
        "arial" | "helvetica" | "segoe ui" => "Liberation Sans",
        "arial narrow" => "Liberation Sans Narrow",
        "times new roman" | "times" => "Liberation Serif",
        "courier new" | "courier" => "Liberation Mono",
        _ => face,
    };
    let quote = |s: &str| format!("\"{}\"", s.replace('"', ""));
    // shortcut: serif and monospace faces without their alias fall back to sans faces, where
    // fontconfig would pick a serif/mono default; add per-class fallbacks when a deck needs them.
    format!("{}, {}, \"DejaVu Sans\", \"Liberation Sans\", \"Noto Sans CJK JP\"", quote(face), quote(alias))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
