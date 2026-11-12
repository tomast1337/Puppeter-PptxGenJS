# Contributing to PuppeteerGen

Thank you for helping improve PuppeteerGen. Contributions should preserve the
PptxGenJS-compatible API while keeping HTML and PDF output as visually close to
PowerPoint as practical.

## Development setup

This repository is a Bun workspace: each published package lives in
`packages/<name>/` (see the package table in the README). Bun installs
dependencies, runs tests, and builds every package.

```bash
bun install
```

## Create a descriptive branch

Open pull requests from a branch that describes the change. Do not develop
directly on `main`, and avoid generic branch names such as `changes`, `update`,
or `fix`.

Examples:

```text
feat/table-pagination
fix/text-wrapping
fix/curved-arrow-geometry
docs/contributing-guide
```

Keep each branch and pull request focused on one feature, fix, or documentation
change.

## Code style

`bun fmt` formats TypeScript, JavaScript, JSON, YAML and Markdown, and rustfmt
formats `crates/`. One command runs both:

```bash
bun run fmt          # format everything
bun run fmt:check    # what CI's "Format" job runs; non-zero when a file needs formatting
```

`fmt:ts`, `fmt:ts:check`, `fmt:rust` and `fmt:rust:check` run one side. `bun
fmt` needs Bun >= 1.4.4. The Rust scripts use the toolchain pinned in
`rust-toolchain.toml` and, like `build:wasm`, fall back to the pinned Docker
image when the host has no matching rustc (`WASM_BUILD=docker` forces it).

Configuration, in one place each:

- `.editorconfig`: four-space indentation (two in JSON/YAML), LF endings and
  the 320-column line width, read by both `bun fmt` and WebStorm.
- `bunfig.toml` `[fmt]`: the rest of the style (double quotes, semicolons,
  trailing commas, `x => x` arrows) and the files never formatted: the
  wasm-bindgen glue, generated preset shapes, `crates/` and gallery output.
  `.gitignore`d paths such as `dist/` are skipped too.
- `crates/rustfmt.toml`: Rust (`max_width = 160`, stable options only).

Avoid unrelated formatting changes in the same pull request.

### WebStorm

WebStorm's own Reformat Code does not match `bun fmt` (it neither adds trailing
commas nor joins or wraps lines the same way), so let `bun fmt` format files:

1. Settings | Tools | File Watchers | + | Custom.
2. File type: TypeScript (add one watcher per type you edit: JavaScript, JSON,
   YAML, Markdown). Scope: Project Files.
3. Program: `bun`. Arguments: `fmt --no-script $FilePath$`. Output paths to
   refresh: `$FilePath$`. Working directory: `$ProjectFileDir$`.
4. Under Advanced Options, untick "Auto-save edited files to trigger the
   watcher" to format on explicit save (Ctrl+S) only, and untick "Trigger the
   watcher on external changes".

Pass `--no-script` whenever you call `bun fmt` directly: with a `fmt` script in
`package.json`, plain `bun fmt` runs that script instead. For Rust, RustRover
and rust-analyzer run rustfmt with `crates/rustfmt.toml`; enable format on save
there.

### Pre-commit hook (optional)

Nothing installs hooks for you. To format staged files on commit, save this as
`.git/hooks/pre-commit` and make it executable:

```sh
#!/bin/sh
bun fmt --no-script --staged
```

`--staged` formats and re-stages only staged files; a file that also has
unstaged changes is reported instead of rewritten, and the commit stops.

### Blame

Formatting-only commits are listed in `.git-blame-ignore-revs`. GitHub skips
them automatically; for local `git blame`, run once:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Build and test

Run the relevant unit tests while developing. Before submitting a pull request,
run the complete validation suite:

```bash
bun run fmt:check
bun run typecheck
bun test
bun run build
bun run test:package
bun run test:visual
git diff --check
```

`bun run test:package` needs the built `.wasm` (`bun run build:wasm`) and fails
without it, because a `@pdfdeck/wasm` tarball without the binary is broken.

The visual suite requires LibreOffice, Poppler, and ImageMagick. New or changed
rendering behavior should include unit coverage and, where useful, a visual
fixture. Do not increase a visual threshold merely to make a regression pass.
`bun run test:visual:docker` runs it in the pinned image CI uses
(`tests/visual/Dockerfile`), which is the only environment whose scores count.

