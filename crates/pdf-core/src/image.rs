//! Raster images from the model: data-URI decoding, sizing, rounding and opacity.
//!
//! Mirrors the Puppeteer renderer (packages/pptxgenjs/src/render/image.ts): the picture is placed
//! at the rectangle `NormalizedImageSizing` resolved, clipped to the object box (an ellipse when
//! `rounding`). PNG and JPEG go through krilla; GIF, WebP and SVG images are reported, not drawn.
//! krilla reads an image's header when it is created and decodes the pixels when the document is
//! written, so corrupt pixel data fails `render` with a serialization error rather than a panic.

use base64::Engine;
use base64::engine::DecodePaddingMode;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use krilla::geom::{Size, Transform};
use krilla::image::Image;
use krilla::paint::FillRule;
use krilla::surface::Surface;

use crate::Renderer;
use crate::color::unit;
use crate::model::{ImageModel, ImageSizing};
use crate::path::{ellipse_path, rect_path};

/// The data-URI payload as the compatibility layer validates it: standard alphabet, padding optional.
const BASE64: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// A decoded data URI: a krilla image, or the reason it is skipped (reported through `warnings()`).
pub(crate) type Decoded = Result<Image, String>;

/// Decodes `data:<mime>;base64,<payload>` by its magic bytes (browsers sniff too, so a mislabelled
/// PNG still draws). `Err` is a broken input; `Ok(Err(_))` an image kind this backend skips.
pub(crate) fn decode_data_uri(source: &str) -> Result<Decoded, String> {
    let (header, payload) = source
        .split_once(',')
        .filter(|(header, _)| header.get(..5).is_some_and(|scheme| scheme.eq_ignore_ascii_case("data:")))
        .ok_or("not a data URI (resolve paths and URLs before rendering)")?;
    let Some(mime) = header
        .get(5..)
        .and_then(|rest| rest.rsplit_once(';'))
        .filter(|(_, encoding)| encoding.eq_ignore_ascii_case("base64"))
        .map(|(mime, _)| mime)
    else {
        return Err(format!("data URI '{header}' is not base64-encoded"));
    };
    let compact: Vec<u8> = payload.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let bytes = BASE64.decode(compact).map_err(|e| format!("invalid base64 data: {e}"))?;
    let decoded = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Image::from_png(bytes.into(), true)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Image::from_jpeg(bytes.into(), true)
    } else if bytes.starts_with(b"GIF8") || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")) {
        // shortcut: krilla's GIF and WebP decoders add ~62 KB gzip, past GZIP_BUDGET; draw them once the budget allows (#17).
        return Ok(Err("GIF and WebP images not rendered".to_owned()));
    } else if mime.eq_ignore_ascii_case("image/svg+xml") {
        // shortcut: krilla's svg feature does not fit GZIP_BUDGET; draw SVG images once it does (#17).
        return Ok(Err("SVG images not rendered".to_owned()));
    } else {
        return Err(format!("'{mime}' data is not a PNG or JPEG image"));
    };
    decoded.map(Ok).map_err(|e| format!("cannot decode {mime} data: {e}"))
}

/// The rectangle the picture is drawn into, relative to the box origin (px).
pub(crate) fn placement(sizing: &ImageSizing, w: f32, h: f32) -> (f32, f32, f32, f32) {
    match *sizing {
        ImageSizing::Stretch => (0.0, 0.0, w, h),
        ImageSizing::Contain { x, y, width, height } | ImageSizing::Cover { x, y, width, height } => (x, y, width, height),
        ImageSizing::Crop {
            offset_x,
            offset_y,
            width,
            height,
        } => (-offset_x, -offset_y, width, height),
    }
}

