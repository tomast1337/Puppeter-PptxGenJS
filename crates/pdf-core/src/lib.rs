//! Renders a PdfLapas HTML profile document (`toHtml()`, docs/HTML_PROFILE.md) straight to PDF: text,
//! shape, image, table and chart objects, and components made of sized boxes.
//!
//! Pure core of the `@pdflapas/wasm` backend, wrapped by `crates/pdf-wasm` (wasm-bindgen): HTML +
//! font bytes in, PDF bytes out. `profile` parses the document into the `model` structs (the subset of
//! the normalized model this renderer reads). Units are CSS px at 96 dpi (`PX_PER_IN`); the PDF page is
//! drawn in px under a `PT_PER_PX` (0.75) scale.

mod color;
mod document_info;
mod effect;
mod image;
mod link;
mod model;
mod path;
mod profile;
mod shape;
mod svg;
mod table;
mod text;

use std::collections::{BTreeSet, HashMap};
use std::ops::Range;

use krilla::Document;
use krilla::annotation::Annotation;
use krilla::geom::{Size, Transform};
use krilla::page::PageSettings;
use krilla::surface::Surface;
use krilla::text::{Font, KrillaGlyph};
use parley::fontique::{Blob, Collection, CollectionOptions, GenericFamily, SourceCache};
use parley::{FontContext, LayoutContext};

