# Output and backends

How a presentation becomes HTML or PDF: the output methods, the default Puppeteer backend, custom
renderers, the browser-safe `/html` entry and the opt-in WASM backend. The main class is still named
`PuppeteerGen` (the default export of `@pdfdeck/pptxgenjs`); the samples below import it under that
name.

## HTML only

`toHtml()` returns the complete, self-contained HTML document (page CSS
included, every image inlined as a data URI) and its page size. It never
launches Chromium. `toPdf()` returns the PDF bytes from the configured renderer
without touching the filesystem; `writeFile()` is `toPdf()` plus a file write.

[HTML_PROFILE.md](./HTML_PROFILE.md) specifies that document: where each model field lives in it, and
which values it loses today.

The HTML is derived from the model alone: `toHtml()` is `modelToHtml(pres.getModel(), ...)`, and
`modelToHtml` is exported for producers that build the model JSON themselves. `pres.page` is only the
input document for `tableToSlides(tableId)`: slides are not written into it, so editing it does not
change `toHtml()` or the PDF.

```typescript
import { modelToHtml } from "@pdfdeck/pptxgenjs/html";

// Optional dependencies: { components, resolveImage, createDocument }, with the /html defaults below.
const { html } = await modelToHtml(model);
```

```typescript
import PuppeteerGen from "@pdfdeck/pptxgenjs";

const pres = new PuppeteerGen();
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });

const { html, pageSize } = await pres.toHtml(); // no browser launched
const pdf = await pres.toPdf(); // Uint8Array from the Puppeteer renderer
```

## `write()` and `stream()`

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

## Puppeteer backend (default)

The Node entry of `@pdfdeck/pptxgenjs` renders through `PuppeteerPdfRenderer`
from `@pdfdeck/puppeteer`:

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

`@pdfdeck/pptxgenjs` installs `@pdfdeck/puppeteer` for its Node entry's
default renderer; install `@pdfdeck/puppeteer` directly only to use
`PuppeteerPdfRenderer` or `closeBrowser` without the compatibility layer.

## Custom renderer

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

## Browser and other runtimes (`@pdfdeck/pptxgenjs/html`)

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

## WASM backend (`@pdfdeck/wasm`, opt-in, text, shapes, images and tables)

An experimental renderer that draws `getModel()` straight to PDF in
WebAssembly (Rust, `crates/`), without HTML or Chromium. Puppeteer stays the
default; nothing loads the WASM code unless you import this entry, and the
`.wasm` binary (~2.5 MB, ~1.0 MB gzip) is only fetched by `createWasmRenderer()`.
The prebuilt binary ships in the `@pdfdeck/wasm` tarball, so installing it
needs no Rust toolchain.
It implements `ModelRenderer`, so `toPdf()`, `write()`, `stream()` and
`writeFile()` work unchanged. It also implements `PresentationRenderer`:
`renderer.render(await pres.toHtml())` parses the [HTML profile](HTML_PROFILE.md#parsing-wasm)
in WebAssembly and gives the same PDF bytes as the model path. It is strict:
HTML outside the profile throws, naming the slide, object and property, and
images must already be `data:` URIs.

**Status:** text boxes (runs, paragraphs, bullets, tab stops, insets, rotation, fit) and
every preset and custom shape (fills, transparency, multi-face shading, lines,
dashes, arrowheads, rotation, flips, text in shapes), PNG and JPEG images
(every sizing mode, rounding, transparency, rotation, flips, alpha channels;
paths and URLs are resolved to data URIs by `toPdf()` before the renderer sees
the model) and tables (merged cells, fills, per-side solid and dashed borders,
cell insets and alignment, vertical text, rows grown to fit their text;
underline styles draw as a single line). GIF, WebP and SVG images, charts and
components are not drawn yet (issue #17).

**Shadows and glow:** outer shadows of shapes, text boxes and images and the
glow of text runs are drawn as blurred rasters (a soft-masked image under the
object), calibrated against the LibreOffice rendering rather than CSS: a
shadow's Gaussian has sigma = 0.46 x blur, a glow spreads 0.45 x its size with
sigma = 0.18 x size. A shape or text box casts the silhouette of what it draws
(fill, stroke, glyphs); an image casts its box, not its PNG alpha. Inner
shadows are reported through `warnings()`.

**Hyperlinks:** linked text runs (also in table cells), shapes and images
become PDF link annotations, like the `<a>` elements Chromium turns into links.
A `url` opens through a URI action; a `slide` jumps to the top of that page.
Two differences from the Puppeteer output: a rotated or flipped object gets
its exact outline (`/QuadPoints`, with the bounding box as `/Rect` for viewers
that ignore them) where Chromium only writes the bounding box, and the
`tooltip` is the annotation's `/Contents`, which Chromium leaves out. Chromium
also normalizes the URL (`https://example.com` becomes `https://example.com/`)
and jumps to slides through named destinations. Both backends accept only
`http:`, `https:` and `mailto:` URLs: normalization rejects any other scheme
(PptxGenJS writes any string).

**Unsupported content:** by default `toPdf()` throws an error listing
everything the backend could not draw. Pass `onUnsupported: "warn"` to get the
PDF anyway; the skipped items are then in `renderer.warnings()`.

**Fonts:** WASM cannot see system fonts, so you pass font files (TTF/OTF/TTC
bytes); at least one is required. Office faces fall back to their
metric-compatible equivalents when the originals are not supplied: Calibri ->
Carlito, Cambria -> Caladea, Arial/Helvetica -> Liberation Sans, Times New
Roman -> Liberation Serif, Courier New -> Liberation Mono, then DejaVu Sans,
Liberation Sans and Noto Sans CJK JP, so Latin text tries a Latin face before
the CJK one.
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
Docker when it is missing; see [CONTRIBUTING.md](../CONTRIBUTING.md)) copies it to
`packages/wasm/src/`, and `bun run build` ships it in `packages/wasm/dist/`.
Tests that need it skip with a message when it is not built, except in CI.
