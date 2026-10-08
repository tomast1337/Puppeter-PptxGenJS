# Project Engineering Guide

## Objective

PuppeteerGen should expose the PptxGenJS API while generating PDF through
Puppeteer. The compatibility baseline is the exact `pptxgenjs` version pinned
in `package.json`.

The active rendering priorities are complete coverage for:

1. Text and rich text
2. Images
3. Shapes
4. Tables and table pagination

Charts, media, notes, and masters may remain unimplemented until those four
families are stable, but their defaults and API types must not be broken.

## Sources of truth

Use this precedence when behavior is ambiguous:

1. PptxGenJS runtime behavior
2. OOXML emitted by PptxGenJS
3. PowerPoint rendering behavior
4. PptxGenJS type declarations and documentation
5. Browser defaults only when none of the above defines behavior

All implicit rendering values belong in `src/defaults.ts`. Never introduce a
renderer-specific magic default when a PptxGenJS or Office default exists.

`docs/` contains optional local planning notes and is intentionally ignored by
Git. Read relevant files there when present, but do not depend on them being in
a fresh checkout and do not link them from committed documentation.

## Architecture direction

Move toward this boundary:

```text
PptxGenJS-compatible API
  -> pure option normalization
  -> normalized slide-object model
  -> text/image/SVG-shape/table renderers
  -> HTML
  -> Puppeteer PDF
```

- Keep unit conversion, defaults, inheritance, and compatibility quirks out of
  DOM-building code.
- Prefer pure normalization functions that can be tested without Chromium.
- Render preset shapes with SVG. Do not silently substitute unsupported shapes
  with rectangles.
- Reuse the text renderer for text in shapes and rich-text table cells.
- Resolve images before PDF generation; output must not depend on an accidental
  browser base URL or external network availability.

## Compatibility discipline

- Preserve PptxGenJS method signatures and chainable slide return values.
- Track every option as unsupported, partial, implemented, or visually verified.
- Unsupported behavior should be explicit and testable, not silently ignored.
- Preserve observed PptxGenJS quirks when compatibility and documentation
  conflict. Add a regression test explaining the quirk.
- Do not upgrade `pptxgenjs` without re-auditing defaults and visual fixtures.

## Testing requirements

For each compatibility change:

1. Add unit tests for normalization, defaults, and inheritance.
2. Add DOM/SVG structural assertions where useful.
3. Add or extend a shared visual fixture for user-visible behavior.
4. Run:

```bash
bun run typecheck
bun test
bun run test:visual
git diff --check
```

The visual reference is created through PptxGenJS, converted with LibreOffice,
and compared with PuppeteerGen using rasterized PDFs. Keep whole-slide normalized
RMSE at or below `0.12`. Prefer feature-level crops with a target of `0.08` so
small regressions cannot hide in large blank regions.

Visual differences caused by LibreOffice or font rasterization must be recorded
in tests or code comments with concrete evidence. Do not loosen thresholds only
to make a regression pass.

## Completion standard

A feature is complete only when its API inputs, defaults, inheritance rules,
rendering, failure behavior, tests, and visual fixture are all covered. A broad
claim such as "text supported" is not sufficient while tracked text options are
silently ignored.