impl Renderer {
    /// Draws the picture over the box `x, y, w, h` (px). `name` labels decode errors.
    #[allow(clippy::too_many_arguments)] // the box is four plain numbers, as in draw_geometry
    pub(crate) fn draw_image(&mut self, surface: &mut Surface, image: &ImageModel, name: &str, x: f32, y: f32, w: f32, h: f32) -> Result<(), String> {
        if image.link.is_some() {
            self.warn("image hyperlink annotations not emitted");
        }
        if image.source_kind != "data" {
            self.warn(format!(
                "image source kind '{}' not rendered (resolve it to a data URI first)",
                image.source_kind
            ));
            return Ok(());
        }
        let picture = match self.images.get(&image.source) {
            Some(decoded) => decoded.clone(),
            None => {
                let decoded = decode_data_uri(&image.source).map_err(|e| format!("image '{name}': {e}"))?;
                self.images.insert(image.source.clone(), decoded.clone());
                decoded
            }
        };
        let picture = match picture {
            Ok(picture) => picture,
            Err(skipped) => {
                self.warn(skipped);
                return Ok(());
            }
        };
        let (px, py, pw, ph) = placement(&image.sizing, w, h);
        let Some(size) = Size::from_wh(pw, ph) else { return Ok(()) };
        // The HTML frame clips to the box (`overflow: hidden`, `border-radius: 50%` when rounded).
        let clip = if image.rounding {
            ellipse_path(x, y, w, h)
        } else {
            rect_path(x, y, w, h, 0.0)
        };
        let Some(clip) = clip else { return Ok(()) };
        surface.push_clip_path(&clip, &FillRule::NonZero);
        let faded = image.opacity < 1.0;
        if faded {
            surface.push_opacity(unit(image.opacity));
        }
        surface.push_transform(&Transform::from_translate(x + px, y + py));
        surface.draw_image(picture, size);
        surface.pop();
        if faded {
            surface.pop();
        }
        surface.pop();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1x1 opaque PNG.
    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn decodes_by_magic_bytes_not_by_label() {
        let image = decode_data_uri(&format!("data:image/jpeg;base64,{PNG_1X1}")).unwrap().unwrap();
        assert_eq!(image.size(), (1, 1));
        let unpadded = PNG_1X1.trim_end_matches('=');
        assert!(decode_data_uri(&format!("DATA:image/png;base64,\n{unpadded}")).unwrap().is_ok());
    }

    #[test]
    fn skips_svg_and_rejects_broken_data() {
        let svg = format!("data:image/svg+xml;base64,{}", BASE64.encode("<svg/>"));
        assert_eq!(decode_data_uri(&svg).unwrap().unwrap_err(), "SVG images not rendered");
        let gif = format!("data:image/gif;base64,{}", BASE64.encode("GIF89a"));
        assert_eq!(decode_data_uri(&gif).unwrap().unwrap_err(), "GIF and WebP images not rendered");
        for (source, error) in [
            ("image.png", "not a data URI"),
            ("data:image/png,abc", "not base64-encoded"),
            ("data:image/png;base64,***", "invalid base64"),
            ("data:image/bmp;base64,Qk0=", "not a PNG or JPEG"),
            // PNG signature, truncated header.
            ("data:image/png;base64,iVBORw0KGgoAAAA=", "cannot decode image/png"),
            ("data:", "not a data URI"),
        ] {
            let got = decode_data_uri(source).err().unwrap_or_default();
            assert!(got.contains(error), "{source}: {got}");
        }
    }

    #[test]
    fn places_each_sizing_mode() {
        let fit = |kind: &str| serde_json::from_str::<ImageSizing>(&format!(r#"{{"type":"{kind}","x":5,"y":-10,"width":100,"height":120}}"#)).unwrap();
        assert_eq!(placement(&ImageSizing::Stretch, 80.0, 60.0), (0.0, 0.0, 80.0, 60.0));
        assert_eq!(placement(&fit("contain"), 80.0, 60.0), (5.0, -10.0, 100.0, 120.0));
        assert_eq!(placement(&fit("cover"), 80.0, 60.0), (5.0, -10.0, 100.0, 120.0));
        let crop = serde_json::from_str::<ImageSizing>(r#"{"type":"crop","offsetX":96,"offsetY":24,"width":384,"height":192}"#).unwrap();
        assert_eq!(placement(&crop, 80.0, 60.0), (-96.0, -24.0, 384.0, 192.0));
    }
}
