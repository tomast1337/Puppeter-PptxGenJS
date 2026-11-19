//! wasm-bindgen binding. JS surface:
//! `new Renderer()`, `addFont(bytes): number`, `renderHtml(html): Uint8Array`, `warnings(): string[]`,
//! `missingFonts(): MissingFont[]`.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Renderer(pdf_core::Renderer);

/// A run face no registered font provides (`pdf_core::MissingFont`).
#[wasm_bindgen(getter_with_clone)]
pub struct MissingFont {
    #[wasm_bindgen(readonly)]
    pub face: String,
    /// The fallback face Latin text was drawn in, when one is registered.
    #[wasm_bindgen(readonly)]
    pub used: Option<String>,
    /// `slide <n> '<object name>'` of each object asking for the face, sorted.
    #[wasm_bindgen(readonly)]
    pub objects: Vec<String>,
}

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

    /// Renders a PdfLapas HTML profile document (`toHtml().html`).
    #[wasm_bindgen(js_name = renderHtml)]
    pub fn render_html(&mut self, html: &str) -> Result<Vec<u8>, JsError> {
        self.0.render_html(html).map_err(|e| JsError::new(&e))
    }

    pub fn warnings(&self) -> Vec<String> {
        self.0.warnings()
    }

    /// The run faces of the last render no registered font provides.
    #[wasm_bindgen(js_name = missingFonts)]
    pub fn missing_fonts(&self) -> Vec<MissingFont> {
        self.0
            .missing_fonts()
            .iter()
            .map(|missing| MissingFont {
                face: missing.face.clone(),
                used: missing.used.clone(),
                objects: missing.objects.iter().cloned().collect(),
            })
            .collect()
    }
}
