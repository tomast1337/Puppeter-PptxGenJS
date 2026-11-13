# pdfdeck

Turn existing PptxGenJS code into PDF. pdfdeck implements the
[PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 4.0.1 API (`addSlide`, `addText`, `addImage`,
`addShape`, `addTable`, `addChart`, `writeFile`, ...) and writes a PDF instead of a `.pptx`, so
layout code you already have keeps working. You choose the backend that draws the PDF:

- **Puppeteer** (default): renders HTML in headless Chromium. Covers text, images, shapes, tables
  and charts.
- **WASM** (opt-in): a Rust renderer compiled to WebAssembly that draws the same model straight to
  PDF, with no browser, in Node, Bun or a web page. Text and shapes today.

> [!IMPORTANT]
> **Release status.** The `@pdfdeck/*` packages described here are **not published to npm yet**, and
> the `@pdfdeck` npm scope is not claimed. The only release on npm is
> [`puppeteer-pptxgenjs`](https://www.npmjs.com/package/puppeteer-pptxgenjs) 0.1.1: a single
> package with the Puppeteer backend only. It has no `/html`, `/wasm` or `/react` entries, no
> constructor options (custom renderer, image resolver), no `toPdf()`, `toHtml()` or `getModel()`,
> no components, and its `write()` and `stream()` throw. This README describes `main`; to use it
> today, [build from source](#use-it-from-source-today). The migration plan is tracked in
> [#22](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/22).

## Packages

| Package               | What it is                                                                                                    | Entries                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@pdfdeck/pptxgenjs`  | The PptxGenJS-compatible API (class `PuppeteerGen`), defaults, normalization, HTML renderers                  | `.` (Node), `./html` (browser-safe)    |
| `@pdfdeck/model`      | The normalized presentation model and the renderer interfaces (`PresentationRenderer`, `ModelRenderer`)       | `.` (types only)                       |
| `@pdfdeck/puppeteer`  | `PuppeteerPdfRenderer`, the default backend, and the shared Chromium (`closeBrowser`)                         | `.` (Node)                             |
| `@pdfdeck/wasm`       | `createWasmRenderer`, the opt-in WebAssembly backend                                                          | `.` (browser, Node and Bun conditions) |
| `@pdfdeck/react`      | `registerReactComponent`, for React components on slides                                                      | `.`                                    |
| `puppeteer-pptxgenjs` | Deprecation shim: re-exports `@pdfdeck/pptxgenjs` and its `/html`, `/react` and `/wasm` subpaths at old names | `.`, `./html`, `./react`, `./wasm`     |

Every package in this repository is at 0.2.0 and unpublished. `@pdfdeck/pptxgenjs` depends on
`@pdfdeck/model`, and its Node entry on `@pdfdeck/puppeteer`; the renderers depend only on
`@pdfdeck/model`; `@pdfdeck/react` takes `react` and `react-dom` 19 as peers. Node.js 22 or newer and
Bun 1.2 or newer are supported.

## How they fit

```text
your PptxGenJS code
  -> @pdfdeck/pptxgenjs   PptxGenJS-compatible API and option normalization
  -> @pdfdeck/model       normalized slide model (plain, serializable data)
  -> renderer             HTML + @pdfdeck/puppeteer (Chromium), or @pdfdeck/wasm (Rust, no browser)
  -> PDF bytes
```

PptxGenJS defaults, inheritance and quirks are resolved once, in the compatibility layer, so both
backends draw the same model. `getModel()` returns it as JSON-serializable data.

## Quick start

```typescript
import pptxgen from "@pdfdeck/pptxgenjs";

const pres = new pptxgen(); // 10 x 5.625 in, the same size as PptxGenJS's default LAYOUT_16x9

const slide = pres.addSlide();
slide.background = { color: "F1F1F1" };
slide
    .addText("Hello from pdfdeck", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true, color: "363636" })
    .addShape("roundRect", { x: 0.5, y: 2, w: 4, h: 2, fill: { color: "0088CC" }, rectRadius: 0.2 })
    .addTable(
        [
            [
                { text: "Plan", options: { bold: true } },
                { text: "Price", options: { bold: true } },
            ],
            [{ text: "Basic" }, { text: "$9" }],
        ],
        { x: 5, y: 2, w: 4.5, border: { type: "solid", pt: 1, color: "999999" } },
    );

await pres.writeFile({ fileName: "hello.pdf" }); // a PDF, not a .pptx
```

The default export is the class `PuppeteerGen` (it keeps that name until the rename planned in [#22](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/22)); any
local name works. Slide methods chain as in PptxGenJS. Differences to know when porting:

- **Page size:** there is no `pres.layout = "LAYOUT_..."` property (TypeScript rejects it; plain
  JavaScript ignores it). Pass a size to the constructor, `new pptxgen(PAGE_SIZES.A4.portrait)`, or
  call `pres.defineLayout({ name, width, height })`, which applies immediately. The sizes in
  `PAGE_SIZES` are listed in [docs/USAGE.md](./docs/USAGE.md#page-sizes-and-layouts).
- **Output:** `writeFile()`, `write()` and `stream()` return PDF bytes; `toPdf()` and `toHtml()`
  are pdfdeck additions. See [docs/BACKENDS.md](./docs/BACKENDS.md).
- **Not drawn:** `addMedia()` and `defineSlideMaster()` throw `UnsupportedFeatureError` with a
  suggested alternative; `addNotes()` is accepted and, as on a PowerPoint slide, not shown.
  Presentation metadata (`title`, `author`, ...) is not part of the API.

### Use it from source today

Until `@pdfdeck/*` is published, build the packages and install them as tarballs:

```bash
git clone https://github.com/tomast1337/Puppeter-PptxGenJS.git pdfdeck
cd pdfdeck
bun install
bun run build:wasm   # only for @pdfdeck/wasm: pinned Rust toolchain, or Docker when it is missing
bun run build
for p in model puppeteer pptxgenjs wasm; do (cd packages/$p && bun pm pack --destination ../../tarballs); done

cd /path/to/your-app
npm install /path/to/pdfdeck/tarballs/pdfdeck-{model,puppeteer,pptxgenjs}-0.2.0.tgz
npm install /path/to/pdfdeck/tarballs/pdfdeck-wasm-0.2.0.tgz   # optional
```

Inside this repository the workspace already resolves `@pdfdeck/*`, so `bun run examples/test.ts`
works after `bun install`. Once the packages are published, this becomes
`npm install @pdfdeck/pptxgenjs` (plus `@pdfdeck/wasm` or `@pdfdeck/react` when you need them).

## Choosing a backend

Puppeteer is the default and the complete backend. Use WASM when you cannot run Chromium (a web
page, a serverless function without a browser) and your slides are text, shapes, raster images and
tables.

| Family                | Puppeteer (default)                                                      | WASM (opt-in)                                                                                      |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Text and rich text    | Partial: 50 of 68 tracked options done, 9 partial                        | Drawn: runs, paragraphs, bullets, tab stops, insets, rotation, fit, hyperlinks; no shadows or glow |
| Shapes                | All 179 presets and custom geometry; 36 of 39 options done               | All presets and custom geometry, hyperlinks; no shadows                                            |
| Images                | Partial: 28 of 29 options done                                           | PNG and JPEG in every sizing mode, hyperlinks; no GIF, WebP, SVG or shadows                        |
| Tables and pagination | Partial: 44 of 47 options done, including `autoPage` and `tableToSlides` | Drawn: merges, fills, borders, rows sized to cell text; single-line underlines                     |
| Charts                | ECharts: 9 of 11 chart types, `mixed` partial, `bubble3D` unsupported    | Not drawn                                                                                          |
| Components            | Implemented ([HTML and React](./docs/COMPONENTS.md))                     | Not drawn                                                                                          |
| Media, slide masters  | Throw `UnsupportedFeatureError`                                          | Same                                                                                               |

The counts come from `COMPATIBILITY`, `CHART_TYPE_COMPATIBILITY` and
`SHAPE_GEOMETRY_COMPATIBILITY`, exported by `@pdfdeck/pptxgenjs` (source:
[`compatibility.ts`](./packages/pptxgenjs/src/compatibility.ts)), which track every option as
unsupported, partial, implemented or visually verified. WASM coverage for GIF, WebP and SVG images is
[#17](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/17).

The WASM backend never drops content silently: by default `toPdf()` throws and lists what it could
not draw; with `onUnsupported: "warn"` it returns the PDF and `renderer.warnings()` lists the
skipped objects. It needs font files (it cannot see system fonts); `loadSystemFonts()` reads the
metric-compatible Office substitutes (Carlito, Liberation, DejaVu) under Node and Bun.

```typescript
import pptxgen from "@pdfdeck/pptxgenjs";
import { createWasmRenderer, loadSystemFonts } from "@pdfdeck/wasm";

const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
const pres = new pptxgen(undefined, { renderer });

pres.addSlide()
    .addText("Drawn without Chromium", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32 })
    .addShape("rightArrow", { x: 0.5, y: 2, w: 4, h: 1.5, fill: { color: "0088CC" } });

await pres.writeFile({ fileName: "hello-wasm.pdf" });
```

In a web page, import the browser-safe entry, which loads no Puppeteer, jsdom or `node:*` module,
and pass font bytes yourself:

```typescript
import pptxgen from "@pdfdeck/pptxgenjs/html";
import { createWasmRenderer } from "@pdfdeck/wasm";

const font = new Uint8Array(await (await fetch("/fonts/Carlito-Regular.ttf")).arrayBuffer());
const renderer = await createWasmRenderer({ fonts: [font] });
const pres = new pptxgen(undefined, { renderer });
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
const pdf = await pres.write({ outputType: "blob" });
```

Without a renderer, the `/html` entry still produces the HTML document (`toHtml()`) for client-side
printing, and any object implementing `PresentationRenderer` can turn that HTML into a PDF. Details,
constructor options, fonts and bundling: [docs/BACKENDS.md](./docs/BACKENDS.md).

## Fidelity

Compatible does not mean pixel-identical: PowerPoint, LibreOffice and Chromium lay out and rasterize
text differently, and output depends on the fonts installed where it renders. Parity is measured, not
assumed: CI builds the same fixture deck through PptxGenJS and through pdfdeck, converts the `.pptx`
to PDF with LibreOffice in a pinned Docker image, rasterizes both PDFs and compares them with
normalized RMSE. Every page must score at or below **0.12**; per-feature crops target **0.08**. The
WASM backend is scored against the same references and gated by a no-regression baseline per crop.

Scores on `main` (CI run [43343617209](https://github.com/tomast1337/Puppeter-PptxGenJS/actions/runs/43343617209), commit `0bd5442`, lower is better):

| Deck                            | Pages: median (max)         | Crops: median, at or below 0.08 |
| ------------------------------- | --------------------------- | ------------------------------- |
| Full fixture, Puppeteer         | 0.054 (max 0.120), 60 pages | 0.023, 237 of 247               |
| Shapes deck, Puppeteer / WASM   | 0.050 / 0.031               | 0.023 / 0.011                   |
| Text deck, Puppeteer / WASM     | 0.076 / 0.056               | 0.123 / 0.082                   |
| Emoji and CJK, Puppeteer / WASM | 0.144 / 0.107               | 0.137 / 0.120                   |

Text crops are the weakest area on both backends: in the Puppeteer renderer glyphs sit 1 to 4 px
higher than in LibreOffice ([#49](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/49)). Charts are drawn with ECharts and SVG, not Office's chart engine:
data, series and options carry over, but they look different by design. Chart slides count toward
the page limit but have no per-feature crops. [docs/DEFAULTS.md](./docs/DEFAULTS.md) lists the PptxGenJS and PowerPoint defaults
pdfdeck reproduces.

## Documentation

- [docs/USAGE.md](./docs/USAGE.md): page sizes, positioning, text, tables, slides, custom layouts, API
  reference
- [docs/QUICK_REFERENCE.md](./docs/QUICK_REFERENCE.md): one-page cheat sheet and common layouts
- [docs/BACKENDS.md](./docs/BACKENDS.md): `toHtml()`/`toPdf()`, `write()`/`stream()` output types,
  the shared browser, custom renderers, the `/html` entry, the WASM backend
- [docs/COMPONENTS.md](./docs/COMPONENTS.md): custom HTML components and the React adapter
- [docs/DEFAULTS.md](./docs/DEFAULTS.md): measured PptxGenJS and PowerPoint defaults
- [docs/IMPLEMENTATION_SUMMARY.md](./docs/IMPLEMENTATION_SUMMARY.md): implementation notes and
  project structure

Runnable examples live in [`examples/`](./examples): `bun run examples/test.ts`,
`bun run examples/comprehensive-example.ts` and `bun run examples/react-component.ts`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the build, the test and visual-parity suites and
the WASM toolchain, and [AGENTS.md](./AGENTS.md) for the engineering rules every change is reviewed
against (sources of truth, architecture, testing and PR requirements).

## License

[MIT](./LICENSE). The vendored PptxGenJS type declarations keep their own MIT license.
