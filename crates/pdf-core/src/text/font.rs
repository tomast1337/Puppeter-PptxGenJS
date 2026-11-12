//! Font family fallback stacks.

/// Requested face first, then the metric-compatible alias the docker image's
/// fontconfig (30-metric-aliases.conf) would pick, then DejaVu Sans, the
/// image's default sans-serif, which also covers Arabic/Greek/Cyrillic, then
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
    format!("{}, {}, \"DejaVu Sans\", \"Noto Sans CJK JP\"", quote(face), quote(alias))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_office_fonts_to_metric_aliases() {
        assert_eq!(family_stack("Calibri"), "\"Calibri\", \"Carlito\", \"DejaVu Sans\", \"Noto Sans CJK JP\"");
        assert_eq!(family_stack("Arial"), "\"Arial\", \"Liberation Sans\", \"DejaVu Sans\", \"Noto Sans CJK JP\"");
    }
}
