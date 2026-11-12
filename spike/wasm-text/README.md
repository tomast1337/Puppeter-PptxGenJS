# Spike harness: text-only PDF renderer from `getModel()` (issue #8)

The renderer moved to `crates/` (`pdf-core`, `pdf-wasm`) and ships as the opt-in
`@pdfdeck/wasm` package (`packages/wasm/`). The napi-rs native addon was dropped:
the spike measured ~1.7 ms/render gain against an 8-package release matrix (#8).

What remains here is the scoring harness, which now goes through the public API
(`createWasmRenderer` + `PuppeteerGen.toPdf()`):

```sh
bun run build:wasm                           # packages/wasm/src/text_pdf_wasm_bg.wasm
sh spike/wasm-text/scripts/docker.sh compare # fidelity vs LibreOffice, in the pinned visual image
sh spike/wasm-text/scripts/docker.sh bench   # cold/warm timings: Puppeteer vs WASM
(cd crates && cargo test)

# Emoji and CJK deck (issue #14): spike image = visual image + Noto Color Emoji + Noto Sans CJK
docker build -t puppeteer-gen-visual-emoji spike/wasm-text
VISUAL_IMAGE=puppeteer-gen-visual-emoji sh spike/wasm-text/scripts/docker.sh compare emoji
```

Results (PDFs, PNG crops, `montage-*.png`, `fidelity.json`, `bench.json`) are written to
`spike/wasm-text/results/<deck>/` (bench: `results/`), which is gitignored. The harness reads fonts from `FONT_DIRS`
(default: the system font directories, via `loadSystemFonts()`).
