# Examples

Short, runnable scripts that use PdfLapas the way an application does. This folder is a private workspace
package: it imports `@pdflapas/*` by package name only (its `tsconfig.json` has no `paths`), so the
examples run against the built packages, not the sources.

## Running

Build first, then run any example. Each one writes its output to the working directory, so run them from
a scratch directory, as CI does:

```bash
bun install
bun run build:wasm   # only for the examples that use @pdflapas/wasm
bun run build

mkdir -p /tmp/pdflapas-examples && cd /tmp/pdflapas-examples
bun run /path/to/pdflapas/examples/migration.ts
```

CI's "Run examples" step runs every `examples/*.ts` this way after `bun run build`. The examples need no
network access and no files outside this folder.

## Index

| Example                                                  | Shows                                                                                               | Writes                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`migration.ts`](./migration.ts)                         | Unchanged PptxGenJS code with only the import changed; a `.pptx` file name writes a `.pdf`          | `migration.pdf`                                                         |
| [`text.ts`](./text.ts)                                   | Rich-text runs, bullets, alignment, margins, line spacing and `fit: "shrink"`                       | `text.pdf`                                                              |
| [`tables.ts`](./tables.ts)                               | Cell styling and `colspan`, `autoPage` across slides, `tableToSlides()` from HTML markup            | `tables.pdf`                                                            |
| [`shapes.ts`](./shapes.ts)                               | Preset shapes, transparency, an outer shadow, text in a shape, lines with dashes and arrowheads     | `shapes.pdf`                                                            |
| [`images.ts`](./images.ts)                               | Images from data URIs and a path, sizing, and the `imageSources` limits (`allowRemote: false`, ...) | `images.pdf`                                                            |
| [`wasm-backend.ts`](./wasm-backend.ts)                   | The same deck rendered with Puppeteer and with `@pdflapas/wasm`                                     | `wasm-backend-puppeteer.pdf`, `wasm-backend-wasm.pdf`                   |
| [`html-output.ts`](./html-output.ts)                     | `toHtml()` to read and diff a deck (deterministic output), `getModel()` as JSON                     | `html-output.html`, `html-output.model.json`                            |
| [`html-input.ts`](./html-input.ts)                       | Rendering stored, edited or hand-written HTML on both backends                                      | `html-*.pdf`, `html-edited-preview.html`                                |
| [`rendering-targets.ts`](./rendering-targets.ts)         | Matching PowerPoint rendering or LibreOffice rendering (`target`, `PuppeteerGenPowerPoint`)         | `rendering-targets-libreoffice.pdf`, `rendering-targets-powerpoint.pdf` |
| [`launch-options.ts`](./launch-options.ts)               | Puppeteer `launchOptions` on the renderer (sandbox, timeouts, executable)                           | `launch-options.pdf`                                                    |
| [`react-component.ts`](./react-component.ts)             | A React component on a slide through `@pdflapas/react`                                              | `react-component.pdf`                                                   |
| [`medical-report.ts`](./medical-report.ts)               | A 9-page A4 report: `autoPage` lab tables with repeated headers, flagged values, rich text, a chart | `medical-report.pdf`, `medical-report.html`                             |
| [`company-report.ts`](./company-report.ts)               | A 14-slide annual report: KPI cards, five chart types, a financial table, a roadmap, SVG images     | `company-report.pdf`, `company-report.html`                             |
| [`comprehensive-example.ts`](./comprehensive-example.ts) | Page sizes, positioning, text, tables and layouts, written as both PDF and PPTX for comparison      | `example-*.pdf`, `example-*.pptx`                                       |
| [`test.ts`](./test.ts)                                   | One deck function run through PptxGenJS and PdfLapas side by side                                   | `Hello-World-PdfLapas.pdf`, `Hello-World-PptxGenJS.pptx`                |

## Backends

Puppeteer (Chromium) is the default and the complete backend; every example uses it unless it says
otherwise. `@pdflapas/wasm` draws the same HTML without a browser and needs font files
(`loadSystemFonts()` under Node and Bun). Both read only the document `toHtml()` returns.

## Read more

- [docs/MIGRATION.md](../docs/MIGRATION.md): moving PptxGenJS code over, what differs and what throws
- [docs/USAGE.md](../docs/USAGE.md): page sizes, text, tables and the API reference
- [docs/BACKENDS.md](../docs/BACKENDS.md): output methods, Puppeteer options, the WASM backend, custom renderers
- [docs/HTML_PROFILE.md](../docs/HTML_PROFILE.md): the HTML document every renderer draws
- [docs/COMPONENTS.md](../docs/COMPONENTS.md): components and the React adapter
