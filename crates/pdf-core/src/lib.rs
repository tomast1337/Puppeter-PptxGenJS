//! Renders the text, shape, image and table objects of the normalized model (`getModel()`) straight to PDF.
//!
//! Pure core of the `@pdfdeck/wasm` backend, wrapped by `crates/pdf-wasm` (wasm-bindgen):
//! model JSON + font bytes in, PDF bytes out. Units in the model are CSS px at
//! 96 dpi (`PX_PER_IN`); the PDF page is drawn in px under a `PT_PER_PX` (0.75) scale.

mod color;
mod effect;
mod image;
mod link;
mod model;
mod path;
mod shape;
mod table;
mod text;

use std::collections::{BTreeSet, HashMap};
use std::ops::Range;

use krilla::Document;
use krilla::annotation::Annotation;
use krilla::geom::{Quadrilateral, Size, Transform};
use krilla::page::PageSettings;
use krilla::surface::Surface;
use krilla::text::{Font, KrillaGlyph};
use parley::fontique::{Blob, Collection, CollectionOptions, GenericFamily, SourceCache};
use parley::{FontContext, LayoutContext};

use crate::color::{parse_color, unit};
use crate::effect::{Effect, Effects};
use crate::image::Decoded;
use crate::link::page_quad;
use crate::model::{Presentation, SlideObject};
use crate::path::rect_path;
use crate::table::TableLayout;
use crate::text::layout::{BoxLayout, Brush};

/// Model page sizes are in inches; PDF user space is in points.
const PT_PER_IN: f32 = 72.0;
/// Model geometry is in CSS px.
const PX_PER_IN: f32 = 96.0;
/// The page is drawn in px under this scale.
const PT_PER_PX: f32 = PT_PER_IN / PX_PER_IN;

pub struct Renderer {
    fonts: FontContext,
    layout_cx: LayoutContext<Brush>,
    pdf_fonts: HashMap<(u64, u32), Font>,
    warnings: BTreeSet<String>,
    /// Images of the current render by data URI: each distinct picture is decoded once per
    /// document however often it repeats. Cleared per render so a renderer does not pin old images.
    images: HashMap<String, Decoded>,
    /// Slides in the model being rendered: slide links past it are reported, not emitted.
    page_count: usize,
    /// Link annotations of the page being drawn, attached to it once its surface is finished.
    links: Vec<Annotation>,
    /// Text links of the box being drawn: (paragraph, run) index and its clickable area per glyph run.
    link_quads: Vec<(u32, u32, Quadrilateral)>,
    /// Shadow and glow silhouettes being captured, and the buffers their masks are made in.
    effects: Effects,
    // Scratch buffers for the per-object, per-paragraph and per-glyph-run paths: each user
    // clear()s one before filling it, so its capacity survives across objects and renders.
    text_layout: BoxLayout,
    table_layout: TableLayout,
    span_ranges: Vec<Range<usize>>,
    span_families: Vec<String>,
    tab_indices: Vec<usize>,
    glyph_ranges: Vec<Range<usize>>,
    positioned: Vec<parley::Glyph>,
    glyphs: Vec<KrillaGlyph>,
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
            images: HashMap::new(),
            page_count: 0,
            links: Vec::new(),
            link_quads: Vec::new(),
            effects: Effects::default(),
            text_layout: BoxLayout::default(),
            table_layout: TableLayout::default(),
            span_ranges: Vec::new(),
            span_families: Vec::new(),
            tab_indices: Vec::new(),
            glyph_ranges: Vec::new(),
            positioned: Vec::new(),
            glyphs: Vec::new(),
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

    /// Features of the last rendered model that were not drawn (unsupported object kinds,
    /// effects, options), deduplicated and sorted. `@pdfdeck/wasm` throws on them unless the caller passes
    /// `onUnsupported: "warn"`.
    pub fn warnings(&self) -> Vec<String> {
        self.warnings.iter().cloned().collect()
    }

    pub fn render(&mut self, model_json: &str) -> Result<Vec<u8>, String> {
        self.warnings.clear();
        self.images.clear();
        self.links.clear();
        let model: Presentation = serde_json::from_str(model_json).map_err(|e| format!("invalid model: {e}"))?;
        let mut document = Document::new();
        let page_size = Size::from_wh(model.page_size.width * PT_PER_IN, model.page_size.height * PT_PER_IN).ok_or("invalid page size")?;
        let (page_w, page_h) = (model.page_size.width * PX_PER_IN, model.page_size.height * PX_PER_IN);
        self.page_count = model.slides.len();
        for slide in &model.slides {
            let mut page = document.start_page_with(PageSettings::new(page_size));
            let mut surface = page.surface();
            surface.push_transform(&Transform::from_scale(PT_PER_PX, PT_PER_PX));
            if let Some(bg) = parse_color(&slide.background) {
                self.fill(&mut surface, &rect_path(0.0, 0.0, page_w, page_h, 0.0), bg);
            }
            // Close the surface before returning an error: krilla asserts balanced push/pop on finish.
            let drawn = slide.objects.iter().try_for_each(|object| self.draw_object(&mut surface, object));
            surface.pop();
            surface.finish();
            for link in self.links.drain(..) {
                page.add_annotation(link);
            }
            page.finish();
            drawn?;
        }
        document.finish().map_err(|e| format!("PDF serialization failed: {e:?}"))
    }

