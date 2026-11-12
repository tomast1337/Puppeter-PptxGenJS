#!/usr/bin/env sh
# Build the WASM text renderer (crates/pdf-wasm) and copy it next to its TS loader in packages/wasm/src/.
# The wasm-bindgen glue (.js/.d.ts) is committed so the TS side typechecks without Rust;
# the .wasm is not (CI cannot build Rust yet, issue #16). wasm-opt flags live in
# crates/pdf-wasm/Cargo.toml.
set -eu
cd "$(dirname "$0")/../.."
wasm-pack build crates/pdf-wasm --release --target web --no-pack --out-dir pkg
for f in text_pdf_wasm.js text_pdf_wasm.d.ts text_pdf_wasm_bg.wasm; do
    cp "crates/pdf-wasm/pkg/$f" "packages/wasm/src/$f"
done
f=packages/wasm/src/text_pdf_wasm_bg.wasm
printf '%s raw=%s gzip=%s\n' "$f" "$(wc -c < "$f")" "$(gzip -9c "$f" | wc -c)"
