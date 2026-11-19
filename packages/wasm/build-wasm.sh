#!/usr/bin/env sh
# Build the WASM text renderer (crates/pdf-wasm) and copy it next to its TS loader in packages/wasm/src/.
#
# Committed outputs: the wasm-bindgen glue (.js/.d.ts), so the TS side typechecks without Rust, and
# pdf_wasm_bg.wasm.sha256. CI rebuilds and fails on any diff, so a stale glue or a
# non-reproducible .wasm cannot merge. The .wasm itself is gitignored; CI ships it in @pdflapas/wasm.
#
# Toolchain: rustc from rust-toolchain.toml; wasm-pack, wasm-bindgen and wasm-opt from
# crates/wasm-toolchain.env, downloaded and checksum-verified into crates/target/wasm-tools/.
# Without rustc 1.95.0 on a linux-x86_64 host, the build reruns itself in the pinned Rust image.
#   WASM_BUILD=docker  always build in Docker (bun run build:wasm:docker)
#   WASM_BUILD=host    never fall back to Docker (also implied by CI=true)
# wasm-opt flags (bulk-memory, nontrapping-fptoint, ... that Rust >= 1.87 emits) live in
# crates/pdf-wasm/Cargo.toml.
set -eu
cd "$(dirname "$0")/../.."
root=$PWD
. crates/wasm-toolchain.env

