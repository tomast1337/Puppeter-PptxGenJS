# PuppeteerGen — PptxGenJS-compatible PDF generation

PuppeteerGen generates HTML and PDF documents through Puppeteer while exposing
an API compatible with PptxGenJS.

## Motivation

PuppeteerGen is intended for systems that already generate presentations with
PptxGenJS but need to migrate their output to HTML and PDF. Existing layout
code can keep familiar methods such as `addText`, `addImage`, `addShape`,
`addTable`, and `addChart` instead of being rewritten around a new document API.

Compatibility does not mean pixel identity. PowerPoint, LibreOffice, and
Chromium use different layout and rendering pipelines. Font availability,
font metrics, and anti-aliasing can therefore produce small visual differences.
Charts use ECharts and custom SVG rendering rather than the Microsoft Office
chart renderer, so their data and functionality are preserved while their
appearance can differ more noticeably.

## Features

- **PptxGenJS-compatible API** - Reuse existing presentation-generation code for HTML and PDF output
- **Multiple page sizes** - 16:9, 4:3, 16:10, Letter, A4, A3, Legal, Tabloid
- **Landscape and Portrait** - All page sizes available in both orientations
- **Inch-based positioning** - Precise element placement using inches
- **Rich text formatting** - Bold, italic, underline, colors, fonts, alignment
- **Tables** - Full table support with cell styling
- **Multiple slides** - Create multi-page PDFs
- **Custom layouts** - Define your own page dimensions
- **Print-optimized CSS** - Automatic CSS generation for consistent PDF output

## Packages

