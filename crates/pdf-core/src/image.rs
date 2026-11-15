//! Images from the model: data-URI decoding, sizing, rounding and opacity.
//!
//! Mirrors the Puppeteer renderer (packages/pptxgenjs/src/render/image.ts): the picture is placed
//! at the rectangle `NormalizedImageSizing` resolved, clipped to the object box (an ellipse when
//! `rounding`). PNG, JPEG, GIF and WebP go through krilla (an animated GIF or WebP draws its first
//! frame, as Chromium prints it); an SVG image is read as the SVG subset (`profile::svg`) and drawn
//! as vectors.
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

/// Decodes `data:<mime>;base64,<payload>` by its magic bytes (browsers sniff too, so a mislabelled
/// PNG still draws). `Err` is a broken or unsupported input.
pub(crate) fn decode_data_uri(source: &str) -> Result<Picture, String> {
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
    } else if bytes.starts_with(b"GIF8") {
        gif_first_frame_fills_screen(&bytes)?;
        Image::from_gif(bytes.into(), true)
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Image::from_webp(bytes.into(), true)
    } else if mime.eq_ignore_ascii_case("image/svg+xml") {
        // Outside the SVG subset is an error, as for a chart: nothing is skipped silently.
        // shortcut: no editor namespaces (inkscape:*, sodipodi:*), <use>, <style> sheets or radial
        // gradients; add one when a real deck's SVG needs it and its gzip cost is measured (#17).
        let text = std::str::from_utf8(&bytes).map_err(|e| format!("SVG image is not UTF-8: {e}"))?;
        let svg = profile::svg::image(text).map_err(|e| format!("SVG image: {e}"))?;
        return Ok(Picture::Svg(Rc::new(svg)));
    } else {
        return Err(format!("'{mime}' data is not a PNG, JPEG, GIF, WebP or SVG image"));
    };
    decoded.map(Picture::Raster).map_err(|e| format!("cannot decode {mime} data: {e}"))
}

