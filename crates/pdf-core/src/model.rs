//! The subset of the normalized model (packages/model/src/types.ts) this renderer reads, filled
//! from the PdfLapas HTML profile by `crate::profile`.

use crate::color::Rgba;
use crate::svg::Svg;

pub(crate) struct Presentation {
    pub(crate) page_size: PageSize,
    pub(crate) metadata: Metadata,
    pub(crate) slides: Vec<Slide>,
}

/// `PresentationMetadata`: `<title>`, `<meta name="author">`, `<meta name="description">` (the
/// subject), `<meta name="pdflapas-company">`, `<meta name="pdflapas-revision">`,
/// `<meta name="keywords">`, `<meta name="pdflapas-creator">`, `<meta name="pdflapas-producer">`,
/// `<meta name="pdflapas-creation-date">` and `<meta name="pdflapas-modification-date">`. Read
/// from profile version 2 only.
#[derive(Default)]
pub(crate) struct Metadata {
    pub(crate) title: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) subject: Option<String>,
    pub(crate) company: Option<String>,
    pub(crate) revision: Option<String>,
    pub(crate) keywords: Option<String>,
    pub(crate) creator: Option<String>,
    pub(crate) producer: Option<String>,
    pub(crate) creation_date: Option<UtcDate>,
    pub(crate) modification_date: Option<UtcDate>,
}

/// A date and time in UTC, to the second: the profile's ISO dates without their milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UtcDate {
    pub(crate) year: u16,
    pub(crate) month: u8,
    pub(crate) day: u8,
    pub(crate) hour: u8,
    pub(crate) minute: u8,
    pub(crate) second: u8,
}

pub(crate) struct PageSize {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

pub(crate) struct Slide {
    /// The slide's number from `id="slide-N"`, which slide links name: hidden slides are not in
    /// the document, so it can be past the slide's position. `None` without an `id`.
    pub(crate) number: Option<u32>,
    pub(crate) background: Rgba,
    pub(crate) objects: Vec<SlideObject>,
}

/// `NormalizedSlideObject`, tagged by `kind`.
pub(crate) enum SlideObject {
    Text(TextObject),
    Shape(ShapeObject),
    Image(ImageObject),
    Table(TableObject),
    /// An object drawn from an SVG display list: a `.slide-chart`'s SVG (the chart options are not
    /// in the HTML), or a `.slide-component`'s boxes as filled rectangles (its props are not either).
    Svg(SvgObject),
}

pub(crate) struct SvgObject {
    pub(crate) style: ObjectStyle,
    pub(crate) svg: Svg,
}

pub(crate) struct TextObject {
    pub(crate) style: ObjectStyle,
    pub(crate) shape: Option<ShapeModel>,
    pub(crate) text: Option<TextBox>,
}

pub(crate) struct ShapeObject {
    pub(crate) style: ObjectStyle,
    pub(crate) shape: Option<ShapeModel>,
}

pub(crate) struct TableObject {
    pub(crate) style: ObjectStyle,
    pub(crate) table: Table,
}

/// `NormalizedTable`. Its `width`/`height` are the sums of `columns` and of the row heights
/// that normalization resolved; rows without one grow to their content, so they are not read.
pub(crate) struct Table {
    /// Grid column widths (px).
    pub(crate) columns: Vec<f32>,
    pub(crate) rows: Vec<TableRow>,
}

pub(crate) struct TableRow {
    /// Minimum height (px); the row grows to fit its cells' text.
    pub(crate) height: Option<f32>,
    /// Origin cells only, as in HTML: grid slots covered by a span have no entry.
    pub(crate) cells: Vec<TableCell>,
}

pub(crate) struct TableCell {
    pub(crate) text: TextBox,
    pub(crate) colspan: u32,
    pub(crate) rowspan: u32,
    pub(crate) fill: Option<FillModel>,
    /// Top, right, bottom, left.
    pub(crate) borders: [TableBorder; 4],
}

pub(crate) struct TableBorder {
    pub(crate) visible: bool,
    pub(crate) color: Rgba,
    pub(crate) width: f32,
    /// SVG stroke-dasharray (px) of a dashed border.
    pub(crate) dash_array: Option<String>,
}

pub(crate) struct ImageObject {
    pub(crate) style: ObjectStyle,
    pub(crate) image: ImageModel,
}

/// `NormalizedImage`. `source` is a data URI: the profile admits no other image source.
pub(crate) struct ImageModel {
    pub(crate) source: String,
    pub(crate) sizing: ImageSizing,
    pub(crate) rounding: bool,
    pub(crate) opacity: f32,
    pub(crate) link: Option<Link>,
}

/// `NormalizedImageSizing`: where the picture sits relative to the object box, in px.
pub(crate) enum ImageSizing {
    Stretch,
    Contain { x: f32, y: f32, width: f32, height: f32 },
    Cover { x: f32, y: f32, width: f32, height: f32 },
    Crop { offset_x: f32, offset_y: f32, width: f32, height: f32 },
}

pub(crate) struct ObjectStyle {
    pub(crate) geometry: Geometry,
    pub(crate) transform: Transform2,
    pub(crate) fill: Option<FillModel>,
    pub(crate) line: Option<LineModel>,
    pub(crate) shadow: Option<Shadow>,
    /// Names the object in errors; optional so hand-written models need not carry it.
    pub(crate) object_name: Option<String>,
}

pub(crate) struct Geometry {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: Option<f32>,
    pub(crate) height: Option<f32>,
}

pub(crate) struct Transform2 {
    pub(crate) rotation: f32,
    pub(crate) flip_h: bool,
    pub(crate) flip_v: bool,
    pub(crate) opacity: f32,
}

/// `NormalizedTextLink` / `NormalizedShapeLink` / `NormalizedImageLink`: a slide jump when `slide`
/// is set (its `href` is then `#slide-N`), otherwise the URL in `href`.
pub(crate) struct Link {
    pub(crate) href: String,
    pub(crate) tooltip: Option<String>,
    /// 1-based slide number.
    pub(crate) slide: Option<u32>,
}

/// `NormalizedShadow`: an object's drop shadow, or a run's glow (no offset). Lengths in px.
pub(crate) struct Shadow {
    pub(crate) visible: bool,
    pub(crate) color: Rgba,
    pub(crate) blur: f32,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
    pub(crate) kind: ShadowKind,
}

/// PptxGenJS `ShadowProps.type`: cast outside the object, or inside it (CSS `inset`).
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum ShadowKind {
    Outer,
    Inner,
}

pub(crate) struct FillModel {
    pub(crate) visible: bool,
    pub(crate) color: Rgba,
}

pub(crate) struct LineModel {
    pub(crate) visible: bool,
    pub(crate) color: Rgba,
    pub(crate) width: f32,
    pub(crate) dash_array: Option<String>,
    /// `None` without an arrowhead (`none` or no attribute).
    pub(crate) begin_arrow: Option<ArrowKind>,
    pub(crate) end_arrow: Option<ArrowKind>,
    /// Resolved head outlines (`NormalizedLine.beginHeadPath`/`endHeadPath`): closed SVG path data
    /// in px, with the line end at the origin and +x pointing out of the line.
    pub(crate) begin_head_path: Option<String>,
    pub(crate) end_head_path: Option<String>,
}

/// `NormalizedLine.beginArrow`/`endArrow` other than `none`.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum ArrowKind {
    Arrow,
    Diamond,
    Oval,
    Stealth,
    Triangle,
}

