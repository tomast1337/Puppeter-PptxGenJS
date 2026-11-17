//! Images from the model: data-URI decoding, sizing, rounding and opacity.
//!
//! Mirrors the Puppeteer renderer (packages/pptxgenjs/src/render/image.ts): the picture is placed
//! at the rectangle `NormalizedImageSizing` resolved, clipped to the object box (an ellipse when
//! `rounding`). PNG, JPEG, GIF and WebP go through krilla (an animated GIF or WebP draws its first
//! frame, as Chromium prints it); an SVG image is read as the SVG subset (`profile::svg`) and drawn
//! as vectors.
//! Without its `rayon` feature krilla decodes the pixels as soon as the image is created (and
//! reports corrupt pixel data when the document is written, as a serialization error rather than a
//! panic), so the pixel limits below are checked on the header before krilla sees the bytes.

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

/// Most pixels one raster image may have (8192 x 8192, 256 MiB as RGBA): a few KB of compressed
/// data can claim billions of pixels, and decoding them would run the wasm instance out of memory.
pub(crate) const MAX_IMAGE_PIXELS: u64 = 1 << 26;
/// Most pixels the distinct raster images of one presentation may have together (1 GiB as RGBA,
/// a quarter of a wasm32 instance's memory), since krilla keeps each decoded image until the end.
pub(crate) const MAX_DECK_IMAGE_PIXELS: u64 = 1 << 28;

/// A decoded data URI: a raster image or an SVG display list.
#[derive(Clone)]
pub(crate) enum Picture {
    Raster(Image),
    Svg(Rc<Svg>),
}

/// Decodes `data:<mime>;base64,<payload>` by its magic bytes (browsers sniff too, so a mislabelled
/// PNG still draws). `Err` is a broken or unsupported input, or a raster image over
/// `MAX_IMAGE_PIXELS` or over the `deck_pixels_left` the presentation's other images left.
pub(crate) fn decode_data_uri(source: &str, deck_pixels_left: u64) -> Result<Picture, String> {
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
    let within_limits = |size: Option<(u32, u32)>| {
        let (w, h) = size.ok_or_else(|| format!("cannot decode {mime} data: no image size in its header"))?;
        let pixels = u64::from(w) * u64::from(h);
        if pixels > MAX_IMAGE_PIXELS {
            Err(format!("{w}x{h} pixels is over the limit of {MAX_IMAGE_PIXELS} pixels per image; downscale it"))
        } else if pixels > deck_pixels_left {
            Err(format!(
                "{w}x{h} pixels takes the presentation's images over the limit of {MAX_DECK_IMAGE_PIXELS} pixels in total; downscale its images"
            ))
        } else {
            Ok(())
        }
    };
    let decoded = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        within_limits(png_size(&bytes))?;
        Image::from_png(bytes.into(), true)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        within_limits(jpeg_size(&bytes))?;
        Image::from_jpeg(bytes.into(), true)
    } else if bytes.starts_with(b"GIF8") {
        within_limits(gif_first_frame_fills_screen(&bytes)?)?;
        Image::from_gif(bytes.into(), true)
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        within_limits(webp_size(&bytes))?;
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
/// `Ok` is the screen size.
fn gif_first_frame_fills_screen(bytes: &[u8]) -> Result<Option<(u32, u32)>, String> {
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
        (Some(0x2C), (Some(0), Some(0), Some(w), Some(h)), (Some(sw), Some(sh))) if (w, h) == (sw, sh) => Ok(Some((u32::from(w), u32::from(h)))),
        (Some(0x2C), (Some(x), Some(y), Some(w), Some(h)), (Some(sw), Some(sh))) => Err(format!(
            "the GIF's first frame ({w}x{h} at {x},{y}) does not fill its {sw}x{sh} screen; save it with a full first frame"
        )),
        _ => Err("cannot decode image/gif data: no image descriptor".into()),
    }
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
    bytes.get(at..at + 2)?.try_into().ok().map(u16::from_be_bytes)
}

fn le_bytes(bytes: &[u8], at: usize, len: usize) -> Option<u32> {
    let b = bytes.get(at..at + len)?;
    Some(b.iter().rev().fold(0, |n, &byte| (n << 8) | u32::from(byte)))
}

/// PNG: the IHDR chunk comes first (signature, length, type), width then height, big-endian.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let word = |at: usize| bytes.get(at..at + 4)?.try_into().ok().map(u32::from_be_bytes);
    (bytes.get(12..16) == Some(b"IHDR")).then_some(())?;
    Some((word(16)?, word(20)?))
}

/// JPEG: the first start-of-frame segment (SOF0-SOF15 except DHT, JPG and DAC) holds the height
/// then the width, after its length and sample precision.
fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    loop {
        (bytes.get(at) == Some(&0xFF)).then_some(())?;
        let marker = *bytes.get(at + 1)?;
        match marker {
            // Fill bytes before a marker.
            0xFF => at += 1,
            // Markers without a segment: TEM and RSTn.
            0x01 | 0xD0..=0xD7 => at += 2,
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                return Some((u32::from(be16(bytes, at + 7)?), u32::from(be16(bytes, at + 5)?)));
            }
            // The scan (SOS) or the end (EOI) before any frame header.
            0xDA | 0xD9 => return None,
            _ => at += 2 + usize::from(be16(bytes, at + 2)?),
        }
    }
}

