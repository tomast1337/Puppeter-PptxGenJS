# Spike: text-only PDF renderer from `getModel()` (issue #8)

Throwaway spike. It is not wired into `src/`, the package or CI.

- `core/` holds the pure renderer: model JSON + font bytes -> PDF bytes (krilla 0.8 + parley 0.13).
- `wasm/` is the wasm-bindgen binding, meant for the `/html` browser entry.
- `node/` is the napi-rs binding, meant for the Node/Bun entry.

Both bindings expose the same JS surface: `new Renderer()`, `addFont(bytes): number`,
`render(modelJson): Uint8Array` and `warnings(): string[]`.

```sh
sh spike/wasm-text/scripts/build.sh          # pkg/ (wasm-pack --target web) + text_pdf_node.node
sh spike/wasm-text/scripts/docker.sh compare # fidelity vs LibreOffice, in the pinned visual image
sh spike/wasm-text/scripts/docker.sh bench   # cold/warm timings: Puppeteer vs WASM vs native
cargo test -p text-pdf-core                  # run from spike/wasm-text
```

Results (PDFs, PNG crops, `montage-*.png`, `fidelity.json`, `bench.json`) are written to
`spike/wasm-text/results/`, which is gitignored. The harness reads fonts from `FONT_DIRS`
(default `/usr/share/fonts`).
