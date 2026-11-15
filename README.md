# pdfdeck

Turn existing PptxGenJS code into PDF. pdfdeck is for codebases that use
[PptxGenJS](https://gitbrent.github.io/PptxGenJS/) only to end up with a PDF: it implements the
PptxGenJS 4.0.1 API (`addSlide`, `addText`, `addImage`, `addShape`, `addTable`, `addChart`,
`writeFile`, ...) and writes the PDF directly, with no `.pptx` and no LibreOffice step. Migrating means
changing the import, not rewriting slide code, so a large codebase can move with a small diff.

Every deck goes through standard HTML and CSS, the most widely known layout system: `toHtml()`
returns it, you can read, diff or edit it, and you can write your own slide content in it
([components](./docs/COMPONENTS.md)). Two backends turn that HTML into PDF:

- **Puppeteer** (default): headless Chromium. Prints any HTML and CSS.
- **WASM** (opt-in): a Rust renderer with no browser, for servers first (Node, Bun) and also web
  pages. Draws text, shapes, images, tables and charts; components only when they are made of sized
  boxes, so far ([#69](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/69)).

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
| `@pdfdeck/model`      | The normalized presentation model and the renderer interface (`PresentationRenderer`)                         | `.` (types only)                       |
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

Moving existing PptxGenJS code over: [Migrating from PptxGenJS](#migrating-from-pptxgenjs).

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

Inside this repository the workspace already resolves `@pdfdeck/*`: after `bun install` and
`bun run build`, `bun run examples/test.ts` uses the built packages as your application would. Once the packages are published, this becomes
`npm install @pdfdeck/pptxgenjs` (plus `@pdfdeck/wasm` or `@pdfdeck/react` when you need them).

## Migrating from PptxGenJS

**Change the import.** Slide code stays as it is: the methods, options, defaults and chaining are
those of PptxGenJS 4.0.1.

```diff
-import pptxgen from "pptxgenjs";
+import pptxgen from "@pdfdeck/pptxgenjs";
```

The default export is the class `PuppeteerGen` (it keeps that name until the rename planned in
[#22](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/22)); any local name works. In a web
page, import `@pdfdeck/pptxgenjs/html` instead and pass a renderer ([below](#choosing-a-backend)).

**What you get.** The output methods keep PptxGenJS's call shapes and return a PDF where PptxGenJS
returns a `.pptx`:

- `writeFile({ fileName })` writes the file under Node, downloads it in a browser, and returns the
  name it used. A trailing `.pptx` becomes `.pdf`, so `"report.pptx"` writes `report.pdf` and the
  call needs no change; `"report.pdf"` is kept and `"report"` gives `report.pdf`. Unlike PptxGenJS,
  which falls back to `Presentation.pptx`, a file name is required: `writeFile()` without one throws
  a `TypeError`.
- `write({ outputType })` returns a `blob` by default, or `arraybuffer`, `base64`, `binarystring`,
  `nodebuffer`, `uint8array` or `STREAM` (a Node Buffer). `stream()` returns a Node Buffer.
- `compression` is accepted and ignored: it only chooses how the `.pptx` zip is packed.
- `toPdf()` (the bytes) and `toHtml()` (the HTML document the PDF is drawn from) are additions. See
  [docs/BACKENDS.md](./docs/BACKENDS.md).

**What differs.**

- **Rendering:** the PDF is drawn by Chromium or the WASM renderer, not PowerPoint, and charts by
  ECharts. Layout is close, not pixel-identical; [Fidelity](#fidelity) has the measured scores.
- **Page size:** `pres.layout = "LAYOUT_WIDE"` (or `LAYOUT_4x3`, `LAYOUT_16x10`, a
  `defineLayout()` name) works as in PptxGenJS. `pres.defineLayout({ name, width, height })` also
  applies its size at once, and the constructor takes a size, `new pptxgen(PAGE_SIZES.A4.portrait)`;
  the sizes in `PAGE_SIZES` are listed in [docs/USAGE.md](./docs/USAGE.md#page-sizes-and-layouts).
- **Theme:** `pres.theme.bodyFontFace` is the font of text, table cells and chart legends that set
  none, as in PowerPoint. Set it before adding objects; changing it afterwards throws.
- **Document properties:** `pres.title`, `author`, `subject`, `company` and `revision` become the
  PDF's Title, Author, Subject and the custom Company and Revision entries. Only what you set is
  written: PptxGenJS's defaults (`PptxGenJS Presentation`, `PptxGenJS`, revision `1`) are not, and
  an unset property reads `""`.
- **Shown nowhere, as in PowerPoint's slide show:** `addNotes()`, `addSection()` and `pres.rtlMode`
  (which orients PowerPoint's editing views) are accepted and change nothing on the page.

**What throws.** pdfdeck fails instead of writing a PDF that silently lacks something:
`addMedia()`, `defineSlideMaster()`, `slide.slideNumber`, a background picture
(`slide.background = { path }`) and `slide.hidden = true` throw `UnsupportedFeatureError` with a
suggested alternative; a chart type or option it cannot draw throws `UnsupportedChartError`. An unknown `outputType`
throws before rendering. `API_COMPATIBILITY`, exported by `@pdfdeck/pptxgenjs`, lists what pdfdeck
does with each PptxGenJS presentation and slide member; `COMPATIBILITY` does the same per option.

**Using the WASM backend.** Pass its renderer to the constructor; nothing else changes:

```typescript
import { createWasmRenderer, loadSystemFonts } from "@pdfdeck/wasm";

const pres = new pptxgen(undefined, { renderer: await createWasmRenderer({ fonts: await loadSystemFonts() }) });
```

It draws text, shapes, images, tables and charts without a browser and throws on what it cannot
draw; [Choosing a backend](#choosing-a-backend) says when to pick it.

## Choosing a backend

Puppeteer is the default and the complete backend. Use WASM when you cannot run Chromium (a web
page, a serverless function without a browser) and your slides are text, shapes, raster images and
tables.

| Family                | Puppeteer (default)                                                      | WASM (opt-in)                                                                                      |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Text and rich text    | Partial: 50 of 68 tracked options done, 9 partial                        | Drawn: runs, paragraphs, bullets, tab stops, insets, rotation, fit, hyperlinks, shadows, glow      |
| Shapes                | All 179 presets and custom geometry; 36 of 39 options done               | All presets and custom geometry, hyperlinks, outer shadows                                         |
| Images                | Partial: 28 of 29 options done                                           | PNG, JPEG, GIF and WebP (first frame), SVG (as vectors), in every sizing mode, hyperlinks, shadows |
| Tables and pagination | Partial: 44 of 47 options done, including `autoPage` and `tableToSlides` | Drawn: merges, fills, borders, rows sized to cell text; single-line underlines                     |
| Charts                | ECharts: 9 of 11 chart types, `mixed` partial, `bubble3D` unsupported    | Drawn from the chart SVG: every type Puppeteer draws, `addChartExtension()`, text as text          |
| Components            | Implemented ([HTML and React](./docs/COMPONENTS.md))                     | Nested sized `<div>` boxes (e.g. progress bars); markup that needs CSS layout throws               |
| Media, slide masters  | Throw `UnsupportedFeatureError`                                          | Same                                                                                               |

The counts come from `COMPATIBILITY`, `CHART_TYPE_COMPATIBILITY` and
`SHAPE_GEOMETRY_COMPATIBILITY`, exported by `@pdfdeck/pptxgenjs` (source:
[`compatibility.ts`](./packages/pptxgenjs/src/compatibility.ts)), which track every option as
unsupported, partial, implemented or visually verified. WASM support for components that need CSS
layout is tracked in
[#17](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/17) and
[#69](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/69) (phase 8).

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

## Rendering your own HTML

`toHtml()` is the exact document both backends draw ([docs/HTML_PROFILE.md](./docs/HTML_PROFILE.md)),
so you can store it, edit it or write one by hand, and render it later. `pptxHtmlDocument(html)` checks
the document, fills the values PptxGenJS would default (text insets, line box, font, colors) and reads
its page size. `htmlDocument(html)` from `@pdfdeck/model` does the same without filling anything, for a
document that already states every value. Either result goes to either renderer. Puppeteer also prints
any other HTML through `render({ html, pageSize })`. WASM reads only the profile and names the slide, the
object and the property it rejects.

```typescript
import { pptxHtmlDocument, PuppeteerPdfRenderer } from "@pdfdeck/pptxgenjs";

const edited = (await pres.toHtml()).html.replace(">Draft</span>", ">Final</span>");
const pdf = await new PuppeteerPdfRenderer().render(pptxHtmlDocument(edited)); // or a WasmRenderer
```

Details and a hand-written example: [docs/BACKENDS.md](./docs/BACKENDS.md#rendering-stored-edited-or-hand-written-html)
and `examples/html-input.ts`.

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
- [docs/HTML_PROFILE.md](./docs/HTML_PROFILE.md): the HTML that `toHtml()` emits, field by field from the
  model, with the values it loses today
- [docs/COMPONENTS.md](./docs/COMPONENTS.md): custom HTML components and the React adapter
- [docs/DEFAULTS.md](./docs/DEFAULTS.md): measured PptxGenJS and PowerPoint defaults
- [docs/IMPLEMENTATION_SUMMARY.md](./docs/IMPLEMENTATION_SUMMARY.md): implementation notes and
  project structure

Runnable examples live in [`examples/`](./examples), a private workspace package that imports
`@pdfdeck/*` by name and runs against the built packages (`bun run build` first): `bun run examples/test.ts`,
`bun run examples/comprehensive-example.ts`, `bun run examples/react-component.ts` and
`bun run examples/html-input.ts`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the build, the test and visual-parity suites and
the WASM toolchain, and [AGENTS.md](./AGENTS.md) for the engineering rules every change is reviewed
against (sources of truth, architecture, testing and PR requirements).

## License

[MIT](./LICENSE). The vendored PptxGenJS type declarations keep their own MIT license.
