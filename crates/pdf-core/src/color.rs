//! CSS colors from the profile and the krilla paints they become.

use krilla::color::rgb;
use krilla::num::NormalizedF32;
use krilla::paint::Fill;

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub(crate) struct Rgba(pub(crate) u8, pub(crate) u8, pub(crate) u8, pub(crate) f32);

impl Rgba {
    pub(crate) const TRANSPARENT: Rgba = Rgba(0, 0, 0, 0.0);
}

/// The CSS named colors (CSS Color 4) and their sRGB values.
const NAMED_COLORS: [(&str, u32); 148] = [
    ("aliceblue", 0xf0f8ff),
    ("antiquewhite", 0xfaebd7),
    ("aqua", 0x00ffff),
    ("aquamarine", 0x7fffd4),
    ("azure", 0xf0ffff),
    ("beige", 0xf5f5dc),
    ("bisque", 0xffe4c4),
    ("black", 0x000000),
    ("blanchedalmond", 0xffebcd),
    ("blue", 0x0000ff),
    ("blueviolet", 0x8a2be2),
    ("brown", 0xa52a2a),
    ("burlywood", 0xdeb887),
    ("cadetblue", 0x5f9ea0),
    ("chartreuse", 0x7fff00),
    ("chocolate", 0xd2691e),
    ("coral", 0xff7f50),
    ("cornflowerblue", 0x6495ed),
    ("cornsilk", 0xfff8dc),
    ("crimson", 0xdc143c),
    ("cyan", 0x00ffff),
    ("darkblue", 0x00008b),
    ("darkcyan", 0x008b8b),
    ("darkgoldenrod", 0xb8860b),
    ("darkgray", 0xa9a9a9),
    ("darkgreen", 0x006400),
    ("darkgrey", 0xa9a9a9),
    ("darkkhaki", 0xbdb76b),
    ("darkmagenta", 0x8b008b),
    ("darkolivegreen", 0x556b2f),
    ("darkorange", 0xff8c00),
    ("darkorchid", 0x9932cc),
    ("darkred", 0x8b0000),
    ("darksalmon", 0xe9967a),
    ("darkseagreen", 0x8fbc8f),
    ("darkslateblue", 0x483d8b),
    ("darkslategray", 0x2f4f4f),
    ("darkslategrey", 0x2f4f4f),
    ("darkturquoise", 0x00ced1),
    ("darkviolet", 0x9400d3),
    ("deeppink", 0xff1493),
    ("deepskyblue", 0x00bfff),
    ("dimgray", 0x696969),
    ("dimgrey", 0x696969),
    ("dodgerblue", 0x1e90ff),
    ("firebrick", 0xb22222),
    ("floralwhite", 0xfffaf0),
    ("forestgreen", 0x228b22),
    ("fuchsia", 0xff00ff),
    ("gainsboro", 0xdcdcdc),
    ("ghostwhite", 0xf8f8ff),
    ("gold", 0xffd700),
    ("goldenrod", 0xdaa520),
    ("gray", 0x808080),
    ("green", 0x008000),
    ("greenyellow", 0xadff2f),
    ("grey", 0x808080),
    ("honeydew", 0xf0fff0),
    ("hotpink", 0xff69b4),
    ("indianred", 0xcd5c5c),
    ("indigo", 0x4b0082),
    ("ivory", 0xfffff0),
    ("khaki", 0xf0e68c),
    ("lavender", 0xe6e6fa),
    ("lavenderblush", 0xfff0f5),
    ("lawngreen", 0x7cfc00),
    ("lemonchiffon", 0xfffacd),
    ("lightblue", 0xadd8e6),
    ("lightcoral", 0xf08080),
    ("lightcyan", 0xe0ffff),
    ("lightgoldenrodyellow", 0xfafad2),
    ("lightgray", 0xd3d3d3),
    ("lightgreen", 0x90ee90),
    ("lightgrey", 0xd3d3d3),
    ("lightpink", 0xffb6c1),
    ("lightsalmon", 0xffa07a),
    ("lightseagreen", 0x20b2aa),
    ("lightskyblue", 0x87cefa),
    ("lightslategray", 0x778899),
    ("lightslategrey", 0x778899),
    ("lightsteelblue", 0xb0c4de),
    ("lightyellow", 0xffffe0),
    ("lime", 0x00ff00),
    ("limegreen", 0x32cd32),
    ("linen", 0xfaf0e6),
    ("magenta", 0xff00ff),
    ("maroon", 0x800000),
    ("mediumaquamarine", 0x66cdaa),
    ("mediumblue", 0x0000cd),
    ("mediumorchid", 0xba55d3),
    ("mediumpurple", 0x9370db),
    ("mediumseagreen", 0x3cb371),
    ("mediumslateblue", 0x7b68ee),
    ("mediumspringgreen", 0x00fa9a),
    ("mediumturquoise", 0x48d1cc),
    ("mediumvioletred", 0xc71585),
    ("midnightblue", 0x191970),
    ("mintcream", 0xf5fffa),
    ("mistyrose", 0xffe4e1),
    ("moccasin", 0xffe4b5),
    ("navajowhite", 0xffdead),
    ("navy", 0x000080),
    ("oldlace", 0xfdf5e6),
    ("olive", 0x808000),
    ("olivedrab", 0x6b8e23),
    ("orange", 0xffa500),
    ("orangered", 0xff4500),
    ("orchid", 0xda70d6),
    ("palegoldenrod", 0xeee8aa),
    ("palegreen", 0x98fb98),
    ("paleturquoise", 0xafeeee),
    ("palevioletred", 0xdb7093),
    ("papayawhip", 0xffefd5),
    ("peachpuff", 0xffdab9),
    ("peru", 0xcd853f),
    ("pink", 0xffc0cb),
    ("plum", 0xdda0dd),
    ("powderblue", 0xb0e0e6),
    ("purple", 0x800080),
    ("rebeccapurple", 0x663399),
    ("red", 0xff0000),
    ("rosybrown", 0xbc8f8f),
    ("royalblue", 0x4169e1),
    ("saddlebrown", 0x8b4513),
    ("salmon", 0xfa8072),
    ("sandybrown", 0xf4a460),
    ("seagreen", 0x2e8b57),
    ("seashell", 0xfff5ee),
    ("sienna", 0xa0522d),
    ("silver", 0xc0c0c0),
    ("skyblue", 0x87ceeb),
    ("slateblue", 0x6a5acd),
    ("slategray", 0x708090),
    ("slategrey", 0x708090),
    ("snow", 0xfffafa),
    ("springgreen", 0x00ff7f),
    ("steelblue", 0x4682b4),
    ("tan", 0xd2b48c),
    ("teal", 0x008080),
    ("thistle", 0xd8bfd8),
    ("tomato", 0xff6347),
    ("turquoise", 0x40e0d0),
    ("violet", 0xee82ee),
    ("wheat", 0xf5deb3),
    ("white", 0xffffff),
    ("whitesmoke", 0xf5f5f5),
    ("yellow", 0xffff00),
    ("yellowgreen", 0x9acd32),
];

