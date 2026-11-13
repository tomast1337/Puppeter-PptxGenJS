# Project Engineering Guide

This file tells agents and contributors what the project is for and what a change must meet before it
merges. Every rule here is something a reviewer can point at. Where today's code falls short, an open
issue tracks it; do not copy a violation because it already exists.

## Objective

PuppeteerGen (published as `@pdfdeck/*`) exposes the PptxGenJS API and produces PDF instead of PPTX.
The compatibility baseline is the exact `pptxgenjs` version pinned in `package.json`. Two backends turn
the normalized model into PDF: Chromium through Puppeteer (`@pdfdeck/puppeteer`, the default) and a
Rust renderer compiled to WebAssembly (`@pdfdeck/wasm`, from `crates/`).

The active rendering priorities are complete coverage for:

1. Text and rich text
2. Images
3. Shapes
4. Tables and table pagination

Charts, media, notes, and masters may remain unimplemented until those four families are stable, but
their defaults and API types must not be broken.

## Sources of truth

Use this precedence when behavior is ambiguous:

1. PptxGenJS runtime behavior
2. OOXML emitted by PptxGenJS
3. PowerPoint rendering behavior
4. PptxGenJS type declarations and documentation
5. Browser defaults only when none of the above defines behavior

All implicit rendering values belong in `packages/pptxgenjs/src/defaults.ts`. Never introduce a
renderer-specific magic default when a PptxGenJS or Office default exists.

`docs/` holds the committed user guides (usage, quick reference, defaults, implementation notes); keep
the repository root for README, CONTRIBUTING, AGENTS and LICENSE. `notes/` contains optional local
planning notes and is intentionally ignored by Git. Read relevant files there when present, but do not
depend on them being in a fresh checkout and do not link them from committed documentation.

## Architecture

```text
PptxGenJS-compatible API        @pdfdeck/pptxgenjs  (PuppeteerGen)
  -> pure option normalization  @pdfdeck/pptxgenjs  src/normalize/
  -> normalized slide model     @pdfdeck/model      (plain, serializable data)
  -> renderer                   HTML + @pdfdeck/puppeteer, or @pdfdeck/wasm (crates/)
  -> PDF bytes
```

- Keep unit conversion, defaults, inheritance, and compatibility quirks out of DOM-building and
  PDF-drawing code. Renderers draw what the model says; they do not decide PptxGenJS behavior.
- Render preset shapes with SVG. Do not silently substitute unsupported shapes with rectangles.
- Reuse the text renderer for text in shapes and rich-text table cells.
- Resolve images before PDF generation; output must not depend on an accidental browser base URL or
  external network availability.

**Packages depend in one direction.** `@pdfdeck/model` has no dependencies. Renderers (`puppeteer`,
`wasm`) depend only on `model`. The compatibility layer (`pptxgenjs`) maps PptxGenJS input onto the
model, never the other way round, and nothing below it imports PptxGenJS types or defaults. A package
imports another only through its package name; a relative import never crosses `packages/<name>/`.
`tests/packages.test.ts` enforces the direction, the manifests and the `tsconfig.json` paths; change
its allow-list only with a reason in the PR. The target layout is #22.

**Browser-safe code stays browser-safe.** `model`, `pptxgenjs` (its runtime-neutral core and `./html`)
and the browser build of `wasm` import no `node:*` module, puppeteer or jsdom. Runtime-specific code
lives in a file named for the runtime, beside the shared code it extends: `packages/wasm/src/node.ts`
reads the binary and system fonts and then calls `browser.ts`; `packages/pptxgenjs/src/node.ts` wires
in Puppeteer and jsdom around `PuppeteerGen.ts`. The package `exports` map picks the file by
condition (`node`, `bun`, `browser`).

## Design

**Data first, objects where they fit.** The normalized model (`packages/model/src/types.ts`) is plain,
serializable data: no classes, methods, functions or DOM nodes in it, so `getModel()` round-trips
through JSON and any producer can feed any renderer. Normalization is free functions that take options
and everything else they need (page size, defaults, inherited style) and return model values; they
must be testable without Chromium. A class is fine when something has identity, a lifetime or large
mutable state: the `PuppeteerGen` presentation, `WasmRenderer` (owns a wasm instance and its fonts),
`ComponentRegistry`, the Rust `Renderer` (font collection and caches). Use inheritance only for real
polymorphism. Add an interface when two implementations exist or when it is a published contract for
third parties: `PresentationRenderer` and `ModelRenderer` in `@pdfdeck/model` qualify.

