//! napi-rs binding. JS surface (identical to the wasm binding):
//! `new Renderer()`, `addFont(bytes): number`, `render(modelJson): Uint8Array`, `warnings(): string[]`.
use napi::bindgen_prelude::{Buffer, Error, Result, Uint8Array};
use napi_derive::napi;

#[napi]
pub struct Renderer(text_pdf_core::Renderer);

#[napi]
#[allow(clippy::new_without_default)]
impl Renderer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Renderer(text_pdf_core::Renderer::new())
    }

    #[napi]
    pub fn add_font(&mut self, data: Uint8Array) -> u32 {
        self.0.add_font(data.to_vec())
    }

    #[napi]
    pub fn render(&mut self, model_json: String) -> Result<Buffer> {
        self.0.render(&model_json).map(Buffer::from).map_err(Error::from_reason)
    }

    #[napi]
    pub fn warnings(&self) -> Vec<String> {
        self.0.warnings()
    }
}
