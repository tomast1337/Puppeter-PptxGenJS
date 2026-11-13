//! The subset of the normalized model (packages/model/src/types.ts) this renderer reads, filled
//! from the pdfdeck HTML profile by `crate::profile`.

pub(crate) struct Presentation {
    pub(crate) page_size: PageSize,
    pub(crate) slides: Vec<Slide>,
}

pub(crate) struct PageSize {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

pub(crate) struct Slide {
    pub(crate) background: String,
    pub(crate) objects: Vec<SlideObject>,
}

/// `NormalizedSlideObject`, tagged by `kind`.
pub(crate) enum SlideObject {
    Text(TextObject),
    Shape(ShapeObject),
    Image(ImageObject),
    Table(TableObject),
    /// A chart or component subtree: reported through `warnings()` instead of failing the document.
    Unsupported(String),
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
    pub(crate) color: String,
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
    pub(crate) color: String,
    pub(crate) blur: f32,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
    pub(crate) inset: bool,
}

pub(crate) struct FillModel {
    pub(crate) visible: bool,
    pub(crate) color: String,
}

pub(crate) struct LineModel {
    pub(crate) visible: bool,
    pub(crate) color: String,
    pub(crate) width: f32,
    pub(crate) dash_array: Option<String>,
    pub(crate) begin_arrow: Option<String>,
    pub(crate) end_arrow: Option<String>,
    /// Resolved head outlines (`NormalizedLine.beginHeadPath`/`endHeadPath`): closed SVG path data
    /// in px, with the line end at the origin and +x pointing out of the line.
    pub(crate) begin_head_path: Option<String>,
    pub(crate) end_head_path: Option<String>,
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

pub(crate) struct ShapeFace {
    pub(crate) data: String,
    pub(crate) fill_modifier: Option<FillModifier>,
}

/// DrawingML path `fill` shading for one face of a multi-face preset (can, cube, bevel, ...).
#[derive(Clone, Copy)]
pub(crate) enum FillModifier {
    Darken,
    DarkenLess,
    Lighten,
    LightenLess,
}

pub(crate) struct TextBox {
    pub(crate) paragraphs: Vec<Paragraph>,
    pub(crate) margin: [f32; 4],
    pub(crate) vertical_align: String,
    pub(crate) wrap: bool,
    pub(crate) fit: String,
    pub(crate) direction: String,
}

pub(crate) struct Paragraph {
    pub(crate) runs: Vec<Run>,
    pub(crate) align: String,
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

/// `NormalizedTextParagraph.lineBox`: every line is `height` px tall with its baseline `baseline` px below its top.
#[derive(Clone, Copy)]
pub(crate) struct LineBox {
    pub(crate) height: f32,
    pub(crate) baseline: f32,
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
    pub(crate) color: String,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) decoration: Decoration,
    /// Super/subscript are already resolved into `font_size` and `baseline_offset`.
    pub(crate) baseline_offset: f32,
    pub(crate) character_spacing: f32,
    pub(crate) highlight: Option<String>,
    pub(crate) outline: Option<Outline>,
    pub(crate) glow: Option<Shadow>,
    // The run's `shadow` is not read: PptxGenJS writes no run shadow, only the object's (`style.shadow`).
    pub(crate) link: Option<Link>,
    pub(crate) soft_break_before: bool,
}

pub(crate) struct Decoration {
    pub(crate) underline: bool,
    pub(crate) underline_color: Option<String>,
    pub(crate) strike: bool,
    pub(crate) double_strike: bool,
}

pub(crate) struct Outline {
    pub(crate) color: String,
    pub(crate) width: f32,
}

/// Test builders: plain objects with every optional field off, for tests that set only what they check.
#[cfg(test)]
pub(crate) mod build {
    use super::*;

    /// One 10 x 5.625in white slide holding `objects`.
    pub(crate) fn deck(objects: Vec<SlideObject>) -> Presentation {
        Presentation {
            page_size: PageSize { width: 10.0, height: 5.625 },
            slides: vec![Slide {
                background: "#FFFFFF".into(),
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
            color: color.into(),
        })
    }

    pub(crate) fn line(color: &str, width: f32) -> LineModel {
        LineModel {
            visible: true,
            color: color.into(),
            width,
            dash_array: None,
            begin_arrow: None,
            end_arrow: None,
            begin_head_path: None,
            end_head_path: None,
        }
    }

    pub(crate) fn shadow(color: &str, blur: f32, offset: f32, inset: bool) -> Shadow {
        Shadow {
            visible: true,
            color: color.into(),
            blur,
            offset_x: offset,
            offset_y: offset,
            inset,
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
            color: "#000000".into(),
            bold: false,
            italic: false,
            decoration: Decoration {
                underline: false,
                underline_color: None,
                strike: false,
                double_strike: false,
            },
            baseline_offset: 0.0,
            character_spacing: 0.0,
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
            align: "left".into(),
            rtl: false,
            line_box: LineBox { height, baseline },
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
            vertical_align: "top".into(),
            wrap: true,
            fit: "none".into(),
            direction: "horizontal".into(),
        }
    }
}
