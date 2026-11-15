//! Images from the model: data-URI decoding, sizing, rounding and opacity.
//!
//! Mirrors the Puppeteer renderer (packages/pptxgenjs/src/render/image.ts): the picture is placed
//! at the rectangle `NormalizedImageSizing` resolved, clipped to the object box (an ellipse when
//! `rounding`). PNG and JPEG go through krilla; an SVG image is read as the SVG subset
//! (`profile::svg`) and drawn as vectors; GIF and WebP images are reported, not drawn.
//! krilla reads an image's header when it is created and decodes the pixels when the document is
//! written, so corrupt pixel data fails `render` with a serialization error rather than a panic.

use base64::Engine;
use base64::engine::DecodePaddingMode;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use krilla::geom::{Size, Transform};
use krilla::image::Image;
use krilla::paint::FillRule;
use krilla::surface::Surface;
use std::rc::Rc;

use crate::Renderer;
use crate::color::unit;
use crate::model::{ImageModel, ImageSizing};
use crate::path::{ellipse_path, rect_path, to_path};
use crate::profile;
use crate::svg::Svg;

/// The data-URI payload as the compatibility layer validates it: standard alphabet, padding optional.
const BASE64: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// A decoded data URI: a raster image or an SVG display list.
#[derive(Clone)]
pub(crate) enum Picture {
    Raster(Image),
    Svg(Rc<Svg>),
}

/// A decoded data URI, or the reason it is skipped (reported through `warnings()`).
pub(crate) type Decoded = Result<Picture, String>;

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
        // Outside the SVG subset is an error, as for a chart: nothing is skipped silently.
        // shortcut: no editor namespaces (inkscape:*, sodipodi:*), <use>, <style> sheets or radial
        // gradients; add one when a real deck's SVG needs it and its gzip cost is measured (#17).
        let text = std::str::from_utf8(&bytes).map_err(|e| format!("SVG image is not UTF-8: {e}"))?;
        let svg = profile::svg::image(text).map_err(|e| format!("SVG image: {e}"))?;
        return Ok(Ok(Picture::Svg(Rc::new(svg))));
    } else {
        return Err(format!("'{mime}' data is not a PNG or JPEG image"));
    };
    decoded
        .map(|image| Ok(Picture::Raster(image)))
        .map_err(|e| format!("cannot decode {mime} data: {e}"))
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
        let frame = if image.rounding {
            ellipse_path(x, y, w, h)
        } else {
            rect_path(x, y, w, h, 0.0)
        };
        let Some(clip) = to_path(&frame) else { return Ok(()) };
        if self.effects.capturing() {
            // Contained and cropped pictures may not fill the box: the silhouette is what is drawn.
            // shortcut: the shadow is cast by the picture rectangle, not by transparent pixels
            // (LibreOffice follows the alpha channel); decode the alpha for it when a deck shadows a cut-out picture.
            let (l, t) = (x.max(x + px), y.max(y + py));
            let (r, b) = ((x + w).min(x + px + pw), (y + h).min(y + py + ph));
            let silhouette = if image.rounding { frame } else { rect_path(l, t, r - l, b - t, 0.0) };
            self.effects.capture(surface.ctm(), &silhouette, image.opacity, None);
        }
        surface.push_clip_path(&clip, &FillRule::NonZero);
        let faded = image.opacity < 1.0;
        if faded {
            surface.push_opacity(unit(image.opacity));
        }
        match picture {
            Picture::Raster(picture) => {
                surface.push_transform(&Transform::from_translate(x + px, y + py));
                surface.draw_image(picture, size);
                surface.pop();
            }
            Picture::Svg(svg) => {
                // The picture's rectangle was captured above: what the SVG draws casts no shadow of its own.
                self.effects.pause();
                self.draw_svg(surface, &svg, x + px, y + py, size.width(), size.height());
                self.effects.resume();
            }
        }
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
        let Ok(Ok(Picture::Raster(image))) = decode_data_uri(&format!("data:image/jpeg;base64,{PNG_1X1}")) else {
            panic!("a PNG")
        };
        assert_eq!(image.size(), (1, 1));
        let unpadded = PNG_1X1.trim_end_matches('=');
        assert!(decode_data_uri(&format!("DATA:image/png;base64,\n{unpadded}")).unwrap().is_ok());
    }

    #[test]
    fn reads_svg_skips_gif_and_rejects_broken_data() {
        let svg = |text: &str| format!("data:image/svg+xml;base64,{}", BASE64.encode(text));
        let Ok(Ok(Picture::Svg(drawn))) = decode_data_uri(&svg(r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#)) else {
            panic!("an SVG")
        };
        assert!(drawn.items.is_empty());
        let gif = format!("data:image/gif;base64,{}", BASE64.encode("GIF89a"));
        assert!(matches!(decode_data_uri(&gif), Ok(Err(skipped)) if skipped == "GIF and WebP images not rendered"));
        let outside = svg(r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.test/a.png"/></svg>"#);
        let not_utf8 = format!("data:image/svg+xml;base64,{}", BASE64.encode([0xFF, 0xFE, 0x3C]));
        for (source, error) in [
            (outside.as_str(), "SVG image: <image> is not in the SVG subset"),
            (not_utf8.as_str(), "SVG image is not UTF-8"),
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
        let (x, y, width, height) = (5.0, -10.0, 100.0, 120.0);
        assert_eq!(placement(&ImageSizing::Stretch, 80.0, 60.0), (0.0, 0.0, 80.0, 60.0));
        assert_eq!(placement(&ImageSizing::Contain { x, y, width, height }, 80.0, 60.0), (x, y, width, height));
        assert_eq!(placement(&ImageSizing::Cover { x, y, width, height }, 80.0, 60.0), (x, y, width, height));
        let crop = ImageSizing::Crop {
            offset_x: 96.0,
            offset_y: 24.0,
            width: 384.0,
            height: 192.0,
        };
        assert_eq!(placement(&crop, 80.0, 60.0), (-96.0, -24.0, 384.0, 192.0));
    }
}