/// krilla takes a GIF's first frame as the whole picture, so a first frame smaller than the
/// logical screen (later frames drawn over it) would not match the image size it declares.
fn gif_first_frame_fills_screen(bytes: &[u8]) -> Result<(), String> {
    let word = |at: usize| bytes.get(at..at + 2).and_then(|b| b.try_into().ok()).map(u16::from_le_bytes);
    // GIF89a: the logical screen descriptor (width, height, packed flags) follows the 6-byte signature.
    let screen = (word(6), word(8));
    let packed = bytes.get(10).copied().unwrap_or(0);
    let mut at = 13 + if packed & 0x80 != 0 { 3 << ((packed & 7) + 1) } else { 0 };
    // Extensions (0x21, a label and data sub-blocks up to an empty one) come before the first
    // image descriptor (0x2C: left, top, width, height).
    while bytes.get(at) == Some(&0x21) {
        at += 2;
        while let Some(&len) = bytes.get(at) {
            at += 1 + usize::from(len);
            if len == 0 {
                break;
            }
        }
    }
    let frame = (word(at + 1), word(at + 3), word(at + 5), word(at + 7));
    match (bytes.get(at), frame, screen) {
        (Some(0x2C), (Some(0), Some(0), Some(w), Some(h)), (Some(sw), Some(sh))) if (w, h) == (sw, sh) => Ok(()),
        (Some(0x2C), (Some(x), Some(y), Some(w), Some(h)), (Some(sw), Some(sh))) => Err(format!(
            "the GIF's first frame ({w}x{h} at {x},{y}) does not fill its {sw}x{sh} screen; save it with a full first frame"
        )),
        _ => Err("cannot decode image/gif data: no image descriptor".into()),
    }
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
        let Ok(Picture::Raster(image)) = decode_data_uri(&format!("data:image/jpeg;base64,{PNG_1X1}")) else {
            panic!("a PNG")
        };
        assert_eq!(image.size(), (1, 1));
        let unpadded = PNG_1X1.trim_end_matches('=');
        assert!(decode_data_uri(&format!("DATA:image/png;base64,\n{unpadded}")).is_ok());
        // A 2x1 lossless WebP (ImageMagick 7.1), labelled PNG.
        let Ok(Picture::Raster(webp)) = decode_data_uri("data:image/png;base64,UklGRhwAAABXRUJQVlA4TA8AAAAvAQAAAAcQ/Y/+ByKi/wEA") else {
            panic!("a WebP")
        };
        assert_eq!(webp.size(), (2, 1));
    }

    #[test]
    fn reads_svg_and_rejects_broken_data() {
        let svg = |text: &str| format!("data:image/svg+xml;base64,{}", BASE64.encode(text));
        let Ok(Picture::Svg(drawn)) = decode_data_uri(&svg(r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#)) else {
            panic!("an SVG")
        };
        assert!(drawn.items.is_empty());
        let outside = svg(r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.test/a.png"/></svg>"#);
        let not_utf8 = format!("data:image/svg+xml;base64,{}", BASE64.encode([0xFF, 0xFE, 0x3C]));
        for (source, error) in [
            (outside.as_str(), "SVG image: <image> is not in the SVG subset"),
            (not_utf8.as_str(), "SVG image is not UTF-8"),
            ("image.png", "not a data URI"),
            ("data:image/png,abc", "not base64-encoded"),
            ("data:image/png;base64,***", "invalid base64"),
            ("data:image/bmp;base64,Qk0=", "not a PNG, JPEG, GIF, WebP or SVG"),
            ("data:image/webp;base64,UklGRgAAAABXRUJQ", "cannot decode image/webp"),
            ("data:image/gif;base64,R0lGODlh", "no image descriptor"),
            // PNG signature, truncated header.
            ("data:image/png;base64,iVBORw0KGgoAAAA=", "cannot decode image/png"),
            ("data:", "not a data URI"),
        ] {
            let got = decode_data_uri(source).err().unwrap_or_default();
            assert!(got.contains(error), "{source}: {got}");
        }
    }

    /// A GIF89a: a 2x1 screen with a two-color table, an optional graphic control extension, and one
    /// image descriptor at `(x, y)` of size `w x h`.
    fn gif(x: u8, y: u8, w: u8, h: u8) -> Vec<u8> {
        let mut gif = b"GIF89a\x02\x00\x01\x00\x80\x00\x00\xff\x00\x00\x00\x00\xff".to_vec();
        gif.extend_from_slice(b"\x21\xf9\x04\x00\x00\x00\x00\x00");
        gif.extend_from_slice(&[0x2C, x, 0, y, 0, w, 0, h, 0, 0]);
        // LZW minimum code size 2, one data sub-block (clear, 0, 1, end), the block end and the trailer.
        gif.extend_from_slice(b"\x02\x02\x44\x0a\x00\x3b");
        gif
    }

    #[test]
    fn draws_gifs_whose_first_frame_fills_the_screen() {
        let uri = |bytes: Vec<u8>| format!("data:image/gif;base64,{}", BASE64.encode(bytes));
        let Ok(Picture::Raster(image)) = decode_data_uri(&uri(gif(0, 0, 2, 1))) else {
            panic!("a GIF")
        };
        assert_eq!(image.size(), (2, 1));
        let error = decode_data_uri(&uri(gif(1, 0, 1, 1))).err().unwrap_or_default();
        assert!(error.contains("first frame (1x1 at 1,0) does not fill its 2x1 screen"), "{error}");
        // Cut anywhere before the frame size, the header walk stops at the end of the data (krilla
        // reads the pixels when the PDF is written).
        let whole = gif(0, 0, 2, 1);
        for end in 6..36 {
            let cut = whole.get(..end).unwrap_or_default().to_vec();
            assert!(decode_data_uri(&uri(cut)).is_err(), "{end}");
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
