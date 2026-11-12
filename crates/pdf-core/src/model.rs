//! The subset of the normalized model (packages/model/src/types.ts) this renderer reads.

use serde::Deserialize;
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
    pub(crate) objects: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObjectStyle {
    pub(crate) geometry: Geometry,
    pub(crate) transform: Transform2,
    pub(crate) fill: Option<FillModel>,
    pub(crate) line: Option<LineModel>,
    pub(crate) shadow: Option<Visible>,
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
}

#[derive(Deserialize)]
pub(crate) struct ShapeModel {
    pub(crate) name: String,
    pub(crate) geometry: Value,
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
