//! Spike: render the text objects of `PuppeteerGen.getModel()` straight to PDF.
//!
//! Pure core shared by the `wasm` (wasm-bindgen) and `node` (napi-rs) bindings:
//! model JSON + font bytes in, PDF bytes out. Units in the model are CSS px at
//! 96 dpi; the PDF page is drawn in px under a 0.75 scale.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use krilla::color::rgb;
use krilla::geom::{Path, PathBuilder, Point, Rect, Size, Transform};
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke, StrokeDash};
use krilla::surface::Surface;
use krilla::text::{Font, GlyphId, KrillaGlyph};
use krilla::{Data, Document};
use parley::fontique::{Blob, Collection, CollectionOptions, GenericFamily, SourceCache};
use parley::{
    Alignment, AlignmentOptions, BaseDirection, FontContext, FontStyle, FontWeight, Layout, LayoutContext, LineHeight, OverflowWrap, PositionedLayoutItem,
    StyleProperty, TextWrapMode, VerticalAlign, WhiteSpaceCollapse,
};
use serde::Deserialize;
use serde_json::Value;

// ---------------------------------------------------------------- model (subset of packages/model/src/types.ts)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Presentation {
    page_size: PageSize,
    slides: Vec<Slide>,
}

#[derive(Deserialize)]
struct PageSize {
    width: f32,
    height: f32,
}

