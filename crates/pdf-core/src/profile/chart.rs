//! Chart objects (`render/chart.ts`): the common box around one `<svg>`, read by `profile::svg`.

use super::allow;
use super::dom::{Dom, Element};
use super::object::{BOX_ATTRS, BOX_CSS, BoxPaint, object_style};
use super::style::Style;
use crate::model::SvgObject;

const CHART_ATTRS: &[&str] = &["role", "aria-label"];

/// A `.slide-chart` object: the common box (`overflow: hidden`) around one `<svg>`.
pub(crate) fn object(dom: &Dom<'_>, element: &Element<'_>) -> Result<SvgObject, String> {
    let style = Style::of(element)?;
    allow(element, &style, &[BOX_ATTRS, CHART_ATTRS], &[BOX_CSS, &["overflow"]])?;
    if style.get("overflow") != Some("hidden") {
        return Err("a chart object must have 'overflow: hidden'".into());
    }
    let [svg] = dom.elements_of(&element.children)?[..] else {
        return Err("a chart object must hold one <svg>".into());
    };
    Ok(SvgObject {
        style: object_style(element, &style, BoxPaint::OnBox)?,
        svg: super::svg::chart(dom, svg)?,
    })
}