use crate::color::unit;
use crate::effect::{Effect, EffectSource, Effects};
use crate::image::Picture;
use crate::link::page_quad;
use crate::model::{Presentation, SlideObject, TextFit};
use crate::path::rect_path;
use crate::table::TableLayout;
use crate::text::draw::LinkQuad;
pub use crate::text::font::MissingFont;
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
    /// Run faces of the current render that no registered font provides (`text::font`).
    missing_fonts: Vec<MissingFont>,
    /// Images of the current render by data URI: each distinct picture is decoded once per
    /// document however often it repeats. Cleared per render so a renderer does not pin old images.
    images: HashMap<String, Picture>,
    /// Pixels of the raster images in `images`, against `image::MAX_DECK_IMAGE_PIXELS`.
    image_pixels: u64,
    /// The slide number each page shows (its `id`, else its position): a slide link jumps to the
    /// page showing that slide, and one to a slide no page shows (hidden, or past the last) is reported.
    page_slides: Vec<u32>,
    /// Link annotations of the page being drawn, attached to it once its surface is finished.
    links: Vec<Annotation>,
    /// Text links of the box being drawn: their run and its clickable area per glyph run.
    link_quads: Vec<LinkQuad>,
    /// Shadow and glow silhouettes being captured, and the buffers their masks are made in.
    effects: Effects,
    // Scratch buffers for the per-object, per-paragraph and per-glyph-run paths: each user
    // clear()s one before filling it, so its capacity survives across objects and renders.
    text_layout: BoxLayout,
    table_layout: TableLayout,
    span_ranges: Vec<Range<usize>>,
    span_families: Vec<String>,
    tab_indices: Vec<usize>,
    tab_clusters: Vec<crate::text::tabs::ClusterX>,
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
            missing_fonts: Vec::new(),
            images: HashMap::new(),
            image_pixels: 0,
            page_slides: Vec::new(),
            links: Vec::new(),
            link_quads: Vec::new(),
            effects: Effects::default(),
            text_layout: BoxLayout::default(),
            table_layout: TableLayout::default(),
            span_ranges: Vec::new(),
            span_families: Vec::new(),
            tab_indices: Vec::new(),
            tab_clusters: Vec::new(),
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

    /// Features of the last rendered document that were not drawn (unsupported object kinds,
    /// effects, options), deduplicated and sorted. `@pdflapas/wasm` throws on them unless the caller passes
    /// `onUnsupported: "warn"`.
    pub fn warnings(&self) -> Vec<String> {
        self.warnings.iter().cloned().collect()
    }

    /// Run faces of the last rendered document that no registered font provides, in the order
    /// the document first uses them. Kept out of `warnings()`: the text is drawn, in a fallback
    /// face, and `@pdflapas/wasm` applies its own `onMissingFont` policy to them.
    pub fn missing_fonts(&self) -> &[MissingFont] {
        &self.missing_fonts
    }

    /// Renders a PdfLapas HTML profile document (`toHtml()`, docs/HTML_PROFILE.md): parses it into
    /// the `model` structs once, then draws them.
    pub fn render_html(&mut self, html: &str) -> Result<Vec<u8>, String> {
        self.reset();
        let model = profile::parse(html).map_err(|e| format!("invalid PdfLapas HTML: {e}"))?;
        self.draw_presentation(&model)
    }

    /// Forgets the previous render's warnings, missing fonts, images and links.
    fn reset(&mut self) {
        self.warnings.clear();
        self.missing_fonts.clear();
        self.images.clear();
        self.image_pixels = 0;
        self.links.clear();
        self.effects.samples = 0;
        self.effects.over_budget = false;
    }

    fn draw_presentation(&mut self, model: &Presentation) -> Result<Vec<u8>, String> {
        let mut document = Document::new();
        document.set_metadata(document_info::krilla_metadata(&model.metadata));
        let page_size = Size::from_wh(model.page_size.width * PT_PER_IN, model.page_size.height * PT_PER_IN).ok_or("invalid page size")?;
        let (page_w, page_h) = (model.page_size.width * PX_PER_IN, model.page_size.height * PX_PER_IN);
        self.find_missing_fonts(model);
        self.page_slides.clear();
        self.page_slides
            .extend(model.slides.iter().zip(1..).map(|(slide, position)| slide.number.unwrap_or(position)));
        for (index, slide) in model.slides.iter().enumerate() {
            let mut page = document.start_page_with(PageSettings::new(page_size));
            let mut surface = page.surface();
            surface.push_transform(&Transform::from_scale(PT_PER_PX, PT_PER_PX));
            if slide.background.3 > 0.0 {
                self.fill(&mut surface, &rect_path(0.0, 0.0, page_w, page_h, 0.0), slide.background);
            }
            // Close the surface before returning an error: krilla asserts balanced push/pop on finish.
            let drawn = slide.objects.iter().try_for_each(|object| self.draw_object(&mut surface, object));
            surface.pop();
            surface.finish();
            for link in self.links.drain(..) {
                page.add_annotation(link);
            }
            page.finish();
            drawn.map_err(|e| format!("slide {}: {e}", index + 1))?;
        }
        let pdf = document.finish().map_err(|e| format!("PDF serialization failed: {e:?}"))?;
        document_info::with_custom_entries(pdf, &model.metadata)
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
            SlideObject::Svg(o) => (&o.style, None, None),
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
            if t.fit == TextFit::Resize {
                h = h.max(layout.height + t.margin[0] + t.margin[2]);
            }
        }

        let opacity = style.transform.opacity < 1.0;
        if opacity {
            surface.push_opacity(unit(style.transform.opacity));
        }
        let shadow = match style.shadow.as_ref().and_then(Effect::shadow) {
            // The profile draws an inner shadow only on a picture (docs/HTML_PROFILE.md): PptxGenJS writes a
            // shape's or text box's as malformed XML, so there is no drawing of one to match.
            Some(Ok(effect)) if effect.inner && !matches!(object, SlideObject::Image(_)) => {
                self.warn("inner shadow not rendered");
                None
            }
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
            Some(effect) => self.under_effect(surface, &effect, EffectSource::Everything, body),
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
        let (style, shape, text, image, table, chart) = match object {
            SlideObject::Text(o) => (&o.style, o.shape.as_ref(), o.text.as_ref(), None, None, None),
            SlideObject::Shape(o) => (&o.style, o.shape.as_ref(), None, None, None, None),
            SlideObject::Image(o) => (&o.style, None, None, Some(&o.image), None, None),
            SlideObject::Table(o) => (&o.style, None, None, None, Some(&o.table), None),
            SlideObject::Svg(o) => (&o.style, None, None, None, None, Some(&o.svg)),
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
        if let Some(chart) = chart {
            self.draw_svg(surface, chart, x, y, w, h);
        }
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
    use crate::color::Rgba;
    use crate::model::build::css;
    use crate::model::{
        ArrowKind, Bullet, ImageModel, ImageObject, ImageSizing, LineModel, Link, ObjectStyle, Outline, Shadow, ShadowKind, ShapeFace, ShapeGeometry,
        ShapeModel, Slide, Table, TableBorder, TableCell, TableObject, TableRow, TextDirection, TextObject, Transform2, VerticalAlign, build,
    };

    /// Draws an already parsed presentation, as `render_html` does after parsing.
    fn render(r: &mut Renderer, model: &Presentation) -> Result<Vec<u8>, String> {
        r.reset();
        r.draw_presentation(model)
    }

    #[test]
    fn renders_without_fonts() {
        let mut r = Renderer::new();
        let html = profile::tests::document(profile::tests::PROGRESS);
        let pdf = r.render_html(&html).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        assert_eq!(r.warnings(), Vec::<String>::new());
    }

    #[test]
    fn writes_the_metadata_and_producer_to_the_info_dictionary_without_a_date() {
        let mut r = Renderer::new();
        let plain = profile::tests::document("");
        let with = plain.replace("<style", r#"<title>Deck</title><meta name="author" content="Ana"><style"#);
        let contains = |pdf: &[u8], needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
        let pdf = r.render_html(&with).unwrap();
        assert!(contains(&pdf, b"<</Title(Deck)/Author(Ana)/Creator(PdfLapas)/Producer(PdfLapas)>>"));
        assert!(!contains(&pdf, b"/Company"));
        let bare = r.render_html(&plain).unwrap();
        assert!(contains(&bare, b"<</Creator(PdfLapas)/Producer(PdfLapas)>>"));
        assert!(!contains(&bare, b"/CreationDate"));
        assert_eq!(bare, r.render_html(&plain).unwrap());

        let company = r
            .render_html(&with.replace("<style", r#"<meta name="pdflapas-company" content="Acme"><style"#))
            .unwrap();
        assert!(contains(
            &company,
            b"<</Title<FEFF004400650063006B>/Author<FEFF0041006E0061>/Company<FEFF00410063006D0065>/Creator<FEFF005000640066004C0061007000610073>/Producer<FEFF005000640066004C0061007000610073>>>"
        ));
        assert!(company.ends_with(b"%%EOF"));
    }

    #[test]
    fn writes_the_caller_s_creator_producer_keywords_and_dates() {
        let mut r = Renderer::new();
        let contains = |pdf: &[u8], needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
        let head = r#"<meta name="keywords" content="k"><meta name="pdflapas-creator" content="App"><meta name="pdflapas-producer" content="Lib"><meta name="pdflapas-creation-date" content="2026-01-02T03:04:05.678Z">"#;
        let html = profile::tests::document("").replace("<style", &format!("{head}<style"));
        // One date is both: krilla writes it, with no incremental update.
        let one = r.render_html(&html).unwrap();
        assert!(contains(
            &one,
            b"<</Keywords(k)/Creator(App)/Producer(Lib)/ModDate(D:20260102030405Z)/CreationDate(D:20260102030405Z)>>"
        ));
        assert!(contains(&one, b"<xmp:ModifyDate>2026-01-02T03:04:05Z</xmp:ModifyDate>"));
        assert!(contains(&one, b"<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>"));
        assert!(!contains(&one, b"/Prev"));
        assert_eq!(one, r.render_html(&html).unwrap());

        // A later modification date: the update's Info has both, and XMP's ModifyDate is replaced in place.
        let later = html.replace("<style", r#"<meta name="pdflapas-modification-date" content="2026-11-19T12:00:00.000Z"><style"#);
        let two = r.render_html(&later).unwrap();
        assert!(two.len() > one.len());
        assert!(contains(&two, b"<xmp:ModifyDate>2026-11-19T12:00:00Z</xmp:ModifyDate>"));
        assert!(contains(&two, b"<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>"));
        assert!(contains(
            &two,
            b"/Creator<FEFF004100700070>/Producer<FEFF004C00690062>/CreationDate(D:20260102030405Z)/ModDate(D:20261119120000Z)>>"
        ));
        assert!(two.ends_with(b"%%EOF"));
    }

    #[test]
    fn renders_profile_html_and_prefixes_its_errors() {
        let mut r = Renderer::new();
        if let Some(font) = liberation_sans() {
            r.add_font(font);
        }
        let image = format!(
            r#"<div class="slide-element slide-image" data-object-name="P" style="left: 0px; top: 0px; width: 96px; height: 96px; transform-origin: center; border-style: none;"><div class="slide-image-frame" style="width: 100%; height: 100%; overflow: hidden; position: relative;"><img class="slide-image-content" data-image-sizing="stretch" alt="" src="{PNG_DATA}" style="display: block; opacity: 1; width: 100%; height: 100%; object-fit: fill;"></div></div>"#
        );
        let html = profile::tests::document(&format!("{}{image}", profile::tests::TEXT));
        assert!(r.render_html(&html).unwrap().starts_with(b"%PDF"));
        assert_eq!(r.warnings(), Vec::<String>::new());

        // A data URI that is not base64 (here not even ASCII) is the decoder's error.
        let broken = html.replace(PNG_DATA, "data:image/png;base64,\u{e9}\u{fffd}==");
        assert!(r.render_html(&broken).is_err());
        let error = r.render_html("<html></html>").unwrap_err();
        assert!(error.starts_with("invalid PdfLapas HTML: "), "{error}");
    }

    #[test]
    fn rejects_bad_colors_and_keywords_naming_the_property() {
        let mut r = Renderer::new();
        let html = profile::tests::document(profile::tests::TEXT);
        assert!(r.render_html(&html).is_ok());
        for (from, to, property) in [
            ("24px; color: #000000;", "24px; color: #FF0000zz;", "CSS property 'color': '#FF0000zz'"),
            ("transparent;", "rgba(1, 2, 3, x);", "CSS property 'background-color': 'rgba(1, 2, 3, x)'"),
            ("#FFFFFF;", "#FFFFF;", "CSS property 'background-color': '#FFFFF'"),
            ("data-text-fit=\"none\"", "data-text-fit=\"grow\"", "attribute 'data-text-fit': 'grow'"),
            ("text-align: left", "text-align: start", "CSS property 'text-align': 'start'"),
            ("align-items: center", "align-items: baseline", "CSS property 'align-items': 'baseline'"),
        ] {
            let error = r.render_html(&html.replacen(from, to, 1)).err().unwrap_or_default();
            assert!(error.starts_with("invalid PdfLapas HTML: ") && error.contains(property), "{error}");
        }
    }

    #[test]
    fn draws_chart_svg_without_warnings() {
        use profile::svg::tests::{BAR3D, ECHARTS, chart};
        let mut r = Renderer::new();
        if let Some(font) = liberation_sans() {
            r.add_font(font);
        }
        let blank = r.render_html(&profile::tests::document(&chart(""))).unwrap();
        let html = profile::tests::document(&format!("{}{}", chart(ECHARTS), chart(BAR3D)));
        let pdf = r.render_html(&html).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        // Paths, a gradient, a soft mask for the group opacity and the text are all written.
        assert!(pdf.len() > blank.len() + 1000, "{} vs {}", pdf.len(), blank.len());
        assert_eq!(r.render_html(&html).unwrap(), pdf, "the same chart gives the same bytes");
    }

    /// A centred 17px cell over `colspan` x `rowspan` slots, with a dashed top border.
    fn cell(colspan: u32, rowspan: u32, fit: TextFit, direction: TextDirection) -> TableCell {
        let border = |dash_array: Option<&str>| TableBorder {
            visible: true,
            color: css("#C00000"),
            width: 2.67,
            dash_array: dash_array.map(Into::into),
        };
        let run = model::Run {
            color: css("#363636"),
            ..build::run("Cell", "Arial", 17.0)
        };
        let paragraph = model::Paragraph {
            align: model::ParagraphAlign::Center,
            ..build::paragraph(vec![run], 20.4, 17.0)
        };
        TableCell {
            text: model::TextBox {
                margin: [7.68; 4],
                vertical_align: VerticalAlign::Middle,
                fit,
                direction,
                ..build::text_box(vec![paragraph])
            },
            colspan,
            rowspan,
            fill: build::fill("#F2F2F2"),
            borders: [border(Some("8 2.67")), border(None), border(None), border(None)],
        }
    }

    #[test]
    fn draws_tables_and_reports_what_it_skips() {
        let mut r = Renderer::new();
        liberation_sans().map(|f| r.add_font(f));
        let table = |extra_cell: Option<TableCell>| {
            let mut style = build::style(48.0, 96.0, 200.0, 0.0);
            style.geometry.height = None;
            let mut second = vec![
                cell(1, 1, TextFit::None, TextDirection::Vertical),
                cell(1, 1, TextFit::None, TextDirection::Horizontal),
            ];
            second.extend(extra_cell);
            let rows = vec![
                TableRow {
                    height: Some(40.0),
                    cells: vec![cell(2, 1, TextFit::None, TextDirection::Horizontal)],
                },
                TableRow { height: None, cells: second },
            ];
            build::deck(vec![SlideObject::Table(TableObject {
                style,
                table: Table {
                    columns: vec![100.0, 100.0],
                    rows,
                },
            })])
        };
        assert!(render(&mut r, &table(None)).unwrap().starts_with(b"%PDF"));
        assert_eq!(r.warnings(), Vec::<String>::new());
        render(&mut r, &table(Some(cell(1, 1, build::SHRINK, TextDirection::Horizontal)))).unwrap();
        assert_eq!(r.warnings(), vec!["table cells beyond the column grid not rendered".to_string()]);
    }

    /// A filled shape with a dashed line, rotated and flipped, over the box (10, 20, 200, 100)
    /// drawn from `geometry` in a 100 x 50 space.
    fn dashed_shape(geometry: ShapeGeometry) -> (ObjectStyle, ShapeModel) {
        let mut style = build::style(10.0, 20.0, 200.0, 100.0);
        style.transform = Transform2 {
            rotation: 30.0,
            flip_h: true,
            flip_v: false,
            opacity: 0.8,
        };
        style.fill = build::fill("rgba(68, 114, 196, 0.5)");
        style.line = Some(LineModel {
            dash_array: Some("8 6".into()),
            ..build::line("#17365D", 2.0)
        });
        (style, build::shape("test", 100.0, 50.0, geometry))
    }

    fn path(data: &str, transform: Option<&str>) -> ShapeGeometry {
        ShapeGeometry::Path {
            data: data.into(),
            transform: transform.map(Into::into),
            faces: None,
            outline_data: None,
        }
    }

    #[test]
    fn draws_every_geometry_kind_without_warnings() {
        let faces = ShapeGeometry::Path {
            data: "M 0 0".into(),
            transform: None,
            faces: Some(vec![
                ShapeFace {
                    data: "M 0 0 L 100 0 L 0 50 Z".into(),
                    fill: Some(Rgba(40, 68, 117, 0.5)),
                },
                ShapeFace {
                    data: "M 0 50 L 100 0 L 100 50 Z".into(),
                    fill: Some(Rgba(68, 114, 196, 0.5)),
                },
            ]),
            outline_data: Some("M 0 0 L 100 0 L 100 50 L 0 50 Z".into()),
        };
        for (index, geometry) in [
            ShapeGeometry::Rect { radius: 8.0 },
            ShapeGeometry::Ellipse,
            ShapeGeometry::Line { inverse: true },
            path("M 0 0 L 100 0 A 50 25 0 0 1 0 50 Q 10 10 0 0 Z", Some("matrix(1 0 0 -1 0 50)")),
            faces,
        ]
        .into_iter()
        .enumerate()
        {
            let (mut style, shape) = dashed_shape(geometry);
            if let Some(line) = style.line.as_mut() {
                line.begin_arrow = Some(ArrowKind::Oval);
                line.end_arrow = Some(ArrowKind::Triangle);
                line.begin_head_path = Some("M 4 0 A 4 4 0 1 0 -4 0 A 4 4 0 1 0 4 0 Z".into());
                line.end_head_path = Some("M 0 0 L -8 4 L -8 -4 Z".into());
            }
            let mut r = Renderer::new();
            let pdf = render(&mut r, &build::deck(vec![build::shape_object(style, shape)])).unwrap();
            assert!(pdf.starts_with(b"%PDF"), "geometry {index}");
            assert_eq!(r.warnings(), Vec::<String>::new(), "geometry {index}");
        }
    }

    #[test]
    fn rejects_invalid_shape_geometry() {
        let mut r = Renderer::new();
        for geometry in [path("M 0 0 X 5 5", None), path("M 0 0 L 5 5", Some("rotate(90)"))] {
            let (style, shape) = dashed_shape(geometry);
            let error = render(&mut r, &build::deck(vec![build::shape_object(style, shape)])).unwrap_err();
            assert!(error.contains("shape"), "{error}");
        }
    }

    #[test]
    fn reports_shape_features_it_does_not_draw() {
        let mut r = Renderer::new();
        let (mut style, shape) = dashed_shape(ShapeGeometry::Line { inverse: false });
        if let Some(line) = style.line.as_mut() {
            line.end_arrow = Some(ArrowKind::Stealth);
        }
        style.shadow = Some(build::shadow("rgba(0, 0, 0, 0.3)", 4.0, 3.0, ShadowKind::Outer));
        render(&mut r, &build::deck(vec![build::shape_object(style, shape)])).unwrap();
        assert_eq!(r.warnings(), vec!["line arrowhead Stealth not rendered"]);
    }

    /// `image` over the box (10, 20, 200, 100), rotated and flipped, named 'Picture 1'.
    fn picture(image: ImageModel) -> SlideObject {
        let mut style = build::style(10.0, 20.0, 200.0, 100.0);
        style.transform = Transform2 {
            rotation: -12.0,
            flip_h: true,
            flip_v: false,
            opacity: 1.0,
        };
        style.object_name = Some("Picture 1".into());
        SlideObject::Image(ImageObject { style, image })
    }

    const PNG_DATA: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn draws_every_image_option_and_decodes_each_source_once() {
        let mut r = Renderer::new();
        let sized = |sizing| ImageModel {
            sizing,
            ..build::image(PNG_DATA)
        };
        let objects = vec![
            picture(build::image(PNG_DATA)),
            picture(sized(ImageSizing::Contain {
                x: 50.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            })),
            picture(ImageModel {
                rounding: true,
                ..sized(ImageSizing::Cover {
                    x: 0.0,
                    y: -50.0,
                    width: 200.0,
                    height: 200.0,
                })
            }),
            picture(ImageModel {
                opacity: 0.55,
                ..sized(ImageSizing::Crop {
                    offset_x: 20.0,
                    offset_y: 10.0,
                    width: 300.0,
                    height: 150.0,
                })
            }),
        ];
        let pdf = render(&mut r, &build::deck(objects)).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert_eq!(r.images.len(), 1, "one distinct source, decoded once");
        assert_eq!(r.image_pixels, 1, "counted once against the presentation's pixel limit");
        // The RGBA picture and its alpha soft mask, written once for four draws.
        assert_eq!(pdf.windows(14).filter(|w| w == b"/Subtype/Image").count(), 2);
        // A second render starts with an empty cache, so old pictures are not kept alive.
        render(&mut r, &build::deck(Vec::new())).unwrap();
        assert!(r.images.is_empty());
        assert_eq!(r.image_pixels, 0);
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

    /// An unfilled rect over (10, 20, 200, 100) linked to `link`.
    fn linked_rect(link: Link, transform: Transform2) -> SlideObject {
        let mut style = build::style(10.0, 20.0, 200.0, 100.0);
        style.transform = transform;
        let shape = ShapeModel {
            link: Some(link),
            ..build::shape("rect", 200.0, 100.0, ShapeGeometry::Rect { radius: 0.0 })
        };
        build::shape_object(style, shape)
    }

    #[test]
    fn links_objects_to_urls_and_slides_over_their_transformed_box() {
        let mut r = Renderer::new();
        let upright = build::style(0.0, 0.0, 0.0, 0.0).transform;
        let turned = Transform2 {
            rotation: 90.0,
            flip_h: true,
            ..build::style(0.0, 0.0, 0.0, 0.0).transform
        };
        let url = Link {
            href: "https://example.com/a".into(),
            tooltip: Some("Open A".into()),
            slide: None,
        };
        let slide = Link {
            href: "#slide-1".into(),
            tooltip: None,
            slide: Some(1),
        };
        let objects = vec![
            linked_rect(url, upright),
            linked_rect(slide, turned),
            picture(ImageModel {
                link: build::link("mailto:a@example.com"),
                ..build::image(PNG_DATA)
            }),
        ];
        let pdf = render(&mut r, &build::deck(objects)).unwrap();
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

    #[test]
    fn slide_links_jump_to_the_page_showing_that_slide_number() {
        let mut r = Renderer::new();
        let upright = || build::style(0.0, 0.0, 0.0, 0.0).transform;
        let to = |slide: u32| Link {
            href: format!("#slide-{slide}"),
            tooltip: None,
            slide: Some(slide),
        };
        // Slide 2 is hidden: the document holds slides 1 and 3, printed as pages 1 and 2.
        let mut deck = build::deck(vec![linked_rect(to(3), upright()), linked_rect(to(2), upright())]);
        let first = deck.slides.remove(0);
        deck.slides = vec![
            Slide { number: Some(1), ..first },
            Slide {
                number: Some(3),
                background: css("#FFFFFF"),
                objects: Vec::new(),
            },
        ];
        let pdf = render(&mut r, &deck).unwrap();
        assert_eq!(
            r.warnings(),
            vec!["link to slide 2 not emitted: no page shows it (hidden, or past the last slide)"]
        );
        let links = annotations(&pdf);
        let [link] = links.as_slice() else {
            panic!("expected 1 annotation: {links:?}")
        };
        // `/Dest <n> 0 R` is the array `[<page> 0 R/XYZ ...]`; its page is the second one /Kids lists.
        let text = String::from_utf8_lossy(&pdf);
        let dest = link.split("/Dest ").nth(1).and_then(|d| d.split(" 0 R").next()).unwrap_or_default();
        let array = text.split(&format!("\n{dest} 0 obj")).nth(1).unwrap_or_default();
        let page = array.trim_start().trim_start_matches('[').split(" 0 R").next().unwrap_or_default();
        let kids = text.split("/Kids[").nth(1).and_then(|k| k.split(']').next()).unwrap_or_default();
        assert_eq!(kids.split(" 0 R").map(str::trim).nth(1), Some(page), "{kids} / {link}");
    }

    /// A filled rect at (10, 20) 200 x 100 px linked to https://example.com, with `shadow`.
    fn linked_rect_with_shadow(shadow: Option<Shadow>) -> Presentation {
        let mut style = build::style(10.0, 20.0, 200.0, 100.0);
        style.fill = build::fill("#4472C4");
        style.shadow = shadow;
        let shape = ShapeModel {
            link: build::link("https://example.com"),
            ..build::shape("rect", 200.0, 100.0, ShapeGeometry::Rect { radius: 0.0 })
        };
        build::deck(vec![build::shape_object(style, shape)])
    }

    #[test]
    fn draws_shadows_as_soft_masked_images_under_the_object() {
        let mut r = Renderer::new();
        let plain = render(&mut r, &linked_rect_with_shadow(None)).unwrap();
        assert!(!String::from_utf8_lossy(&plain).contains("/SMask"));
        let shadow = build::shadow("rgba(0, 0, 0, 0.75)", 10.67, 4.0, ShadowKind::Outer);
        let pdf = render(&mut r, &linked_rect_with_shadow(Some(shadow))).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert!(String::from_utf8_lossy(&pdf).contains("/SMask"), "the shadow is an image with a soft mask");
        // The object moves into a sub-stream; its link must stay on the page where it was.
        let links = annotations(&pdf);
        let [link] = links.as_slice() else { panic!("{links:?}") };
        assert_close(&numbers_after(link, "/QuadPoints"), &[7.5, 315.0, 157.5, 315.0, 157.5, 390.0, 7.5, 390.0]);
    }

    #[test]
    fn stops_drawing_shadows_past_the_renders_sample_budget() {
        // A blur this wide makes a mask of the largest size: the budget holds four of them.
        let huge = || Some(build::shadow("rgba(0, 0, 0, 0.75)", 1e6, 4.0, ShadowKind::Outer));
        let objects = (0..5).flat_map(|_| linked_rect_with_shadow(huge()).slides.remove(0).objects).collect();
        let mut r = Renderer::new();
        render(&mut r, &build::deck(objects)).unwrap();
        assert_eq!(
            r.warnings(),
            vec![format!(
                "shadows and glows past {} mask samples per render not rendered",
                effect::MAX_RENDER_SAMPLES
            )]
        );
        // The budget is per render.
        render(&mut r, &linked_rect_with_shadow(huge())).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
    }

    #[test]
    fn draws_a_pictures_inner_shadow_over_it() {
        let mut r = Renderer::new();
        let mut shadowed = picture(build::image(PNG_DATA));
        if let SlideObject::Image(object) = &mut shadowed {
            object.style.shadow = Some(build::shadow("rgba(0, 0, 0, 0.75)", 10.67, 4.0, ShadowKind::Inner));
        }
        let pdf = render(&mut r, &build::deck(vec![shadowed])).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert!(String::from_utf8_lossy(&pdf).contains("/SMask"), "the shadow is an image with a soft mask");
    }

    /// The profile draws an inner shadow only on a picture: a shape's is reported.
    #[test]
    fn reports_inner_shadows_and_draws_the_object() {
        let mut r = Renderer::new();
        let inset = build::shadow("#000000", 4.0, 2.0, ShadowKind::Inner);
        let pdf = render(&mut r, &linked_rect_with_shadow(Some(inset))).unwrap();
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
        let text = |glow: Option<Shadow>| {
            let run = model::Run {
                color: css("#17365D"),
                glow,
                ..build::run("Glow", "Liberation Sans", 30.0)
            };
            let text = build::text_box(vec![build::paragraph(vec![run], 36.0, 30.0)]);
            build::deck(vec![build::text_object(build::style(10.0, 20.0, 300.0, 60.0), text)])
        };
        let plain = render(&mut r, &text(None)).unwrap();
        assert!(!String::from_utf8_lossy(&plain).contains("/SMask"));
        let glow = build::shadow("rgba(255, 192, 0, 0.6)", 10.67, 0.0, ShadowKind::Outer);
        let pdf = render(&mut r, &text(Some(glow))).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert!(String::from_utf8_lossy(&pdf).contains("/SMask"), "the glow is an image with a soft mask");
    }

    #[test]
    fn draws_a_bounded_number_of_glows_per_text_box() {
        let mut r = Renderer::new();
        let Some(font) = liberation_sans() else {
            return eprintln!("Liberation Sans not installed: glow limit not checked");
        };
        r.add_font(font);
        // One glow per run, each a different radius: thousands of them overflowed the wasm stack.
        let runs = (0..2000)
            .map(|i| model::Run {
                glow: Some(build::shadow("rgba(255, 192, 0, 0.6)", 1.0 + i as f32 / 100.0, 0.0, ShadowKind::Outer)),
                ..build::run("g", "Liberation Sans", 10.0)
            })
            .collect();
        let text = build::text_box(vec![build::paragraph(runs, 12.0, 10.0)]);
        let pdf = render(&mut r, &build::deck(vec![build::text_object(build::style(10.0, 20.0, 600.0, 400.0), text)])).unwrap();
        assert_eq!(r.warnings(), vec!["text glows past the first 16 distinct ones in a text box not rendered"]);
        assert_eq!(String::from_utf8_lossy(&pdf).matches("/SMask").count(), 16);
    }

    #[test]
    fn shadows_a_shape_with_huge_coordinates() {
        let mut r = Renderer::new();
        let (mut style, shape) = dashed_shape(path("M 0 0 C 1e17 0 1e17 1e17 0 1e17 Z", None));
        style.shadow = Some(build::shadow("rgba(0, 0, 0, 0.75)", 10.67, 4.0, ShadowKind::Outer));
        render(&mut r, &build::deck(vec![build::shape_object(style, shape)])).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
    }

    #[test]
    fn links_each_line_of_a_wrapped_run() {
        let mut r = Renderer::new();
        let Some(font) = liberation_sans() else {
            return eprintln!("Liberation Sans not installed: text links not checked");
        };
        r.add_font(font);
        let mut run = model::Run {
            color: css("#0563C1"),
            link: build::link("https://example.com"),
            ..build::run("linked words that wrap", "Liberation Sans", 20.0)
        };
        run.decoration.underline = true;
        let text = build::text_box(vec![build::paragraph(vec![run], 24.0, 20.0)]);
        let pdf = render(&mut r, &build::deck(vec![build::text_object(build::style(10.0, 20.0, 120.0, 200.0), text)])).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        let links = annotations(&pdf);
        assert!(links.len() > 1, "one annotation per line: {links:?}");
        assert!(links.iter().all(|l| l.contains("/URI(https://example.com)")));
    }

    #[test]
    fn links_a_flat_line_over_its_stroke() {
        let mut r = Renderer::new();
        let mut style = build::style(96.0, 192.0, 288.0, 0.0);
        style.line = Some(build::line("#4472C4", 3.0));
        let shape = ShapeModel {
            link: build::link("https://example.com"),
            ..build::shape("line", 288.0, 0.0, ShapeGeometry::Line { inverse: false })
        };
        let pdf = render(&mut r, &build::deck(vec![build::shape_object(style, shape)])).unwrap();
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
        let linked = |link| {
            build::deck(vec![picture(ImageModel {
                link: Some(link),
                ..build::image(PNG_DATA)
            })])
        };
        let script = Link {
            href: "javascript:alert(1)".into(),
            tooltip: None,
            slide: None,
        };
        let error = render(&mut r, &linked(script)).unwrap_err();
        assert_eq!(error, "slide 1: 'Picture 1': link 'javascript:alert(1)' is not an http, https or mailto URL");
        let missing = Link {
            href: "#slide-3".into(),
            tooltip: None,
            slide: Some(3),
        };
        let pdf = render(&mut r, &linked(missing)).unwrap();
        assert_eq!(
            r.warnings(),
            vec!["link to slide 3 not emitted: no page shows it (hidden, or past the last slide)"]
        );
        assert!(annotations(&pdf).is_empty());
    }

    #[test]
    fn rejects_undecodable_image_data_by_object_name() {
        let mut r = Renderer::new();
        let error = render(&mut r, &build::deck(vec![picture(build::image("data:image/png;base64,iVBORw0KGgoAAAA="))])).unwrap_err();
        assert!(error.starts_with("slide 1: image 'Picture 1': cannot decode image/png data"), "{error}");
    }

    /// An SVG image of `body` in a 100 x 50 viewBox.
    fn svg_image(body: &str) -> String {
        use base64::Engine;
        let svg = format!(r#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">{body}</svg>"#);
        format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
    }

    #[test]
    fn draws_svg_images_as_vectors_and_names_what_it_cannot_read() {
        let mut r = Renderer::new();
        let blank = render(&mut r, &build::deck(vec![picture(build::image(&svg_image("")))])).unwrap();
        let shapes =
            svg_image(r##"<rect width="100" height="50" rx="8" fill="navy"/><circle cx="50" cy="25" r="20" style="fill: #fff; stroke: red" opacity=".5"/>"##);
        let mut shadowed = picture(build::image(&shapes));
        if let SlideObject::Image(object) = &mut shadowed {
            object.style.shadow = Some(build::shadow("rgba(0, 0, 0, 0.3)", 4.0, 3.0, ShadowKind::Outer));
        }
        let pdf = render(&mut r, &build::deck(vec![picture(build::image(&shapes)), shadowed])).unwrap();
        assert_eq!(r.warnings(), Vec::<String>::new());
        assert_eq!(r.images.len(), 1, "one distinct source, read once");
        // Vectors, not an image: the only image XObjects are the shadow's colour and soft mask.
        assert_eq!(pdf.windows(14).filter(|w| w == b"/Subtype/Image").count(), 2);
        assert!(pdf.len() > blank.len() + 500, "{} vs {}", pdf.len(), blank.len());

        let error = render(&mut r, &build::deck(vec![picture(build::image(&svg_image(r##"<use href="#a"/>"##)))])).unwrap_err();
        assert!(
            error.starts_with("slide 1: image 'Picture 1': SVG image: <use> is not in the SVG subset"),
            "{error}"
        );
    }

    /// A text-in-shape object whose fill, line, run, outline, highlight and
    /// underline all use `color`, on a slide of that colour.
    fn model_with_color(color: &str) -> Presentation {
        let mut run = model::Run {
            color: css(color),
            highlight: Some(css(color)),
            outline: Some(Outline { color: css(color), width: 1.0 }),
            ..build::run("Ag", "Liberation Sans", 24.0)
        };
        run.decoration.underline = true;
        run.decoration.underline_color = Some(css(color));
        let mut style = build::style(10.0, 10.0, 300.0, 100.0);
        style.transform.opacity = 0.5;
        style.fill = build::fill(color);
        style.line = Some(build::line(color, 2.0));
        let object = SlideObject::Text(TextObject {
            style,
            shape: Some(build::shape("rect", 300.0, 100.0, ShapeGeometry::Rect { radius: 0.0 })),
            text: Some(build::text_box(vec![build::paragraph(vec![run], 38.4, 32.0)])),
        });
        let mut deck = build::deck(vec![object]);
        if let Some(slide) = deck.slides.first_mut() {
            slide.background = css(color);
        }
        deck
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

    /// The Noto Sans CJK collection (JP, KR, SC, TC and HK faces), at the Debian/Ubuntu or the Arch path.
    pub(crate) fn noto_sans_cjk() -> Option<Vec<u8>> {
        [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        ]
        .iter()
        .find_map(|p| std::fs::read(p).ok())
    }

    /// A text box of 30px Liberation Sans paragraphs, each a list of runs (every run after the first
    /// starts a new line) and its `lineBox` height and baseline.
    fn text_box(paragraphs: &[(&[&str], f32, f32)]) -> model::TextBox {
        let paragraph = |&(runs, height, baseline): &(&[&str], f32, f32)| {
            let runs = runs
                .iter()
                .enumerate()
                .map(|(i, text)| model::Run {
                    soft_break_before: i > 0,
                    ..build::run(text, "Liberation Sans", 30.0)
                })
                .collect();
            build::paragraph(runs, height, baseline)
        };
        build::text_box(paragraphs.iter().map(paragraph).collect())
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
    fn a_line_of_from_font_underlines_takes_their_post_bands_averaged_by_width() {
        let run = |text, size| {
            let mut run = build::run(text, "Liberation Sans", size);
            run.decoration.underline = true;
            run.decoration.underline_from_font = true;
            run
        };
        let text = build::text_box(vec![build::paragraph(vec![run("Small run ", 16.0), run("Large run", 32.0)], 40.0, 32.0)]);
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: the line's underline band not checked");
        };
        let line = layout.paras[0].layout.lines().next().expect("one line");
        let runs: Vec<_> = line
            .items()
            .filter_map(|item| match item {
                parley::PositionedLayoutItem::GlyphRun(run) => Some((run.advance(), *run.run().font_metrics())),
                parley::PositionedLayoutItem::InlineBox(_) => None,
            })
            .collect();
        let [(small, s), (large, l)] = runs[..] else { panic!("two glyph runs") };
        let band = crate::text::draw::line_underline_band(&line, &layout.paints).expect("an underlined line");
        let mean = |a: f32, b: f32| (small * a + large * b) / (small + large);
        assert!((band.size - mean(s.underline_size, l.underline_size)).abs() < 1e-4);
        assert!((band.offset - mean(s.underline_offset, l.underline_offset)).abs() < 1e-4);
        // Between the two runs' own bands, nearer the wider run's.
        assert!(s.underline_size < band.size && band.size < l.underline_size && large > small);
    }

    #[test]
    fn a_from_font_underline_with_an_em_band_takes_it_in_place_of_the_post_band() {
        let band_of = |band: Option<model::EmBand>| {
            let mut run = build::run("Band", "Liberation Sans", 20.0);
            run.decoration.underline = true;
            run.decoration.underline_from_font = true;
            run.decoration.underline_band = band;
            let layout = laid_out(&build::text_box(vec![build::paragraph(vec![run], 40.0, 32.0)]))?;
            let line = layout.paras[0].layout.lines().next().expect("one line");
            let metrics = line
                .items()
                .find_map(|item| match item {
                    parley::PositionedLayoutItem::GlyphRun(run) => Some(*run.run().font_metrics()),
                    parley::PositionedLayoutItem::InlineBox(_) => None,
                })
                .expect("a glyph run");
            let band = crate::text::draw::line_underline_band(&line, &layout.paints).expect("an underlined line");
            Some((band.offset, band.size, metrics))
        };
        let Some((offset, size, metrics)) = band_of(Some(model::EmBand { offset: -0.045, size: 0.072 })) else {
            return eprintln!("Liberation Sans not installed: the em underline band not checked");
        };
        assert!((offset - -0.9).abs() < 1e-4 && (size - 1.44).abs() < 1e-4);
        // The post band given as em draws as the post band.
        let post = model::EmBand {
            offset: metrics.underline_offset / 20.0,
            size: metrics.underline_size / 20.0,
        };
        let (offset, size, _) = band_of(Some(post)).expect("installed");
        let (post_offset, post_size, _) = band_of(None).expect("installed");
        assert!((offset - post_offset).abs() < 1e-4 && (size - post_size).abs() < 1e-4);
        assert!((post_offset - metrics.underline_offset).abs() < 1e-4);
    }

    #[test]
    fn stacked_text_puts_every_character_on_its_own_line() {
        let mut text = text_box(&[(&["Ab c", "d"], 36.0, 30.0)]);
        text.direction = TextDirection::Stacked;
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: stacked text not checked");
        };
        // A, b, the space (an empty line, as in LibreOffice), c, then the soft-broken d.
        assert_eq!(layout.baselines, [30.0, 66.0, 102.0, 138.0, 174.0]);
        assert_eq!(layout.paras[0].text, "A\nb\n \nc\nd");
    }

    #[test]
    fn latin_text_in_a_missing_office_face_falls_back_to_liberation_sans_before_cjk() {
        let (Some(sans), Some(cjk)) = (liberation_sans(), noto_sans_cjk()) else {
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
    fn font_kerning_none_lays_text_out_without_pair_kerning() {
        // Liberation Sans kerns "AV" and "Te" pairs tighter, so the kerned line is narrower.
        let mut text = text_box(&[(&["AVAVAV Te Te To"], 36.0, 30.0)]);
        let Some(kerned) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: kerning not checked");
        };
        text.paragraphs[0].runs[0].kerning = false;
        let Some(unkerned) = laid_out(&text) else { return };
        let width = |layout: &BoxLayout| layout.paras[0].layout.width();
        assert!(
            width(&unkerned) > width(&kerned) + 1.0,
            "unkerned {} vs kerned {}",
            width(&unkerned),
            width(&kerned)
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
    fn raises_the_last_line_and_a_line_ending_in_a_soft_break_to_their_baselines() {
        // A wrapped line keeps the line baseline, the line before the soft break and the last line take theirs; every
        // line stays 36px tall, so only the baselines inside it move.
        let mut text = text_box(&[(&[&"word ".repeat(15), "End"], 36.0, 30.0)]);
        if let Some(p) = text.paragraphs.first_mut() {
            (p.line_box.mark_baseline, p.line_box.break_baseline) = (28.0, 29.0);
        }
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: mark and break baselines not checked");
        };
        let para = &layout.paras[0];
        assert_eq!(layout.baselines.get(para.baselines.clone()), Some(&[30.0, 65.0, 100.0][..]));
        assert_eq!(layout.height, 108.0);
    }

    #[test]
    fn tabs_end_at_their_stops() {
        use crate::model::{TabAlign, TabStop};
        let mut text = text_box(&[(&["a\tLeft\tEnd\t12.50\tMid\tx"], 36.0, 30.0)]);
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
    fn a_raised_or_lowered_run_keeps_its_line_box() {
        // On a 36px line box (baseline 30): "Base" and a 20px subscript lowered 8px, a 30px "x" raised 12px, and an
        // empty run raised 4px. The line box already holds what the target grows a line by for an escapement
        // (normalization, #298), so every line is the box's, as Chromium lays out a relatively positioned run.
        let mut text = text_box(&[(&["Base", "sub"], 36.0, 30.0), (&["x"], 36.0, 30.0), (&[""], 36.0, 30.0)]);
        let sub = &mut text.paragraphs[0].runs[1];
        (sub.baseline_offset, sub.font_size, sub.soft_break_before) = (-8.0, 20.0, false);
        text.paragraphs[1].runs[0].baseline_offset = 12.0;
        text.paragraphs[2].runs[0].baseline_offset = 4.0;
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: escapement line box not checked");
        };
        // Baselines are below their paragraph's top.
        assert_eq!(layout.baselines, [30.0, 30.0, 30.0]);
        assert_eq!(layout.height, 108.0);
    }

    #[test]
    fn asks_for_synthetic_bold_and_italic_when_only_the_regular_face_is_loaded() {
        let mut text = text_box(&[(&["Ag"], 36.0, 30.0)]);
        let run = &mut text.paragraphs[0].runs[0];
        (run.bold, run.italic) = (true, true);
        // The LibreOffice target's, from data-synthetic-bold and data-synthetic-italic.
        let libreoffice = model::Synthesis {
            bold_stroke_em: 1.0 / 30.0,
            italic_shear: 0.346_253_56,
        };
        run.synthesis = libreoffice;
        let Some(layout) = laid_out(&text) else {
            return eprintln!("Liberation Sans not installed: synthesis not checked");
        };
        let line = layout.paras[0].layout.lines().next().expect("one line");
        let Some(parley::PositionedLayoutItem::GlyphRun(glyph_run)) = line.items().next() else {
            panic!("the line starts with a glyph run");
        };
        // draw_layout strokes (bold) and shears (italic) exactly these runs, by the run's own amounts.
        let synthesis = glyph_run.run().synthesis();
        assert!(synthesis.embolden() && synthesis.skew().is_some());
        let paint = layout.paints.get(glyph_run.style().brush.0 as usize).map(|p| p.synthesis);
        assert_eq!(paint, Some(libreoffice));
    }

    #[test]
    fn renders_out_of_range_alpha_without_panicking() {
        let mut r = Renderer::new();
        let has_font = liberation_sans().is_some_and(|f| r.add_font(f) > 0);
        if !has_font {
            eprintln!("Liberation Sans not installed: glyph outline paths not exercised");
        }
        // NaN and inf alphas no longer reach the model: `parse_color` rejects them.
        for alpha in ["2", "-1"] {
            let pdf = render(&mut r, &model_with_color(&format!("rgba(10, 20, 30, {alpha})"))).unwrap();
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
    /// The lines of one paragraph of `runs` (all on one line) in a box 1px narrower than the unwrapped text, so
    /// it breaks once, at the last opportunity; None when Liberation Sans is not installed.
    fn lines_one_px_too_narrow(runs: &[&str]) -> Option<Vec<String>> {
        let runs = runs.iter().map(|text| build::run(text, "Liberation Sans", 30.0)).collect();
        let text = build::text_box(vec![build::paragraph(runs, 36.0, 30.0)]);
        let mut r = Renderer::new();
        r.add_font(liberation_sans()?);
        let mut layout = BoxLayout::default();
        r.fit_text(&text, 800.0, 400.0, &mut layout);
        let width = layout.paras.first()?.layout.width();
        r.fit_text(&text, width - 1.0, 400.0, &mut layout);
        let para = layout.paras.first()?;
        Some(
            para.layout
                .lines()
                .filter_map(|line| para.text.get(line.text_range()))
                .map(String::from)
                .collect(),
        )
    }

    #[test]
    fn breaks_lines_where_chromium_does() {
        let cases: [(&[&str], [&str; 2]); 6] = [
            // Blink's ASCII pair table: no break around "/" (UAX #14 breaks after it), also in a URL across two runs.
            (&["lorem amet/elit"], ["lorem ", "amet/elit"]),
            (&["see https://", "example.com/docs"], ["see ", "https://example.com/docs"]),
            // After a space run, even before "." (UAX #14 LB13) or a closing guillemet before ")" (LB15b).
            (&["lorem sit .elit"], ["lorem sit ", ".elit"]),
            (&["(dolor « sit »)"], ["(dolor « sit ", "»)"]),
            // The table breaks before "(" after ")"; the PowerPoint target's U+2060 still joins them (#274).
            (&["lorem word)(word"], ["lorem word)", "(word"]),
            (&["lorem word)\u{2060}(word"], ["lorem ", "word)\u{2060}(word"]),
        ];
        for (runs, expected) in cases {
            let Some(lines) = lines_one_px_too_narrow(runs) else {
                return eprintln!("Liberation Sans not installed: line breaks not checked");
            };
            assert_eq!(lines, expected, "{runs:?}");
        }
    }

    fn shrink_model() -> Presentation {
        let run = |text: &str| {
            let mut run = model::Run {
                color: css("rgb(17, 34, 51)"),
                ..build::run(text, "Arial", 28.0)
            };
            run.decoration.strike = true;
            run
        };
        let para = |runs: Vec<model::Run>, bullet: Option<Bullet>| model::Paragraph {
            align: model::ParagraphAlign::Center,
            space_before: 2.0,
            space_after: 4.0,
            bullet,
            ..build::paragraph(runs, 44.8, 37.33)
        };
        let object = |x: f32, fit: TextFit, paragraphs: Vec<model::Paragraph>| {
            let text = model::TextBox {
                margin: [4.0; 4],
                vertical_align: VerticalAlign::Middle,
                fit,
                ..build::text_box(paragraphs)
            };
            build::text_object(build::style(x, 10.0, 200.0, 60.0), text)
        };
        let bullet = Bullet {
            marker: "•".into(),
            indent: 20.0,
            level: 1,
        };
        let long = vec![run("Shrink this oversized text until it fits "), run("within the fixed box")];
        let shrink = vec![para(long, Some(bullet)), para(vec![run("")], None), para(vec![run("Tail")], None)];
        build::deck(vec![
            object(10.0, build::SHRINK, shrink),
            object(300.0, TextFit::None, vec![para(vec![run("Plain")], None)]),
        ])
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
        let fresh = render(&mut renderer(), &shrink_model()).unwrap();
        let mut reused = renderer();
        render(&mut reused, &model_with_color("#336699")).unwrap();
        for pass in 0..2 {
            assert!(
                render(&mut reused, &shrink_model()).unwrap() == fresh,
                "pass {pass}: output depends on earlier renders"
            );
        }
    }

    /// A renderer with Liberation Sans Regular only, so a bold run is drawn as synthetic bold.
    fn regular_only() -> Renderer {
        let mut r = Renderer::new();
        if let Some(font) = liberation_sans() {
            r.add_font(font);
        }
        r
    }

    // GHSA-fmx3-qwqc-h37c: each of these panicked in pdf-writer's `line width must be positive` assert, which aborts
    // the wasm instance. Now each is invalid HTML.
    #[test]
    fn rejects_negative_font_sizes_and_stroke_widths_as_invalid_html() {
        let bold = profile::tests::TEXT.replace("font-weight: normal", "font-weight: bold");
        let border = profile::tests::TEXT.replace("border-style: none;", "border-color: #FF0000; border-width: -2px; border-style: solid;");
        for (text, property) in [
            (bold.replace("font-size: 24px", "font-size: -1.33px"), "font-size"),
            (
                bold.replace(
                    "text-decoration-style: solid;",
                    "text-decoration-style: solid; -webkit-text-stroke: -2.67px #FF0000;",
                ),
                "-webkit-text-stroke",
            ),
            (border, "border-width"),
        ] {
            let error = regular_only().render_html(&profile::tests::document(&text)).unwrap_err();
            assert!(
                error.starts_with("invalid PdfLapas HTML: ") && error.contains(property) && error.contains("negative"),
                "{error}"
            );
        }
    }

    // GHSA-fmx3-qwqc-h37c: an arc of radius 1e38 gave a path whose bounding box is not finite, and krilla unwrapped it.
    #[test]
    fn rejects_svg_coordinates_that_overflow_once_drawn() {
        use profile::svg::tests::chart;
        for (path, expected) in [
            (
                r##"<path d="M1 0A1 1e38 0 1 1 1 -0.1" stroke="#FF0000" fill="#00FF00"></path>"##,
                "'1e38' is out of range",
            ),
            (r##"<path d="M0 0L-3.5e9-1" stroke="#FF0000"></path>"##, "'-3.5e9' is out of range"),
            (
                r##"<path d="M0 0L1 1" stroke="#FF0000" transform="scale(1e10)"></path>"##,
                "'scale(1e10)' is not a list",
            ),
        ] {
            let error = regular_only().render_html(&profile::tests::document(&chart(path))).unwrap_err();
            assert!(error.starts_with("invalid PdfLapas HTML: ") && error.contains(expected), "{error}");
        }
        let image = svg_image(r##"<path d="M1 0A1 1e38 0 1 1 1 -0.1" stroke="red"/>"##);
        let error = render(&mut regular_only(), &build::deck(vec![picture(build::image(&image))])).unwrap_err();
        assert!(error.contains("'1e38' is out of range"), "{error}");

        // Each transform is in range, their product is not: the path is reported and skipped.
        let nested = format!(
            "{}{}{}",
            r#"<g transform="scale(1e9)">"#.repeat(5),
            r##"<path d="M0 0L1 1Z" stroke="#FF0000" fill="#00FF00"></path>"##,
            "</g>".repeat(5)
        );
        let mut r = regular_only();
        assert!(r.render_html(&profile::tests::document(&chart(&nested))).unwrap().starts_with(b"%PDF"));
        assert_eq!(r.warnings(), vec!["path past the page's coordinate range not rendered".to_owned()]);
    }

    // GHSA-fmx3-qwqc-h37c: krilla unwraps the box of each glyph run, clip path, opacity layer and image it
    // writes, so one that overflows f32 once transformed aborted the wasm instance. Each is now reported and
    // not drawn; the deck still renders.
    #[test]
    fn skips_text_clips_and_images_whose_box_overflows_once_drawn() {
        use profile::svg::tests::chart;
        use profile::tests::{TEXT, document};
        // An opacity layer makes krilla compute the box of what it holds.
        let faded = TEXT.replace("transform-origin: center;", "transform-origin: center; opacity: 0.5;");
        let nested = |inner: &str| format!("{}{inner}{}", r#"<g transform="scale(1e9)">"#.repeat(5), "</g>".repeat(5));
        let clip = r##"<defs><clipPath id="c"><path d="M0 0L10 0L10 10Z" fill="#000"></path></clipPath></defs>"##;
        for (html, warning) in [
            (faded.replace("font-size: 24px", "font-size: 3e38px"), "text"),
            (faded.replace("left: 96px", "left: 3.4e38px").replace("width: 288px", "width: 3.4e38px"), "text"),
            (
                chart(&format!(
                    r#"<g opacity="0.5">{}</g>"#,
                    nested(r##"<text style="font-size:16px;font-family:Arial;" fill="#000000">Hi</text>"##)
                )),
                "text",
            ),
            (
                chart(&format!(
                    r##"{}{clip}"##,
                    nested(r##"<g clip-path="url(#c)"><path d="M0 0L1 1Z" fill="#00FF00"></path></g>"##)
                )),
                "clip path",
            ),
            (chart(&nested(r##"<g opacity="0.5"></g>"##)), "SVG group"),
        ] {
            let mut r = regular_only();
            assert!(r.render_html(&document(&html)).unwrap().starts_with(b"%PDF"), "{html}");
            assert_eq!(r.warnings(), vec![format!("{warning} past the page's coordinate range not rendered")], "{html}");
        }

        // The picture's corners are finite, but turned 45 degrees its box is wider than f32::MAX; the opacity
        // layer makes krilla compute it. Its frame is the clip path checked first.
        let SlideObject::Image(mut wide) = picture(build::image(PNG_DATA)) else {
            panic!("picture() builds an image object")
        };
        wide.style = build::style(-1.7e38, 0.0, 3.4e38, 3.4e38);
        wide.style.transform.rotation = 45.0;
        wide.style.transform.opacity = 0.5;
        let mut r = Renderer::new();
        assert!(render(&mut r, &build::deck(vec![SlideObject::Image(wide)])).unwrap().starts_with(b"%PDF"));
        assert_eq!(r.warnings(), vec!["clip path past the page's coordinate range not rendered".to_owned()]);
    }
}
