//! CSS colors from the model and the krilla paints they become.

use krilla::color::rgb;
use krilla::num::NormalizedF32;
use krilla::paint::Fill;

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub(crate) struct Rgba(pub(crate) u8, pub(crate) u8, pub(crate) u8, pub(crate) f32);

/// The model carries CSS colors: `#RRGGBB`, `rgba(r, g, b, a)` or `transparent`.
/// As in CSS, out-of-range values clamp: alpha to [0, 1], channels to [0, 255]
/// (`as u8` saturates; it truncates where CSS rounds). A NaN component makes the
/// color invalid, like any other unparsable color.
pub(crate) fn parse_color(css: &str) -> Option<Rgba> {
    let css = css.trim();
    if let Some(hex) = css.strip_prefix('#') {
        let v = u32::from_str_radix(hex.get(..6)?, 16).ok()?;
        return Some(Rgba((v >> 16) as u8, (v >> 8) as u8, v as u8, 1.0));
    }
    let inner = css.strip_prefix("rgba(").or_else(|| css.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<f32> = inner.split(',').filter_map(|p| p.trim().parse().ok()).collect();
    if parts.iter().any(|v| v.is_nan()) {
        return None;
    }
    match parts.as_slice() {
        [r, g, b] => Some(Rgba(*r as u8, *g as u8, *b as u8, 1.0)),
        [r, g, b, a] => Some(Rgba(*r as u8, *g as u8, *b as u8, a.clamp(0.0, 1.0))),
        _ => None,
    }
}

pub(crate) fn fill_of(c: Rgba) -> Fill {
    Fill {
        paint: rgb::Color::new(c.0, c.1, c.2).into(),
        opacity: unit(c.3),
        ..Fill::default()
    }
}

/// Clamps to [0, 1]. NaN, which no model value carries (the profile rejects it and
/// `parse_color` rejects it), becomes transparent rather than a panic.
pub(crate) fn unit(v: f32) -> NormalizedF32 {
    NormalizedF32::new(v.clamp(0.0, 1.0)).unwrap_or(NormalizedF32::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_colors() {
        assert_eq!(parse_color("#17365D"), Some(Rgba(0x17, 0x36, 0x5D, 1.0)));
        assert_eq!(parse_color("rgba(23, 54, 93, 0)"), Some(Rgba(23, 54, 93, 0.0)));
        assert_eq!(parse_color("transparent"), None);
        // CSS clamps out-of-range components; NaN is not a CSS number.
        assert_eq!(parse_color("rgba(300, -5, 12.7, 2)"), Some(Rgba(255, 0, 12, 1.0)));
        assert_eq!(parse_color("rgba(0, 0, 0, -1)"), Some(Rgba(0, 0, 0, 0.0)));
        assert_eq!(parse_color("rgba(0, 0, 0, NaN)"), None);
        assert_eq!(parse_color("rgb(NaN, 0, 0)"), None);
    }
}
