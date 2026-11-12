#!/usr/bin/env sh
# Run the visual parity test in the pinned image (tests/visual/Dockerfile).
# Artifacts land in .visual-parity/ on the host.
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
    "$image"
