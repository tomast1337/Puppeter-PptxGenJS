# Spike harness: text-only PDF renderer from `getModel()` (issue #8)

The renderer moved to `crates/` (`pdf-core`, `pdf-wasm`) and ships as the opt-in
`@pdfdeck/wasm` package (`packages/wasm/`). The napi-rs native addon was dropped:
the spike measured ~1.7 ms/render gain against an 8-package release matrix (#8).

The fidelity harness and its decks (text, emoji/CJK) moved to `tests/visual/wasm/`
and run in CI (`bun run test:visual:wasm:docker`, see CONTRIBUTING.md); the pinned
visual image now carries the emoji and CJK fonts. The benchmark moved to `scripts/bench-wasm.ts`
(`bun run bench:wasm`); this script still runs it in the pinned image:

```sh
bun run build:wasm                         # packages/wasm/src/text_pdf_wasm_bg.wasm
sh spike/wasm-text/scripts/docker.sh bench # cold/warm timings: Puppeteer vs WASM
bun spike/wasm-text/harness/render.ts out.pdf
```

Results (`bench.json`) are written to `spike/wasm-text/results/`, which is gitignored.
The harness reads fonts from `FONT_DIRS` (default: the system font directories, via
`loadSystemFonts()`).