pub(crate) struct ShapeModel {
    pub(crate) name: String,
    /// The coordinate space of `geometry` (an SVG viewBox stretched over the object box).
    pub(crate) width: f32,
    pub(crate) height: f32,
    pub(crate) geometry: ShapeGeometry,
    pub(crate) link: Option<Link>,
}

/// `NormalizedShapeGeometry`.
pub(crate) enum ShapeGeometry {
    Rect {
        radius: f32,
    },
    Ellipse,
    Line {
        inverse: bool,
    },
    Path {
        /// SVG path data.
        data: String,
        /// SVG `matrix(a b c d e f)`.
        transform: Option<String>,
        faces: Option<Vec<ShapeFace>>,
        outline_data: Option<String>,
    },
}

/// One face of a multi-face preset (can, cube, bevel, ...), with the shaded fill the HTML gives it.
pub(crate) struct ShapeFace {
    pub(crate) data: String,
    pub(crate) fill: Option<Rgba>,
}

pub(crate) struct TextBox {
    pub(crate) paragraphs: Vec<Paragraph>,
    pub(crate) margin: [f32; 4],
    pub(crate) vertical_align: VerticalAlign,
    pub(crate) wrap: bool,
    pub(crate) fit: TextFit,
    pub(crate) direction: TextDirection,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum VerticalAlign {
    Top,
    Middle,
    Bottom,
}

/// `NormalizedTextBox.fit`: shrink the fonts, or grow the box, to fit the text.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum TextFit {
    None,
    Shrink(Shrink),
    Resize,
}

/// The shrink rule a `data-text-fit="shrink"` box states (`data-text-fit-*`): scale by `step` while the text
/// overflows by more than `tolerance` px, at most `max_steps` times.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct Shrink {
    pub(crate) step: f32,
    pub(crate) max_steps: u32,
    pub(crate) tolerance: f32,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum TextDirection {
    Horizontal,
    Vertical,
    Vertical270,
    Stacked,
}