**Explicit state by default.** Prefer state that is created by the caller and passed down, so a
function's inputs are visible at its call site. Module-level mutable state (`let` at module scope, a
module-level `Map`/`WeakMap` that is written to, a Rust `static` with interior mutability) is a cost,
not a ban. Legitimate cases: the shared Chromium in `packages/puppeteer/src/browser.ts`, caches of
expensive immutable results, and counters a third-party API forces to be global. Each one gets a short
comment saying why it is global, who owns it and when it is released. A new one needs that reason in
its commit message or PR. Module-level constants (`as const` tables, frozen `Set`s of option names) are
not state.

**Pass dependencies explicitly.** A function or class gets what it needs as parameters. The pattern is
`PuppeteerGenOptions`: the caller injects `renderer`, `resolveImage` and `createDocument`, and the
Node entry supplies the defaults in plain code. Group related values into one options or context
object and pass it down. Out: service locators, global registries reachable from anywhere, and
dependency-injection containers. Construction stays visible in code, so you can see where each
dependency comes from.

**Structured flow.** Short functions that read top to bottom, explicit branches and loops, `async`/
`await` over promise chains, no webs of callbacks or event emitters. A pipeline is a function that
calls its stages in order: `toPdf()` normalizes, builds the model, renders, returns bytes.

**One topic per file, and the path says what it is.** Folder = domain, file name = what the code
does. Glance test: from the path alone you can tell what is inside without opening it, so no
`utils.ts`, `helpers.ts` or `misc.rs` grab bags; name the file after what it holds
(`normalize/geometry.ts`, `render/table.ts`). A feature's types and the functions that act on them
share one file until it no longer reads as one topic. Three or more files with one prefix become a
folder and the prefix goes: `normalize/table.ts`, `normalize/tablePagination.ts`,
`normalize/htmlTable.ts` become `normalize/table/{index,pagination,html}.ts`. TypeScript has no
namespaces here: the package plus the folder is the namespace. In Rust the module path follows the
folder: `crates/pdf-core/src/text/layout.rs` is `text::layout`. A package's main entry is `index.ts`,
or `browser.ts`/`node.ts` when it splits by runtime. File names are camelCase in TypeScript (PascalCase
only for a file whose single export is a class) and snake_case in Rust.

**Product code and fixtures stay apart.** Library code lives in `packages/*/src` and `crates/*/src`;
tests in `tests/` (visual fixtures and their scoring in `tests/visual/`); scripts in `scripts/`;
examples in `examples/`. Rust unit tests may sit in a `#[cfg(test)]` module beside the code. `spike/` is
exploratory: nothing in `packages/`, `crates/` or `tests/` imports from it, and code that graduates is
moved, not referenced.

**A value that means something has one name, in one place.** PptxGenJS and Office defaults live in
`packages/pptxgenjs/src/defaults.ts`. Unit conversions (96 CSS px per inch, 72 pt per inch, EMU) are
named once (`PPTX_DEFAULTS.units`, `units.ts` helpers) and used by that name, never retyped as `* 96` in
another file. Environment variable names (`VISUAL_DIFF_THRESHOLD`, `WASM_BASELINE_UPDATE`,
`BENCH_RUNS`, `FONT_DIRS`), visual thresholds (0.12 page, 0.08 crop, 0.002 baseline epsilon) and budgets
(`GZIP_BUDGET` in `packages/wasm/build-wasm.sh`) are named once and imported. Plain `0`, `1`, `0.5`, and
format offsets with a comment naming the format and field, are fine. A new duplicate of an existing
constant needs a reason in its commit message or PR.

## Performance

What costs time is work repeated per object, per glyph or per page, and setup repeated per deck. The
hot paths are: normalizing and rendering each slide object, per-run and per-glyph layout in
`crates/pdf-core`, per-page PDF work, and per-deck setup (browser launch, font loading, wasm
instantiation). Data loaded once stays loaded; do not micro-optimize code that runs once per deck.

1. **Set up once, reuse.** Launch Chromium through `withBrowser` (shared, idle-closed), create one
   `WasmRenderer` and render many decks with it, load fonts once per renderer, compile the wasm module
   once. Never launch, load or instantiate inside a per-slide or per-object loop.
