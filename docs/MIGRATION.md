# Migrating from PptxGenJS

**Change the import.** Slide code stays as it is: the methods, options, defaults and chaining are
those of PptxGenJS 4.0.1.

```diff
-import pptxgen from "pptxgenjs";
+import pptxgen from "@pdflapas/pptxgenjs";
```

The default export is the class `PuppeteerGen` (it keeps that name until the rename planned in
[#22](https://github.com/tomast1337/Puppeter-PptxGenJS/issues/22)); any local name works. In a web
page, import `@pdflapas/pptxgenjs/html` instead and pass a renderer (see [Choosing a backend](../README.md#choosing-a-backend)).

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
  [docs/BACKENDS.md](./BACKENDS.md).
- `tableToSlides(id)` finds the table in the global `document`, as PptxGenJS does (in Node, install a
  jsdom one); it also takes the `<table>` element or its HTML markup. See
  [docs/USAGE.md](./USAGE.md#tables-from-html-tabletoslides).

**What differs.**

- **Rendering:** the PDF is drawn by Chromium or the WASM renderer, not PowerPoint, and charts by
  ECharts. Layout is close, not pixel-identical; [Fidelity](../README.md#fidelity) has the measured scores.
- **Page size:** `pres.layout = "LAYOUT_WIDE"` (or `LAYOUT_4x3`, `LAYOUT_16x10`, a
  `defineLayout()` name) works as in PptxGenJS. `pres.defineLayout({ name, width, height })` also
  applies its size at once, and the constructor takes a size, `new pptxgen(PAGE_SIZES.A4.portrait)`;
  the sizes in `PAGE_SIZES` are listed in [docs/USAGE.md](./USAGE.md#page-sizes-and-layouts).
- **Theme:** `pres.theme.bodyFontFace` is the font of text, table cells and chart legends that set
  none, as in PowerPoint. Set it before adding objects; changing it afterwards throws.
- **Document properties:** `pres.title`, `author`, `subject`, `company` and `revision` become the
  PDF's Title, Author, Subject and the custom Company and Revision entries. Only what you set is
  written: PptxGenJS's defaults (`PptxGenJS Presentation`, `PptxGenJS`, revision `1`) are not, and
  an unset property reads `""`.
- **Hidden slides:** `slide.hidden = true` leaves the slide out of the PDF, as PowerPoint and
  LibreOffice export it. The other slides keep their numbers, so `slide.slideNumber` prints the
  same number as with the slide shown, and a link to slide 3 jumps to the page that shows slide 3;
  a link to the hidden slide jumps nowhere.
- **Shown nowhere, as in PowerPoint's slide show:** `addNotes()`, `addSection()` and `pres.rtlMode`
  (which orients PowerPoint's editing views) are accepted and change nothing on the page.
- **Ignored, as PptxGenJS ignores them:** text `bulletNumberType`, `textDirection` (a table cell
  option), `isTextBox`, `data` and `path`, shape `align` and table `verbose` are accepted and draw
  nothing different. A string `line` and `lineSize`, `lineDash`, `lineHead`, `lineTail` apply to
  `addText` only with `shape: "line"`, as in PptxGenJS. Inside a `line` object, the deprecated `pt`,
  `size`, `lineDash`, `lineHead` and `lineTail` are ignored: use `width`, `dashType`, `beginArrowType`
  and `endArrowType`.
- **Text fit and tab stops:** `fit: "shrink"` (`shrinkText`) scales font size and line height in
  steps until the text fits, close to but not the scale PowerPoint or LibreOffice pick.
  `fit: "resize"` (`autoFit`) grows the box to its text, where PowerPoint keeps the stored size until
  the text is edited. Explicit `tabStops` are drawn by the WASM renderer; the Puppeteer renderer
  uses the 1in default stops.

**What throws.** PdfLapas fails instead of writing a PDF that silently lacks something:
`addMedia()` and `defineSlideMaster()` throw `UnsupportedFeatureError` with a suggested
alternative, and so do the options that need a slide master: `placeholder` on `addText()` and
`addImage()`, `masterName` on `addSlide()` and `masterSlideName` on `tableToSlides()` (except PptxGenJS's built-in `"DEFAULT"`). An inner shadow on a shape stops the PDF
(PptxGenJS writes it as XML that LibreOffice drops); a chart type or option it cannot draw throws `UnsupportedChartError`. An unknown `outputType`
throws before rendering. `API_COMPATIBILITY`, exported by `@pdflapas/pptxgenjs`, lists what PdfLapas
does with each PptxGenJS presentation and slide member; `COMPATIBILITY` does the same per option.

**Choosing a rendering target.** PowerPoint and LibreOffice draw the same `.pptx` differently. Pick
the one whose output your PDFs should match; the target is set once, on the constructor:

```typescript
import { PuppeteerGenPowerPoint } from "@pdflapas/pptxgenjs";

const pres = new PuppeteerGenPowerPoint(); // or new pptxgen(undefined, { target: "powerpoint" })
```

- `PuppeteerGenLibreOffice`, the default export and `PuppeteerGen` match LibreOffice rendering, the
  reference the fidelity scores are measured against. Existing code keeps this behaviour.
- `PuppeteerGenPowerPoint` matches PowerPoint rendering. PptxGenJS writes `kern="1200"` in its default
  text style and `kern="0"` on a run with `charSpacing`; PowerPoint reads them, so text under 12pt and
  text with `charSpacing` is drawn without the font's pair kerning, and a line that just fits kerned
  may wrap. LibreOffice kerns every run.

Both targets leave a text box's last paragraph's space after out of the height that middle and
bottom anchoring centre, as PowerPoint and LibreOffice do. The target is written into the HTML
(`font-kerning: none` on each unkerned run), so both backends follow it.

**Using the WASM backend.** Pass its renderer to the constructor; nothing else changes:

```typescript
import { createWasmRenderer, loadSystemFonts } from "@pdflapas/wasm";

const pres = new pptxgen(undefined, { renderer: await createWasmRenderer({ fonts: await loadSystemFonts() }) });
```

It draws text, shapes, images, tables and charts without a browser and throws on what it cannot
draw; [Choosing a backend](../README.md#choosing-a-backend) says when to pick it.
