#!/usr/bin/env sh
# Build both bindings from the shared core and print artifact sizes.
set -eu
cd "$(dirname "$0")/.."
wasm-pack build wasm --release --target web --out-dir ../pkg
cargo build --profile release-native -p text-pdf-node
cp target/release-native/libtext_pdf_node.so text_pdf_node.node
for f in pkg/text_pdf_wasm_bg.wasm text_pdf_node.node; do
    printf '%s raw=%s gzip=%s\n' "$f" "$(wc -c < "$f")" "$(gzip -9c "$f" | wc -c)"
done
