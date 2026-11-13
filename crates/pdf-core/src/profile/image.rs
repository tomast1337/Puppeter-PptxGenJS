//! Picture objects (`render/image.ts`): the box, its clipping frame and the `img`.

use super::allow;
use super::dom::{Dom, Element};
use super::object::{BOX_ATTRS, BOX_CSS, LINK_ATTRS, link, object_style};
use super::style::{Style, number};
use crate::model::{ImageModel, ImageObject, ImageSizing};

const FRAME_CSS: &[&str] = &["width", "height", "overflow", "position", "border-radius"];
const IMG_ATTRS: &[&str] = &["data-image-sizing", "alt", "src"];
const IMG_CSS: &[&str] = &[
    "display",
    "opacity",
    "position",
    "left",
    "top",
    "width",
    "height",
    "object-fit",
    "object-position",
];
/// `border-radius` of a rounded picture's box and frame.
const ROUNDED: &str = "50%";

pub(crate) fn object(dom: &Dom<'_>, element: &Element<'_>) -> Result<ImageObject, String> {
    let style = Style::of(element)?;
    allow(
        element,
        &style,
        &[BOX_ATTRS, LINK_ATTRS, &["role", "aria-label"]],
        &[BOX_CSS, &["border-radius"]],
    )?;
    let [frame] = dom.elements_of(&element.children)?[..] else {
        return Err("an image object must hold one div.slide-image-frame".into());
    };
    if frame.name != "div" || !frame.has_class("slide-image-frame") {
        return Err(format!("expected div.slide-image-frame, found <{}>", frame.name));
    }
    let frame_style = Style::of(frame)?;
    allow(frame, &frame_style, &[], &[FRAME_CSS])?;
    let [img] = dom.elements_of(&frame.children)?[..] else {
        return Err("div.slide-image-frame must hold one img.slide-image-content".into());
    };
    if img.name != "img" || !img.has_class("slide-image-content") {
        return Err(format!("expected img.slide-image-content, found <{}>", img.name));
    }
    let css = Style::of(img)?;
    allow(img, &css, &[IMG_ATTRS], &[IMG_CSS])?;

    let source = img.attr("src")?.ok_or("img: attribute 'src' is missing")?;
    if !source.starts_with("data:") {
        return Err(format!(
            "img: attribute 'src' must be a data: URI (resolve images before rendering), not '{}'",
            super::dom::preview(&source)
        ));
    }
    let sizing = img.attr("data-image-sizing")?.ok_or("img: attribute 'data-image-sizing' is missing")?;
    let sizing = match sizing.as_ref() {
        "stretch" => ImageSizing::Stretch,
        "contain" | "cover" => {
            let (x, y, width, height) = (
                css.require_px("left")?,
                css.require_px("top")?,
                css.require_px("width")?,
                css.require_px("height")?,
            );
            if sizing == "contain" {
                ImageSizing::Contain { x, y, width, height }
            } else {
                ImageSizing::Cover { x, y, width, height }
            }
        }
        // `left`/`top` are the negated crop offsets.
        "crop" => ImageSizing::Crop {
            offset_x: -css.require_px("left")?,
            offset_y: -css.require_px("top")?,
            width: css.require_px("width")?,
            height: css.require_px("height")?,
        },
        other => return Err(format!("img: attribute 'data-image-sizing': '{other}' is not stretch, contain, cover or crop")),
    };
    let rounding = match style.get("border-radius") {
        None => false,
        Some(ROUNDED) => true,
        Some(other) => return Err(format!("CSS property 'border-radius': '{other}' is not {ROUNDED}")),
    };
    Ok(ImageObject {
        style: object_style(element, &style, true)?,
        image: ImageModel {
            source: source.into_owned(),
            source_kind: "data".to_owned(),
            sizing,
            rounding,
            opacity: number(css.require("opacity")?).map_err(|e| format!("img: CSS property 'opacity': {e}"))?,
            link: link(element)?,
        },
    })
}

#[cfg(test)]
mod tests {
    use crate::model::{ImageObject, ImageSizing, SlideObject};
    use crate::profile::parse;
    use crate::profile::tests::document;

    fn image(src: &str, sizing: &str, css: &str) -> Result<ImageObject, String> {
        let html = document(&format!(
            r#"<a class="slide-element slide-image" href="mailto:a@b.test" data-slide="3" data-object-name="I" role="img" aria-label="Alt" style="left: 0px; top: 0px; width: 10px; height: 10px; transform-origin: center; border-style: none; border-radius: 50%;"><div class="slide-image-frame" style="width: 100%; height: 100%; overflow: hidden; position: relative; border-radius: 50%;"><img class="slide-image-content" data-image-sizing="{sizing}" alt="Alt" src="{src}" style="display: block; {css}"></div></a>"#
        ));
        match parse(&html)?.slides.pop().and_then(|mut s| s.objects.pop()) {
            Some(SlideObject::Image(object)) => Ok(object),
            _ => Err("not an image".into()),
        }
    }

    #[test]
    fn reads_every_sizing() {
        let crop = image(
            "data:image/png;base64,AA==",
            "crop",
            "opacity: 0.55; position: absolute; left: -20px; top: 0px; width: 300px; height: 150px; object-fit: fill;",
        )
        .unwrap();
        assert!(
            matches!(crop.image.sizing, ImageSizing::Crop { offset_x, offset_y, width, height } if (offset_x, offset_y, width, height) == (20.0, 0.0, 300.0, 150.0))
        );
        assert!(crop.image.rounding && crop.image.opacity == 0.55 && crop.image.source_kind == "data");
        assert_eq!(crop.image.link.as_ref().map(|l| (l.href.as_str(), l.slide)), Some(("mailto:a@b.test", Some(3))));
        let cover = image(
            "data:,x",
            "cover",
            "opacity: 1; position: absolute; left: 0px; top: -50px; width: 200px; height: 200px; object-fit: fill;",
        )
        .unwrap();
        assert!(matches!(cover.image.sizing, ImageSizing::Cover { y, .. } if y == -50.0));
        let stretch = image(
            "data:,x",
            "stretch",
            "opacity: 1; width: 100%; height: 100%; object-fit: fill; object-position: center center;",
        )
        .unwrap();
        assert!(matches!(stretch.image.sizing, ImageSizing::Stretch));
    }

    #[test]
    fn rejects_unresolved_or_out_of_profile_images() {
        for (src, sizing, css) in [
            ("logo.png", "stretch", "opacity: 1;"),
            ("https://x.test/a.png", "stretch", "opacity: 1;"),
            ("data:,x", "tile", "opacity: 1;"),
            ("data:,x", "crop", "opacity: 1; left: 1px;"),
            ("data:,x", "stretch", ""),
            ("data:,x", "stretch", "opacity: 1; filter: blur(1px);"),
        ] {
            let error = image(src, sizing, css).err().unwrap_or_default();
            assert!(error.starts_with("slide 1: object 'I': "), "{src} {sizing} {css}: {error}");
        }
    }
}
