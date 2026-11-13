#!/usr/bin/env sh
# Build the WASM text renderer (crates/pdf-wasm) and copy it next to its TS loader in packages/wasm/src/.
#
# Committed outputs: the wasm-bindgen glue (.js/.d.ts), so the TS side typechecks without Rust, and
# pdf_wasm_bg.wasm.sha256. CI rebuilds and fails on any diff, so a stale glue or a
# non-reproducible .wasm cannot merge. The .wasm itself is gitignored; CI ships it in @pdfdeck/wasm.
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
GZIP_BUDGET=972072

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
RUSTFLAGS="--remap-path-prefix=$root=/pdfdeck --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
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
