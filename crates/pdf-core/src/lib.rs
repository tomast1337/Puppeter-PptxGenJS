//! Spike: render the text objects of `PuppeteerGen.getModel()` straight to PDF.
//!
//! Pure core shared by the `wasm` (wasm-bindgen) and `node` (napi-rs) bindings:
//! model JSON + font bytes in, PDF bytes out. Units in the model are CSS px at
//! 96 dpi; the PDF page is drawn in px under a 0.75 scale.

mod color;
mod model;
mod path;
mod text;

use std::collections::{BTreeSet, HashMap};

use krilla::Document;
use krilla::color::rgb;
use krilla::geom::{Size, Transform};
use krilla::page::PageSettings;
use krilla::paint::{Stroke, StrokeDash};
use krilla::surface::Surface;
use krilla::text::Font;
use parley::fontique::{Blob, Collection, CollectionOptions, GenericFamily, SourceCache};
use parley::{FontContext, LayoutContext};

use crate::color::{parse_color, unit};
use crate::model::{Presentation, SlideObject};
use crate::path::{fill_path, rect_path};
use crate::text::layout::Brush;

pub struct Renderer {
    fonts: FontContext,
    layout_cx: LayoutContext<Brush>,
    pdf_fonts: HashMap<(u64, u32), Font>,
    warnings: BTreeSet<String>,
}

impl Default for Renderer {
    fn default() -> Self {
        Self::new()
    }
}

