#!/usr/bin/env sh
# Run the spike benchmark inside the pinned visual image (tests/visual/Dockerfile),
# so fonts, LibreOffice and Chromium match CI. Build the renderer first
# (bun run build:wasm). Usage: scripts/docker.sh [bench]
# Results land in spike/wasm-text/results/ on the host.
set -eu
cd "$(dirname "$0")/../../.."
image=${VISUAL_IMAGE:-puppeteer-gen-visual}
script=${1:-bench}
# The benchmark graduated to scripts/bench-wasm.ts; other names still run from harness/.
case $script in bench) entry=scripts/bench-wasm.ts ;; *) entry=spike/wasm-text/harness/$script.ts ;; esac
mkdir -p spike/wasm-text/results
docker run --rm --user "$(id -u):$(id -g)" \
    --volume "$PWD:/repo:ro" \
    --volume "$PWD/spike/wasm-text/results:/out" \
    --env BENCH_OUT=/out --env BENCH_RUNS="${BENCH_RUNS:-20}" \
    "$image" sh -c "tar -C /repo --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./.visual-parity --exclude=./crates/target --exclude=./spike/wasm-text/results -cf - . | tar --no-overwrite-dir -xf - && ln -s /deps/node_modules node_modules && bun $entry"