/// WebP: the first chunk after the RIFF header is VP8X (canvas size minus one, 24-bit
/// little-endian), VP8L (signature 0x2F, then 14-bit width and height minus one) or VP8 (key
/// frame start code, then 14-bit width and height).
fn webp_size(bytes: &[u8]) -> Option<(u32, u32)> {
    match bytes.get(12..16)? {
        b"VP8X" => Some((le_bytes(bytes, 24, 3)? + 1, le_bytes(bytes, 27, 3)? + 1)),
        b"VP8L" if bytes.get(20) == Some(&0x2F) => {
            let bits = le_bytes(bytes, 21, 4)?;
            Some(((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1))
        }
        b"VP8 " if bytes.get(23..26) == Some(&[0x9D, 0x01, 0x2A]) => Some((le_bytes(bytes, 26, 2)? & 0x3FFF, le_bytes(bytes, 28, 2)? & 0x3FFF)),
        _ => None,
    }
}

/// The rectangle the picture is drawn into, relative to the box origin (px).
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct Placement {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: f32,
    pub(crate) height: f32,
}

pub(crate) fn placement(sizing: &ImageSizing, w: f32, h: f32) -> Placement {
    match *sizing {
        ImageSizing::Stretch => Placement {
            x: 0.0,
            y: 0.0,
            width: w,
            height: h,
        },
        ImageSizing::Contain { x, y, width, height } | ImageSizing::Cover { x, y, width, height } => Placement { x, y, width, height },
        ImageSizing::Crop {
            offset_x,
            offset_y,
            width,
            height,
        } => Placement {
            x: -offset_x,
            y: -offset_y,
            width,
            height,
        },
    }
}

impl Renderer {
    /// Draws the picture over the box `x, y, w, h` (px). `name` labels decode errors.
    #[allow(clippy::too_many_arguments)] // the box is four plain numbers, as in draw_geometry
    pub(crate) fn draw_image(&mut self, surface: &mut Surface, image: &ImageModel, name: &str, x: f32, y: f32, w: f32, h: f32) -> Result<(), String> {
        let picture = match self.images.get(&image.source) {
            Some(decoded) => decoded.clone(),
            None => {
                let left = MAX_DECK_IMAGE_PIXELS.saturating_sub(self.image_pixels);
                let decoded = decode_data_uri(&image.source, left).map_err(|e| format!("image '{name}': {e}"))?;
                if let Picture::Raster(raster) = &decoded {
                    let (w, h) = raster.size();
                    self.image_pixels += u64::from(w) * u64::from(h);
                }
                self.images.insert(image.source.clone(), decoded.clone());
                decoded
            }
        };
        let Placement {
            x: px,
            y: py,
            width: pw,
            height: ph,
        } = placement(&image.sizing, w, h);
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

    fn decode(source: &str) -> Result<Picture, String> {
        decode_data_uri(source, MAX_DECK_IMAGE_PIXELS)
    }

    /// A 1x1 opaque PNG.
    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn decodes_by_magic_bytes_not_by_label() {
        let Ok(Picture::Raster(image)) = decode(&format!("data:image/jpeg;base64,{PNG_1X1}")) else {
            panic!("a PNG")
        };
        assert_eq!(image.size(), (1, 1));
        let unpadded = PNG_1X1.trim_end_matches('=');
        assert!(decode(&format!("DATA:image/png;base64,\n{unpadded}")).is_ok());
        // A 2x1 lossless WebP (ImageMagick 7.1), labelled PNG.
        let Ok(Picture::Raster(webp)) = decode("data:image/png;base64,UklGRhwAAABXRUJQVlA4TA8AAAAvAQAAAAcQ/Y/+ByKi/wEA") else {
            panic!("a WebP")
        };
        assert_eq!(webp.size(), (2, 1));
    }

    #[test]
    fn reads_svg_and_rejects_broken_data() {
        let svg = |text: &str| format!("data:image/svg+xml;base64,{}", BASE64.encode(text));
        let Ok(Picture::Svg(drawn)) = decode(&svg(r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#)) else {
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
            let got = decode(source).err().unwrap_or_default();
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
        let Ok(Picture::Raster(image)) = decode(&uri(gif(0, 0, 2, 1))) else {
            panic!("a GIF")
        };
        assert_eq!(image.size(), (2, 1));
        let error = decode(&uri(gif(1, 0, 1, 1))).err().unwrap_or_default();
        assert!(error.contains("first frame (1x1 at 1,0) does not fill its 2x1 screen"), "{error}");
        // Cut anywhere before the frame size, the header walk stops at the end of the data (krilla
        // reads the pixels when the PDF is written).
        let whole = gif(0, 0, 2, 1);
        for end in 6..36 {
            let cut = whole.get(..end).unwrap_or_default().to_vec();
            assert!(decode(&uri(cut)).is_err(), "{end}");
        }
    }

    #[test]
    fn reads_the_pixel_size_from_each_header() {
        assert_eq!(png_size(&BASE64.decode(PNG_1X1).unwrap_or_default()), Some((1, 1)));
        assert_eq!(
            webp_size(&BASE64.decode("UklGRhwAAABXRUJQVlA4TA8AAAAvAQAAAAcQ/Y/+ByKi/wEA").unwrap_or_default()),
            Some((2, 1))
        );
        // VP8X canvas 300 x 200 (stored minus one), VP8 key frame 640 x 480.
        let vp8x = [b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".as_slice(), &[43, 1, 0, 199, 0, 0]].concat();
        assert_eq!(webp_size(&vp8x), Some((300, 200)));
        let vp8 = [b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0\0\0\0\x9d\x01\x2a".as_slice(), &[0x80, 0x02, 0xE0, 0x01]].concat();
        assert_eq!(webp_size(&vp8), Some((640, 480)));
        // SOI, an APP0 segment, fill bytes, then SOF2 (progressive): height 480, width 640.
        let jpeg = b"\xff\xd8\xff\xe0\x00\x04\x00\x00\xff\xff\xc2\x00\x0b\x08\x01\xe0\x02\x80\x01\x01\x11\x00";
        assert_eq!(jpeg_size(jpeg), Some((640, 480)));
        // DHT (0xC4) is not a frame header; a scan before any frame header has no size.
        assert_eq!(jpeg_size(b"\xff\xd8\xff\xc4\x00\x02\xff\xda\x00\x02"), None);
        // Cut before the end of the frame size (byte 18), there is no size.
        for end in 0..18 {
            assert_eq!(jpeg_size(jpeg.get(..end).unwrap_or_default()), None, "{end}");
        }
    }

    #[test]
    fn rejects_images_over_the_pixel_limits_before_decoding() {
        let uri = |mime: &str, bytes: &[u8]| format!("data:{mime};base64,{}", BASE64.encode(bytes));
        // A PNG header claiming 100000 x 100000 pixels (40 GB as RGBA) and no pixel data.
        let mut png = BASE64.decode(PNG_1X1).unwrap_or_default();
        png.splice(16..24, [100_000u32.to_be_bytes(), 100_000u32.to_be_bytes()].concat());
        // A 16383 x 16383 VP8X canvas, a 65535 x 65535 GIF screen, a 20000 x 20000 JPEG frame.
        let webp = [b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".as_slice(), &[0xFE, 0x3F, 0, 0xFE, 0x3F, 0]].concat();
        let mut big_gif = gif(0, 0, 2, 1);
        big_gif.splice(6..10, [0xFF; 4]);
        big_gif.splice(32..36, [0xFF; 4]);
        let jpeg = b"\xff\xd8\xff\xc0\x00\x0b\x08\x4e\x20\x4e\x20\x01\x01\x11\x00";
        for (source, size) in [
            (uri("image/png", &png), "100000x100000"),
            (uri("image/webp", &webp), "16383x16383"),
            (uri("image/gif", &big_gif), "65535x65535"),
            (uri("image/jpeg", jpeg), "20000x20000"),
        ] {
            let error = decode(&source).err().unwrap_or_default();
            assert!(
                error.contains(&format!("{size} pixels is over the limit of 67108864 pixels per image")),
                "{error}"
            );
        }
        // Within the per-image limit, but past what the presentation's other images left.
        let error = decode_data_uri(&format!("data:image/png;base64,{PNG_1X1}"), 0).err().unwrap_or_default();
        assert!(
            error.contains("1x1 pixels takes the presentation's images over the limit of 268435456 pixels"),
            "{error}"
        );
        let error = decode(&uri("image/png", b"\x89PNG\r\n\x1a\n")).err().unwrap_or_default();
        assert!(error.contains("no image size in its header"), "{error}");
    }

    #[test]
    fn places_each_sizing_mode() {
        let (x, y, width, height) = (5.0, -10.0, 100.0, 120.0);
        let stretched = Placement {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 60.0,
        };
        assert_eq!(placement(&ImageSizing::Stretch, 80.0, 60.0), stretched);
        assert_eq!(
            placement(&ImageSizing::Contain { x, y, width, height }, 80.0, 60.0),
            Placement { x, y, width, height }
        );
        assert_eq!(
            placement(&ImageSizing::Cover { x, y, width, height }, 80.0, 60.0),
            Placement { x, y, width, height }
        );
        let crop = ImageSizing::Crop {
            offset_x: 96.0,
            offset_y: 24.0,
            width: 384.0,
            height: 192.0,
        };
        let cropped = Placement {
            x: -96.0,
            y: -24.0,
            width: 384.0,
            height: 192.0,
        };
        assert_eq!(placement(&crop, 80.0, 60.0), cropped);
    }
}
