# Output and backends

How a presentation becomes HTML or PDF: the output methods, the default Puppeteer backend, custom
renderers, the browser-safe `/html` entry and the opt-in WASM and PDFKit backends. The main class is still named
`PuppeteerGen` (the default export of `@pdflapas/pptxgenjs`); the samples below import it under that
name.

## HTML only

`toHtml()` returns the complete, self-contained HTML document (page CSS
included, every image inlined as a data URI) and its page size. It never
launches Chromium. `toPdf()` returns the PDF bytes from the configured renderer
without touching the filesystem; `writeFile()` is `toPdf()` plus a file write.

[HTML_PROFILE.md](./HTML_PROFILE.md) specifies that document: where each model field lives in it, and
which values it loses today.

The HTML is derived from the model alone: `toHtml()` is `modelToHtml(pres.getModel(), ...)`, and
`modelToHtml` is exported for producers that build the model JSON themselves. That JSON is untrusted
input, so `modelToHtml` first checks it with `parseModel`, which accepts plain JSON and throws an
`InvalidModelError` naming each wrong value's path (`model.slides[0].background: is not a CssColor ...`).
Colors must be in the forms `colorToCSS` writes, page sizes finite and positive, links http(s), mailto or
`#slide-<n>`, data images `data:image/...;base64,` URIs, and objects carry no unknown keys. `toHtml()` skips
the check: its model comes from the normalizer.

```typescript
import { modelToHtml, parseModel } from "@pdflapas/pptxgenjs/html";

// Optional dependencies: { components, resolveImage, createDocument }, with the /html defaults below.
const { html } = await modelToHtml(JSON.parse(stored));
// Or check without rendering: the typed model, or InvalidModelError.
const model = parseModel(JSON.parse(stored));
```

```typescript
import PuppeteerGen from "@pdflapas/pptxgenjs";

const pres = new PuppeteerGen();
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });

const { html, pageSize } = await pres.toHtml(); // no browser launched
const pdf = await pres.toPdf(); // Uint8Array from the Puppeteer renderer
```

## Rendering stored, edited or hand-written HTML

Every renderer reads only `{ html, pageSize }`, so HTML that did not come from `toHtml()` in this process
renders too: a stored document, an edited one, or one written by hand.

| Input                                                                           | Puppeteer | WASM                                   |
| ------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| `toHtml()` output, stored or edited, through `pptxHtmlDocument()`               | Yes       | Yes                                    |
| Hand-written [profile v1 or v2](./HTML_PROFILE.md) through `pptxHtmlDocument()` | Yes       | Yes                                    |
| Any other HTML, through `render({ html, pageSize })`                            | Yes       | No: an error names the first violation |