impl TextDirection {
    /// Lines run down the box (rotated 90 or 270 degrees).
    pub(crate) fn is_vertical(self) -> bool {
        matches!(self, Self::Vertical | Self::Vertical270)
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum ParagraphAlign {
    Left,
    Center,
    Right,
    Justify,
}

pub(crate) struct Paragraph {
    pub(crate) runs: Vec<Run>,
    pub(crate) align: ParagraphAlign,
    pub(crate) rtl: bool,
    pub(crate) line_box: LineBox,
    pub(crate) space_before: f32,
    pub(crate) space_after: f32,
    pub(crate) tab_stops: Vec<TabStop>,
    /// Spacing of the default stops after the last explicit one, in px.
    pub(crate) default_tab_stop: f32,
    pub(crate) bullet: Option<Bullet>,
}

/// `NormalizedTextParagraph.tabStops[]`: `position` in px from the text area's left edge.
#[derive(Clone, Copy)]
pub(crate) struct TabStop {
    pub(crate) position: f32,
    pub(crate) alignment: TabAlign,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum TabAlign {
    Left,
    Right,
    Center,
    Decimal,
}

/// `NormalizedTextParagraph.lineBox`: every line is `height` px tall with its baseline `baseline` px below its top,
/// except the last line, whose baseline is `mark_baseline`, and a line ending in a soft break, `break_baseline`
/// (`baseline` when the HTML gives none).
#[derive(Clone, Copy)]
pub(crate) struct LineBox {
    pub(crate) height: f32,
    pub(crate) baseline: f32,
    pub(crate) mark_baseline: f32,
    pub(crate) break_baseline: f32,
}

pub(crate) struct Bullet {
    pub(crate) marker: String,
    pub(crate) indent: f32,
    pub(crate) level: u32,
}

pub(crate) struct Run {
    pub(crate) text: String,
    pub(crate) font_face: String,
    pub(crate) font_size: f32,
    pub(crate) color: Rgba,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) decoration: Decoration,
    /// Super/subscript are already resolved into `font_size` and `baseline_offset`.
    pub(crate) baseline_offset: f32,
    pub(crate) character_spacing: f32,
    /// False: laid out without the font's pair kerning (`font-kerning: none`, the PowerPoint target).
    pub(crate) kerning: bool,
    pub(crate) synthesis: Synthesis,
    pub(crate) highlight: Option<Rgba>,
    pub(crate) outline: Option<Outline>,
    pub(crate) glow: Option<Shadow>,
    // The run's `shadow` is not read: PptxGenJS writes no run shadow, only the object's (`style.shadow`).
    pub(crate) link: Option<Link>,
    pub(crate) soft_break_before: bool,
}

/// Chromium's synthetic styles, read from its PDF output of a regular-only Liberation Sans at 9 to 72pt: bold
/// draws an outline 1/64 em wider on each side (`106 -1516 244 1548 re` for the 138-318 x 0-1484 `l` of a
/// 2048-unit em), a 1/32 em stroke at every size; italic shears by a quarter (`1 0 .25 -1 x y Tm`).
const CHROMIUM_SYNTHETIC_BOLD_STROKE_EM: f32 = 1.0 / 32.0;
const CHROMIUM_SYNTHETIC_ITALIC_SHEAR: f32 = 0.25;

/// How a run is drawn when its face has no bold or italic style (`data-synthetic-bold`,
/// `data-synthetic-italic`); the default is the browser's, for HTML that does not say.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) struct Synthesis {
    /// The stroke drawn around the filled glyphs, as a fraction of the font size.
    pub(crate) bold_stroke_em: f32,
    /// The shear to the right per unit of height above the baseline.
    pub(crate) italic_shear: f32,
}

impl Default for Synthesis {
    fn default() -> Self {
        Self {
            bold_stroke_em: CHROMIUM_SYNTHETIC_BOLD_STROKE_EM,
            italic_shear: CHROMIUM_SYNTHETIC_ITALIC_SHEAR,
        }
    }
}

pub(crate) struct Decoration {
    pub(crate) underline: bool,
    pub(crate) underline_style: UnderlineStyle,
    pub(crate) underline_color: Option<Rgba>,
    pub(crate) strike: bool,
    pub(crate) double_strike: bool,
}

/// `NormalizedTextDecoration.underlineStyle`: the CSS `text-decoration-style` the PptxGenJS style maps to.
// shortcut: the HTML carries only these five styles, so `heavy` variants draw at the normal thickness and
// `dashLong`, `dotDash` and `dotDotDash` as plain dashes in both renderers; carry the OOXML style in the
// profile when a fixture needs them.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum UnderlineStyle {
    Solid,
    Double,
    Dotted,
    Dashed,
    Wavy,
}

pub(crate) struct Outline {
    pub(crate) color: Rgba,
    pub(crate) width: f32,
}

/// Test builders: plain objects with every optional field off, for tests that set only what they check.
#[cfg(test)]
pub(crate) mod build {
    use super::*;

