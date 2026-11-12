# Spike-only image: the pinned visual image plus emoji and CJK fonts, so
# LibreOffice, Chromium and the WASM/native harness all see the same faces.
# tests/visual/Dockerfile stays untouched so CI references cannot move.
ARG BASE=puppeteer-gen-visual
FROM ${BASE}
ARG APT_SNAPSHOT=20261110T000000Z
USER root
RUN apt-get update --snapshot "$APT_SNAPSHOT" \
    && apt-get install --yes --no-install-recommends --snapshot "$APT_SNAPSHOT" fonts-noto-color-emoji fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f
