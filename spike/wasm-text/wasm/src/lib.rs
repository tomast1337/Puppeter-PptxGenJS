//! wasm-bindgen binding. JS surface (identical to the napi binding):
//! `new Renderer()`, `addFont(bytes): number`, `render(modelJson): Uint8Array`, `warnings(): string[]`.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Renderer(text_pdf_core::Renderer);

#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Renderer {
        Renderer(text_pdf_core::Renderer::new())
    }

    #[wasm_bindgen(js_name = addFont)]
    pub fn add_font(&mut self, data: Vec<u8>) -> u32 {
        self.0.add_font(data)
    }

    pub fn render(&mut self, model_json: &str) -> Result<Vec<u8>, JsError> {
        self.0.render(model_json).map_err(|e| JsError::new(&e))
    }

    pub fn warnings(&self) -> Vec<String> {
        self.0.warnings()
    }
}