The project is moving to the `@pdfdeck` scope (issue #22). The repository is a
Bun workspace with one package per directory under `packages/`:

| Package               | Contents                                                                                                                          | Depends on                                               | Entries                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| `@pdfdeck/model`      | Normalized presentation model types and renderer interfaces (`PresentationRenderer`, `ModelRenderer`, `HtmlPresentationDocument`) | nothing                                                  | `.` (types only)                       |
| `@pdfdeck/pptxgenjs`  | The PptxGenJS-compatible API (`PuppeteerGen`), defaults, normalization, DOM renderers, vendored pptxgenjs 4.0.1 types             | `@pdfdeck/model`; `@pdfdeck/puppeteer` (Node entry only) | `.` (Node), `./html` (browser-safe)    |
| `@pdfdeck/puppeteer`  | `PuppeteerPdfRenderer` and the shared Chromium (`closeBrowser`)                                                                   | `@pdfdeck/model`, `puppeteer`                            | `.` (Node)                             |
| `@pdfdeck/wasm`       | Opt-in WebAssembly text renderer                                                                                                  | `@pdfdeck/model`                                         | `.` (browser, Node and Bun conditions) |
| `@pdfdeck/react`      | `registerReactComponent`                                                                                                          | `@pdfdeck/pptxgenjs`; `react` and `react-dom` as peers   | `.`                                    |
| `puppeteer-pptxgenjs` | Deprecation shim: re-exports `@pdfdeck/pptxgenjs` and the `/html`, `/react` and `/wasm` subpaths                                  | the packages above                                       | `.`, `./html`, `./react`, `./wasm`     |

The `@pdfdeck/*` packages are **not published yet**. Until they are, install
`puppeteer-pptxgenjs` (0.1.x is the single-package release). Once they are,
`puppeteer-pptxgenjs` becomes a thin shim over them and will be deprecated;
the old import paths keep working.

## Installation

```bash
npm install @pdfdeck/pptxgenjs          # drop-in PptxGenJS API; Puppeteer PDF output by default
npm install @pdfdeck/wasm               # optional: WASM text renderer
npm install @pdfdeck/react react react-dom   # optional: React components
```

`@pdfdeck/pptxgenjs` installs `@pdfdeck/puppeteer` for its Node entry's
default renderer; install `@pdfdeck/puppeteer` directly only to use
`PuppeteerPdfRenderer` or `closeBrowser` without the compatibility layer.

The published packages support Node.js 22 and newer. Bun remains supported as
both a runtime and the development toolchain used by this repository.

Build every package's entrypoints and TypeScript declarations:

```bash
bun run build
```

The build writes each package's bundled ESM entrypoints, source maps, and
declaration files to `packages/<name>/dist/`. Runtime dependencies, including
the other `@pdfdeck` packages, remain external so Puppeteer can locate its
installed browser correctly. The pinned PptxGenJS package is used only while
developing to audit its API types; the build vendors its declaration file and
license into `@pdfdeck/pptxgenjs`, so consumers neither install nor execute
PptxGenJS. Package tarballs run this build automatically.

Verify the packed packages, and the `puppeteer-pptxgenjs` shim, in clean
temporary consumer projects with:

```bash
bun run test:package
```

## Quick Start

```typescript
import PuppeteerGen, { PAGE_SIZES } from "@pdfdeck/pptxgenjs";

// Create a presentation with 16:9 layout
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Add a slide
const slide = pres.addSlide();

// Add text with positioning and styling
slide.addText("Hello World!", {
    x: 1, // 1 inch from left
    y: 1, // 1 inch from top
    fontSize: 32,
    bold: true,
    color: "#0066CC",
});

// Generate PDF
await pres.writeFile({ fileName: "presentation.pdf" });
```

## Available Page Sizes

### Presentation Formats

- `PAGE_SIZES.SCREEN_16X9` - 16:9 widescreen (10" × 5.625")
- `PAGE_SIZES.SCREEN_4X3` - 4:3 standard (10" × 7.5")
- `PAGE_SIZES.SCREEN_16X10` - 16:10 widescreen (10" × 6.25")

### Document Formats

- `PAGE_SIZES.LETTER` - US Letter (8.5" × 11")
- `PAGE_SIZES.LEGAL` - US Legal (8.5" × 14")
- `PAGE_SIZES.A4` - ISO A4 (8.27" × 11.69")
- `PAGE_SIZES.A3` - ISO A3 (11.69" × 16.54")
- `PAGE_SIZES.TABLOID` - Tabloid (11" × 17")

All sizes available in both `.landscape` and `.portrait` orientations.

## Usage Examples

### Different Page Sizes

```typescript
// 16:9 Presentation
const pres1 = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// A4 Document
const pres2 = new PuppeteerGen(PAGE_SIZES.A4.portrait);

// Letter Document
const pres3 = new PuppeteerGen(PAGE_SIZES.LETTER.landscape);
```

### Text Styling

```typescript
const slide = pres.addSlide();

slide.addText("Styled Text", {
    x: 1,
    y: 1,
    w: 6,
    h: 1,
    fontSize: 28,
    bold: true,
    italic: true,
    underline: true,
    color: "#FF0000",
    fill: { color: "#FFFF00" },
    align: "center",
});
```

### Tables

```typescript
slide.addTable(
    [
        [
            { text: "Header 1", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" } },
            { text: "Header 2", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" } },
        ],
        [{ text: "Row 1 Col 1" }, { text: "Row 1 Col 2", options: { align: "right", color: "#00AA00" } }],
    ],
    {
        x: 1,
        y: 2,
        w: 8,
        h: 2,
    },
);
```

### Multiple Slides

```typescript
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Title slide
const slide1 = pres.addSlide();
slide1.addText("My Presentation", { x: 1, y: 2, fontSize: 48, bold: true });

// Content slide
const slide2 = pres.addSlide();
slide2.addText("Content", { x: 1, y: 0.5, fontSize: 36 });

await pres.writeFile({ fileName: "multi-slide.pdf" });
```

### HTML only

`toHtml()` returns the complete, self-contained HTML document (page CSS
included, every image inlined as a data URI) and its page size. It never
launches Chromium. `toPdf()` returns the PDF bytes from the configured renderer
without touching the filesystem; `writeFile()` is `toPdf()` plus a file write.

```typescript
import PuppeteerGen from "@pdfdeck/pptxgenjs";

const pres = new PuppeteerGen();
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });

const { html, pageSize } = await pres.toHtml(); // no browser launched
const pdf = await pres.toPdf(); // Uint8Array from the Puppeteer renderer
```

### `write()` and `stream()`

Both follow PptxGenJS 4.0.1 semantics, but return PDF bytes instead of a PPTX
zip. `write()` accepts `{ outputType }` or, as PptxGenJS does at runtime, a bare
outputType string.

| Call                                                                                   | Result                             |
| -------------------------------------------------------------------------------------- | ---------------------------------- |
| `write()` / `write({})`                                                                | `Blob` (`application/pdf`)         |
| `write({ outputType: "blob" })`                                                        | `Blob` (`application/pdf`)         |
| `write({ outputType: "uint8array" })`                                                  | `Uint8Array`                       |
| `write({ outputType: "arraybuffer" })`                                                 | `ArrayBuffer`                      |
| `write({ outputType: "base64" })`                                                      | base64 `string`                    |
| `write({ outputType: "binarystring" })`                                                | latin1 `string`, one char per byte |
| `write({ outputType: "nodebuffer" })` / `write({ outputType: "STREAM" })` / `stream()` | Node `Buffer`                      |

`compression` is accepted and ignored: in PptxGenJS it only selects zip
DEFLATE vs STORE. Unknown output types throw before rendering. `nodebuffer`
and `STREAM` throw in runtimes without a global `Buffer` (for example a browser
using `/html`); use another output type there.

### Custom renderer

Any object implementing `PresentationRenderer` can turn the HTML into a PDF
(Playwright, a remote rendering service, ...). The Node entry exports the
default `PuppeteerPdfRenderer` adapter.

```typescript
import PuppeteerGen, { PAGE_SIZES, type HtmlPresentationDocument, type PresentationRenderer } from "@pdfdeck/pptxgenjs";

const remoteRenderer: PresentationRenderer = {
    async render({ html, pageSize }: HtmlPresentationDocument): Promise<Uint8Array> {
        const response = await fetch("https://renderer.example.com/pdf", {
            method: "POST",
            body: JSON.stringify({ html, width: `${pageSize.width}in`, height: `${pageSize.height}in` }),
        });
        return new Uint8Array(await response.arrayBuffer());
    },
};

const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape, { renderer: remoteRenderer });
```

The default renderer lives in `@pdfdeck/puppeteer` and works on any
`HtmlPresentationDocument`, for example one produced by the `/html` entry:

```typescript
import { closeBrowser, PuppeteerPdfRenderer } from "@pdfdeck/puppeteer";

const pdf = await new PuppeteerPdfRenderer().render(await pres.toHtml());
await closeBrowser();
```

### Browser and other runtimes (`@pdfdeck/pptxgenjs/html`)

The `/html` entry exposes the same API without loading Puppeteer, jsdom, or any
`node:*` module. It uses `document.implementation.createHTMLDocument()` from
the global DOM, resolves data URIs and http(s) images with `fetch`, and has no
default PDF renderer. `tests/htmlBrowser.test.ts` runs the browser bundle of
this entry in headless Chromium on every CI run (text, shapes, images, tables,
charts, components, `toHtml()`, and `toPdf()` with an injected renderer).

```typescript
import PuppeteerGen from "@pdfdeck/pptxgenjs/html";

const pres = new PuppeteerGen();
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });
const { html } = await pres.toHtml();

// Print client-side, or pass { renderer } to the constructor and call toPdf().
const frame = document.body.appendChild(document.createElement("iframe"));
frame.srcdoc = html;
frame.onload = () => frame.contentWindow?.print();
```

Constructor options (both entries): `new PuppeteerGen(pageSize?, options?)`

| Option                                               | Node entry default                                         | `/html` default                         |
| ---------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `renderer?: PresentationRenderer \| ModelRenderer`   | `PuppeteerPdfRenderer`                                     | none: `toPdf()` throws                  |
| `resolveImage?: (source: string) => Promise<string>` | data URIs, http(s), file paths relative to `process.cwd()` | data URIs and http(s); file paths throw |
| `createDocument?: () => Document`                    | jsdom                                                      | global `document`; throws without a DOM |

In `/html`, `writeFile()` throws because it needs a filesystem; use `toPdf()`.
Without a global DOM (for example a worker or a server runtime without
jsdom), pass `createDocument`.

### WASM backend (`@pdfdeck/wasm`, opt-in, text and shapes)

An experimental renderer that draws `getModel()` straight to PDF in
WebAssembly (Rust, `crates/`), without HTML or Chromium. Puppeteer stays the
default; nothing loads the WASM code unless you import this entry, and the
`.wasm` binary (~2.3 MB, ~935 KB gzip) is only fetched by `createWasmRenderer()`.
The prebuilt binary ships in the `@pdfdeck/wasm` tarball, so installing it
needs no Rust toolchain.
It implements `ModelRenderer`, so `toPdf()`, `write()`, `stream()` and
`writeFile()` work unchanged.

**Status:** text boxes (runs, paragraphs, bullets, insets, rotation, fit) and
every preset and custom shape (fills, transparency, multi-face shading, lines,
dashes, arrowheads, rotation, flips, text in shapes). Images, tables, charts,
components, shadows, tab stops and hyperlink annotations are not drawn yet
(issue #17).

**Unsupported content:** by default `toPdf()` throws an error listing
everything the backend could not draw. Pass `onUnsupported: "warn"` to get the
PDF anyway; the skipped items are then in `renderer.warnings()`.

**Fonts:** WASM cannot see system fonts, so you pass font files (TTF/OTF/TTC
bytes); at least one is required. Office faces fall back to their
metric-compatible equivalents when the originals are not supplied: Calibri ->
Carlito, Cambria -> Caladea, Arial/Helvetica -> Liberation Sans, Times New
Roman -> Liberation Serif, Courier New -> Liberation Mono, then DejaVu Sans.
Under Node/Bun, `loadSystemFonts()` reads those faces (and the Office
originals, Noto Color Emoji and Noto Sans CJK when installed) from the system
font directories; pass `{ dirs, match }` to choose others. Emoji and CJK fonts
are ~50 MB together, so in a browser supply your own (ideally subsetted) fonts.

```typescript
// Node / Bun
import PuppeteerGen from "@pdfdeck/pptxgenjs";
import { createWasmRenderer, loadSystemFonts } from "@pdfdeck/wasm";

const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
const pres = new PuppeteerGen(undefined, { renderer });
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
await pres.writeFile({ fileName: "hello.pdf" });
```

```typescript
// Browser
import PuppeteerGen from "@pdfdeck/pptxgenjs/html";
import { createWasmRenderer } from "@pdfdeck/wasm";

const font = new Uint8Array(await (await fetch("/fonts/Carlito-Regular.ttf")).arrayBuffer());
// `wasm` defaults to pdf_wasm_bg.wasm next to the module; pass a URL or bytes if your bundler moves it.
const renderer = await createWasmRenderer({ fonts: [font], onUnsupported: "warn" });
const pres = new PuppeteerGen(undefined, { renderer });
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });
const pdf = await pres.write({ outputType: "blob" });
```

The `browser` export condition resolves to a build without `node:*` modules;
`node`/`bun` resolve to one that reads the `.wasm` from disk. To build the
binary from this repository, `bun run build:wasm` (pinned Rust toolchain, or
Docker when it is missing; see CONTRIBUTING.md) copies it to
`packages/wasm/src/`, and `bun run build` ships it in `packages/wasm/dist/`.
Tests that need it skip with a message when it is not built, except in CI.

## Running Examples

Run the basic example:

```bash
bun run examples/test.ts
```

Run comprehensive examples:

```bash
bun run examples/comprehensive-example.ts
```

This generates multiple example PDFs demonstrating:

- Different page sizes and orientations
- Positioning with inches
- Text styling (bold, italic, colors, alignment)
- Tables with styled cells
- Multi-slide presentations
- Custom layouts

## Testing

Run the type checker and fast unit/DOM rendering tests:

```bash
bun run typecheck
bun test
```

Run the visual parity test against a real PptxGenJS rendering:

```bash
bun run test:visual
```

The visual test creates the same presentation through both APIs, converts the
PptxGenJS `.pptx` to PDF with LibreOffice, rasterizes both PDFs with Poppler,
and uses ImageMagick's normalized RMSE metric. The default maximum difference
is `0.12`; override it with `VISUAL_DIFF_THRESHOLD=0.10` as fidelity improves.
LibreOffice, `pdftoppm`, and ImageMagick must be available on `PATH`.

LibreOffice's reference output depends on installed fonts, so scores vary
between machines. CI runs the test in a pinned image (`tests/visual/Dockerfile`:
fixed Ubuntu digest, apt snapshot, fonts and Bun). Run the same environment
locally with Docker; artifacts are written to `.visual-parity/`:

```bash
bun run test:visual:docker
```

CI doesn't rebuild the image on every run. It pulls
`ghcr.io/tomast1337/puppeteer-gen-visual:<hash>`, where the tag hashes the
Dockerfile, `package.json` and `bun.lock`, and only builds and publishes a new
image when one of those changes. To test against a prebuilt image locally, set
`VISUAL_IMAGE=<image>`.

## Documentation

For detailed documentation, see [USAGE.md](./docs/USAGE.md) which covers:

- Complete API reference
- Positioning and sizing guide
- Text styling options
- Table formatting
- Custom layouts
- CSS and print layout details
- Best practices and troubleshooting

See [DEFAULTS.md](./docs/DEFAULTS.md) for the measured PptxGenJS/PowerPoint defaults
that PuppeteerGen reproduces and the current compatibility status.

## Project Structure

```
├── packages/
│   ├── model/src/         # @pdfdeck/model: normalized model types and renderer interfaces
│   ├── pptxgenjs/src/     # @pdfdeck/pptxgenjs
│   │   ├── PuppeteerGen.ts    # Runtime-neutral core (no Puppeteer, jsdom or node:*)
│   │   ├── node.ts            # Node defaults: jsdom, file images, Puppeteer, writeFile
│   │   ├── output.ts          # write()/stream() outputType conversion of PDF bytes
│   │   ├── pageLayouts.ts     # Page size definitions
│   │   ├── units.ts           # Inch, point and percentage to pixel conversion
│   │   ├── color.ts           # PptxGenJS color to CSS color
│   │   ├── alignment.ts       # PptxGenJS alignment to CSS
│   │   ├── pageCss.ts         # Page and slide CSS
│   │   ├── pptx.ts            # Type definitions
│   │   ├── html.ts            # Browser-safe entry (@pdfdeck/pptxgenjs/html)
│   │   └── index.ts           # Node entry (@pdfdeck/pptxgenjs)
│   ├── puppeteer/src/     # @pdfdeck/puppeteer: PuppeteerPdfRenderer and the shared browser
│   ├── wasm/src/          # @pdfdeck/wasm: WASM backend loaders + wasm-bindgen glue
│   ├── react/src/         # @pdfdeck/react: React component adapter
│   └── puppeteer-pptxgenjs/src/  # Deprecation shim re-exporting the packages above
├── crates/                # Rust workspace: pdf-core (model -> PDF) and pdf-wasm (wasm-bindgen)
├── examples/
│   ├── test.ts                   # Basic example
│   └── comprehensive-example.ts  # Feature demonstrations
├── tests/                       # Unit, DOM, and visual parity tests
├── docs/                  # Usage guide, quick reference, defaults, implementation notes
└── README.md              # This file
```

## Implementation Details

### Positioning System

All positioning uses **inches** as the unit (consistent with PptxGenJS):

- `x`, `y`: Position from top-left corner
- `w`, `h`: Width and height
- Converted to pixels at 96 DPI for HTML/CSS

### CSS Generation

The library automatically generates CSS that:

- Sets page dimensions using `@page` rule
- Creates slide containers with exact dimensions
- Positions elements absolutely
- Handles page breaks between slides
- Optimizes for print/PDF output

### PDF Generation

1. Builds HTML document with styled elements
2. Injects CSS for layout and styling
3. Reuses a shared `chrome-headless-shell` browser (launched on demand)
4. Renders HTML to PDF with correct page size
5. Outputs PDF file

Concurrent and back-to-back `writeFile()` calls share one browser, which
skips Chromium startup. The browser closes after 1 second idle, so scripts
exit on their own. Call `closeBrowser()` to shut it down immediately:

```typescript
import { closeBrowser } from "@pdfdeck/pptxgenjs";

await closeBrowser();
```

## Compatibility

- Targets the PptxGenJS 4.0.1 API and observed runtime behavior
- Works with Node.js 22+ and Bun
- The Node entry uses Puppeteer for PDF generation and jsdom for the HTML
  document; the `/html` entry uses neither
- Tracks implemented, partial, unsupported, and visually verified behavior in
  the compatibility manifest

## Limitations

- Output is designed to be visually close to PptxGenJS and PowerPoint, not
  pixel-identical. Browser anti-aliasing and font metrics can cause small
  differences.
- Charts use ECharts and custom SVG rendering, so they do not reproduce the
  exact appearance of Microsoft Office charts.
- Matching fonts must be installed in the rendering environment for consistent
  text layout.
- Some PptxGenJS options remain partial or explicitly unsupported. Media,
  notes, and slide masters are not currently implemented.

## Custom HTML components

Register versioned application components on each presentation, then place them
with the same inch-based coordinates used by the standard drawing methods:

```typescript
import { z } from "zod";

const metricSchema = z.object({ label: z.string().default("Revenue"), value: z.number() });
const pres = new PuppeteerGen();
pres.registerComponent("acme/metric", 1, {
    schema: metricSchema,
    render(props, { document, width, height }) {
        const card = document.createElement("div");
        card.style.cssText = "height:100%;padding:12px;box-sizing:border-box;background:#eef2ff";
        // textContent safely represents data as text. Context dimensions are pixels.
        card.textContent = `${props.label}: ${props.value}`;
        return card;
    },
});
pres.addSlide().addComponent({ type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } }, { x: 1, y: 1, w: 3, h: 1, objectName: "revenue-card" });
await pres.writeFile({ fileName: "metrics.pdf" });
```

`addComponent` is a PuppeteerGen extension. It returns the slide for chaining.
`x`, `y`, `w`, and `h` are required finite numbers in inches; dimensions must be
positive. Components follow insertion order and clip content to their box.
`objectName` is optional. Other drawing options (rotation, percentage geometry,
fill, etc.) are currently unsupported: style the inner HTML in the renderer.
Component default overflow is tracked in `packages/pptxgenjs/src/defaults.ts`.

A component's type and positive integer version select an exact registration.
Different versions can coexist; duplicate registration and unknown versions
throw. Registries belong to a presentation and are also shared with its existing
and automatically created slides. Register definitions before calling
`addComponent` or replaying a recording. Components render synchronously when
added; registration changes do not retroactively redraw existing elements.

Props must be a plain JSON object (no functions, undefined, dates, cycles or DOM
nodes). They are copied before validation/rendering. The optional validator throws
on invalid application data. The renderer returns an HTML string or an HTMLElement
created with the supplied document; elements are cloned, so event listeners and
other runtime state are not part of the output. React/Vue hydration and async
renderers are not supported. Fetch data before generation.

HTML renderers are trusted application code, not a sandbox. Prefer DOM creation
and `textContent` for user data; sanitize any untrusted HTML before returning it.
Use inline styles or explicitly scoped CSS: components share the slide document,
so global selectors can affect other elements. `<img src>` paths and URLs enter
the normal image-resolution pipeline before PDF generation. Use embedded images
for portability. `srcset` is rejected; CSS background URLs, external stylesheets,
SVG external references and web fonts are not bundled by this API and should be
embedded or supplied by the application.

The `pptx-serializer` workspace package in `icap-dev-tools` records the same
`addComponent(input, options)` contract. Its document contains only type,
version, props and geometry—not renderer functions. Register definitions inside
the replay factory. Unknown types remain editable in saved data but fail clearly
when rendered without a matching registration. For changed props schemas, add a
new version and migrate documents explicitly. Standard PptxGenJS has no
`addComponent` method; replaying a component document into it requires an adapter.

## React components (optional)

Install matching React 19 packages in the consuming application:

```sh
npm install @pdfdeck/react react@19 react-dom@19
# TypeScript applications also need their React types:
npm install --save-dev @types/react@19 @types/react-dom@19
```

The adapter is a separate package, `@pdfdeck/react`. Importing
`@pdfdeck/pptxgenjs` alone does not load or require React.

```tsx
import PuppeteerGen from "@pdfdeck/pptxgenjs";
import { registerReactComponent } from "@pdfdeck/react";

import { z } from "zod";

const metricSchema = z.object({ label: z.string().default("Revenue"), value: z.number() });
type MetricProps = z.output<typeof metricSchema>;

function MetricCard({ label, value }: MetricProps) {
    return (
        <div style={{ height: "100%", background: "#eef2ff", padding: 16, boxSizing: "border-box" }}>
            <strong>{label}</strong>
            <div>{value}</div>
        </div>
    );
}

const presentation = new PuppeteerGen();
registerReactComponent(presentation, "acme/metric", 1, MetricCard, {
    schema: metricSchema,
});
presentation.addSlide().addComponent({ type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } }, { x: 1, y: 1, w: 3, h: 1 });
await presentation.writeFile({ fileName: "react-metrics.pdf" });
```

`registerReactComponent` returns the presentation and uses the existing versioned
component registry. Prefer `schema` with a shared Zod definition: its output type
must match the React props, and its defaults/refinements run before rendering.
The legacy `parseProps` callback remains supported; provide either `schema` or
`parseProps`. Without either, props are passed through without schema validation.

HTML `registerComponent` also accepts `schema`, inferring `render` and `validate`
props from its output. A legacy `validate` callback can add checks after parsing.
Input and parsed props must remain plain JSON objects. Schemas are synchronous;
async refinements/transforms are unsupported. Saved props are schema inputs and
are never overwritten with parsed outputs, so transforms run once per render.
Keep the same versioned schema in a shared package used by the editor, HTML and
React code; schemas and component functions never enter the serialized document.

The adapter renders function or class components with React's synchronous
`renderToStaticMarkup`. It automatically gives each render a distinct `useId`
prefix within the presentation. React components can be composed normally; wrap
them in another component to supply providers or application themes. Use inline
styles or supply the corresponding scoped CSS; importing a CSS module does not
bundle its stylesheet into the PDF.

Output is static HTML: event handlers, client effects, hydration and browser-only
APIs are not available. Load data before rendering. Suspense emits its fallback
rather than waiting for asynchronous content, so async components that need to
resolve before export are not supported by this adapter. React elements, callbacks
and component functions are not serializable props; keep those in registered code.

The serializer's `addComponent` data is unchanged. Register the React adapter in
the replay factory, then replay the document normally. The same React component
can later be mounted interactively by an editor, with the editor updating the
saved props; this adapter only handles static export.

Run the repository example with `bun run examples/react-component.ts`.
