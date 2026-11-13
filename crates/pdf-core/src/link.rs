//! Hyperlinks from the model as PDF link annotations: a URL opens through a `/URI` action, a slide
//! link jumps to that page (`/Dest`), and the tooltip becomes the annotation's `/Contents`.
//!
//! The clickable area is the linked quadrilateral mapped through the surface's current transform,
//! so rotated and flipped objects get their exact outline as `/QuadPoints` (and its bounding box as
//! `/Rect`, which viewers without QuadPoints support fall back to).

use krilla::action::LinkAction;
use krilla::annotation::{Annotation, LinkAnnotation, Target};
use krilla::destination::XyzDestination;
use krilla::geom::{Point, Quadrilateral, Transform};
use krilla::surface::Surface;

use crate::Renderer;
use crate::model::Link;

/// The schemes the compatibility layer lets through (packages/pptxgenjs/src/normalize/link.ts).
const URL_SCHEMES: [&str; 3] = ["http:", "https:", "mailto:"];

fn map(t: &Transform, x: f32, y: f32) -> Point {
    Point::from_xy(t.sx() * x + t.kx() * y + t.tx(), t.ky() * x + t.sy() * y + t.ty())
}

/// The corners of the box `x, y, w, h` (px, the surface's user space) in page space, or `None` for
/// an empty or non-finite box: nothing is clickable there.
pub(crate) fn page_quad(surface: &Surface, x: f32, y: f32, w: f32, h: f32) -> Option<Quadrilateral> {
    let t = surface.ctm();
    // Counter-clockwise from the bottom-left in PDF space (y up), the order QuadPoints expects.
    let corners = [map(&t, x, y + h), map(&t, x + w, y + h), map(&t, x + w, y), map(&t, x, y)];
    let finite = corners.iter().all(|p| p.x.is_finite() && p.y.is_finite());
    (w > 0.0 && h > 0.0 && finite).then_some(Quadrilateral(corners))
}

impl Renderer {
    /// Queues a link annotation over `quad` for the page being drawn; `render` attaches it once
    /// the page's surface is finished. A URL with another scheme is an error.
    pub(crate) fn add_link(&mut self, link: &Link, quad: Quadrilateral) -> Result<(), String> {
        let target = match link.slide {
            Some(slide) => {
                let page = usize::try_from(slide).ok().and_then(|s| s.checked_sub(1)).filter(|&p| p < self.page_count);
                let Some(page) = page else {
                    // krilla panics on a destination past the last page.
                    self.warn(format!("link to slide {slide} not emitted: the deck has {} slides", self.page_count));
                    return Ok(());
                };
                Target::Destination(XyzDestination::new(page, Point::from_xy(0.0, 0.0)).into())
            }
            None => {
                let scheme_ok = URL_SCHEMES
                    .iter()
                    .any(|scheme| link.href.get(..scheme.len()).is_some_and(|s| s.eq_ignore_ascii_case(scheme)));
                if !scheme_ok {
                    return Err(format!("link '{}' is not an http, https or mailto URL", link.href));
                }
                Target::Action(LinkAction::new(link.href.clone()).into())
            }
        };
        let tooltip = link.tooltip.clone().filter(|t| !t.is_empty());
        self.links
            .push(Annotation::new_link(LinkAnnotation::new_with_quad_points(vec![quad], target), tooltip));
        Ok(())
    }
}