2. **No repeated parsing in loops.** Hoist regexes, lookup tables and `Set`s to module constants. Do not
   round-trip through `JSON.stringify`/`JSON.parse` or `structuredClone` per object; clone once at the
   API boundary when a defensive copy is required (`getModel()`).
3. **Rust: reuse buffers on per-run and per-glyph paths.** Keep scratch `Vec`s in their owner
   (`Renderer`), `clear()` them each time, which keeps their memory, and fill them again. Deserialize
   into typed structs once instead of cloning `serde_json::Value` subtrees per object. No `clone()` of
   font data, layouts or strings on a hot path when a borrow or `Arc` works. Prefer iterators over
   collect-then-filter.
4. **Keep only what is used.** If the code needs the first match, stop at it; do not collect and sort
   all candidates.

Measure before and after on the same deck and machine: `bun run bench` (Puppeteer, `BENCH_RUNS`
sequential and concurrent), and `bun run bench:wasm` for the WASM backend. Put both numbers
in the PR. An optimization keeps behavior identical: visual score lines must not change, and the wasm
hash changes only when Rust code or its pins change.

## Code style: TypeScript

- **Formatting is a tool's job.** `bun run fmt` formats TypeScript, JavaScript, JSON, YAML and Markdown
  with `bun fmt` and Rust with rustfmt; `bun run fmt:check` is what CI runs. Never hand-format or
  reformat generated files (`generatedPresetShapes.ts`, the wasm-bindgen glue). Do not mix unrelated
  formatting into a change.
- **Strict types, no escape hatches.** `strict` and `noUncheckedIndexedAccess` stay on. No `any`; use
  `unknown` and narrow at the boundary. No non-null `!` on anything derived from user input, a regex
  match or an array index you have not checked; handle the missing case. `as` casts only where the type
  system cannot see an invariant, with a comment saying why it holds. `tsc` must pass with no new errors.
- **Validate untrusted input at the boundary.** Untrusted: options passed to the PptxGenJS API, image
  paths, URLs, bytes and data URIs, font files, component props, and model JSON from another producer.
  Check it where it enters (normalization, `parseComponentProps`, `createWasmRenderer`) with zod where
  the code already uses it (`components/schema.ts`), and pass only checked values inward.
- **Fail loudly and helpfully.** Unsupported or invalid input throws an error that names the input, what
  is wrong and how to fix it, like `UnsupportedChartError` (`packages/pptxgenjs/src/chart/errors.ts`) or
  the `createWasmRenderer` font errors. Use a dedicated error class when callers need to tell cases apart.
  Never silently ignore an option, drop an object or substitute something else.
  `"Method not implemented."` is not an acceptable message.
- **Build text with template literals**, not by joining strings with `+`. Appending one piece with `+=`
  is fine.
- **Build objects as literals**: `{ ...base, color, ...(bold ? { bold } : {}) }`, not declare-then-assign
  field after field. Assign afterwards only fields that depend on control flow. Mark data that is not
  mutated `readonly` or `as const`.
- **Imports**: `import type` for type-only imports (`verbatimModuleSyntax` requires it), package names
  across packages, relative paths inside one.
- Match the surrounding code's naming and comment density. Comments say why, not what. A known limit
  gets a `shortcut: <the limit>, <when to fix it>` comment.

## Code style: Rust

- **Parsing untrusted bytes is bounds-checked and returns `Result`.** Untrusted: model JSON, font files,
  image bytes, color strings. Never `unwrap()`, `expect()`, index with `[]` or slice with `[a..b]` on
  values derived from that data; use `get`, `?`, `checked_*` and explicit errors. `expect("...")` is
  allowed only for internal invariants, with a message that says why it holds. A panic in wasm aborts
  the instance, so a panic on bad input is a bug.
- **Errors cross the wasm boundary as JS errors.** Core functions return `Result`; `crates/pdf-wasm`
  maps them to `JsError` with the message intact. Features the renderer skips are reported through
  `warnings()`, never dropped silently.
- **Warnings are errors.** `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` (plus the
  `wasm32-unknown-unknown` clippy run) stay clean. Do not add `#[allow(...)]` without a comment saying why.
- **Build text with `format!`**, values with struct literals listing every field or using
  `..Default::default()`, not `let mut x = T::new()` followed by field assignments.