# Spike measured 850 KB; 0.2.0 built 912,028 B. ~5% headroom: growth past it needs a deliberate bump.
# +4,404 B: tab stops (parley inline boxes), measured on top of the line-box fix (958,384 B).
# +6,510 B: table drawing (#57), 962,788 -> 970,914 B measured on top of tab stops; budget = that size.
# +38 B: Liberation Sans before the CJK fallback face, measured on top of tables and synthetic styles.
# +1,120 B: PDF link annotations (krilla's annotation, URI action and page destination writers), 970,586 -> 972,072 B measured; budget = that size.
# +12,462 B: shadows and text glow (capture, flattening, stroker, coverage raster, EDT dilation, box blur, soft-masked image), 972,072 -> 984,534 B measured; budget = that size.
# +30,024 B: the HTML profile reader (#69: strict tokenizer, profile-to-model mapping, renderHtml binding), 984,534 -> 1,014,558 B measured; budget = that size.
# -56,463 B: the JSON model reader and serde/serde_json removed (#69 phase 5: renderHtml is the only input), 1,014,558 -> 958,095 B measured; budget = that size.
# -40 B: the line-box strut leaves the text allow-lists (#69 phase 6), 958,095 -> 958,055 B measured; budget = that size.
# -95 B: the print snap and dash rewrite leave the shape allow-lists; the dash pattern is read from stroke-dasharray (#69 phase 6), 958,055 -> 957,960 B measured; budget = that size.
# +93 B: the table offset leaves the table allow-list (#69 phase 6); raw -26 B, gzip packs it worse, 957,960 -> 958,053 B measured; budget = that size.
# -112 B: font-family is exactly one quoted family; the bullet copy is checked too (#69 phase 7), 958,053 -> 957,941 B measured; budget = that size.
# +17,807 B: chart SVG (#69 phase 8a: strict SVG subset reader, gradients, clip paths, SVG text), 957,941 -> 975,748 B measured; budget = that size.
# +7 B: the SVG reader and drawing renamed from chart to svg (#69 phase 8b, shared with SVG images); only embedded source paths change, 975,748 -> 975,755 B measured; budget = that size.
# +6,425 B: SVG images (#69 phase 8b: data URI reading, viewBox/preserveAspectRatio fit, +2,136 B; the subset's named colors +1,755 B; rotate/skew +47 B; style, circle, rx/ry, opacity, fill-rule, transform lists and the XML prolog +2,487 B), 975,755 -> 982,180 B measured; budget = that size.
# +16,569 B: GIF images (krilla's GIF decoder, first frame; #17), 982,180 -> 998,749 B measured; budget = that size.
# +44,714 B: WebP images (krilla's image-webp decoder, lossy and lossless, first frame; #17; the skip warning path goes), 998,749 -> 1,043,463 B measured; budget = that size.
# +1,135 B: components made of sized boxes (#69 phase 8c: box reader lowered to the SVG display list; the component warning path goes), 1,043,463 -> 1,044,598 B measured; budget = that size.
# +1,133 B: document properties (#102: profile v2 <title>, author and description read into krilla's Info dictionary and XMP writer), 1,044,598 -> 1,045,731 B measured; budget = that size.
# +1,594 B: company and revision as custom Info keys (#102: an incremental update after krilla's output, which has no field for them), 1,045,731 -> 1,047,325 B measured; budget = that size.
# +318 B: slide links by the slide number in id="slide-N" (#102: hidden slides are not in the document, so a link to slide N jumps to the page that shows it), 1,047,325 -> 1,047,643 B measured; budget = that size.
# -561 B: face fills read from the HTML, the Rust copy of the shading factors removed (#43), 1,047,643 -> 1,047,082 B measured; budget = that size.
# -13 B: the project renamed to PdfLapas (error messages, the v2 profile meta names beside the frozen v1 ones, the /pdflapas source path remap), 1,047,082 -> 1,047,069 B measured; budget = that size.
# +186 B: font-kerning: none on a run (the PowerPoint rendering target) turns parley's kern feature off, 1,047,069 -> 1,047,255 B measured; budget = that size.
# +1,279 B: resource limits (#160: image header sizes for the pixel limits, effect flattening tolerance from the path extent, glow count per text box), 1,047,255 -> 1,048,534 B measured; budget = that size.
# +94 B: profile colors and keywords parsed once into typed model values, every color strictly (#152: error messages naming the property, the keyword tables), 1,048,534 -> 1,048,628 B measured; budget = that size.
# +9 B: a tab within 0.01px before a stop counts as on it, so float rounding cannot send the next tab back to that stop (#161), 1,048,628 -> 1,048,637 B measured; budget = that size.
# +1,408 B: tab layout measures each line once and re-breaks only when a widened tab moves text to another line, within a re-break budget (#161: per-line cluster table sorted by byte offset), 1,048,637 -> 1,050,045 B measured; budget = that size.
# -67 B: flag parameters and tuple results replaced by named enums and structs, draw_layout split (#158), 1,050,045 -> 1,049,978 B measured; budget = that size.
# +306 B: the shrink-to-fit rule read from data-text-fit-step, -max-steps and -tolerance instead of renderer constants (#154: three attributes and their errors), 1,049,978 -> 1,050,284 B measured; budget = that size.
# +60 B: a table cell's data-text-fit other than none is a profile error instead of a "shrink-to-fit not applied" warning (#197: the longer error message), 1,050,284 -> 1,050,344 B measured; budget = that size.
# +821 B: every underline style drawn (#205: double, dotted and dashed bands, the wavy band, the text-decoration-style and data-underline-style keywords), 1,050,344 -> 1,051,165 B measured; budget = that size.
# +181 B: the last line and a line ending in a soft break take their own baselines (#234: data-mark-baseline and data-break-baseline read, parley break reasons), 1,051,165 -> 1,051,346 B measured; budget = that size.
# +1,063 B: each table grid edge drawn once and each run of edges with the same border stroked as one line (shared edges resolved per grid line), 1,051,346 -> 1,052,409 B measured; budget = that size.
# +4 B: an empty paragraph keeps a raised or lowered empty run's offset out of its line box, as Chromium does, 1,052,409 -> 1,052,413 B measured; budget = that size.
GZIP_BUDGET=1052413

locked=$(sed -n '/^name = "wasm-bindgen"$/{n;s/^version = "\(.*\)"$/\1/p;}' crates/Cargo.lock)
if [ "$locked" != "$WASM_BINDGEN_VERSION" ]; then
    echo "crates/Cargo.lock has wasm-bindgen $locked, crates/wasm-toolchain.env pins wasm-bindgen-cli $WASM_BINDGEN_VERSION: they must match" >&2
    exit 1
fi