/// A profile color: `#rgb`, `#rrggbb`, `rgb(r, g, b)`, `rgba(r, g, b, a)`, a CSS color name or
/// `transparent`. Every component must be a finite number. As in CSS, out-of-range values clamp:
/// alpha to [0, 1], channels to [0, 255] (`as u8` saturates; it truncates where CSS rounds).
pub(crate) fn parse_color(value: &str) -> Result<Rgba, String> {
    let css = value.trim_ascii();
    let color = match css.strip_prefix('#') {
        Some(hex) => hex_color(hex),
        None => match css.strip_prefix("rgba(").or_else(|| css.strip_prefix("rgb(")) {
            Some(inner) => inner.strip_suffix(')').and_then(function_color),
            None => named_color(css),
        },
    };
    color.ok_or_else(|| format!("'{value}' is not a #rgb, #rrggbb, rgb(), rgba() or named color"))
}

fn hex_color(hex: &str) -> Option<Rgba> {
    if !matches!(hex.len(), 3 | 6) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(hex, 16).ok()?;
    // `#rgb` doubles each digit: `#f80` is `#ff8800`.
    let digit = |shift: u32| ((v >> shift & 0xF) * 0x11) as u8;
    Some(if hex.len() == 3 {
        Rgba(digit(8), digit(4), digit(0), 1.0)
    } else {
        Rgba((v >> 16) as u8, (v >> 8) as u8, v as u8, 1.0)
    })
}