`pptxHtmlDocument(html)` (from `@pdflapas/pptxgenjs` or the browser-safe `/html` entry) checks that `html`
is a profile document (`<meta name="pdflapas-profile" content="2">`, or version 1's `<meta name="pdfdeck-profile" content="1">`) and fills the values PptxGenJS
defaults (insets, line box, font, colors, the stylesheet; the list is in
[HTML_PROFILE.md](./HTML_PROFILE.md#completion)). It also reads the page size from the document. A
`toHtml()` result passes through byte for byte. `completeProfileHtml(html)` is the same completion step,
returning only the string. `htmlDocument(html)` from `@pdflapas/model` is the step after it, with no
PptxGenJS rules: it checks the version and reads the page size from the `@page` rule, and throws when
the document has none instead of filling it.

```typescript
import { pptxHtmlDocument, PuppeteerPdfRenderer, printHtml } from "@pdflapas/pptxgenjs";
import { createWasmRenderer, loadSystemFonts } from "@pdflapas/wasm";

const document = pptxHtmlDocument(storedHtml.replace(">Draft</span>", ">Final</span>"));
const viaChromium = await new PuppeteerPdfRenderer().render(document);
const viaWasm = await (await createWasmRenderer({ fonts: await loadSystemFonts() })).render(document);

// Puppeteer prints any HTML: the escape hatch for fully custom HTML and CSS.
const custom = await new PuppeteerPdfRenderer().render({ html: myHtml, pageSize: { width: 10, height: 5.625, name: "Custom" } });

// The document as Puppeteer prints it, print workarounds written in, to open in a browser (Chromium only, not for WASM).
const printed = printHtml(document.html);
```

WASM errors name the place, as in `invalid PdfLapas HTML: slide 1: object 'Title': paragraph 1: run 1: CSS
property 'font-variant' on <span> is not in profile v2`. `examples/html-input.ts` renders an edited and
a hand-written document on both backends.

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

The Node entry of `@pdflapas/pptxgenjs` renders through `PuppeteerPdfRenderer`
from `@pdflapas/puppeteer`:

1. Builds HTML document with styled elements
2. Injects CSS for layout and styling
3. Reuses a shared `chrome-headless-shell` browser (launched on demand)
4. Renders HTML to PDF with correct page size
5. Outputs PDF file

**Deterministic bytes.** Both PDF backends are byte-deterministic: the same HTML and options give the same PDF
bytes, given the same fonts and, for this backend, the same Chromium version. Chromium dates its own Info
dictionary with the time of the run; the Info update PdfLapas appends replaces it, blanks the old one in place
and writes a trailer `/ID` computed from the file's content (ISO 32000-1, 14.4), so no run-specific byte remains.

Concurrent and back-to-back `writeFile()` calls share one browser, which
skips Chromium startup. The browser closes after 1 second idle, so scripts
exit on their own. Call `closeBrowser()` to shut it down immediately:

```typescript
import { closeBrowser } from "@pdflapas/pptxgenjs";

await closeBrowser();
```

Each document prints in its own browser context (no cache, cookies or storage
shared with another render) on a page that has JavaScript turned off and no
network: every request other than a `data:` URI is aborted. Images are inlined
before the page loads, so the HTML needs nothing else. A URL left in the HTML
(a CSS `url()`, an `<iframe>`, a `<link>`, an `<img>` that a component wrote
after image resolution) is therefore never fetched from the server; an `<img>`
that names one fails with "Image failed to decode".

Chromium launches with Puppeteer's `{ headless: "shell", args: ["--no-sandbox", "--disable-setuid-sandbox"] }`:
its sandbox refuses to start as root, the usual user in a container. Without
the sandbox, a bug in Chromium's renderer that the printed HTML triggers runs
with the server process's rights. When the decks hold content from untrusted
users, run Chromium sandboxed: run the service as a non-root user (in Docker,
add a `USER` and keep the default seccomp profile, or use Puppeteer's
[sandbox guide](https://pptr.dev/troubleshooting#setting-up-chrome-linux-sandbox)),
pass `launchOptions: { args: [] }` as below, and keep Puppeteer up to date for
Chromium's security fixes. Pass your own
[Puppeteer launch options](https://pptr.dev/api/puppeteer.launchoptions)
(`executablePath`, `args`, `headless`, `timeout`, `protocolTimeout`,
`userDataDir`, `env`; the `PuppeteerLaunchOptions` type) to the renderer; they
are merged over the defaults, so `args` replaces the default args. Renderers
with the same options share one browser:

```typescript
import PuppeteerGen, { PuppeteerPdfRenderer } from "@pdflapas/pptxgenjs";

// Keep Chromium's sandbox (needs a non-root user or a configured sandbox).
const renderer = new PuppeteerPdfRenderer({ launchOptions: { args: [] } });
const pres = new PuppeteerGen(undefined, { renderer });
```

### Missing fonts (`onMissingFont`)

A `fontFace` the renderer has no font for is drawn in a fallback face, whose
widths differ, so lines wrap differently from PowerPoint. Both renderers check
every text run's face (text boxes, shapes, table cells) and apply
`onMissingFont`:

| Value              | Effect                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `"warn"` (default) | `console.warn` lists each face, the face drawn instead and the objects  |
| `"throw"`          | `toPdf()` rejects with `MissingFontError`; its `missing` holds the list |
| `"ignore"`         | renders without reporting                                               |
| a function         | called with the list (`MissingFont[]`: `face`, `objects`, `usedFace`)   |

Objects are named `slide <n> '<object name>'` (`#<index>` when unnamed). A
metric-compatible substitute counts as the face: Arial and Helvetica drawn in
Liberation Sans, Times New Roman in Liberation Serif, Courier New in Liberation
Mono, any Calibri face (the default text font and the theme's Calibri Light) in
Carlito, Cambria in Caladea. Segoe UI drawn in Liberation Sans is reported: its
widths differ. Chart text is not checked.

```typescript
import PuppeteerGen, { MissingFontError, PuppeteerPdfRenderer } from "@pdflapas/pptxgenjs";

const pres = new PuppeteerGen(undefined, { renderer: new PuppeteerPdfRenderer({ onMissingFont: "throw" }) });
pres.addSlide().addText("Q3", { x: 1, y: 1, w: 4, h: 1, fontFace: "Corporate Sans" });
try {
    await pres.writeFile({ fileName: "q3.pdf" });
} catch (error) {
    if (error instanceof MissingFontError)
        console.error(error.missing); // [{ face: "Corporate Sans", objects: ["slide 1 'Text 0'"], usedFace: "Arial" }]
    else throw error;
}
```

The WASM renderer takes the same option: `createWasmRenderer({ fonts, onMissingFont })`.
Puppeteer checks the faces in the page before printing: one canvas width
comparison per distinct `font-family` list, not per run.

`@pdflapas/pptxgenjs` installs `@pdflapas/puppeteer` for its Node entry's
default renderer; install `@pdflapas/puppeteer` directly only to use
`PuppeteerPdfRenderer` or `closeBrowser` without the compatibility layer.

## Custom renderer

Any object implementing `PresentationRenderer` can turn the HTML into a PDF
(Playwright, a remote rendering service, ...). The Node entry exports the
default `PuppeteerPdfRenderer` adapter.

```typescript
import PuppeteerGen, { PAGE_SIZES, type HtmlPresentationDocument, type PresentationRenderer } from "@pdflapas/pptxgenjs";

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

The default renderer lives in `@pdflapas/puppeteer` and works on any
`HtmlPresentationDocument`, for example one produced by the `/html` entry:

```typescript
import { closeBrowser, PuppeteerPdfRenderer } from "@pdflapas/puppeteer";

const pdf = await new PuppeteerPdfRenderer().render(await pres.toHtml());
await closeBrowser();
```

## Browser and other runtimes (`@pdflapas/pptxgenjs/html`)

The `/html` entry exposes the same API without loading Puppeteer, jsdom, or any
`node:*` module. It uses `document.implementation.createHTMLDocument()` from
the global DOM, resolves data URIs and http(s) images with `fetch`, and has no
default PDF renderer. `tests/htmlBrowser.test.ts` runs the browser bundle of
this entry in headless Chromium on every CI run (text, shapes, images, tables,
charts, components, `toHtml()`, and `toPdf()` with an injected renderer).

```typescript
import PuppeteerGen from "@pdflapas/pptxgenjs/html";

const pres = new PuppeteerGen();
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1 });
const { html } = await pres.toHtml();

// Print client-side, or pass { renderer } to the constructor and call toPdf().
const frame = document.body.appendChild(document.createElement("iframe"));
frame.srcdoc = html;
frame.onload = () => frame.contentWindow?.print();
```

Constructor options (both entries): `new PuppeteerGen(pageSize?, options?)`

| Option                                               | Node entry default                                                                                                       | `/html` default                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `renderer?: PresentationRenderer`                    | `PuppeteerPdfRenderer`                                                                                                   | none: `toPdf()` throws                                               |
| `resolveImage?: (source: string) => Promise<string>` | data URIs, http(s), file paths relative to `process.cwd()`                                                               | data URIs and http(s); file paths throw                              |
| `imageSources?: ImageSourceOptions`                  | 30 s fetch timeout, 50 MiB per image; opt-in `baseDir`, `allowLocalPaths`, `allowRemote`, `allowedHosts`, `maxRedirects` | same limits, `allowRemote`, `allowedHosts`, `maxRedirects`; no paths |
| `createDocument?: () => Document`                    | jsdom                                                                                                                    | global `document`; throws without a DOM                              |

In `/html`, `writeFile()` downloads the PDF in a browser, as PptxGenJS downloads its `.pptx`; without a
global `document` it throws, so use `toPdf()`.
Without a global DOM (for example a worker or a server runtime without
jsdom), pass `createDocument`: `tableToSlides(html)` parses
the markup into one (it needs a window for computed styles). `toHtml()` and `modelToHtml()`
build the HTML as strings and call `createDocument` only for a component that reads `context.document`;
so does `addComponent()`, which renders a component once to check it and creates at most one document per deck.

## WASM backend (`@pdflapas/wasm`, opt-in, text, shapes, images and tables)

An experimental renderer that parses the `toHtml()` document and draws it to PDF in
WebAssembly (Rust, `crates/`), without Chromium. Puppeteer stays the
default; nothing loads the WASM code unless you import this entry, and the
`.wasm` binary (~2.5 MB, ~1.0 MB gzip) is only fetched by `createWasmRenderer()`.
The prebuilt binary ships in the `@pdflapas/wasm` tarball, so installing it
needs no Rust toolchain.
It implements `PresentationRenderer` like the Puppeteer default (it has no model input), so `toPdf()`, `write()`,
`stream()` and `writeFile()` hand it `toHtml()`, and `renderer.render(await pres.toHtml())` does the
same directly. It parses the [HTML profile](HTML_PROFILE.md#parsing-wasm) strictly:
HTML outside the profile throws, naming the slide, object and property, and
images must already be `data:` URIs (`toHtml()` inlines them).

**Status:** text boxes (runs, paragraphs, bullets, tab stops, insets, rotation, fit) and
every preset and custom shape (fills, transparency, multi-face shading, lines,
dashes, arrowheads, rotation, flips, text in shapes), PNG, JPEG, GIF, WebP and SVG images
(every sizing mode, rounding, transparency, rotation, flips, alpha channels;
paths and URLs are resolved to data URIs by `toHtml()` before the renderer sees
the document; an SVG is drawn as vectors, sized by its `viewBox`,
`preserveAspectRatio`, `width` and `height` as Chromium sizes an `<img>`, and one
outside the [SVG subset](HTML_PROFILE.md#parsing-wasm) throws naming the slide,
picture and element; an animated GIF or WebP draws its first frame, as Chromium
prints it, and a GIF whose first frame does not fill its logical screen throws)
and tables (merged cells, fills, per-side solid and dashed borders,
cell insets and alignment, vertical text, rows grown to fit their text) and charts (every `addChart()` type and
`addChartExtension()`, drawn from the chart's SVG in the HTML: paths, gradients,
clip paths, opacity and text as text; an SVG outside the
[subset](HTML_PROFILE.md#parsing-wasm) throws, naming the element) and
components whose markup is nested sized `<div>` boxes (`width`/`height` in px
or %, a background color), such as a progress bar. A component that needs CSS
layout (text, siblings, padding, ...) throws, naming the slide, object,
component and element or property; render it with Puppeteer
([subset](HTML_PROFILE.md#parsing-wasm), issue #69).

**Shadows and glow:** outer shadows of shapes, text boxes and images and the
glow of text runs are drawn as blurred rasters (a soft-masked image under the
object), calibrated against the LibreOffice rendering rather than CSS: a
shadow's Gaussian has sigma = 0.46 x blur, a glow spreads 0.45 x its size with
sigma = 0.18 x size. A shape or text box casts the silhouette of what it draws
(fill, stroke, glyphs); an image casts its box, not its PNG alpha. A picture's
inner shadow is drawn over it the same way, from the outside of its box moved by
the offset, with the CSS blur (sigma = blur / 2) that Chromium uses; the HTML
already holds the blur and offset measured against PowerPoint's PDF export, as
LibreOffice draws none. An inner shadow anywhere else, which
only hand-written HTML can carry, is reported through `warnings()`.

**Hyperlinks:** linked text runs (also in table cells), shapes and images
become PDF link annotations, like the `<a>` elements Chromium turns into links.
A `url` opens through a URI action; a `slide` jumps to the top of that page.
Two differences from the Puppeteer output: a rotated or flipped object gets
its exact outline (`/QuadPoints`, with the bounding box as `/Rect` for viewers
that ignore them) where Chromium only writes the bounding box, and the
`tooltip` is the annotation's `/Contents`, which Chromium leaves out. Chromium
also jumps to slides through named destinations. Both write the `url` as the
deck gives it: Chromium would canonicalize it (`https://example.com` becomes
`https://example.com/`), so the Puppeteer renderer prints each link with a
placeholder and an incremental update (`packages/puppeteer/src/pdfLinks.ts`)
writes the URL back into the annotation. Every backend accepts only
`http:`, `https:` and `mailto:` URLs: normalization rejects any other scheme
(PptxGenJS writes any string), and each renderer checks the HTML again, so a
`javascript:` or `file:` link in component output or hand-written HTML fails
the render instead of reaching the PDF (`LINK_URL_SCHEME` in `@pdflapas/model`).

**Unsupported content:** by default `toPdf()` throws an error listing
everything the backend could not draw. Pass `onUnsupported: "warn"` to get the
PDF anyway; the skipped items are then in `renderer.warnings()`. HTML outside
the profile, including a component that needs layout, is an error either way.

**Fonts:** WASM cannot see system fonts, so you pass font files (TTF/OTF/TTC
bytes); at least one is required. Office faces fall back to their
metric-compatible equivalents when the originals are not supplied: Calibri ->
Carlito, Cambria -> Caladea, Arial/Helvetica -> Liberation Sans, Times New
Roman -> Liberation Serif, Courier New -> Liberation Mono, then DejaVu Sans,
Liberation Sans and Noto Sans CJK JP, so Latin text tries a Latin face before
the CJK one. A face neither supplied nor aliased is reported through
`onMissingFont` (see [Missing fonts](#missing-fonts-onmissingfont)); it is not
one of the `onUnsupported` warnings, since its text is drawn.
Under Node/Bun, `loadSystemFonts()` reads those faces (and the Office
originals, Noto Color Emoji and Noto Sans CJK when installed) from the system
font directories; pass `{ dirs, match }` to choose others. Emoji and CJK fonts
are ~50 MB together, so in a browser supply your own (ideally subsetted) fonts.

```typescript
// Node / Bun
import PuppeteerGen from "@pdflapas/pptxgenjs";
import { createWasmRenderer, loadSystemFonts } from "@pdflapas/wasm";

const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
const pres = new PuppeteerGen(undefined, { renderer });
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
await pres.writeFile({ fileName: "hello.pdf" });
```

```typescript
// Browser
import PuppeteerGen from "@pdflapas/pptxgenjs/html";
import { createWasmRenderer } from "@pdflapas/wasm";

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

## PDFKit backend (`@pdflapas/pdfkit`, experimental, text, images, simple shapes, tables and effects)

A third renderer in pure JavaScript on [PDFKit](https://pdfkit.org): no Chromium and no WebAssembly, so it runs
wherever JavaScript does. It is a first version (#310); the WASM backend covers far more. Like the others it
implements `PresentationRenderer` and reads only the `toHtml()` document: it parses the HTML once per render with
parse5 and draws the [profile](HTML_PROFILE.md) with PDFKit, so HTML outside the profile throws and images must be
`data:` URIs (`toHtml()` inlines them).

**Drawn:**

- Text boxes: runs with their face and its fallback families, size, bold, italic (synthesized when the face has
  none, with the profile's stroke and shear), color, letter spacing (per-word spans included), kerning
  (`font-kerning: none`, and pairs across a break opportunity shaped as one run, as `crates/pdf-core` does),
  underline (single, double, heavy, dotted, dashed, dot-dash and wavy, the bands pdf-core draws), strike and double strike,
  superscript and subscript (the profile's baseline offset and size), highlight, outline, hyperlinks and slide
  links; paragraph alignment (left, center, right, justify), line spacing, space before and after, indents,
  bullets and numbers, default and explicit tab stops (left, right, center, decimal), right-to-left paragraphs; insets, vertical anchor, `fit: shrink` and `fit: resize`, rotation and
  flips. Lines break where Chromium breaks them: UAX #14 opportunities from `linebreak`, with the same overrides as
  `crates/pdf-core` (after a run of spaces, a minus before a digit, Blink's ASCII pair table), and words wider than
  the box break between characters. Every line sits on the profile's line box and baseline
  (`data-line-baseline`, `data-mark-baseline`, `data-break-baseline`), so only the breaks and x positions are
  measured, with fontkit, shaping each piece exactly as PDFKit draws it.
- Images: PNG, JPEG, GIF and WebP (the first frame, decoded with `image-in-browser` and embedded as PNG; a GIF
  whose first frame does not fill its screen throws, as in WASM) and SVG (drawn as vectors: `g`, `path`, `rect`,
  `circle`, `ellipse`, `line`, `polyline` and `polygon` with inherited paint, transforms, `viewBox` and
  `preserveAspectRatio`, a translucent element faded as one group; any other element is reported), every sizing
  mode (stretch, contain, cover, crop), rounding, transparency, rotation and flips.
- Shapes whose geometry is a `rect`, `ellipse` or untransformed `path`, and multi-face presets (their faces and
  outline): fill, stroke, transparency, dashes and line heads (the profile's markers, sized and turned as
  `crates/pdf-core` draws them), and the fill and line of text boxes.
- Shadows and glow: outer shadows of shapes, text boxes and images, the inner shadow of a picture, and the glow of
  text runs, drawn as `crates/pdf-core` draws them: the object's silhouette blurred with the same box-blur
  approximation, as a soft-masked image under the object (over it, for an inner shadow).
- Tables: the HTML's column widths and row heights, merged cells, each row grown until its cells' text fits,
  cell fills, margins and anchor, cell text through the text box layout, and solid and dashed borders, each grid
  edge drawn once (the steps of `crates/pdf-core`'s `table.rs`); vertical cell text is reported.

**Reported** (an error by default, a `warnings()` line under `onUnsupported: "warn"`): charts and
components; SVG elements outside that subset; an inner shadow on anything but a picture (as WASM reports it);
vertical text; a
paragraph that mixes directions (there is no bidi algorithm, so its words run in the paragraph's direction) and
tabs in a right-to-left paragraph; and any CSS property or `data-*` attribute of the profile
it does not read, so nothing is dropped silently.

**Fonts:** as with WASM, you pass font files (TTF/OTF/TTC bytes), parsed once when the renderer is created; at
least one is required. Office faces fall back to the same metric-compatible faces as the WASM backend (Calibri ->
Carlito, Arial -> Liberation Sans, ..., then DejaVu Sans, Liberation Sans and Noto Sans CJK JP), each character
in the first face that has its glyph. A face neither supplied nor aliased goes to `onMissingFont`. Under Node/Bun,
`loadSystemFonts()` reads the same faces as the WASM one, without the bitmap emoji font PDFKit cannot embed.

```typescript
import PuppeteerGen from "@pdflapas/pptxgenjs";
import { createPdfkitRenderer, loadSystemFonts } from "@pdflapas/pdfkit";

const renderer = await createPdfkitRenderer({ fonts: await loadSystemFonts(), onUnsupported: "warn" });
const pres = new PuppeteerGen(undefined, { renderer });
pres.addSlide().addText("Hello", { x: 1, y: 1, w: 4, h: 1, fontFace: "Calibri" });
await pres.writeFile({ fileName: "hello.pdf" });
```

The `browser` export condition resolves to a build without `node:*` modules (`loadSystemFonts()` throws there;
pass font bytes). The same HTML gives the same PDF bytes: the creation date is fixed at the Unix epoch, since
PDFKit always writes one and derives the file ID from it. `bun run test:visual:pdfkit:docker` scores it against
the LibreOffice references next to the Puppeteer and WASM backends; it has no baseline and gates nothing.
