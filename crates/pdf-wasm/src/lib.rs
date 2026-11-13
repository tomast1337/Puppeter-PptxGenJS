//! wasm-bindgen binding. JS surface:
//! `new Renderer()`, `addFont(bytes): number`, `renderHtml(html): Uint8Array`, `warnings(): string[]`.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Renderer(pdf_core::Renderer);

#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Renderer {
        Renderer(pdf_core::Renderer::new())
    }

    #[wasm_bindgen(js_name = addFont)]
    pub fn add_font(&mut self, data: Vec<u8>) -> u32 {
        self.0.add_font(data)
    }

    /// Renders a pdfdeck HTML profile document (`toHtml().html`).
    #[wasm_bindgen(js_name = renderHtml)]
    pub fn render_html(&mut self, html: &str) -> Result<Vec<u8>, JsError> {
        self.0.render_html(html).map_err(|e| JsError::new(&e))
    }

    pub fn warnings(&self) -> Vec<String> {
        self.0.warnings()
    }
}