/// The inside of `rgb(...)` or `rgba(...)`: three channels and an optional alpha.
fn function_color(inner: &str) -> Option<Rgba> {
    let mut parts = [1.0f32; 4];
    let mut count = 0;
    for part in inner.split(',') {
        *parts.get_mut(count)? = css_number(part.trim_ascii())?;
        count += 1;
    }
    let [r, g, b, a] = parts;
    (count >= 3).then(|| Rgba(r as u8, g as u8, b as u8, a.clamp(0.0, 1.0)))
}

/// A CSS number: digits with an optional sign, fraction and exponent (no `inf` or `NaN`).
fn css_number(text: &str) -> Option<f32> {
    let digits = !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.' | b'e' | b'E'));
    text.parse::<f32>().ok().filter(|v| digits && v.is_finite())
}

/// A CSS color keyword, matched without regard to case.
fn named_color(value: &str) -> Option<Rgba> {
    if value.eq_ignore_ascii_case("transparent") {
        return Some(Rgba::TRANSPARENT);
    }
    let (_, rgb) = NAMED_COLORS.iter().find(|(name, _)| name.eq_ignore_ascii_case(value))?;
    Some(Rgba((rgb >> 16) as u8, (rgb >> 8) as u8, *rgb as u8, 1.0))
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
    fn parses_profile_colors() {
        assert_eq!(parse_color("#17365D"), Ok(Rgba(0x17, 0x36, 0x5D, 1.0)));
        assert_eq!(parse_color("#f80"), Ok(Rgba(0xFF, 0x88, 0x00, 1.0)));
        assert_eq!(parse_color("rgba(23, 54, 93, 0)"), Ok(Rgba(23, 54, 93, 0.0)));
        assert_eq!(parse_color("rgb(1,2,3)"), Ok(Rgba(1, 2, 3, 1.0)));
        assert_eq!(parse_color("transparent"), Ok(Rgba::TRANSPARENT));
        assert_eq!(parse_color("CornflowerBlue"), Ok(Rgba(0x64, 0x95, 0xED, 1.0)));
        // CSS clamps out-of-range components.
        assert_eq!(parse_color("rgba(300, -5, 12.7, 2)"), Ok(Rgba(255, 0, 12, 1.0)));
        assert_eq!(parse_color("rgba(0, 0, 0, -1)"), Ok(Rgba(0, 0, 0, 0.0)));
    }

    #[test]
    fn rejects_every_malformed_color() {
        for bad in [
            "#FF0000zz",
            "#FF00",
            "#FF000080",
            "#+F0",
            "rgba(1, 2, 3, x)",
            "rgba(0, 0, 0, NaN)",
            "rgb(NaN, 0, 0)",
            "rgb(inf, 0, 0)",
            "rgb(1, 2)",
            "rgba(1, 2, 3, 4, 5)",
            "rgb(1, 2, 3",
            "notacolor",
            "",
        ] {
            let error = parse_color(bad).expect_err(bad);
            assert!(error.contains(&format!("'{bad}'")), "{error}");
        }
    }
}
