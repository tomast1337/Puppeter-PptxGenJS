//! Mutated font bytes through `add_font`, then a text deck drawn in that face: registering, shaping,
//! outlining (shadow, glow, synthetic bold) and subsetting a malformed font must not panic.
//! Seeds: real font files (docs/FUZZING.md).
#![no_main]

use libfuzzer_sys::fuzz_target;
use pdf_core::Renderer;

/// Text in the registered face, regular and as synthetic bold, outlined and glowing, so a face that
/// registers reaches layout, glyph outlines, the effect silhouettes and the PDF subsetter.
const DECK: &str = include_str!("add_font.html");

fuzz_target!(|data: &[u8]| {
    let mut renderer = Renderer::new();
    if renderer.add_font(data.to_vec()) > 0 {
        let _ = renderer.render_html(DECK);
    }
});
