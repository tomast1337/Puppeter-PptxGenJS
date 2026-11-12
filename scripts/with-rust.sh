#!/usr/bin/env sh
# Run a command with the pinned Rust toolchain: on the host when its rustc matches rust-toolchain.toml,
# otherwise in the pinned Rust image (RUST_IMAGE in crates/wasm-toolchain.env) with the repo at /src.
#   sh scripts/with-rust.sh cargo fmt --manifest-path crates/Cargo.toml --all
#   WASM_BUILD=docker  always use Docker
#   WASM_BUILD=host    never fall back to Docker (also implied by CI=true)
# packages/wasm/build-wasm.sh sources it from the repo root with WITH_RUST_SOURCED=1 to reuse the
# detection and in_rust_image, adding its own platform check.
set -eu
[ -n "${WITH_RUST_SOURCED:-}" ] || cd "$(dirname "$0")/.."
root=$PWD
. crates/wasm-toolchain.env

mode=${WASM_BUILD:-auto}
[ "${CI:-}" = true ] && [ "$mode" = auto ] && mode=host
rust_version=$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)
problem=
if ! rustc --version 2>/dev/null | grep -q "^rustc $rust_version "; then
    problem="rustc $rust_version not found (have: $(rustc --version 2>/dev/null || echo none))"
fi

# Runs "$@" in the pinned image (the caller decides when). WASM_BUILD=host stops a nested fallback.
in_rust_image() {
    mkdir -p crates/target
    # The registry lives under crates/target so repeated Docker runs reuse it.
    exec docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" --volume "$root:/src" --workdir /src \
        --env HOME=/tmp --env CARGO_HOME=/src/crates/target/docker-cargo-home --env WASM_BUILD=host \
        "$RUST_IMAGE" "$@"
}

[ -n "${WITH_RUST_SOURCED:-}" ] && return 0
if [ "$mode" = docker ] || { [ -n "$problem" ] && [ "$mode" = auto ]; }; then
    [ -n "$problem" ] && echo "$problem; running in $RUST_IMAGE" >&2
    in_rust_image "$@"
fi
if [ -n "$problem" ]; then
    echo "$problem (WASM_BUILD=$mode forbids the Docker fallback)" >&2
    exit 1
fi
exec "$@"
