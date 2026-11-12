#!/usr/bin/env sh
# Run the visual parity test in the pinned image (tests/visual/Dockerfile).
# Artifacts land in .visual-parity/ on the host.
# Arguments name another package script and its arguments, e.g. `test:visual:wasm text`.
set -eu
cd "$(dirname "$0")/.."
# Set VISUAL_IMAGE to use a prebuilt image (CI pulls one from ghcr.io) instead of building.
image=${VISUAL_IMAGE:-puppeteer-gen-visual}
if [ -z "${VISUAL_IMAGE:-}" ]; then
    docker build --tag "$image" --file tests/visual/Dockerfile .
fi
mkdir -p .visual-parity
docker run --rm --user "$(id -u):$(id -g)" \
    --volume "$PWD:/repo:ro" \
    --volume "$PWD/.visual-parity:/out" \
    --env VISUAL_SCRIPT="${*:-test:visual}" \
    --env WASM_BASELINE_UPDATE="${WASM_BASELINE_UPDATE:-}" \
    "$image"
