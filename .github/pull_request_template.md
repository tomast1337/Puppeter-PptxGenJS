## What changed and why

## Reference behaviour

<!-- The PptxGenJS runtime behaviour, OOXML or PowerPoint/LibreOffice rendering used as reference. -->

## Tests added

## Known gaps

<!-- Remaining unsupported behaviour or visual differences, with issue links. -->

## Checklist

- [ ] One topic; branch named for it.
- [ ] Conventional commits that say why, each with `Signed-off-by` (`git commit -s`).
- [ ] `bun run fmt:check`, `bun run typecheck`, `bun test`, `bun run test:visual`, `git diff --check` pass.
- [ ] Rust changed: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `bun run build:wasm`, `bun run test:visual:wasm:docker`.
- [ ] Exports, manifests or entry files changed: `bun run build`, `bun run test:package`.
- [ ] Visual fixture added or extended; scores (and any baseline change) explained above.
- [ ] Docs updated.