impl Renderer {
    pub fn new() -> Self {
        let fonts = FontContext {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: false,
            }),
            source_cache: SourceCache::default(),
        };
        Self {
            fonts,
            layout_cx: LayoutContext::new(),
            pdf_fonts: HashMap::new(),
            warnings: BTreeSet::new(),
        }
    }

    /// Registers a font file (TTF/OTF/TTC). Returns the number of faces registered.
    pub fn add_font(&mut self, data: Vec<u8>) -> u32 {
        let families = self.fonts.collection.register_fonts(Blob::from(data), None);
        // parley appends the `emoji` generic family for emoji-presentation clusters.
        for (id, _) in &families {
            if self
                .fonts
                .collection
                .family_name(*id)
                .is_some_and(|name| name.to_ascii_lowercase().contains("emoji"))
            {
                self.fonts.collection.set_generic_families(GenericFamily::Emoji, std::iter::once(*id));
            }
        }
        families.iter().map(|(_, faces)| faces.len() as u32).sum()
    }

    /// Features in the last rendered model that this spike ignored.
    pub fn warnings(&self) -> Vec<String> {
        self.warnings.iter().cloned().collect()
    }

    pub fn render(&mut self, model_json: &str) -> Result<Vec<u8>, String> {
        self.warnings.clear();
        let model: Presentation = serde_json::from_str(model_json).map_err(|e| format!("invalid model: {e}"))?;
        let mut document = Document::new();
        let page_size = Size::from_wh(model.page_size.width * 72.0, model.page_size.height * 72.0).ok_or("invalid page size")?;
        let (page_w, page_h) = (model.page_size.width * 96.0, model.page_size.height * 96.0);
        for slide in &model.slides {
            let mut page = document.start_page_with(PageSettings::new(page_size));
            let mut surface = page.surface();
            surface.push_transform(&Transform::from_scale(0.75, 0.75));
            if let Some(bg) = parse_color(&slide.background) {
                fill_path(&mut surface, rect_path(0.0, 0.0, page_w, page_h, 0.0), bg);
            }
            for object in &slide.objects {
                self.draw_object(&mut surface, object);
            }
            surface.pop();
            surface.finish();
            page.finish();
        }
        document.finish().map_err(|e| format!("PDF serialization failed: {e:?}"))
    }

    fn warn(&mut self, message: impl Into<String>) {
        self.warnings.insert(message.into());
    }

    fn draw_object(&mut self, surface: &mut Surface, object: &SlideObject) {
        let (style, shape, text) = match object {
            SlideObject::Text(o) => (&o.style, o.shape.as_ref(), o.text.as_ref()),
            SlideObject::Shape(o) => (&o.style, o.shape.as_ref(), None),
            SlideObject::Unsupported(kind) => {
                self.warn(format!("object kind '{kind}' not rendered"));
                return;
            }
        };
        let g = &style.geometry;
        let (x, y, w) = (g.x, g.y, g.width.unwrap_or(0.0));
        let mut h = g.height.unwrap_or(0.0);

        let layout = text.map(|t| self.fit_text(t, w, h));
        if let (Some(t), Some(l)) = (&text, &layout)
            && t.fit == "resize"
        {
            h = h.max(l.height + t.margin[0] + t.margin[2]);
        }

        let t = &style.transform;
        let opacity = t.opacity < 1.0;
        if opacity {
            surface.push_opacity(unit(t.opacity));
        }
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        let (fx, fy) = (if t.flip_h { -1.0 } else { 1.0 }, if t.flip_v { -1.0 } else { 1.0 });
        let rotation = Transform::from_rotate_at(t.rotation, cx, cy);
        let flip = Transform::from_row(fx, 0.0, 0.0, fy, cx - fx * cx, cy - fy * cy);
        surface.push_transform(&rotation);
        surface.push_transform(&flip);

        if style.shadow.as_ref().is_some_and(|s| s.visible) {
            self.warn("object shadow not rendered");
        }
        // Geometry: text boxes are rectangles; shapes support rect/roundRect only.
        let radius = match shape.map(|s| (&s.name, &s.geometry)) {
            None => Some(0.0),
            Some((_, geo)) if geo["kind"] == "rect" => Some(geo["radius"].as_f64().unwrap_or(0.0) as f32),
            Some((name, _)) => {
                self.warn(format!("preset shape '{name}' geometry not rendered"));
                None
            }
        };
        if let Some(radius) = radius {
            if let Some(fill) = style.fill.as_ref().filter(|f| f.visible).and_then(|f| parse_color(&f.color)) {
                fill_path(surface, rect_path(x, y, w, h, radius), fill);
            }
            if let Some(line) = style.line.as_ref().filter(|l| l.visible && l.width > 0.0)
                && let Some(color) = parse_color(&line.color).filter(|c| c.3 > 0.0)
            {
                // PowerPoint/LibreOffice centre the stroke on the geometry.
                let dash = line.dash_array.as_ref().map(|d| StrokeDash {
                    array: d.split_whitespace().filter_map(|v| v.parse().ok()).collect(),
                    offset: 0.0,
                });
                surface.set_fill(None);
                surface.set_stroke(Some(Stroke {
                    paint: rgb::Color::new(color.0, color.1, color.2).into(),
                    width: line.width,
                    opacity: unit(color.3),
                    dash,
                    ..Stroke::default()
                }));
                if let Some(path) = rect_path(x, y, w, h, radius) {
                    surface.draw_path(&path);
                }
                surface.set_stroke(None);
            }
        }

        if let (Some(text), Some(layout)) = (&text, &layout) {
            self.draw_text(surface, text, layout, x, y, w, h);
        }

        surface.pop();
        surface.pop();
        if opacity {
            surface.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_without_fonts_and_reports_skips() {
        let mut r = Renderer::new();
        let model = r##"{"pageSize":{"width":10,"height":5.625},"slides":[{"background":"#FFFFFF","objects":[{"kind":"image","style":{}}]}]}"##;
        let pdf = r.render(model).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        assert_eq!(r.warnings(), vec!["object kind 'image' not rendered".to_string()]);
    }

    fn slide_with(object: &str) -> String {
        format!(r##"{{"pageSize":{{"width":10,"height":5.625}},"slides":[{{"background":"#FFFFFF","objects":[{object}]}}]}}"##)
    }

    #[test]
    fn reports_objects_without_a_string_kind() {
        let mut r = Renderer::new();
        r.render(&slide_with(r#"{"style":{}},{"kind":7}"#)).unwrap();
        assert_eq!(r.warnings(), vec!["object kind '?' not rendered".to_string()]);
    }

    #[test]
    fn rejects_malformed_drawn_objects_instead_of_skipping_them() {
        let mut r = Renderer::new();
        // A known kind with a bad payload must not fall through to the unsupported-kind warning.
        for object in [r#"{"kind":"text","style":{}}"#, r#"{"kind":"shape","style":{}}"#] {
            assert!(r.render(&slide_with(object)).is_err(), "{object}");
        }
    }

    /// A text-in-shape object whose fill, line, run, outline, highlight and
    /// underline all use `color`.
    fn model_with_color(color: &str) -> String {
        let run = format!(
            r#"{{"text":"Ag","fontFace":"Liberation Sans","fontSize":24,"color":"{color}","bold":false,"italic":false,
            "decoration":{{"underline":true,"underlineColor":"{color}","strike":false,"doubleStrike":false}},
            "verticalAlign":"baseline","baselineOffset":0,"characterSpacing":0,"highlight":"{color}",
            "outline":{{"color":"{color}","width":1}},"softBreakBefore":false}}"#
        );
        format!(
            r#"{{"pageSize":{{"width":10,"height":5.625}},"slides":[{{"background":"{color}","objects":[{{"kind":"text",
            "style":{{"geometry":{{"x":10,"y":10,"width":300,"height":100}},"transform":{{"rotation":0,"flipH":false,"flipV":false,"opacity":0.5}},
            "fill":{{"visible":true,"color":"{color}"}},"line":{{"visible":true,"color":"{color}","width":2}}}},
            "shape":{{"name":"rect","geometry":{{"kind":"rect","radius":0}}}},
            "text":{{"paragraphs":[{{"runs":[{run}],"align":"left","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[]}}],
            "margin":[0,0,0,0],"verticalAlign":"top","wrap":true,"fit":"none","direction":"horz"}}}}]}}]}}"#
        )
    }

    #[test]
    fn renders_out_of_range_and_nan_alpha_without_panicking() {
        let mut r = Renderer::new();
        // Text paints (outline, highlight, underline) are only drawn for shaped glyphs, which need a font.
        let font = [
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        ]
        .iter()
        .find_map(|p| std::fs::read(p).ok());
        let has_font = font.is_some_and(|f| r.add_font(f) > 0);
        if !has_font {
            eprintln!("Liberation Sans not installed: glyph outline paths not exercised");
        }
        for alpha in ["2", "-1", "NaN", "inf"] {
            let pdf = r.render(&model_with_color(&format!("rgba(10, 20, 30, {alpha})"))).unwrap();
            assert!(pdf.starts_with(b"%PDF"), "alpha {alpha}");
            assert_eq!(
                has_font,
                pdf.windows(9).any(|w| w == b"/FontFile"),
                "alpha {alpha}: glyphs drawn iff a font is installed"
            );
        }
    }
}