WITH_RUST_SOURCED=1
. scripts/with-rust.sh
if [ "$(uname -sm)" != "Linux x86_64" ]; then
    # shortcut: prebuilt tools are pinned for linux-x86_64 only; add per-platform sums if contributors need native builds.
    problem="host is $(uname -sm), the pinned tools are linux-x86_64"
fi
if [ "$mode" = docker ] || { [ -n "$problem" ] && [ "$mode" = auto ]; }; then
    [ -n "$problem" ] && echo "$problem; building in $RUST_IMAGE"
    in_rust_image sh packages/wasm/build-wasm.sh
fi
if [ -n "$problem" ]; then
    echo "$problem (WASM_BUILD=$mode forbids the Docker fallback)" >&2
    exit 1
fi

tools=crates/target/wasm-tools
pins="$WASM_PACK_VERSION $WASM_BINDGEN_VERSION $BINARYEN_VERSION"
fetch() { # url sha256 strip-components member
    curl -fsSL --retry 3 -o "$tools/download.tar.gz" "$1"
    echo "$2  $tools/download.tar.gz" | sha256sum -c --quiet -
    tar -xzf "$tools/download.tar.gz" -C "$tools/bin" --strip-components="$3" "$4"
    rm "$tools/download.tar.gz"
}
if [ "$(cat "$tools/pins" 2>/dev/null)" != "$pins" ]; then
    rm -rf "$tools"
    mkdir -p "$tools/bin"
    gh=https://github.com
    fetch "$gh/rustwasm/wasm-pack/releases/download/v$WASM_PACK_VERSION/wasm-pack-v$WASM_PACK_VERSION-x86_64-unknown-linux-musl.tar.gz" \
        "$WASM_PACK_SHA256" 1 "wasm-pack-v$WASM_PACK_VERSION-x86_64-unknown-linux-musl/wasm-pack"
    fetch "$gh/wasm-bindgen/wasm-bindgen/releases/download/$WASM_BINDGEN_VERSION/wasm-bindgen-$WASM_BINDGEN_VERSION-x86_64-unknown-linux-musl.tar.gz" \
        "$WASM_BINDGEN_SHA256" 1 "wasm-bindgen-$WASM_BINDGEN_VERSION-x86_64-unknown-linux-musl/wasm-bindgen"
    fetch "$gh/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/binaryen-version_$BINARYEN_VERSION-x86_64-linux.tar.gz" \
        "$BINARYEN_SHA256" 2 "binaryen-version_$BINARYEN_VERSION/bin/wasm-opt"
    echo "$pins" > "$tools/pins"
fi
# wasm-pack uses the wasm-bindgen and wasm-opt it finds on PATH when their versions fit.
PATH="$root/$tools/bin:$PATH"
# Panic locations embed source paths: remap them so host, Docker and CI builds hash the same.
RUSTFLAGS="--remap-path-prefix=$root=/pdflapas --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
export PATH RUSTFLAGS
echo "$(rustc --version), wasm-pack $WASM_PACK_VERSION, wasm-bindgen $WASM_BINDGEN_VERSION, wasm-opt $BINARYEN_VERSION"
wasm-pack build crates/pdf-wasm --release --target web --no-pack --out-dir pkg
for f in pdf_wasm.js pdf_wasm.d.ts pdf_wasm_bg.wasm; do
    cp "crates/pdf-wasm/pkg/$f" "packages/wasm/src/$f"
done

f=packages/wasm/src/pdf_wasm_bg.wasm
(cd packages/wasm/src && sha256sum pdf_wasm_bg.wasm > pdf_wasm_bg.wasm.sha256)
raw=$(wc -c < "$f" | tr -d ' ')
gzip=$(gzip -9cn "$f" | wc -c | tr -d ' ')
echo "$f sha256=$(cut -d' ' -f1 "$f.sha256") raw=$raw gzip=$gzip gzip-budget=$GZIP_BUDGET"
if [ "$gzip" -gt "$GZIP_BUDGET" ]; then
    echo "$f is $gzip B gzipped, over the $GZIP_BUDGET B budget (GZIP_BUDGET in $0)" >&2
    exit 1
fi