#[derive(Deserialize)]
struct Slide {
    background: String,
    objects: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectStyle {
    geometry: Geometry,
    transform: Transform2,
    fill: Option<FillModel>,
    line: Option<LineModel>,
    shadow: Option<Visible>,
}

#[derive(Deserialize)]
struct Geometry {
    x: f32,
    y: f32,
    width: Option<f32>,
    height: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transform2 {
    rotation: f32,
    flip_h: bool,
    flip_v: bool,
    opacity: f32,
}

#[derive(Deserialize)]
struct Visible {
    visible: bool,
}

#[derive(Deserialize)]
struct FillModel {
    visible: bool,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineModel {
    visible: bool,
    color: String,
    width: f32,
    dash_array: Option<String>,
}

#[derive(Deserialize)]
struct ShapeModel {
    name: String,
    geometry: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextBox {
    paragraphs: Vec<Paragraph>,
    margin: [f32; 4],
    vertical_align: String,
    wrap: bool,
    fit: String,
    direction: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paragraph {
    runs: Vec<Run>,
    align: String,
    rtl: bool,
    line_height: Option<f32>,
    space_before: f32,
    space_after: f32,
    tab_stops: Vec<Value>,
    bullet: Option<Bullet>,
}

#[derive(Deserialize)]
struct Bullet {
    marker: String,
    indent: f32,
    level: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    text: String,
    font_face: String,
    font_size: f32,
    color: String,
    bold: bool,
    italic: bool,
    decoration: Decoration,
    vertical_align: String,
    baseline_offset: f32,
    character_spacing: f32,
    highlight: Option<String>,
    outline: Option<Outline>,
    glow: Option<Value>,
    shadow: Option<Visible>,
    link: Option<Value>,
    soft_break_before: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Decoration {
    underline: bool,
    underline_color: Option<String>,
    strike: bool,
    double_strike: bool,
}

#[derive(Deserialize)]
struct Outline {
    color: String,
    width: f32,
}

// ---------------------------------------------------------------- colors & fonts

#[derive(Clone, Copy, PartialEq, Debug, Default)]
struct Rgba(u8, u8, u8, f32);

/// The model carries CSS colors: `#RRGGBB`, `rgba(r, g, b, a)` or `transparent`.
fn parse_color(css: &str) -> Option<Rgba> {
    let css = css.trim();
    if let Some(hex) = css.strip_prefix('#') {
        let v = u32::from_str_radix(hex.get(..6)?, 16).ok()?;
        return Some(Rgba((v >> 16) as u8, (v >> 8) as u8, v as u8, 1.0));
    }
    let inner = css.strip_prefix("rgba(").or_else(|| css.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<f32> = inner.split(',').filter_map(|p| p.trim().parse().ok()).collect();
    match parts.as_slice() {
        [r, g, b] => Some(Rgba(*r as u8, *g as u8, *b as u8, 1.0)),
        [r, g, b, a] => Some(Rgba(*r as u8, *g as u8, *b as u8, *a)),
        _ => None,
    }
}

fn fill_of(c: Rgba) -> Fill {
    Fill {
        paint: rgb::Color::new(c.0, c.1, c.2).into(),
        opacity: NormalizedF32::new(c.3.clamp(0.0, 1.0)).unwrap(),
        ..Fill::default()
    }
}

/// Requested face first, then the metric-compatible alias the docker image's
/// fontconfig (30-metric-aliases.conf) would pick, then DejaVu Sans, the
/// image's default sans-serif, which also covers Arabic/Greek/Cyrillic, then
/// Noto Sans CJK JP for Han/Kana/Hangul. Emoji clusters additionally fall
/// through to the registered `emoji` generic family (see `add_font`).
fn family_stack(face: &str) -> String {
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

// ---------------------------------------------------------------- layout

/// Per-run paint data that parley does not carry; the parley brush is the index.
#[derive(Clone)]
struct RunPaint {
    color: Rgba,
    highlight: Option<Rgba>,
    outline: Option<(Rgba, f32)>,
    underline: bool,
    underline_color: Option<Rgba>,
    strike: bool,
    double_strike: bool,
    baseline_offset: f32,
}

#[derive(Clone, Copy, PartialEq, Debug, Default)]
struct Brush(u32);

struct ParaLayout {
    text: String,
    layout: Layout<Brush>,
    x: f32,
    y: f32,
    marker: Option<(String, Layout<Brush>, f32)>,
}

struct BoxLayout {
    paras: Vec<ParaLayout>,
    paints: Vec<RunPaint>,
    width: f32,
    height: f32,
}

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
                self.draw_object(&mut surface, object)?;
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

    fn draw_object(&mut self, surface: &mut Surface, object: &Value) -> Result<(), String> {
        let kind = object.get("kind").and_then(Value::as_str).unwrap_or("?");
        if kind != "text" && kind != "shape" {
            self.warn(format!("object kind '{kind}' not rendered"));
            return Ok(());
        }
        let style: ObjectStyle = serde_json::from_value(object["style"].clone()).map_err(|e| format!("style: {e}"))?;
        let shape: Option<ShapeModel> = match object.get("shape") {
            Some(v) if !v.is_null() => Some(serde_json::from_value(v.clone()).map_err(|e| format!("shape: {e}"))?),
            _ => None,
        };
        let text: Option<TextBox> = match object.get("text") {
            Some(v) if kind == "text" => Some(serde_json::from_value(v.clone()).map_err(|e| format!("text: {e}"))?),
            _ => None,
        };
        let g = &style.geometry;
        let (x, y, w) = (g.x, g.y, g.width.unwrap_or(0.0));
        let mut h = g.height.unwrap_or(0.0);

        let layout = text.as_ref().map(|t| self.fit_text(t, w, h));
        if let (Some(t), Some(l)) = (&text, &layout)
            && t.fit == "resize"
        {
            h = h.max(l.height + t.margin[0] + t.margin[2]);
        }

        let t = &style.transform;
        let opacity = t.opacity < 1.0;
        if opacity {
            surface.push_opacity(NormalizedF32::new(t.opacity.clamp(0.0, 1.0)).unwrap());
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
        let radius = match shape.as_ref().map(|s| (&s.name, &s.geometry)) {
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
                    opacity: NormalizedF32::new(color.3).unwrap(),
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
        Ok(())
    }

    /// Lays the box out, applying the current renderer's shrink-to-fit rule:
    /// scale fonts (and px line heights) by 0.95 up to 20 times while the
    /// content overflows the inset box.
    fn fit_text(&mut self, text: &TextBox, w: f32, h: f32) -> BoxLayout {
        let [top, right, bottom, left] = text.margin;
        let vertical = text.direction == "vertical" || text.direction == "vertical270";
        if text.direction == "stacked" {
            self.warn("stacked (wordArtVert) text direction rendered horizontally");
        }
        let (inner_w, inner_h) = if vertical {
            (h - top - bottom, w - left - right)
        } else {
            (w - left - right, h - top - bottom)
        };
        let mut scale = 1.0;
        let mut layout = self.layout_text(text, inner_w, scale);
        if text.fit == "shrink" {
            for _ in 0..20 {
                if layout.height <= inner_h + 0.5 && layout.width <= inner_w + 0.5 {
                    break;
                }
                scale *= 0.95;
                layout = self.layout_text(text, inner_w, scale);
            }
        }
        layout
    }

    fn layout_text(&mut self, text: &TextBox, inner_w: f32, scale: f32) -> BoxLayout {
        let mut paints = Vec::new();
        let mut paras = Vec::new();
        let (mut y, mut width) = (0.0f32, 0.0f32);
        for paragraph in &text.paragraphs {
            if !paragraph.tab_stops.is_empty() {
                self.warn("tab stops ignored");
            }
            let (indent, marker_x) = match &paragraph.bullet {
                Some(b) => (b.indent, b.indent / (b.level as f32 + 1.0) * b.level as f32),
                None => (0.0, 0.0),
            };
            let max_w = if text.wrap { Some((inner_w - indent).max(1.0)) } else { None };

            // Runs -> one string plus style spans. Empty paragraphs keep a line box.
            let mut s = String::new();
            let mut spans = Vec::new();
            for (i, run) in paragraph.runs.iter().enumerate() {
                if run.soft_break_before && i > 0 {
                    s.push('\n');
                }
                let start = s.len();
                s.push_str(&run.text);
                spans.push((start..s.len(), run));
            }
            let first = paragraph.runs.first();
            if s.is_empty() {
                s.push('\u{200B}');
                if let Some(r) = first {
                    spans = vec![(0..s.len(), r)];
                }
            }

            let line_height = match paragraph.line_height {
                None => LineHeight::FontSizeRelative(DEFAULT_LINE_HEIGHT),
                Some(v) if v < 10.0 => LineHeight::FontSizeRelative(v),
                Some(v) => LineHeight::Absolute(v * scale),
            };
            let mut builder = self.layout_cx.ranged_builder(&mut self.fonts, &s, 1.0, false);
            builder.set_base_direction(if paragraph.rtl { BaseDirection::Rtl } else { BaseDirection::Ltr });
            builder.push_default(StyleProperty::LineHeight(line_height));
            builder.push_default(StyleProperty::WhiteSpaceCollapse(WhiteSpaceCollapse::Preserve));
            builder.push_default(StyleProperty::OverflowWrap(OverflowWrap::BreakWord));
            builder.push_default(StyleProperty::TextWrapMode(if text.wrap { TextWrapMode::Wrap } else { TextWrapMode::NoWrap }));
            let mut families = Vec::new();
            for (range, run) in &spans {
                families.push((range.clone(), family_stack(&run.font_face)));
            }
            for ((range, run), (_, family)) in spans.iter().zip(&families) {
                let index = paints.len() as u32;
                let color = parse_color(&run.color).unwrap_or_default();
                paints.push(RunPaint {
                    color,
                    highlight: run.highlight.as_deref().and_then(parse_color),
                    outline: run.outline.as_ref().and_then(|o| parse_color(&o.color).map(|c| (c, o.width))),
                    underline: run.decoration.underline,
                    underline_color: run.decoration.underline_color.as_deref().and_then(parse_color),
                    strike: run.decoration.strike,
                    double_strike: run.decoration.double_strike,
                    baseline_offset: run.baseline_offset,
                });
                let r = range.clone();
                builder.push(StyleProperty::FontFamily(family.as_str().into()), r.clone());
                builder.push(StyleProperty::FontSize(run.font_size * scale), r.clone());
                builder.push(
                    StyleProperty::FontWeight(if run.bold { FontWeight::BOLD } else { FontWeight::NORMAL }),
                    r.clone(),
                );
                builder.push(
                    StyleProperty::FontStyle(if run.italic { FontStyle::Italic } else { FontStyle::Normal }),
                    r.clone(),
                );
                builder.push(StyleProperty::Brush(Brush(index)), r.clone());
                if run.character_spacing != 0.0 {
                    builder.push(StyleProperty::LetterSpacing(run.character_spacing), r.clone());
                }
                match run.vertical_align.as_str() {
                    "super" => builder.push(StyleProperty::VerticalAlign(VerticalAlign::SUPER), r.clone()),
                    "sub" => builder.push(StyleProperty::VerticalAlign(VerticalAlign::SUB), r.clone()),
                    _ => {}
                }
            }
            // parley tries the run's own stack before the emoji family, so a text font that has
            // U+2764 wins even with VS16. Force emoji presentation: base char + U+FE0F go to the emoji font.
            // shortcut: covers only `X U+FE0F`; ZWJ/keycap sequences already resolve via parley's emoji path.
            for (i, _) in s.match_indices('\u{FE0F}') {
                if let Some((start, _)) = s[..i].char_indices().next_back() {
                    builder.push(StyleProperty::FontFamily("\"Noto Color Emoji\"".into()), start..i + 3);
                }
            }
            let mut layout: Layout<Brush> = builder.build(&s);
            for run in &paragraph.runs {
                if run.glow.is_some() || run.shadow.as_ref().is_some_and(|s| s.visible) {
                    self.warn("text glow/shadow not rendered");
                }
                if run.link.is_some() {
                    self.warn("hyperlink annotations not emitted (styling only)");
                }
            }
            let alignment = match paragraph.align.as_str() {
                "center" => Alignment::Center,
                "right" => Alignment::Right,
                "justify" => Alignment::Justify,
                _ => Alignment::Left,
            };
            // parley applies the alignment while breaking lines, so set it first.
            layout.set_alignment(
                alignment,
                AlignmentOptions {
                    align_when_overflowing: true,
                    ..AlignmentOptions::default()
                },
            );
            layout.break_all_lines(max_w);

            // Unwrapped text: align the single line manually against the inset box.
            let x = indent
                + if max_w.is_none() {
                    let slack = inner_w - indent - layout.width();
                    match alignment {
                        Alignment::Center => slack / 2.0,
                        Alignment::Right => slack,
                        _ => 0.0,
                    }
                } else {
                    0.0
                };

            let marker = match (&paragraph.bullet, first) {
                (Some(b), Some(run)) => {
                    let mut mb = self.layout_cx.ranged_builder(&mut self.fonts, &b.marker, 1.0, false);
                    let index = paints.len() as u32;
                    paints.push(RunPaint {
                        color: parse_color(&run.color).unwrap_or_default(),
                        highlight: None,
                        outline: None,
                        underline: false,
                        underline_color: None,
                        strike: false,
                        double_strike: false,
                        baseline_offset: 0.0,
                    });
                    mb.push_default(StyleProperty::FontFamily(family_stack(&run.font_face).as_str().into()));
                    mb.push_default(StyleProperty::FontSize(run.font_size * scale));
                    mb.push_default(StyleProperty::Brush(Brush(index)));
                    let mut ml: Layout<Brush> = mb.build(&b.marker);
                    ml.break_all_lines(None);
                    Some((b.marker.clone(), ml, marker_x))
                }
                _ => None,
            };

            // PowerPoint adds paragraph spacing (CSS would collapse adjacent margins).
            y += paragraph.space_before;
            width = width.max(x + layout.width());
            let height = layout.height();
            paras.push(ParaLayout { text: s, layout, x, y, marker });
            y += height + paragraph.space_after;
        }
        BoxLayout {
            paras,
            paints,
            width,
            height: y,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_text(&mut self, surface: &mut Surface, text: &TextBox, layout: &BoxLayout, x: f32, y: f32, w: f32, h: f32) {
        let [top, right, bottom, left] = text.margin;
        let (ix, iy, iw, ih) = (x + left, y + top, w - left - right, h - top - bottom);
        // Local frame: u along the line, v along the block axis.
        let (frame, block) = match text.direction.as_str() {
            "vertical" => (Transform::from_row(0.0, 1.0, -1.0, 0.0, ix + iw, iy), iw),
            "vertical270" => (Transform::from_row(0.0, -1.0, 1.0, 0.0, ix, iy + ih), iw),
            _ => (Transform::from_translate(ix, iy), ih),
        };
        let v0 = match text.vertical_align.as_str() {
            "middle" => (block - layout.height) / 2.0,
            "bottom" => block - layout.height,
            _ => 0.0,
        };
        surface.push_transform(&frame);
        for para in &layout.paras {
            if let Some((marker, ml, mx)) = &para.marker {
                // Marker shares the first line's baseline.
                let first_baseline = para.layout.lines().next().map(|l| l.metrics().baseline).unwrap_or(0.0);
                let marker_baseline = ml.lines().next().map(|l| l.metrics().baseline).unwrap_or(0.0);
                self.draw_layout(surface, ml, marker, &layout.paints, *mx, v0 + para.y + first_baseline - marker_baseline);
            }
            self.draw_layout(surface, &para.layout, &para.text, &layout.paints, para.x, v0 + para.y);
        }
        surface.pop();
    }

    fn pdf_font(&mut self, font: &parley::FontData) -> Option<Font> {
        let key = (font.data.id(), font.index);
        if let Some(f) = self.pdf_fonts.get(&key) {
            return Some(f.clone());
        }
        let bytes: Arc<dyn AsRef<[u8]> + Send + Sync> = Arc::new(font.data.clone());
        let f = Font::new(Data::from(bytes), font.index)?;
        self.pdf_fonts.insert(key, f.clone());
        Some(f)
    }

    fn draw_layout(&mut self, surface: &mut Surface, layout: &Layout<Brush>, text: &str, paints: &[RunPaint], ox: f32, oy: f32) {
        for line in layout.lines() {
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run) = item else { continue };
                let run = glyph_run.run();
                let size = run.font_size();
                let metrics = *run.font_metrics();
                let paint = &paints[glyph_run.style().brush.0 as usize];
                let baseline = oy + glyph_run.baseline() - paint.baseline_offset;
                let start = ox + glyph_run.offset();
                let advance = glyph_run.advance();
                if run.synthesis().embolden() || run.synthesis().skew().is_some() {
                    self.warn("synthetic bold/italic requested but not applied");
                }

                if let Some(hl) = paint.highlight {
                    fill_path(
                        surface,
                        rect_path(start, baseline - metrics.ascent, advance, metrics.ascent + metrics.descent, 0.0),
                        hl,
                    );
                }

                // Glyph -> source text cluster ranges, for the PDF ToUnicode map.
                let mut ranges = Vec::new();
                for cluster in run.visual_clusters() {
                    if cluster.style_index() == glyph_run.style_index() {
                        for _ in cluster.glyphs() {
                            ranges.push(cluster.text_range());
                        }
                    }
                }
                let positioned: Vec<_> = glyph_run.positioned_glyphs().collect();
                if ranges.len() != positioned.len() {
                    // shortcut: a run whose style repeats non-contiguously maps all glyphs to the run's text; fix if text extraction matters.
                    ranges = vec![run.text_range(); positioned.len()];
                }
                let mut pen = glyph_run.offset();
                let glyphs: Vec<KrillaGlyph> = positioned
                    .iter()
                    .zip(ranges)
                    .map(|(g, range)| {
                        let glyph = KrillaGlyph::new(
                            GlyphId::new(g.id),
                            g.advance / size,
                            (g.x - pen) / size,
                            -(g.y - glyph_run.baseline()) / size,
                            0.0,
                            range,
                            None,
                        );
                        pen += g.advance;
                        glyph
                    })
                    .collect();
                let Some(font) = self.pdf_font(run.font()) else {
                    self.warn("font could not be embedded");
                    continue;
                };
                let origin = Point::from_xy(start, baseline);
                surface.set_stroke(None);
                surface.set_fill(Some(fill_of(paint.color)));
                surface.draw_glyphs(origin, &glyphs, font.clone(), text, size, false);
                if let Some((color, width)) = paint.outline {
                    surface.set_fill(None);
                    surface.set_stroke(Some(Stroke {
                        paint: rgb::Color::new(color.0, color.1, color.2).into(),
                        width,
                        opacity: NormalizedF32::new(color.3).unwrap(),
                        ..Stroke::default()
                    }));
                    surface.draw_glyphs(origin, &glyphs, font, text, size, false);
                    surface.set_stroke(None);
                }

                let deco = paint.underline_color.unwrap_or(paint.color);
                if paint.underline {
                    fill_path(
                        surface,
                        rect_path(start, baseline - metrics.underline_offset, advance, metrics.underline_size.max(0.5), 0.0),
                        deco,
                    );
                }
                if paint.strike || paint.double_strike {
                    let t = metrics.strikethrough_size.max(0.5);
                    let y = baseline - metrics.strikethrough_offset;
                    if paint.double_strike {
                        fill_path(surface, rect_path(start, y - t, advance, t, 0.0), paint.color);
                        fill_path(surface, rect_path(start, y + t, advance, t, 0.0), paint.color);
                    } else {
                        fill_path(surface, rect_path(start, y, advance, t, 0.0), paint.color);
                    }
                }
            }
        }
    }
}

/// CSS `line-height: 1.2`, as used by packages/pptxgenjs/src/render/text.ts for single spacing.
/// Measured: font-metrics line height (ascent+descent+gap) scored slightly worse
/// against LibreOffice on the text deck (page median 0.0580 vs 0.0556).
const DEFAULT_LINE_HEIGHT: f32 = 1.2;

fn fill_path(surface: &mut Surface, path: Option<Path>, color: Rgba) {
    let Some(path) = path else { return };
    if color.3 <= 0.0 {
        return;
    }
    surface.set_stroke(None);
    surface.set_fill(Some(fill_of(color)));
    surface.draw_path(&path);
}

fn rect_path(x: f32, y: f32, w: f32, h: f32, radius: f32) -> Option<Path> {
    let mut pb = PathBuilder::new();
    let r = radius.min(w / 2.0).min(h / 2.0).max(0.0);
    if r == 0.0 {
        pb.push_rect(Rect::from_xywh(x, y, w.max(0.01), h.max(0.01))?);
    } else {
        let k = r * 0.552_284_8;
        pb.move_to(x + r, y);
        pb.line_to(x + w - r, y);
        pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        pb.line_to(x + w, y + h - r);
        pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        pb.line_to(x + r, y + h);
        pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        pb.line_to(x, y + r);
        pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
        pb.close();
    }
    pb.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_colors() {
        assert_eq!(parse_color("#17365D"), Some(Rgba(0x17, 0x36, 0x5D, 1.0)));
        assert_eq!(parse_color("rgba(23, 54, 93, 0)"), Some(Rgba(23, 54, 93, 0.0)));
        assert_eq!(parse_color("transparent"), None);
    }

    #[test]
    fn maps_office_fonts_to_metric_aliases() {
        assert_eq!(family_stack("Calibri"), "\"Calibri\", \"Carlito\", \"DejaVu Sans\", \"Noto Sans CJK JP\"");
        assert_eq!(family_stack("Arial"), "\"Arial\", \"Liberation Sans\", \"DejaVu Sans\", \"Noto Sans CJK JP\"");
    }

    #[test]
    fn renders_without_fonts_and_reports_skips() {
        let mut r = Renderer::new();
        let model = r##"{"pageSize":{"width":10,"height":5.625},"slides":[{"background":"#FFFFFF","objects":[{"kind":"image","style":{}}]}]}"##;
        let pdf = r.render(model).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        assert_eq!(r.warnings(), vec!["object kind 'image' not rendered".to_string()]);
    }
}