    /// The shrink rule `toHtml()` writes (`PPTX_DEFAULTS.text.shrink`).
    pub(crate) const SHRINK: TextFit = TextFit::Shrink(Shrink {
        step: 0.95,
        max_steps: 20,
        tolerance: 0.5,
    });

    /// A color the test writes as CSS.
    pub(crate) fn css(color: &str) -> Rgba {
        crate::color::parse_color(color).expect("test colors are valid CSS")
    }

    /// One 10 x 5.625in white slide holding `objects`.
    pub(crate) fn deck(objects: Vec<SlideObject>) -> Presentation {
        Presentation {
            page_size: PageSize { width: 10.0, height: 5.625 },
            metadata: Metadata::default(),
            slides: vec![Slide {
                number: None,
                background: Rgba(255, 255, 255, 1.0),
                objects,
            }],
        }
    }

    /// An untransformed box with no fill, line, shadow or name.
    pub(crate) fn style(x: f32, y: f32, width: f32, height: f32) -> ObjectStyle {
        ObjectStyle {
            geometry: Geometry {
                x,
                y,
                width: Some(width),
                height: Some(height),
            },
            transform: Transform2 {
                rotation: 0.0,
                flip_h: false,
                flip_v: false,
                opacity: 1.0,
            },
            fill: None,
            line: None,
            shadow: None,
            object_name: None,
        }
    }

    pub(crate) fn fill(color: &str) -> Option<FillModel> {
        Some(FillModel {
            visible: true,
            color: css(color),
        })
    }

    pub(crate) fn line(color: &str, width: f32) -> LineModel {
        LineModel {
            visible: true,
            color: css(color),
            width,
            dash_array: None,
            begin_arrow: None,
            end_arrow: None,
            begin_head_path: None,
            end_head_path: None,
        }
    }

    pub(crate) fn shadow(color: &str, blur: f32, offset: f32, kind: ShadowKind) -> Shadow {
        Shadow {
            visible: true,
            color: css(color),
            blur,
            offset_x: offset,
            offset_y: offset,
            kind,
        }
    }

    pub(crate) fn link(href: &str) -> Option<Link> {
        Some(Link {
            href: href.into(),
            tooltip: None,
            slide: None,
        })
    }

    pub(crate) fn shape(name: &str, width: f32, height: f32, geometry: ShapeGeometry) -> ShapeModel {
        ShapeModel {
            name: name.into(),
            width,
            height,
            geometry,
            link: None,
        }
    }

    pub(crate) fn shape_object(style: ObjectStyle, shape: ShapeModel) -> SlideObject {
        SlideObject::Shape(ShapeObject { style, shape: Some(shape) })
    }

    pub(crate) fn text_object(style: ObjectStyle, text: TextBox) -> SlideObject {
        SlideObject::Text(TextObject {
            style,
            shape: None,
            text: Some(text),
        })
    }

    /// A stretched picture at full opacity.
    pub(crate) fn image(source: &str) -> ImageModel {
        ImageModel {
            source: source.into(),
            sizing: ImageSizing::Stretch,
            rounding: false,
            opacity: 1.0,
            link: None,
        }
    }

    /// A plain black run.
    pub(crate) fn run(text: &str, font_face: &str, font_size: f32) -> Run {
        Run {
            text: text.into(),
            font_face: font_face.into(),
            font_size,
            color: Rgba(0, 0, 0, 1.0),
            bold: false,
            italic: false,
            decoration: Decoration {
                underline: false,
                underline_style: UnderlineStyle::Solid,
                underline_color: None,
                strike: false,
                double_strike: false,
            },
            baseline_offset: 0.0,
            character_spacing: 0.0,
            kerning: true,
            synthesis: Synthesis::default(),
            highlight: None,
            outline: None,
            glow: None,
            link: None,
            soft_break_before: false,
        }
    }

    /// A left-aligned paragraph whose lines are `height` px with the baseline `baseline` px below their top.
    pub(crate) fn paragraph(runs: Vec<Run>, height: f32, baseline: f32) -> Paragraph {
        Paragraph {
            runs,
            align: ParagraphAlign::Left,
            rtl: false,
            line_box: LineBox {
                height,
                baseline,
                mark_baseline: baseline,
                break_baseline: baseline,
            },
            space_before: 0.0,
            space_after: 0.0,
            tab_stops: Vec::new(),
            default_tab_stop: 96.0,
            bullet: None,
        }
    }

    /// A top-aligned, wrapping, horizontal box without insets.
    pub(crate) fn text_box(paragraphs: Vec<Paragraph>) -> TextBox {
        TextBox {
            paragraphs,
            margin: [0.0; 4],
            vertical_align: VerticalAlign::Top,
            wrap: true,
            fit: TextFit::None,
            direction: TextDirection::Horizontal,
        }
    }
}
