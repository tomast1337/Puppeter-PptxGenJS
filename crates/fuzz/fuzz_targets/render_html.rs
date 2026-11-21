//! Mutated profile HTML into one shared `Renderer`, as a server shares one `WasmRenderer`: any
//! panic is a bug (GHSA-fmx3-qwqc-h37c). An `Err` is the expected answer to invalid HTML.
//! Seeds: `bun run scripts/export-fuzz-seeds.ts`; how to run: docs/FUZZING.md.
#![no_main]

use std::cell::RefCell;

use libfuzzer_sys::fuzz_target;
use pdf_core::Renderer;

thread_local! {
    // One renderer for every input, loaded once with the faces in FUZZ_FONTS (colon-separated paths):
    // without a font no glyph is drawn, and the text paths are not reached.
    static RENDERER: RefCell<Renderer> = RefCell::new({
        let mut renderer = Renderer::new();
        for path in std::env::var("FUZZ_FONTS").unwrap_or_default().split(':').filter(|p| !p.is_empty()) {
            let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("FUZZ_FONTS: cannot read {path}: {e}"));
            renderer.add_font(bytes);
        }
        renderer
    });
}

fuzz_target!(|data: &[u8]| {
    if let Ok(html) = std::str::from_utf8(data) {
        RENDERER.with_borrow_mut(|renderer| {
            let _ = renderer.render_html(html);
        });
    }
});
