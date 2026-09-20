# Contributing to PuppeteerGen

Thank you for helping improve PuppeteerGen. Contributions should preserve the
PptxGenJS-compatible API while keeping HTML and PDF output as visually close to
PowerPoint as practical.

## Development setup

This repository uses Bun to install dependencies, run tests, and build the
package.

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

Biome is the formatter and linter for this project. Format and check your work
before opening a pull request:

```bash
bun run check:fix
bun run check
```

Avoid unrelated formatting changes in the same pull request.

## Build and test

Run the relevant unit tests while developing. Before submitting a pull request,
run the complete validation suite:

```bash
bun run typecheck
bun test
bun run build
bun run test:package
bun run test:visual
git diff --check
```

The visual suite requires LibreOffice, Poppler, and ImageMagick. New or changed
rendering behavior should include unit coverage and, where useful, a visual
fixture. Do not increase a visual threshold merely to make a regression pass.

## Compatibility changes

PptxGenJS 4.0.1 is the compatibility baseline. When behavior is unclear,
prefer observed PptxGenJS runtime behavior and generated OOXML over browser
defaults.

- Keep compatibility defaults in `src/defaults.ts`.
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
