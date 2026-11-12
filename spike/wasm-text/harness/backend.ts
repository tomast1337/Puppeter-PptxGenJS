// The text deck's WASM backend, through the public API (src/wasm/node.ts). The deck has
// non-text objects, so unsupported ones are reported in warnings() instead of throwing.
import { createWasmRenderer, loadSystemFonts } from "../../../src/wasm/node";

export async function createRenderer() {
    return createWasmRenderer({ fonts: await loadSystemFonts({ dirs: process.env.FONT_DIRS?.split(":") }), onUnsupported: "warn" });
}
