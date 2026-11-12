// The text deck's WASM backend, through the public API (packages/wasm/src/node.ts). The deck has
// non-text objects, so unsupported ones are reported in warnings() instead of throwing.
import { createWasmRenderer, loadSystemFonts } from "../../../packages/wasm/src/node";

export async function createRenderer() {
    return createWasmRenderer({ fonts: await loadSystemFonts({ dirs: process.env.FONT_DIRS?.split(":") }), onUnsupported: "warn" });
}
