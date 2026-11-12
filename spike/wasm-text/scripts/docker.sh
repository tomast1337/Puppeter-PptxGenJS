#!/usr/bin/env sh
# Run a spike harness script inside the pinned visual image (tests/visual/Dockerfile),
# so fonts, LibreOffice and Chromium match CI. Build pkg/ and text_pdf_node.node first
# (spike/wasm-text/scripts/build.sh). Usage: scripts/docker.sh compare|bench
# Results land in spike/wasm-text/results/ on the host.
set -eu
cd "$(dirname "$0")/../../.."
image=${VISUAL_IMAGE:-puppeteer-gen-visual}
script=${1:-compare}
mkdir -p spike/wasm-text/results
docker run --rm --user "$(id -u):$(id -g)" \
    --volume "$PWD:/repo:ro" \
    --volume "$PWD/spike/wasm-text/results:/out" \
    --env SPIKE_OUT=/out --env BENCH_RUNS="${BENCH_RUNS:-20}" \
    "$image" sh -c "tar -C /repo --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./.visual-parity --exclude=./spike/wasm-text/target --exclude=./spike/wasm-text/results -cf - . | tar --no-overwrite-dir -xf - && ln -s /deps/node_modules node_modules && bun spike/wasm-text/harness/$script.ts ${2:-}"
