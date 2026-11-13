//! The subset of the normalized model (packages/model/src/types.ts) this renderer reads.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Presentation {
    pub(crate) page_size: PageSize,
    pub(crate) slides: Vec<Slide>,
}

#[derive(Deserialize)]
pub(crate) struct PageSize {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

#[derive(Deserialize)]
pub(crate) struct Slide {
    pub(crate) background: String,
    pub(crate) objects: Vec<SlideObject>,
}

/// `NormalizedSlideObject`, tagged by `kind`.
pub(crate) enum SlideObject {
    Text(TextObject),
    Shape(ShapeObject),
    Image(ImageObject),
    /// Any other `kind` (table, chart, ...), or `?` when it is missing or not a
    /// string: reported through `warnings()` instead of failing the model.
    Unsupported(String),
}

#[derive(Deserialize)]
pub(crate) struct TextObject {
    pub(crate) style: ObjectStyle,
    pub(crate) shape: Option<ShapeModel>,
    pub(crate) text: Option<TextBox>,
}

#[derive(Deserialize)]
pub(crate) struct ShapeObject {
    pub(crate) style: ObjectStyle,
    pub(crate) shape: Option<ShapeModel>,
}

#[derive(Deserialize)]
pub(crate) struct ImageObject {
    pub(crate) style: ObjectStyle,
    pub(crate) image: ImageModel,
}

/// `NormalizedImage`. `source` is a data URI once the compatibility layer has resolved paths and URLs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageModel {
    pub(crate) source: String,
    pub(crate) source_kind: String,
    pub(crate) sizing: ImageSizing,
    pub(crate) rounding: bool,
    pub(crate) opacity: f32,
    pub(crate) link: Option<Value>,
}

/// `NormalizedImageSizing`: where the picture sits relative to the object box, in px.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ImageSizing {
    Stretch,
    Contain {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
    Cover {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
    #[serde(rename_all = "camelCase")]
    Crop {
        offset_x: f32,
        offset_y: f32,
        width: f32,
        height: f32,
    },
}

/// Dispatches on `kind` by hand instead of `#[serde(tag = "kind")]`: serde's catch-all
/// variants either drop the kind name (`other`) or swallow the errors of a malformed
/// text or shape object (`untagged`). Each object is buffered once and moved, never cloned.
impl<'de> Deserialize<'de> for SlideObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let object = Value::deserialize(deserializer)?;
        let typed = match object.get("kind").and_then(Value::as_str) {
            Some("text") => TextObject::deserialize(object).map(SlideObject::Text),
            Some("shape") => ShapeObject::deserialize(object).map(SlideObject::Shape),
            Some("image") => ImageObject::deserialize(object).map(SlideObject::Image),
            kind => return Ok(SlideObject::Unsupported(kind.unwrap_or("?").to_owned())),
        };
        typed.map_err(D::Error::custom)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObjectStyle {
    pub(crate) geometry: Geometry,
    pub(crate) transform: Transform2,
    pub(crate) fill: Option<FillModel>,
    pub(crate) line: Option<LineModel>,
    pub(crate) shadow: Option<Visible>,
    /// Names the object in errors; optional so hand-written models need not carry it.
    pub(crate) object_name: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct Geometry {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: Option<f32>,
    pub(crate) height: Option<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Transform2 {
    pub(crate) rotation: f32,
    pub(crate) flip_h: bool,
    pub(crate) flip_v: bool,
    pub(crate) opacity: f32,
}

#[derive(Deserialize)]
pub(crate) struct Visible {
    pub(crate) visible: bool,
}

#[derive(Deserialize)]
pub(crate) struct FillModel {
    pub(crate) visible: bool,
    pub(crate) color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Deserialize)]
pub(crate) struct ShapeModel {
    pub(crate) name: String,
    /// The coordinate space of `geometry` (an SVG viewBox stretched over the object box).
    pub(crate) width: f32,
    pub(crate) height: f32,
    pub(crate) geometry: ShapeGeometry,
    pub(crate) link: Option<Value>,
}

/// `NormalizedShapeGeometry`. An unknown `kind` fails the model rather than drawing a substitute.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ShapeGeometry {
    Rect {
        radius: f32,
    },
    Ellipse,
    Line {
        inverse: bool,
    },
    #[serde(rename_all = "camelCase")]
    Path {
        /// SVG path data.
        data: String,
        /// SVG `matrix(a b c d e f)`.
        transform: Option<String>,
        faces: Option<Vec<ShapeFace>>,
        outline_data: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShapeFace {
    pub(crate) data: String,
    pub(crate) fill_modifier: Option<FillModifier>,
}

/// DrawingML path `fill` shading for one face of a multi-face preset (can, cube, bevel, ...).
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FillModifier {
    Darken,
    DarkenLess,
    Lighten,
    LightenLess,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextBox {
    pub(crate) paragraphs: Vec<Paragraph>,
    pub(crate) margin: [f32; 4],
    pub(crate) vertical_align: String,
    pub(crate) wrap: bool,
    pub(crate) fit: String,
    pub(crate) direction: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Paragraph {
    pub(crate) runs: Vec<Run>,
    pub(crate) align: String,
    pub(crate) rtl: bool,
    pub(crate) line_height: Option<f32>,
    pub(crate) space_before: f32,
    pub(crate) space_after: f32,
    pub(crate) tab_stops: Vec<Value>,
    pub(crate) bullet: Option<Bullet>,
}

#[derive(Deserialize)]
pub(crate) struct Bullet {
    pub(crate) marker: String,
    pub(crate) indent: f32,
    pub(crate) level: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Run {
    pub(crate) text: String,
    pub(crate) font_face: String,
    pub(crate) font_size: f32,
    pub(crate) color: String,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) decoration: Decoration,
    pub(crate) vertical_align: String,
    pub(crate) baseline_offset: f32,
    pub(crate) character_spacing: f32,
    pub(crate) highlight: Option<String>,
    pub(crate) outline: Option<Outline>,
    pub(crate) glow: Option<Value>,
    pub(crate) shadow: Option<Visible>,
    pub(crate) link: Option<Value>,
    pub(crate) soft_break_before: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Decoration {
    pub(crate) underline: bool,
    pub(crate) underline_color: Option<String>,
    pub(crate) strike: bool,
    pub(crate) double_strike: bool,
}

#[derive(Deserialize)]
pub(crate) struct Outline {
    pub(crate) color: String,
    pub(crate) width: f32,
}