## WASM backend (Rust)

`@pdfdeck/wasm` wraps the Rust renderer in `crates/`. Consumers get the
prebuilt `.wasm` in the npm tarball; contributors build it with one command:

```bash
bun run build:wasm          # host toolchain when it matches the pins, else Docker
bun run build:wasm:docker   # always build in the pinned rust image
```

Pins, in one place each:

- `rust-toolchain.toml`: rustc, the `wasm32-unknown-unknown` target, clippy,
  rustfmt. rustup installs it automatically.
- `crates/wasm-toolchain.env`: wasm-pack, wasm-bindgen-cli (must equal the
  `wasm-bindgen` crate in `crates/Cargo.lock`; the build checks it), binaryen's
  wasm-opt, their sha256 sums, and the Docker fallback image. The build
  downloads these into `crates/target/wasm-tools/` and never uses copies on your
  PATH.
- `crates/pdf-wasm/Cargo.toml`: the wasm-opt flags. Rust >= 1.87 emits
  bulk-memory, non-trapping float-to-int, sign-ext and related instructions by
  default, so wasm-opt must be told to accept them.

Without Docker, a host build needs rustup and curl on linux-x86_64. The build
remaps source paths, so host, Docker and CI builds produce the same bytes.

It writes the wasm-bindgen glue (`text_pdf_wasm.js`/`.d.ts`) and
`text_pdf_wasm_bg.wasm.sha256` into `packages/wasm/src/`; commit both whenever
they change. The "WASM build" CI job rebuilds from scratch and fails when either
differs, so a stale glue file or a non-reproducible binary cannot merge. The
build also fails when the binary's gzip size exceeds `GZIP_BUDGET` in
`packages/wasm/build-wasm.sh`; raising it is a deliberate, reviewed change.

Rust checks, as CI runs them:

```bash
bun run fmt:rust:check   # cargo fmt --all --check with the pinned toolchain
cd crates
cargo clippy --all-targets -- -D warnings
cargo clippy -p text-pdf-wasm --target wasm32-unknown-unknown -- -D warnings
cargo test
```

### WASM visual baseline

```bash
bun run build:wasm
bun run test:visual:wasm:docker          # text and emoji decks; or append `text`
```

This scores the WASM backend against the same LibreOffice references as the
Puppeteer suite, in the same pinned image. Every page of the text and emoji/CJK
decks must stay at or below 0.12. Most per-object crops are still above the 0.08 target, so instead of
a fixed limit each crop must not score worse than its entry in
`tests/visual/wasm/baseline.json` (plus 0.002 for rounding). The baseline is a
ratchet: lower it when a change improves a crop, never raise it to hide a
regression. To update it deliberately:

```bash
WASM_BASELINE_UPDATE=1 bun run test:visual:wasm:docker
cp .visual-parity/wasm-parity/baseline.json tests/visual/wasm/baseline.json
git diff tests/visual/wasm/baseline.json   # explain every increase in the PR
```

Side-by-side crops (`montage-*.png`) land in `.visual-parity/wasm-parity/<deck>/`.

## Releases

`.github/workflows/release.yml` (manual, or on a `v*` tag) runs every CI job,
rebuilds the `.wasm` in Docker and checks it matches CI's build and the
committed hash, packs every package, checks the `@pdfdeck/wasm` tarball carries
that binary, and runs `npm publish --dry-run`. On a tag it also checks every
package version matches the tag and creates the GitHub release. It does not
publish to npm yet.

## Compatibility changes

PptxGenJS 4.0.1 is the compatibility baseline. When behavior is unclear,
prefer observed PptxGenJS runtime behavior and generated OOXML over browser
defaults.

- Keep compatibility defaults in `packages/pptxgenjs/src/defaults.ts`.
- Preserve chainable slide methods and PptxGenJS method signatures.
- Make unsupported behavior explicit instead of silently ignoring it.
- Add regression tests for compatibility quirks.
- Do not upgrade PptxGenJS without re-auditing defaults and visual fixtures.

## Pull requests

In the pull request description, explain:

- What changed and why.
- Which PptxGenJS behavior or output was used as the reference.
- Which tests were added or updated.
- Any known visual differences or unsupported behavior that remains.

Confirm that the branch has a descriptive name and that the validation commands
above pass before requesting review.