- Name constants (`const PT_PER_IN: f32 = 72.0;`) instead of repeating `72.0`, `96.0` or `0.75`.
- A known limit gets a `// shortcut: <the limit>, <when to fix it>` comment, as in `pdf-core`.

## Generated, vendored and pinned files

- `packages/wasm/src/pdf_wasm.js`, `.d.ts` and `pdf_wasm_bg.wasm.sha256` are written by
  `bun run build:wasm`. Never edit them by hand; commit them whenever the build changes them. CI's "WASM
  build" job rebuilds and fails on any difference.
- `packages/pptxgenjs/src/generatedPresetShapes.ts` is written by `scripts/generate-preset-shapes.ts`;
  change the script, not the output.
- Toolchain pins live in one place each: `rust-toolchain.toml` (rustc, target, clippy, rustfmt),
  `crates/wasm-toolchain.env` (wasm-pack, wasm-bindgen-cli, binaryen, sha256 sums, Docker image),
  `tests/visual/Dockerfile` (the visual image). Bumping one is its own reviewed change.
- `tests/visual/wasm/baseline.json` changes only through
  `WASM_BASELINE_UPDATE=1 bun run test:visual:wasm:docker`, and the PR explains every entry that went up.

## Testing requirements

For each compatibility or rendering change:

1. Add unit tests for normalization, defaults, and inheritance.
2. Add DOM/SVG structural assertions where useful.
3. Add or extend a shared visual fixture (`tests/visual/fixture.ts`) for user-visible behavior.
4. Run:

```bash
bun run fmt:check
bun run typecheck
bun test
bun run test:visual        # or test:visual:docker, the only environment whose scores count
git diff --check
```

Also run, when the change touches them:

- Rust (`crates/`): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` in
  `crates/`, then `bun run build:wasm` and `bun run test:visual:wasm:docker`.
- Package exports, manifests or entry files: `bun run build` and `bun run test:package`.

The visual reference is created through PptxGenJS, converted with LibreOffice, and compared with
PuppeteerGen using rasterized PDFs. Keep whole-slide normalized RMSE at or below `0.12`. Prefer
feature-level crops with a target of `0.08` so small regressions cannot hide in large blank regions.

The WASM backend keeps the 0.12 page limit on its text and emoji/CJK decks and gates crops against
`tests/visual/wasm/baseline.json`, a no-regression ratchet (plus 0.002 for rounding): lower entries when
crops improve, never raise one to make a regression pass.

Visual differences caused by LibreOffice or font rasterization must be recorded in tests or code
comments with concrete evidence. Do not loosen thresholds only to make a regression pass.

## Git and pull requests

- **Every change goes through a PR**; `main` is protected. Branch from `main` with a descriptive name
  (`feat/table-pagination`, `fix/text-wrapping`, `docs/contributing-guide`), never `changes` or `fix`.
- **One topic per PR.** A refactor, a formatting pass and a behavior change are separate PRs.
- **Conventional commits that say why**: `fix(text): ...`, `docs: ...`. The body explains the reason
  and the evidence (scores, issue, PptxGenJS output), not a list of edited files.
- **Every commit carries a `Signed-off-by` trailer for the human author** (`git commit -s`). Do not
  add AI co-author trailers.
- **Required checks must pass** before merge: "Build and test package", "Packed package on Node.js 22",
  "Packed package on Node.js 24", "Visual parity", "WASM build", and "Format" (#27). Never rename a CI
  job: the branch rules match on these names.
- **Rebase merges only, linear history.** `main` accepts only rebase merges (the ruleset enforces it),
  so every commit on a PR lands on `main` as written: each one builds, says why, and carries its
  sign-off. Keep PR branches free of merge commits: to pick up `main`, rebase onto it and push with
  `git push --force-with-lease` (PR branches only; `main` rejects force-pushes). For a stacked PR,
  after the PR below it merges, run `git rebase --onto origin/main <old-base>` and retarget it to `main`.
- The PR description says what changed and why, which PptxGenJS behavior was the reference, which tests
  were added, and what known gaps remain (with issue links).

## Completion standard

A feature is complete only when its API inputs, defaults, inheritance rules, rendering, failure behavior,
tests, and visual fixture are all covered. A broad claim such as "text supported" is not sufficient while
tracked text options are silently ignored.
