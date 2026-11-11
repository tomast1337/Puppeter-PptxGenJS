#!/usr/bin/env sh
# Run the visual parity test in the pinned image (tests/visual/Dockerfile).
# Artifacts land in .visual-parity/ on the host.
set -eu
cd "$(dirname "$0")/.."
image=puppeteer-gen-visual
docker build --quiet --tag "$image" --file tests/visual/Dockerfile . >/dev/null
mkdir -p .visual-parity
docker run --rm --user "$(id -u):$(id -g)" \
    --volume "$PWD:/repo:ro" \
    --volume "$PWD/.visual-parity:/out" \
    "$image"