    fn warn(&mut self, message: impl Into<String>) {
        self.warnings.insert(message.into());
    }

    fn draw_object(&mut self, surface: &mut Surface, object: &SlideObject) -> Result<(), String> {
        let (style, text, table) = match object {
            SlideObject::Text(o) => (&o.style, o.text.as_ref(), None),
            SlideObject::Shape(o) => (&o.style, None, None),
            SlideObject::Image(o) => (&o.style, None, None),
            SlideObject::Table(o) => (&o.style, None, Some(&o.table)),
            SlideObject::Unsupported(kind) => {
                self.warn(format!("object kind '{kind}' not rendered"));
                return Ok(());
            }
        };
        let g = &style.geometry;
        let (x, y, w) = (g.x, g.y, g.width.unwrap_or(0.0));
        let mut h = g.height.unwrap_or(0.0);

        // A table is as tall as its rows grow (table.rs), not its model height.
        let mut cells = std::mem::take(&mut self.table_layout);
        if let Some(table) = table {
            self.layout_table(table, &mut cells)?;
            h = cells.height();
        }
        let mut layout = std::mem::take(&mut self.text_layout);
        if let Some(t) = text {
            self.fit_text(t, w, h, &mut layout);
            if t.fit == "resize" {
                h = h.max(layout.height + t.margin[0] + t.margin[2]);
            }
        }

        let opacity = style.transform.opacity < 1.0;
        if opacity {
            surface.push_opacity(unit(style.transform.opacity));
        }
        let shadow = match style.shadow.as_ref().and_then(Effect::shadow) {
            Some(Ok(effect)) => Some(effect),
            Some(Err(skipped)) => {
                self.warn(skipped);
                None
            }
            None => None,
        };
        // The shadow is cast in slide space: PptxGenJS writes rotWithShape="0".
        let body = |r: &mut Self, surface: &mut Surface| r.draw_body(surface, object, &layout, &cells, x, y, w, h);
        let drawn = match shadow {
            Some(effect) => self.under_effect(surface, &effect, false, body),
            None => body(self, surface),
        };
        self.text_layout = layout;
        self.table_layout = cells;
        if opacity {
            surface.pop();
        }
        drawn
    }

    /// Draws the object over its box `x, y, w, h` (px), rotated and flipped about its centre.
    #[allow(clippy::too_many_arguments)] // the box is four plain numbers, as in draw_geometry
    fn draw_body(
        &mut self,
        surface: &mut Surface,
        object: &SlideObject,
        layout: &BoxLayout,
        cells: &TableLayout,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> Result<(), String> {
        let (style, shape, text, image, table) = match object {
            SlideObject::Text(o) => (&o.style, o.shape.as_ref(), o.text.as_ref(), None, None),
            SlideObject::Shape(o) => (&o.style, o.shape.as_ref(), None, None, None),
            SlideObject::Image(o) => (&o.style, None, None, Some(&o.image), None),
            SlideObject::Table(o) => (&o.style, None, None, None, Some(&o.table)),
            SlideObject::Unsupported(_) => return Ok(()),
        };
        let t = &style.transform;
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        let (fx, fy) = (if t.flip_h { -1.0 } else { 1.0 }, if t.flip_v { -1.0 } else { 1.0 });
        let rotation = Transform::from_rotate_at(t.rotation, cx, cy);
        let flip = Transform::from_row(fx, 0.0, 0.0, fy, cx - fx * cx, cy - fy * cy);
        surface.push_transform(&rotation);
        surface.push_transform(&flip);

        let name = style.object_name.as_deref().unwrap_or("?");
        let drawn = match image {
            Some(image) => self.draw_image(surface, image, name, x, y, w, h),
            None => self.draw_geometry(surface, shape, style, x, y, w, h),
        };
        // The whole object box is clickable, as the Puppeteer renderer's <a> wrapper is. A straight
        // line's box is flat: it gets the stroke's thickness (Chromium's is the SVG's 1px-high box).
        let link = shape.and_then(|s| s.link.as_ref()).or(image.and_then(|i| i.link.as_ref()));
        let stroke = style.line.as_ref().filter(|l| l.visible).map_or(0.0, |l| l.width).max(1.0);
        let thick = |at: f32, size: f32| if size > 0.0 { (at, size) } else { (at - stroke / 2.0, stroke) };
        let ((lx, lw), (ly, lh)) = (thick(x, w), thick(y, h));
        let mut drawn = drawn.and_then(|()| match link.map(|link| (link, page_quad(surface, lx, ly, lw, lh))) {
            Some((link, Some(quad))) => self.add_link(link, quad).map_err(|e| format!("'{name}': {e}")),
            Some((_, None)) => {
                self.warn("link on an object without a finite box not emitted");
                Ok(())
            }
            None => Ok(()),
        });

        if let Some(text) = text {
            drawn = drawn.and_then(|()| self.draw_text(surface, text, layout, x, y, w, h));
        }
        if let Some(table) = table {
            drawn = drawn.and_then(|()| self.draw_table(surface, table, cells, x, y));
        }
        surface.pop();
        surface.pop();
        drawn
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn renders_without_fonts_and_reports_skips() {
        let mut r = Renderer::new();
        let model = r##"{"pageSize":{"width":10,"height":5.625},"slides":[{"background":"#FFFFFF","objects":[{"kind":"chart","style":{}}]}]}"##;
        let pdf = r.render(model).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        assert_eq!(r.warnings(), vec!["object kind 'chart' not rendered".to_string()]);
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
        for object in [
            r#"{"kind":"text","style":{}}"#,
            r#"{"kind":"shape","style":{}}"#,
            r#"{"kind":"image","style":{}}"#,
            r#"{"kind":"table","style":{}}"#,
        ] {
            assert!(r.render(&slide_with(object)).is_err(), "{object}");
        }
    }

    #[test]
    fn draws_tables_and_reports_what_it_skips() {
        let mut r = Renderer::new();
        liberation_sans().map(|f| r.add_font(f));
        let border = |dash: &str| format!(r##"{{"visible":true,"color":"#C00000","width":2.67{dash}}}"##);
        let cell = |span: &str, fit: &str, direction: &str| {
            format!(
                r##"{{"text":{{"paragraphs":[{{"runs":[{{"text":"Cell","fontFace":"Arial","fontSize":17,"color":"#363636","bold":false,"italic":false,
                "decoration":{{"underline":false,"strike":false,"doubleStrike":false}},"verticalAlign":"baseline","baselineOffset":0,
                "characterSpacing":0,"softBreakBefore":false}}],"align":"center","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[],"defaultTabStop":96,"lineBox":{{"height":20.4,"baseline":17}}}}],
                "margin":[7.68,7.68,7.68,7.68],"verticalAlign":"middle","wrap":true,"fit":"{fit}","direction":"{direction}"}},
                {span},"fill":{{"visible":true,"color":"#F2F2F2"}},"borders":[{},{},{},{}]}}"##,
                border(r#","dashArray":"8 2.67""#),
                border(""),
                border(""),
                border("")
            )
        };
        let table = |extra_cell: &str| {
            slide_with(&format!(
                r#"{{"kind":"table","style":{{"geometry":{{"x":48,"y":96,"width":200}},"transform":{{"rotation":0,"flipH":false,"flipV":false,"opacity":1}}}},
                "table":{{"width":200,"columns":[100,100],"rows":[{{"height":40,"cells":[{}]}},{{"cells":[{},{}{extra_cell}]}}]}}}}"#,
                cell(r#""colspan":2,"rowspan":1"#, "none", "horizontal"),
                cell(r#""colspan":1,"rowspan":1"#, "none", "vertical"),
                cell(r#""colspan":1,"rowspan":1"#, "none", "horizontal"),
            ))
        };
        assert!(r.render(&table("")).unwrap().starts_with(b"%PDF"));
        assert_eq!(r.warnings(), Vec::<String>::new());
        r.render(&table(&format!(",{}", cell(r#""colspan":1,"rowspan":1"#, "shrink", "horizontal"))))
            .unwrap();
        assert_eq!(r.warnings(), vec!["table cells beyond the column grid not rendered".to_string()]);
    }

    /// A filled, stroked shape object with `geometry` (a JSON object without its braces) and
    /// extra `ObjectStyle`/`NormalizedShape` fields.
    fn shape_with(geometry: &str, line: &str, extra_style: &str, extra_shape: &str) -> String {
        slide_with(&format!(
            r##"{{"kind":"shape","style":{{"geometry":{{"x":10,"y":20,"width":200,"height":100}},
            "transform":{{"rotation":30,"flipH":true,"flipV":false,"opacity":0.8}},
            "fill":{{"visible":true,"color":"rgba(68, 114, 196, 0.5)"}},
            "line":{{"visible":true,"color":"#17365D","width":2,"style":"dashed","dashArray":"8 6"{line}}}{extra_style}}},
            "shape":{{"name":"test","width":100,"height":50,"geometry":{{{geometry}}}{extra_shape}}}}}"##
        ))
    }

    #[test]
    fn draws_every_geometry_kind_without_warnings() {
        let arrows =
            r#","beginArrow":"oval","endArrow":"triangle","beginHeadPath":"M 4 0 A 4 4 0 1 0 -4 0 A 4 4 0 1 0 4 0 Z","endHeadPath":"M 0 0 L -8 4 L -8 -4 Z""#;
        for geometry in [
            r#""kind":"rect","radius":8"#,
            r#""kind":"ellipse""#,
            r#""kind":"line","inverse":true"#,
            r#""kind":"path","data":"M 0 0 L 100 0 A 50 25 0 0 1 0 50 Q 10 10 0 0 Z","transform":"matrix(1 0 0 -1 0 50)""#,
            r#""kind":"path","data":"M 0 0","faces":[{"data":"M 0 0 L 100 0 L 0 50 Z","fillModifier":"darken"},{"data":"M 0 50 L 100 0 L 100 50 Z"}],"outlineData":"M 0 0 L 100 0 L 100 50 L 0 50 Z""#,
        ] {
            let mut r = Renderer::new();
            assert!(r.render(&shape_with(geometry, arrows, "", "")).unwrap().starts_with(b"%PDF"), "{geometry}");
            assert_eq!(r.warnings(), Vec::<String>::new(), "{geometry}");
        }
    }

    #[test]
    fn rejects_invalid_shape_geometry() {
        let mut r = Renderer::new();
        for geometry in [
            r#""kind":"path","data":"M 0 0 X 5 5""#,
            r#""kind":"path","data":"M 0 0 L 5 5","transform":"rotate(90)""#,
            r#""kind":"path","data":"M 0 0","faces":[{"data":"M 0 0 L 1 1","fillModifier":"shade"}]"#,
            r#""kind":"star","points":5"#,
        ] {
            let error = r.render(&shape_with(geometry, "", "", "")).unwrap_err();
            assert!(error.contains("shape") || error.contains("invalid model"), "{geometry}: {error}");
        }
    }

    #[test]
    fn reports_shape_features_it_does_not_draw() {
        let mut r = Renderer::new();
        let shadow = r##","shadow":{"visible":true,"color":"rgba(0, 0, 0, 0.3)","blur":4,"offsetX":3,"offsetY":3,"inset":false}"##;
        r.render(&shape_with(r#""kind":"line","inverse":false"#, r#","endArrow":"hook""#, shadow, ""))
            .unwrap();
        assert_eq!(r.warnings(), vec!["line arrowhead 'hook' not rendered"]);
    }

    /// An image object over the box (10, 20, 200, 100), rotated and flipped, with `fields`
    /// (a JSON object) replacing the defaults of its `image`.
    fn image_with(source: &str, fields: &str) -> String {
        let mut object = serde_json::json!({
            "kind": "image",
            "style": {
                "geometry": { "x": 10, "y": 20, "width": 200, "height": 100 },
                "transform": { "rotation": -12, "flipH": true, "flipV": false, "opacity": 1 },
                "objectName": "Picture 1"
            },
            "image": { "source": source, "sourceKind": "data", "sizing": { "type": "stretch" }, "rounding": false, "opacity": 1, "altText": "" }
        });
        let fields: serde_json::Map<String, Value> = serde_json::from_str(fields).unwrap();
        if let Some(image) = object.get_mut("image").and_then(Value::as_object_mut) {
            image.extend(fields);
        }
        object.to_string()
    }

    const PNG_DATA: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn draws_every_image_option_and_decodes_each_source_once() {
        let mut r = Renderer::new();
        let objects = [
            image_with(PNG_DATA, "{}"),
            image_with(PNG_DATA, r#"{"sizing":{"type":"contain","x":50,"y":0,"width":100,"height":100}}"#),
            image_with(
                PNG_DATA,
                r#"{"sizing":{"type":"cover","x":0,"y":-50,"width":200,"height":200},"rounding":true}"#,
            ),
            image_with(
                PNG_DATA,
                r#"{"sizing":{"type":"crop","offsetX":20,"offsetY":10,"width":300,"height":150},"opacity":0.55}"#,
            ),
        ]
        .join(",");
        let pdf = r.render(&slide_with(&objects)).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert_eq!(r.images.len(), 1, "one distinct source, decoded once");
        // The RGBA picture and its alpha soft mask, written once for four draws.
        assert_eq!(pdf.windows(14).filter(|w| w == b"/Subtype/Image").count(), 2);
        // A second render starts with an empty cache, so old pictures are not kept alive.
        r.render(&slide_with("")).unwrap();
        assert!(r.images.is_empty());
    }

    #[test]
    fn reports_images_it_does_not_draw() {
        let mut r = Renderer::new();
        let svg = "data:image/svg+xml;base64,PHN2Zy8+";
        let objects = [image_with(svg, "{}"), image_with("logo.png", r#"{"sourceKind":"path"}"#)].join(",");
        r.render(&slide_with(&objects)).unwrap();
        assert_eq!(
            r.warnings(),
            vec![
                "SVG images not rendered",
                "image source kind 'path' not rendered (resolve it to a data URI first)"
            ]
        );
    }

    /// The PDF's annotations, the PDF syntax of one object each.
    fn annotations(pdf: &[u8]) -> Vec<String> {
        let pdf = String::from_utf8_lossy(pdf);
        pdf.split("/Type/Annot")
            .skip(1)
            .map(|a| a.split("endobj").next().unwrap_or_default().to_owned())
            .collect()
    }

    /// The numbers of the array after `key` in a PDF dictionary, e.g. `/Rect[1 2 3 4]`.
    fn numbers_after(annotation: &str, key: &str) -> Vec<f32> {
        let rest = annotation.split(key).nth(1).unwrap_or_default();
        let list = rest.trim_start().trim_start_matches('[').split(']').next().unwrap_or_default();
        list.split_whitespace().filter_map(|n| n.parse().ok()).collect()
    }

    fn assert_close(got: &[f32], want: &[f32]) {
        assert_eq!(got.len(), want.len(), "{got:?} != {want:?}");
        assert!(got.iter().zip(want).all(|(g, w)| (g - w).abs() < 0.01), "{got:?} != {want:?}");
    }

    #[test]
    fn links_objects_to_urls_and_slides_over_their_transformed_box() {
        let mut r = Renderer::new();
        let shape = |link: &str, transform: &str| {
            format!(
                r#"{{"kind":"shape","style":{{"geometry":{{"x":10,"y":20,"width":200,"height":100}},"transform":{transform}}},
                "shape":{{"name":"rect","width":200,"height":100,"geometry":{{"kind":"rect","radius":0}},"link":{link}}}}}"#
            )
        };
        let objects = [
            shape(
                r#"{"href":"https://example.com/a","tooltip":"Open A"}"#,
                r#"{"rotation":0,"flipH":false,"flipV":false,"opacity":1}"#,
            ),
            shape(
                r##"{"href":"#slide-1","slide":1}"##,
                r#"{"rotation":90,"flipH":true,"flipV":false,"opacity":1}"#,
            ),
            image_with(PNG_DATA, r#"{"link":{"href":"mailto:a@example.com"}}"#),
        ];
        let pdf = r.render(&slide_with(&objects.join(","))).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        let links = annotations(&pdf);
        let [url, slide, mail] = links.as_slice() else {
            panic!("expected 3 annotations: {links:?}")
        };
        assert!(url.contains("/Subtype/Link") && url.contains("/URI(https://example.com/a)"), "{url}");
        assert!(url.contains("/Contents(Open A)"), "the tooltip: {url}");
        assert!(slide.contains("/Dest ") && !slide.contains("/Contents"), "{slide}");
        assert!(mail.contains("/URI(mailto:a@example.com)"), "{mail}");
        // px -> pt (x 0.75), y up from the bottom of the 405pt-high page.
        assert_close(&numbers_after(url, "/QuadPoints"), &[7.5, 315.0, 157.5, 315.0, 157.5, 390.0, 7.5, 390.0]);
        // A quarter turn about the centre (82.5, 352.5) makes the 150 x 75pt box 75 x 150pt; /Rect is its bounding box.
        assert_close(&numbers_after(slide, "/QuadPoints"), &[45.0, 277.5, 45.0, 427.5, 120.0, 427.5, 120.0, 277.5]);
        // The destination is the top-left corner of page 1.
        assert!(String::from_utf8_lossy(&pdf).contains("/XYZ 0 405 0]"));
    }

    /// A linked rect at (10, 20) 200 x 100 px with `shadow` (JSON, or empty for none).
    fn linked_rect_with_shadow(shadow: &str) -> String {
        let shadow = if shadow.is_empty() { String::new() } else { format!(r#","shadow":{shadow}"#) };
        slide_with(&format!(
            r##"{{"kind":"shape","style":{{"geometry":{{"x":10,"y":20,"width":200,"height":100}},
            "transform":{{"rotation":0,"flipH":false,"flipV":false,"opacity":1}},"fill":{{"visible":true,"color":"#4472C4"}}{shadow}}},
            "shape":{{"name":"rect","width":200,"height":100,"geometry":{{"kind":"rect","radius":0}},"link":{{"href":"https://example.com"}}}}}}"##
        ))
    }

    #[test]
    fn draws_shadows_as_soft_masked_images_under_the_object() {
        let mut r = Renderer::new();
        let plain = r.render(&linked_rect_with_shadow("")).unwrap();
        assert!(!String::from_utf8_lossy(&plain).contains("/SMask"));
        let shadow = r##"{"visible":true,"color":"rgba(0, 0, 0, 0.75)","blur":10.67,"offsetX":4,"offsetY":4,"inset":false}"##;
        let pdf = r.render(&linked_rect_with_shadow(shadow)).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert!(String::from_utf8_lossy(&pdf).contains("/SMask"), "the shadow is an image with a soft mask");
        // The object moves into a sub-stream; its link must stay on the page where it was.
        let links = annotations(&pdf);
        let [link] = links.as_slice() else { panic!("{links:?}") };
        assert_close(&numbers_after(link, "/QuadPoints"), &[7.5, 315.0, 157.5, 315.0, 157.5, 390.0, 7.5, 390.0]);
    }

    #[test]
    fn reports_inner_shadows_and_draws_the_object() {
        let mut r = Renderer::new();
        let inset = r##"{"visible":true,"color":"#000000","blur":4,"offsetX":2,"offsetY":2,"inset":true}"##;
        let pdf = r.render(&linked_rect_with_shadow(inset)).unwrap();
        assert_eq!(r.warnings(), vec!["inner shadow not rendered".to_string()]);
        assert!(!String::from_utf8_lossy(&pdf).contains("/SMask"));
        assert_eq!(annotations(&pdf).len(), 1);
    }

    #[test]
    fn draws_text_glow_as_a_soft_masked_image() {
        let mut r = Renderer::new();
        let Some(font) = liberation_sans() else {
            return eprintln!("Liberation Sans not installed: text glow not checked");
        };
        r.add_font(font);
        let text = |glow: &str| {
            slide_with(&format!(
                r##"{{"kind":"text","style":{{"geometry":{{"x":10,"y":20,"width":300,"height":60}},
                "transform":{{"rotation":0,"flipH":false,"flipV":false,"opacity":1}}}},
                "text":{{"paragraphs":[{{"runs":[{{"text":"Glow","fontFace":"Liberation Sans","fontSize":30,"color":"#17365D",
                "bold":false,"italic":false,"decoration":{{"underline":false,"strike":false,"doubleStrike":false}},"verticalAlign":"baseline",
                "baselineOffset":0,"characterSpacing":0,"softBreakBefore":false{glow}}}],
                "align":"left","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[],"defaultTabStop":96,"lineBox":{{"height":36,"baseline":30}}}}],
                "margin":[0,0,0,0],"verticalAlign":"top","wrap":true,"fit":"none","direction":"horz"}}}}"##
            ))
        };
        let plain = r.render(&text("")).unwrap();
        assert!(!String::from_utf8_lossy(&plain).contains("/SMask"));
        let glow = r#","glow":{"visible":true,"color":"rgba(255, 192, 0, 0.6)","blur":10.67,"offsetX":0,"offsetY":0,"inset":false}"#;
        let pdf = r.render(&text(glow)).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert!(String::from_utf8_lossy(&pdf).contains("/SMask"), "the glow is an image with a soft mask");
    }

    #[test]
    fn links_each_line_of_a_wrapped_run() {
        let mut r = Renderer::new();
        let Some(font) = liberation_sans() else {
            return eprintln!("Liberation Sans not installed: text links not checked");
        };
        r.add_font(font);
        let object = r##"{"kind":"text","style":{"geometry":{"x":10,"y":20,"width":120,"height":200},
            "transform":{"rotation":0,"flipH":false,"flipV":false,"opacity":1}},
            "text":{"paragraphs":[{"runs":[{"text":"linked words that wrap","fontFace":"Liberation Sans","fontSize":20,"color":"#0563C1",
            "bold":false,"italic":false,"decoration":{"underline":true,"strike":false,"doubleStrike":false},"verticalAlign":"baseline",
            "baselineOffset":0,"characterSpacing":0,"softBreakBefore":false,"link":{"href":"https://example.com"}}],
            "align":"left","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[],"defaultTabStop":96,"lineBox":{"height":24,"baseline":20}}],
            "margin":[0,0,0,0],"verticalAlign":"top","wrap":true,"fit":"none","direction":"horz"}}"##;
        let pdf = r.render(&slide_with(object)).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        let links = annotations(&pdf);
        assert!(links.len() > 1, "one annotation per line: {links:?}");
        assert!(links.iter().all(|l| l.contains("/URI(https://example.com)")));
    }

    #[test]
    fn links_a_flat_line_over_its_stroke() {
        let mut r = Renderer::new();
        let model = slide_with(
            r##"{"kind":"shape","style":{"geometry":{"x":96,"y":192,"width":288,"height":0},
            "transform":{"rotation":0,"flipH":false,"flipV":false,"opacity":1},"line":{"visible":true,"color":"#4472C4","width":3}},
            "shape":{"name":"line","width":288,"height":0,"geometry":{"kind":"line","inverse":false},"link":{"href":"https://example.com"}}}"##,
        );
        let pdf = r.render(&model).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        let links = annotations(&pdf);
        let [link] = links.as_slice() else { panic!("{links:?}") };
        // 3px (2.25pt) thick about y 192px (261pt from the bottom).
        assert_close(
            &numbers_after(link, "/QuadPoints"),
            &[72.0, 259.875, 288.0, 259.875, 288.0, 262.125, 72.0, 262.125],
        );
    }

    #[test]
    fn rejects_unsafe_link_schemes_and_reports_missing_slides() {
        let mut r = Renderer::new();
        let error = r
            .render(&slide_with(&image_with(PNG_DATA, r#"{"link":{"href":"javascript:alert(1)"}}"#)))
            .unwrap_err();
        assert_eq!(error, "'Picture 1': link 'javascript:alert(1)' is not an http, https or mailto URL");
        let pdf = r
            .render(&slide_with(&image_with(PNG_DATA, r##"{"link":{"href":"#slide-3","slide":3}}"##)))
            .unwrap();
        assert_eq!(r.warnings(), vec!["link to slide 3 not emitted: the deck has 1 slides"]);
        assert!(annotations(&pdf).is_empty());
    }

    #[test]
    fn rejects_undecodable_image_data_by_object_name() {
        let mut r = Renderer::new();
        let error = r.render(&slide_with(&image_with("data:image/png;base64,iVBORw0KGgoAAAA=", "{}"))).unwrap_err();
        assert!(error.starts_with("image 'Picture 1': cannot decode image/png data"), "{error}");
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
            "shape":{{"name":"rect","width":300,"height":100,"geometry":{{"kind":"rect","radius":0}}}},
            "text":{{"paragraphs":[{{"runs":[{run}],"align":"left","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[],"defaultTabStop":96,"lineBox":{{"height":38.4,"baseline":32}}}}],
            "margin":[0,0,0,0],"verticalAlign":"top","wrap":true,"fit":"none","direction":"horz"}}}}]}}]}}"#
        )
    }

    /// Glyph paths (outlines, decorations, glyph buffers) only run for shaped glyphs, which need a font.
    pub(crate) fn liberation_sans() -> Option<Vec<u8>> {
        [
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
        ]
        .iter()
        .find_map(|p| std::fs::read(p).ok())
    }

    /// A text box of 30px Liberation Sans paragraphs, each a list of runs (every run after the first
    /// starts a new line) and its `lineBox` height and baseline.
    fn text_box(paragraphs: &[(&[&str], f32, f32)]) -> model::TextBox {
        let run = |(i, text): (usize, &&str)| {
            format!(
                r##"{{"text":"{text}","fontFace":"Liberation Sans","fontSize":30,"color":"#000000","bold":false,"italic":false,
                "decoration":{{"underline":false,"strike":false,"doubleStrike":false}},"verticalAlign":"baseline",
                "baselineOffset":0,"characterSpacing":0,"softBreakBefore":{}}}"##,
                i > 0
            )
        };
        let paragraphs: Vec<String> = paragraphs
            .iter()
            .map(|(runs, height, baseline)| {
                let runs: Vec<String> = runs.iter().enumerate().map(run).collect();
                format!(
                    r#"{{"runs":[{}],"align":"left","rtl":false,"spaceBefore":0,"spaceAfter":0,"tabStops":[],"defaultTabStop":96,"lineBox":{{"height":{height},"baseline":{baseline}}}}}"#,
                    runs.join(",")
                )
            })
            .collect();
        serde_json::from_str(&format!(
            r#"{{"paragraphs":[{}],"margin":[0,0,0,0],"verticalAlign":"top","wrap":true,"fit":"none","direction":"horz"}}"#,
            paragraphs.join(",")
        ))
        .expect("test text box is valid model JSON")
    }

    /// `text` laid out in an 800x400 box with Liberation Sans, or None when it is not installed.
    fn laid_out(text: &model::TextBox) -> Option<BoxLayout> {
        let mut r = Renderer::new();
        r.add_font(liberation_sans()?);
        let mut layout = BoxLayout::default();
        r.fit_text(text, 800.0, 400.0, &mut layout);
        Some(layout)
    }

    #[test]
    fn stacked_text_puts_every_character_on_its_own_line() {
        let mut text = text_box(&[(&["Ab c", "d"], 36.0, 30.0)]);
        text.direction = "stacked".into();
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: stacked text not checked");
        };
        // A, b, the space (an empty line, as in LibreOffice), c, then the soft-broken d.
        assert_eq!(layout.baselines, [30.0, 66.0, 102.0, 138.0, 174.0]);
        assert_eq!(layout.paras[0].text, "A\nb\n \nc\nd");
    }

    #[test]
    fn latin_text_in_a_missing_office_face_falls_back_to_liberation_sans_before_cjk() {
        let cjk = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        ]
        .iter()
        .find_map(|p| std::fs::read(p).ok());
        let (Some(sans), Some(cjk)) = (liberation_sans(), cjk) else {
            return eprintln!("Liberation Sans or Noto Sans CJK not installed: Latin fallback not checked");
        };
        let mut r = Renderer::new();
        r.add_font(sans.clone());
        r.add_font(cjk);
        // No Carlito or DejaVu Sans loaded: Calibri used to land on Noto Sans CJK JP.
        let mut text = text_box(&[(&["Calibri text"], 36.0, 30.0)]);
        text.paragraphs[0].runs[0].font_face = "Calibri".into();
        let mut layout = BoxLayout::default();
        r.fit_text(&text, 800.0, 400.0, &mut layout);
        let line = layout.paras[0].layout.lines().next().expect("one line");
        let Some(parley::PositionedLayoutItem::GlyphRun(glyph_run)) = line.items().next() else {
            panic!("the line starts with a glyph run");
        };
        assert!(
            glyph_run.run().font().data.as_ref() == sans.as_slice(),
            "Calibri text did not use Liberation Sans"
        );
    }

    #[test]
    fn puts_every_line_on_the_models_line_box() {
        // 1.5x spacing at 30px (LibreOffice): 1.8em = 54px lines, baseline 0.2em = 6px above each line bottom.
        let Some(layout) = laid_out(&text_box(&[(&["Line one", "Line two"], 54.0, 48.0)])) else {
            return eprintln!("Liberation Sans not installed: line box not checked");
        };
        let para = &layout.paras[0];
        assert_eq!(layout.baselines.get(para.baselines.clone()), Some(&[48.0, 102.0][..]));
        assert_eq!(layout.height, 108.0);
    }

    #[test]
    fn tabs_end_at_their_stops() {
        use crate::model::{TabAlign, TabStop};
        let mut text = text_box(&[(&[r"a\tLeft\tEnd\t12.50\tMid\tx"], 36.0, 30.0)]);
        let stop = |position, alignment| TabStop { position, alignment };
        text.paragraphs[0].tab_stops = vec![
            stop(150.0, TabAlign::Left),
            stop(300.0, TabAlign::Right),
            stop(450.0, TabAlign::Decimal),
            stop(600.0, TabAlign::Center),
        ];
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: tab stops not checked");
        };
        let para = &layout.paras[0];
        // Left and right x of the ASCII `needle`.
        let span = |needle: &str| {
            let start = para.text.find(needle).expect("needle in text");
            let cluster = |i| parley::Cluster::from_byte_index(&para.layout, i).expect("cluster in text");
            let last = cluster(start + needle.len() - 1);
            let left = cluster(start).visual_offset().expect("cluster on a line");
            (left, last.visual_offset().expect("cluster on a line") + last.advance())
        };
        let close = |a: f32, b: f32| assert!((a - b).abs() < 0.01, "{a} != {b}");
        close(span("Left").0, 150.0);
        close(span("End").1, 300.0);
        close(span(".50").0, 450.0);
        let (left, right) = span("Mid");
        close((left + right) / 2.0, 600.0);
        let x = |needle| span(needle).0;
        // Past the last stop: the next 96px default stop.
        close(x("x"), 672.0);
    }

    #[test]
    fn a_16px_line_is_1_2em_tall_whatever_parleys_root_style() {
        // parley's root style has no family or size; its default strut once made this line 19.95px.
        let mut text = text_box(&[(&["Arial"], 19.2, 16.0)]);
        text.paragraphs[0].runs[0].font_size = 16.0;
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: 16px line height not checked");
        };
        assert!((layout.height - 19.2).abs() < 1e-4, "{}", layout.height);
    }

    #[test]
    fn a_lowered_subscript_grows_its_line_below_the_baseline() {
        let mut text = text_box(&[(&["Base", "sub"], 36.0, 30.0)]);
        let sub = &mut text.paragraphs[0].runs[1];
        // A 20px subscript lowered 40%, as normalization resolves it.
        (sub.baseline_offset, sub.font_size, sub.soft_break_before) = (-8.0, 20.0, false);
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: subscript line growth not checked");
        };
        // The baseline stays 1.0em below the top; only the descent grows past its 0.2em (6px).
        assert_eq!(layout.baselines, [30.0]);
        assert!(layout.height > 36.5, "{}", layout.height);
    }

    #[test]
    fn asks_for_synthetic_bold_and_italic_when_only_the_regular_face_is_loaded() {
        let mut text = text_box(&[(&["Ag"], 36.0, 30.0)]);
        let run = &mut text.paragraphs[0].runs[0];
        (run.bold, run.italic) = (true, true);
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: synthesis not checked");
        };
        let line = layout.paras[0].layout.lines().next().expect("one line");
        let Some(parley::PositionedLayoutItem::GlyphRun(glyph_run)) = line.items().next() else {
            panic!("the line starts with a glyph run");
        };
        // draw_layout strokes (bold) and shears (italic) exactly these runs.
        let synthesis = glyph_run.run().synthesis();
        assert!(synthesis.embolden() && synthesis.skew().is_some());
    }

    #[test]
    fn renders_out_of_range_and_nan_alpha_without_panicking() {
        let mut r = Renderer::new();
        let has_font = liberation_sans().is_some_and(|f| r.add_font(f) > 0);
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

    /// A shrink-to-fit box (re-laid out several times) holding a bulleted paragraph and an
    /// empty one, beside a plain text box.
    fn shrink_model() -> String {
        let run = |text: &str| {
            format!(
                r#"{{"text":"{text}","fontFace":"Arial","fontSize":28,"color":"rgb(17, 34, 51)","bold":false,"italic":false,
                "decoration":{{"underline":false,"strike":true,"doubleStrike":false}},"verticalAlign":"baseline",
                "baselineOffset":0,"characterSpacing":0,"softBreakBefore":false}}"#
            )
        };
        let para = |runs: &str, bullet: &str| {
            format!(
                r#"{{"runs":[{runs}],"align":"center","rtl":false,"spaceBefore":2,"spaceAfter":4,"tabStops":[],"defaultTabStop":96,"lineBox":{{"height":44.8,"baseline":37.33}}{bullet}}}"#
            )
        };
        let object = |x: u32, fit: &str, paragraphs: &str| {
            format!(
                r#"{{"kind":"text","style":{{"geometry":{{"x":{x},"y":10,"width":200,"height":60}},
                "transform":{{"rotation":0,"flipH":false,"flipV":false,"opacity":1}}}},
                "text":{{"paragraphs":[{paragraphs}],"margin":[4,4,4,4],"verticalAlign":"middle","wrap":true,"fit":"{fit}","direction":"horz"}}}}"#
            )
        };
        let long = format!("{},{}", run("Shrink this oversized text until it fits "), run("within the fixed box"));
        let shrink = [
            para(&long, r#","bullet":{"marker":"•","indent":20,"level":1}"#),
            para(&run(""), ""),
            para(&run("Tail"), ""),
        ]
        .join(",");
        let plain = object(300, "none", &para(&run("Plain"), ""));
        format!(
            r##"{{"pageSize":{{"width":10,"height":5.625}},"slides":[{{"background":"#FFFFFF","objects":[{},{plain}]}}]}}"##,
            object(10, "shrink", &shrink)
        )
    }

    #[test]
    fn reused_scratch_buffers_render_identically() {
        let font = liberation_sans();
        let renderer = || {
            let mut r = Renderer::new();
            if let Some(f) = &font {
                r.add_font(f.clone());
            }
            r
        };
        let fresh = renderer().render(&shrink_model()).unwrap();
        let mut reused = renderer();
        reused.render(&model_with_color("#336699")).unwrap();
        for pass in 0..2 {
            assert!(
                reused.render(&shrink_model()).unwrap() == fresh,
                "pass {pass}: output depends on earlier renders"
            );
        }
    }
}
