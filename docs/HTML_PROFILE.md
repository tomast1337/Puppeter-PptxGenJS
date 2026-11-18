# PdfLapas HTML profile, version 2

This document specifies the HTML that `toHtml()` emits as the mapping from each field of the JSON model
(`packages/model/src/types.ts`) to the element, class, CSS property or attribute that holds it. Version 2
describes that output exactly, including the values it loses.

**Versions are frozen** (#69 phase 7). Any change to the markup a reader accepts or to what a value means
(a new element, attribute, CSS property or enumerated value, a changed unit or default) is a new version:
`toHtml()` then writes the next number, this document describes it, and the WASM reader parses every
version before a release writes the new one. Fixes that only change error messages stay within a version,
as do changes to the Puppeteer print step and to the shared stylesheet outside its `@page` size, since a
reader never sees them.

**Version 2** (#102) adds the [document properties](#document-properties): `<title>` and the `author`,
`description`, `pdflapas-company` and `pdflapas-revision` meta tags. Nothing else changed. Documents that
declare `<meta name="pdfdeck-profile" content="1">` keep rendering the same way: every reader still
accepts them, and the WASM reader gives their `<title>` and meta tags no meaning, as version 1 did, so
their PDFs have no document properties. Puppeteer prints any HTML, so Chromium keeps writing a version 1
document's `<title>` as the PDF Title, as before. Version 2 is not released yet (no `@pdflapas/*` package has
been published), so its description was corrected in place rather than as a version 3: the elements are
the same, but `toHtml()` writes only the properties the deck sets (PptxGenJS's defaults are not written)
and both renderers put `company` and `revision` in the PDF. For the same reason, hidden slides were also
corrected in place: `toHtml()` leaves a hidden slide out instead of marking it `data-hidden`, so a slide
container's `#slide-N` is the slide's number in the deck and can skip one, and a slide link jumps to the
container with that number ([Slide](#slide)). Readers accept `data-hidden` and give it no meaning.
Likewise, a `data-text-fit="shrink"` box now states its shrink rule in `data-text-fit-step`,
`data-text-fit-max-steps` and `data-text-fit-tolerance` ([Text](#text)) instead of each renderer
keeping its own copy (#154); the WASM reader requires them in both versions, and
[completion](#completion) fills them in a hand-written or older document.

**Meta names.** The project was called pdfdeck when version 1 was frozen, so a version 1 document spells its
meta names `pdfdeck-profile` and `pdfdeck-page-size`, and readers keep accepting exactly that. Version 2 was
renamed in place, still unreleased, to `pdflapas-profile`, `pdflapas-page-size`, `pdflapas-company` and
`pdflapas-revision`. Each version has one spelling: `<meta name="pdfdeck-profile" content="2">` and
`<meta name="pdflapas-profile" content="1">` are errors that name both accepted forms.

## Pipeline

The target pipeline (#69) has two intermediate representations in a line:

```text
PptxGenJS API -> JSON model (IR 1, getModel()) -> HTML (IR 2, this profile) -> Puppeteer -> PDF
                                                                            \-> WASM      -> PDF
```

The model is the public schema; the HTML is derived from it by one pure, deterministic function, and
both backends read only the HTML.

- **The model is the only source of truth.** Each `add*` call writes only the model. `toHtml()` is
  `modelToHtml(getModel())` (`render/document.ts`), exported from `@pdflapas/pptxgenjs/html` for producers
  that build the model themselves: it writes the whole document at once as strings, without a DOM,
  inlines images through `resolveImage`, and renders components with the caller's registry. Only a
  component that reads `context.document` gets a document, from the caller's `createDocument`.
- **HTML is also an input.** A stored, edited or hand-written document enters at the HTML stage:
  `pptxHtmlDocument(html)` (`render/completion.ts`, exported from `@pdflapas/pptxgenjs` and `/html`) fills
  the [defaulted values](#completion), then `htmlDocument(html)` (`@pdflapas/model`) checks the version and
  reads the page size, and its result goes to either renderer. Puppeteer also prints HTML outside the
  profile through `render({ html, pageSize })`; WASM reads only the profile.
- **Every renderer reads the HTML.** `toPdf()` hands `toHtml()` to the renderer, whichever it is.
  `WasmRenderer.render(document)` parses this profile in Rust (`crates/pdf-core/src/profile/`,
  [Parsing (WASM)](#parsing-wasm)). The renderers have no model input: the model reaches them only
  through `modelToHtml`.

## Decisions

From the maintainer's decisions on #69:

- **Numbers keep full float precision** (`110.39999999999999px`) during the migration, so PDFs from the
  HTML path could be compared byte for byte with the model path (phases 3 and 4; the model input is gone
  since phase 5). Rounding for readable diffs is revisited next.
- **Missing values are completed in TypeScript.** HTML written by hand may omit LibreOffice-specific
  values such as the line box. A browser-safe completion step fills them from
  `packages/pptxgenjs/src/defaults.ts` before either backend renders; Rust gets no PptxGenJS rules.
- **The WASM parser is small and strict.** Malformed or out-of-profile input is an error, never a guess.
- **CSS or `data-*`** (still open, question 2): the default is a CSS property where one states the value
  exactly, a `data-*` attribute otherwise. A value has one spelling, never both. Version 1 does not yet
  follow this everywhere; the [field mapping](#field-mapping) says what each value uses today.

## Conventions

- **Lengths** are CSS px at 96 px per inch (`PPTX_DEFAULTS.units`), the model's unit, written with a `px`
  suffix in CSS and without a unit in SVG attributes. Only `@page` uses inches. Angles are `deg`.
- **Values are written verbatim, never through the CSSOM.** Each inline `style` attribute is a string
  the renderer formats itself (`render/css.ts`): `property: value;` pairs joined by one space, in
  first-write order. Numbers keep full float precision and colors keep the model's spelling (`#17365D`,
  `rgba(…)`). The CSSOM would let the DOM decide: Chromium rounds lengths to 6 significant digits,
  collapses `padding` and drops font-family quotes, and jsdom turns hex colors into `rgb()` (#69
  finding 4). So jsdom (Node entry) and Chromium (`/html` entry in a browser) give the same bytes;
  `tests/htmlBrowser.test.ts` checks it. Markup a component returns, and chart SVG, are parsed and
  serialized with parse5 (`render/fragment.ts`), as an `innerHTML` round trip in jsdom does; every
  other element is written as a string, escaped as the HTML serializer escapes (`render/markup.ts`).
- **A property at its default may be omitted**: `opacity` when 1, `letter-spacing` when 0,
  `font-kerning` when the run is kerned, `text-decoration-line` when there is none, `transform` when there is no rotation or flip.

## Document

```html
<!DOCTYPE html>
<html>
    <head>
        <meta name="pdflapas-profile" content="2" />
        <meta name="pdflapas-page-size" content="Screen 16:9 Landscape" />
        <!-- the document properties the deck sets, here pres.title and pres.company -->
        <title>Q3 review</title>
        <meta name="pdflapas-company" content="Acme" />
        <style id="puppeteer-gen-styles">
            /* presentationCSS(pageSize), render/slide.ts:103 */
        </style>
    </head>
    <body>
        <div class="slide-container" id="slide-1" style="background-color: …; --slide-text-color: …">
            <!-- slide objects in insertion (paint) order -->
        </div>
        <!-- one .slide-container per slide -->
    </body>
</html>
```

- The doctype is required: quirks mode drops the line-box strut that text layout relies on
  (`render/document.ts:8`).
- The shared stylesheet holds `@page { size: <width>in <height>in; margin: 0 }`, the slide size as
  `.slide-container { width; height }` in px, the defaults for each class (font, color, padding, table
  insets, from `defaults.ts`), the line-box strut and the print rules. It is generated from the page size
  only, so it is the same for every deck of one size.
- `<meta name="pdflapas-profile" content="2">` names the profile version this document follows
  (`HTML_PROFILE_VERSION`, `@pdflapas/model`; `READABLE_HTML_PROFILE_VERSIONS` lists what readers accept).
- `<meta name="pdflapas-page-size">` holds the page size's name (`PageSize.name`, `Custom` when it is
  missing); the size itself is in the stylesheet.
- The [document properties](#document-properties) follow the page size. There is no `<script>` or
  external resource. Every image is a `data:` URI by the time `toHtml()` returns (`modelToHtml`,
  `render/document.ts`).

### Document properties

Version 2. The presentation's `title`, `author`, `subject`, `company` and `revision`
(`PresentationMetadata`), which PptxGenJS writes to `docProps/core.xml` and `docProps/app.xml`. Standard
HTML holds a value where it has a name for it; each element is left out when its value is empty or absent,
and appears at most once.

| Property   | PptxGenJS (its default, not written by PdfLapas)   | HTML                              | PDF Info dictionary (both renderers) | WASM also writes XMP |
| ---------- | -------------------------------------------------- | --------------------------------- | ------------------------------------ | -------------------- |
| `title`    | `dc:title` (`PptxGenJS Presentation`)              | `<title>`                         | `/Title`                             | `dc:title`           |
| `author`   | `dc:creator` and `cp:lastModifiedBy` (`PptxGenJS`) | `<meta name="author">`            | `/Author`                            | `dc:creator`         |
| `subject`  | `dc:subject` (`PptxGenJS Presentation`)            | `<meta name="description">`       | `/Subject`                           | `dc:description`     |
| `company`  | app.xml `Company` (`PptxGenJS`)                    | `<meta name="pdflapas-company">`  | `/Company` (custom key)              | none                 |
| `revision` | `cp:revision` (`1`)                                | `<meta name="pdflapas-revision">` | `/Revision` (custom key)             | none                 |

- **Only what the deck sets.** PptxGenJS fills every property with its own name when the caller sets
  none; those values brand the file rather than describe it, so `toHtml()` writes no element for a property
  the deck leaves unset, and the PDF has no entry for it.
- **Subject is `description`.** HTML has no subject meta name; `description` is its free-form summary of
  the page, which is what a PDF Subject holds, and krilla writes the same value to both Subject and
  `dc:description`.
- **Company and revision are custom Info keys.** A PDF has no standard field for either; ISO 32000-1
  14.3.3 allows other keys in the Info dictionary, and `/Company` and `/Revision` are the names
  `pdfinfo -custom` lists them under. XMP has no standard property for them and krilla (0.8) writes no
  custom XMP, so neither renderer writes them to XMP. LibreOffice's PDF export of the PptxGenJS `.pptx`
  writes neither, so the visual reference has none.
- **The title is read as `document.title`:** ASCII whitespace stripped and collapsed.
- **Each renderer writes them.** WASM sets krilla's metadata (Info dictionary and XMP packet) from a
  version 2 document; when it has a company or revision, `crates/pdf-core/src/document_info.rs` appends an
  incremental update (ISO 32000-1 7.5.6) whose Info dictionary holds all five. Chromium writes only
  `/Title`, from `<title>`; the Puppeteer renderer then appends an incremental update
  (`packages/puppeteer/src/pdfInfo.ts`) whose Info dictionary adds `/Author`, `/Subject`, `/Company` and
  `/Revision` from the meta tags of any HTML it prints, and keeps Chromium's Creator, Producer and dates.
  It writes no XMP packet, as Chromium writes none.
- **Completion adds none of them**: a hand-written document without them gives a PDF without them.

## Slide

`div.slide-container#slide-N` is one page: `position: relative`, `overflow: hidden`, the page size from
the stylesheet. Children are the slide's objects in model order, which is also paint order.

N is the slide's number in the deck, from 1. A hidden slide is not written, so the numbers can skip one:
a deck whose second slide is hidden has `#slide-1` and `#slide-3`. A slide link (`href="#slide-N"` and
`data-slide="N"` on the linked element) jumps to the page of the container `#slide-N`. With no such
container (the target is hidden) the PDF gets no link there: Chromium writes none for the dangling
anchor, and the WASM reader reports it through `warnings()`. A container without an `id` takes its
position as its number; any other `id` than `slide-<n>` is an error. `data-hidden` (written before
hidden slides were left out) is accepted and ignored.

## Slide objects

Every object is one absolutely positioned element with class `slide-element` plus a kind class, and
`data-object-name`. The common box comes from `applyObjectStyle` (`render/style.ts:55`):

| CSS / attribute    | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `left`, `top`      | object x, y in px                                                         |
| `width`, `height`  | object size in px; omitted when the model has none                        |
| `transform`        | `rotate(<deg>deg) scaleX(-1) scaleY(-1)`, the parts that apply, in order  |
| `transform-origin` | always `center`                                                           |
| `opacity`          | object opacity, omitted at 1                                              |
| `background-color` | fill color, `transparent` when the fill is hidden; omitted with no fill   |
| `border-*`         | the line, for objects without SVG geometry (`border-style: none` if none) |
| `box-shadow`       | `[inset ]<x>px <y>px <blur>px <color>`, for objects without SVG geometry  |

| Model kind       | Element                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `text`           | `div.slide-element.slide-text`, with `data-shape` and an SVG when it has one |
| `shape`          | `div.slide-element.slide-shape` (`a` when linked)                            |
| `image`          | `div.slide-element.slide-image` (`a` when linked)                            |
| `table`          | `div.slide-element.slide-table-container`                                    |
| `chart`          | `div.slide-element.slide-chart`                                              |
| `chartExtension` | `div.slide-element.slide-chart`                                              |
| `component`      | `div.slide-element.slide-component`                                          |

There is no media, notes or master element: the model has no such kinds.

### Text

```html
<div class="slide-element slide-text" style="…box…; padding; align-items; white-space; overflow-wrap; direction" data-object-name="Text 1" data-text-fit="none" data-text-direction="horizontal">
    <div class="text-content" style="width: 100%">
        <div class="text-paragraph" style="text-align; direction; margin-top; margin-bottom; line-height; tab-size" data-line-baseline="14.4" data-tab-stops="96:left,192:right" data-bullet-level="0" data-bullet-type="bullet" data-bullet-indent="27" data-bullet-start="1">
            <span class="text-bullet" style="display: inline-block; width; font-family; font-size; color">•&nbsp;</span>
            <span class="text-run" lang="en-US" style="font-family; font-size; color; font-weight; font-style; text-decoration-*; …">text</span>
            <br /><a class="text-run" href="…" title="…" data-slide="2" data-soft-break-before="" style="…">linked text</a>
            <span class="text-run" lang="en-US" data-vertical-align="super" data-text-shadow="glow shadow" style="…">x</span>
        </div>
    </div>
</div>
```

`render/text.ts`. The box is a flex container: `align-items` is the vertical anchor (`flex-start`,
`center`, `flex-end`). Vertical text sets `writing-mode` (`vertical-rl` for `vertical270`, `vertical-lr`
otherwise) and `text-orientation` (`upright` for `stacked`) on `.text-content`. With `fit: resize` the
height becomes `min-height` and `height: auto`. With `fit: shrink` the box also states the shrink rule
(`PPTX_DEFAULTS.text.shrink`): `data-text-fit-step="0.95"`, `data-text-fit-max-steps="20"` and
`data-text-fit-tolerance="0.5"`. While the text overflows the box's inner size (its size less the
`padding`) by more than the tolerance in px, a renderer scales every run and bullet `font-size`, every px
`line-height` and the baseline shift (`data-line-baseline` within it) by the step, at most max-steps
times. The step is between 0 and 1, max-steps a whole number and the tolerance not negative; a reader
rejects a shrink box without all three. A soft break is a `<br>` before the run and
`data-soft-break-before` on it. A run is an `a` when it has a link, a `span` otherwise. Model values that
CSS cannot state exactly are `data-*` on the run: `data-vertical-align` (`sub`, `super`),
`data-text-shadow` (which `text-shadow` entry is the `glow` and which the `shadow`), `data-double-strike`
with `data-underline-style`, and `data-empty` on an empty run (its text is U+200B).

The rendering target (`PuppeteerGenPowerPoint`, `PuppeteerGenLibreOffice`, or the `target` option) is not
written as a document-level value: each difference is on the element it changes, so a reader of the HTML
and the WASM renderer follow it without knowing the target. Today that is `font-kerning: none` on a run
the PowerPoint target draws unkerned (under 12pt, or with `charSpacing`).

### Shape

```html
<div class="slide-element slide-shape" style="…box without fill, line or shadow…" data-object-name="Shape 0" data-shape="rect">
    <svg class="shape-svg" viewBox="0 0 W H" width="100%" height="100%" preserveAspectRatio="none" style="overflow: visible; filter: drop-shadow(…)" data-line-begin-arrow="oval" data-line-end-arrow="triangle">
        <defs>
            <marker id="line-head-…" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="…" fill="…" /></marker>
        </defs>
        <rect|ellipse|path|g class="shape-geometry" fill="…" stroke="…" stroke-width="…" vector-effect="non-scaling-stroke" stroke-dasharray="…" marker-start="url(#…)" marker-end="url(#…)" />
    </svg>
</div>
```

`render/shape.ts`. Fill, line and shadow live on the SVG, not in CSS. Geometry: `rect` with `rx`/`ry`,
`ellipse`, a `path` for lines (`M 0 0 L W H`, or `M 0 H L W 0` when inverse) and preset or custom paths
(`d`, optional `transform`). A multi-face preset is a `g` with one `path.shape-face` per face and a
`path.shape-outline` that carries the stroke. A face's `fill` is final: `toHtml()` shades it with
`PPTX_DEFAULTS.shape.faceShading`, and `data-fill-modifier` only names the shading, which renderers do not
apply again (#43).
Arrow heads are markers whose id spells out the color and path, so equal heads share one id.

A text object with a shape is a `.slide-text` with `data-shape` whose first child is the same
`svg.shape-svg`, drawn behind `.text-content`; the box itself then has no fill, border or shadow. The
stylesheet gives every `.slide-text` `overflow: visible`: PptxGenJS writes no clip, so text that does not fit
is drawn past the box from its anchor, and a shape's outline and line heads reach past it, as in PowerPoint.

### Image

```html
<div class="slide-element slide-image" role="img" aria-label="alt" style="…box…; border-radius: 50%?" data-object-name="Image 0">
    <div class="slide-image-frame" style="width: 100%; height: 100%; overflow: hidden; position: relative; border-radius: 50%?">
        <img class="slide-image-content" data-image-sizing="stretch|contain|cover|crop" alt="alt" src="data:…" style="display: block; opacity; position; left; top; width; height; object-fit: fill" />
    </div>
</div>
```

`render/image.ts`. `stretch` fills the frame (`width: 100%; height: 100%`). `contain`/`cover` place the
image at the model's box (`left`, `top`, `width`, `height`); `crop` places it at `-offsetX`, `-offsetY`
with the full scaled size, and the frame clips.

### Table

```html
<div class="slide-element slide-table-container" style="…box…" data-object-name="Table 0">
    <table class="slide-table" style="width; height; table-layout: fixed; border-collapse: collapse; border-spacing: 0px">
        <colgroup>
            <col style="width: 408px" />
        </colgroup>
        <tr style="height">
            <td colspan="1" rowspan="1" style="padding: 0px; overflow: hidden; position: relative; vertical-align; background-color; border-top; border-right; border-bottom; border-left">
                <div class="table-cell-text" style="display: flex; box-sizing: border-box; position: absolute; inset: 0px | width: 100%; overflow: hidden; …text box…">
                    <!-- .text-content as for text -->
                </div>
            </td>
        </tr>
    </table>
</div>
```

`render/table.ts`. A cell's text box is the text renderer's output on `.table-cell-text`, in flow
(`width: 100%`), so a row's `height` is a minimum and the row grows to its text as in PowerPoint and
LibreOffice; only vertical text in a row with a height fills the cell (`position: absolute; inset: 0px`). Its
`data-text-fit` is always `none`: PptxGenJS writes a bare `<a:bodyPr/>` in a cell, whatever `fit`, `shrinkText` or
`autoFit` say, and both renderers refuse another value. In a row sized to its content (no row or table
height), the cell's `padding` also holds the table's `contentRowSlack`: on the bottom for top text, half on
each side for middle, on the top for bottom, so the row is that much taller than its text and margins and the
text sits where the anchor puts it. Borders are
`<width>px <solid|dashed> <color>` per side, `transparent` when hidden. Pagination happens in
normalization (`normalize/table/pagination.ts`), so a paginated table is already several slides.

### Charts

```html
<div class="slide-element slide-chart" role="img" aria-label="alt" style="…box…; overflow: hidden" data-object-name="Chart 0">
    <svg width="100%" height="100%" viewBox="0 0 W H" …>…</svg>
</div>
```

`render/chart.ts:373-387`. The SVG is an opaque subtree (ECharts output, the 3D bar renderer, or a
`chartExtension`'s caller SVG). Its ids are prefixed with the object name; it may not reference external
resources. Its class names are deterministic after #66. The chart options are not in the HTML.

### Components

```html
<div class="slide-element slide-component" data-component-type="fixture/progress" data-component-version="1" style="…box…; position: absolute; overflow: hidden" data-object-name="Component 0">…the component's markup…</div>
```

`render/component.ts`. The content is whatever the registered definition rendered; its `props` are not
in the HTML. Component images are resolved to `data:` URIs like slide images. The WASM reader draws only
content made of [sized boxes](#parsing-wasm); Puppeteer prints any content.

## Renderer workarounds

Chromium needs declarations that LibreOffice does not to print what LibreOffice draws. They are not deck
content: each is derived from a value the profile states once, so it lives outside the markup, either in
the shared stylesheet (driven by profile classes and attributes) or in the Puppeteer print step,
`printHtml(html)` (`packages/puppeteer/src/printWorkarounds.ts`). The print step reads only attributes and
raw `style` text, never layout, so it is a pure string transform: the Puppeteer renderer passes its output
to `setContent`, before fonts are awaited, shrink-to-fit and `page.pdf()`. It adds declarations and
attributes inside start tags and leaves every other byte as it was; the same input gives the same output,
and HTML outside the profile gets only the print zoom, so it must write out its `<html>` start tag.
Opening the HTML in a browser shows the stylesheet rules but not the print step; open `printHtml(html)`
(`@pdflapas/puppeteer`, re-exported by `@pdflapas/pptxgenjs`) to see what Chromium prints, at 12.5% page
zoom to undo the print zoom. Its additions are outside the profile, so it is for Chromium only. A parser
of this profile never sees either.

| Workaround     | Derived from                                                       | Where it lives                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line-box strut | `line-height` on `.text-paragraph`                                 | Stylesheet: `.text-paragraph { font-size: 0 }` and `.text-run, .text-bullet { line-height: 0 }`, so each line is exactly `line-height` tall, baseline centred                                                                                                                                                                      |
| Baseline shift | `line-height` and `data-line-baseline` on a horizontal paragraph   | Print step: `position: relative; top: <baseline - line-height / 2>px`, read from the raw `style` attribute at full precision                                                                                                                                                                                                       |
| Print zoom     | `PRINT_ZOOM` (8) in `printWorkarounds.ts`, not a profile value     | Print step: `zoom: 8` on `<html>`, and `page.pdf({ scale: 1 / 8 })` scales it back, since Chromium paints text baselines and SVG roots on whole device px: 1/8 CSS px instead of 1 px (issue #49). Every layout read in the page (shrink-to-fit, image sizes) is in CSS px either way                                              |
| Paper size     | the `@page` `size`                                                 | Print step: `page.pdf({ preferCSSPageSize: true })` prints on the `@page` size; with only `width`/`height` Chromium rounds the paper up and centres the page on it at a whole CSS px, moving everything up to 0.75pt (an 8.2646 x 11.695in page)                                                                                   |
| Print snap     | `left`, `top` and `transform` of the object around `svg.shape-svg` | Print step: `transform: translate(…)` on the svg, undoing Chromium's snap of SVG roots to a whole device px (1/8 CSS px under the print zoom) in print (issue #42), in the object's pre-transform space                                                                                                                            |
| Dash rewrite   | `stroke-dasharray` that starts with a zero-length dash             | Print step: the same pattern shifted by `stroke-dashoffset`, since Chromium's PDF keeps the zero-length dash and poppler paints it as a hairline                                                                                                                                                                                   |
| Text outline   | `border-color`, `border-width`, `border-style` on `.slide-text`    | Print step: `border-style: none; outline: <width>px <style> <color>; outline-offset: -<width / 2>px`, since DrawingML centres a text box's line on its edge and measures the inset from the edge, while a CSS border lies inside the box and moves the text                                                                        |
| Font fallback  | the face in `font-family` on `.text-run` and `.text-bullet`        | Print step: appends `"Carlito", "Noto Sans", Arial, "Liberation Sans", sans-serif` to a Calibri face, `"Caladea", Arial, "Liberation Sans", sans-serif` to a Cambria face, `Arial, "Liberation Sans", sans-serif` to any other, since Chromium does not apply LibreOffice's Microsoft-font substitutions; before fonts are awaited |
| Table offset   | the widest `border-*` width over the table's cells                 | Print step: `position: relative; left/top: -<width / 2>px` on `table.slide-table`, since DrawingML centres borders on the grid and Chromium collapses the outer half inside the table                                                                                                                                              |
| Cell inset     | the `border-*` widths of each `td`                                 | Print step: on its `.table-cell-text`, `inset: -<top / 2>px …` (absolute) or `margin: -<top / 2>px …; width: calc(100% + <(left + right) / 2>px)` (in flow), since DrawingML measures cell margins from the grid line and Chromium from the inner half of the border                                                               |

Other Chromium-specific details that stay in the markup or stylesheet: `z-index: 0` stacking contexts
(stylesheet), the clamped `viewBox` and `height="1"` for zero-height lines (`render/shape.ts`), U+200B for
empty runs (`render/text.ts`). Each also states a profile value or is plain CSS layout, so none is a
second spelling.

## Parsing (WASM)

`Renderer::render_html` (`renderHtml` in `crates/pdf-wasm`, `WasmRenderer.render(document)` in
`@pdflapas/wasm`) reads versions 1 and 2 with a hand-written tokenizer, not a general HTML parser
(`crates/pdf-core/src/profile/`: `dom.rs` tokenizes, `style.rs` reads inline CSS, one file per object kind
maps the elements onto the `model.rs` structs the drawing code reads). It is the only input of the WASM
backend.

- **Version.** `<meta name="pdflapas-profile" content="2">` (or `<meta name="pdfdeck-profile" content="1">`) is required; a missing tag or another version
  is an error.
- **Markup is what the serializer writes.** Every element is closed by its own end tag, `/>` only ends void
  and SVG elements, attributes are not repeated, character references are `&amp; &lt; &gt; &quot; &apos;
&nbsp;` and numeric ones. HTML a browser would repair (a stray end tag, `<td>` outside `<tr>`, text
  between objects) is an error. Nesting depth does not recurse, so deep input cannot overflow the stack.
- **Only the profile.** Each element accepts the attributes and inline CSS properties this document lists
  for it and reads each value from its one place. The [renderer workarounds](#renderer-workarounds) are
  not in the profile, so they are errors too. Any other attribute, property, element, enumerated value or a
  repeated property is an error. Numbers are JSON numbers with their unit (`px`, `deg`, `in`); `NaN`,
  infinities and values outside `f32` are errors. `font-family` is exactly one quoted family
  (`"Calibri"`), as `toHtml()` writes it: a fallback list is an error, since fallbacks are the print
  step's. A run's `font-kerning` is `none`, `normal` or `auto`; `none` turns the font's `kern` feature off
  in the layout.
- **Images are `data:` URIs.** The parser fetches nothing; a path or URL in `src` is an error (`toHtml()`
  always inlines images). PNG, JPEG, GIF and WebP are recognized by their bytes, whatever the media type
  says, as browsers sniff them; an animated GIF or WebP draws its first frame, and a GIF whose first frame
  does not fill its logical screen is an error. `image/svg+xml` is read as the SVG subset below. Anything
  else is an error.
- **Chart SVG and SVG images are one strict subset.** A `.slide-chart` (from `addChart()` or
  `addChartExtension()`) is drawn from its one `<svg>`, and an `image/svg+xml` picture from its decoded
  document, both read once as the subset ECharts, the 3D bar renderer, caller SVGs and common SVG files
  use: `g` (`opacity`, `clip-path`, `transform`, inherited paint and font), `defs` with `clipPath`
  (`path`, `rect`) and `linearGradient` (bounding-box `x1 y1 x2 y2`, `stop` with `offset`/`stop-color`),
  `path` (all SVG path commands), `rect` (`rx`/`ry`), `circle`, `ellipse`, `polygon`, `polyline`, `line`,
  and single-line `text` (`x`, `y`, `text-anchor`, `dominant-baseline` `auto`/`central`, `xml:space`,
  `paint-order: stroke` halos, one font family, `font-size` in px, `font-weight` normal/bold,
  `font-style` normal/italic). Paints are `none`, `#rgb`, `#rrggbb`, `rgb()`/`rgba()`, the CSS named
  colors and `transparent`, or `url(#id)` (fill only), with `fill-opacity`, `fill-rule`,
  `stroke-opacity`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`,
  `stroke-dasharray` and `opacity`, as attributes or in `style`; transforms are lists of `matrix()`,
  `translate()`, `scale()`, `rotate()` (with an optional centre), `skewX()` and `skewY()`. `title`,
  `desc`, `metadata` and `id` draw nothing. A chart's `viewBox` maps `xMidYMid meet` into the box. An SVG
  image's document may start with a byte order mark, an XML declaration, comments and a
  `<!DOCTYPE svg …>` without an internal subset; its `<svg>` needs `xmlns="http://www.w3.org/2000/svg"`
  and is sized into the picture's rectangle as Chromium sizes an `<img>`: a `viewBox` maps by
  `preserveAspectRatio` (any alignment, `meet` or `slice`, or `none`) and ignores `width`/`height`;
  without one, px `width` and `height` stretch to the rectangle like a raster image, and without those
  its user units are px from the top-left. The drawing is clipped to the rectangle. zrender's
  `pointer-events`, `ecmeta_*` and the 3D renderer's `data-series`/`data-category` are accepted and have
  no effect. Any other element, attribute or value is an error naming the slide, the object and the
  element, never skipped: `<tspan>`, `<use>`, `<image>`, `<style>`, `href`, `url()` to anything but a
  local `#id`, filters, masks, patterns, radial gradients, units other than px and editor namespaces
  (`inkscape:*`, `sodipodi:*`) among them. An SVG image is never fetched from: an external reference is
  an error.
- **Components are drawn when they need no layout.** A `div.slide-component` (the common box with
  `position: absolute`, `overflow: hidden`, `data-component-type` and `data-component-version`) is drawn
  from its markup when that markup is nested sized boxes, the subset the repository's own drawable
  components emit (the shared fixture's HTML and React progress bars): `<div>` elements with no attribute
  but `style`, each holding at most one `<div>` (whitespace between tags is formatting), placed at its
  parent's top-left corner (the outermost at the component box's), sized by `width` and `height` (both
  required: `<n>px`, `<n>%` of the parent's width or height, or `0`) and filled by `background` (a color
  alone) or `background-color`, in the SVG subset's color forms. Each box becomes a filled rectangle,
  clipped to the component box as `overflow: hidden` clips it; a box may overflow its parent. Anything
  else needs CSS layout, which WASM does not do (#69 phase 8), and is an error naming the slide, the
  object, the component's type and version and the element or property, never skipped, even with
  `onUnsupported: "warn"`: text, a second element beside a box, any other element (`<span>`, `<b>`,
  `<svg>`, `<img>`, `<style>`, `<script>` among them), `class`, `id` or any other attribute, any other
  property (`padding`, `margin`, `border`, `display`, `box-sizing`, `font-*` among them), and a missing,
  `auto` or negative size. The repository's text components (`test/badge` in
  `tests/crossRuntimeDeck.ts`, the `acme/metric` card in `docs/COMPONENTS.md` and
  `examples/react-component.ts`) need inline and block layout, so they are errors:

    ```text
    invalid PdfLapas HTML: slide 1: object 'Component 0': component 'test/badge' v1: <strong> is not in profile v2: component markup is nested <div> boxes
    invalid PdfLapas HTML: slide 1: object 'Component 0': component 'acme/metric' v1: CSS property 'padding' on <div> is not in profile v2
    ```

- **Errors name the place.** Every error is prefixed `invalid PdfLapas HTML:` and names the slide, the object
  (its `data-object-name`, else `#<index>` on the slide) and the attribute or property; malformed markup
  names its byte offset. For example:

    ```text
    invalid PdfLapas HTML: slide 1: object 'Title': CSS property 'filter' on <div> is not in profile v2
    invalid PdfLapas HTML: profile version '3' in <meta name="pdflapas-profile"> is not supported (this renderer reads <meta name="pdfdeck-profile" content="1"> and <meta name="pdflapas-profile" content="2">)
    invalid PdfLapas HTML: slide 2: object 'Table 0': row 1: cell 1: attribute 'rowspan' is missing
    invalid PdfLapas HTML: malformed HTML at byte 6488: </body> closes <p>
    ```

- **No PptxGenJS rules.** A value missing from the HTML is an error, never a default: the defaults are the
  [completion step](#completion)'s, in TypeScript. Multi-face presets keep the base fill only on their
  unshaded face; a hand-written preset whose every face is shaded has no base fill and is rejected (#43).

## Completion

`completeProfileHtml(html)` (`render/completion.ts`, exported from `@pdflapas/pptxgenjs/html`) fills the
values a hand-written or edited document may leave out, with the value PptxGenJS gives the same object
when its option is not set (`packages/pptxgenjs/src/defaults.ts`). It is pure, deterministic and
browser-safe (parse5, no DOM): it splices each missing value into the original string, so a document that
states everything, such as any `toHtml()` result, comes back byte for byte (`tests/htmlBytes.test.ts`
checks every pinned deck), and completing twice changes nothing. Values already in the document are kept;
`.slide-chart` and `.slide-component` subtrees are not touched. When it adds the stylesheet for the default
size, it also adds `<meta name="pdflapas-page-size" content="Screen 16:9 Landscape">` (`pdfdeck-page-size` in
version 1), so the completed
document states its whole page size.

It throws when the input is not a profile document: a non-string or empty input, no
`<meta name="pdflapas-profile">` (or version 1's `pdfdeck-profile`), another version, an unknown page-size name without an `@page` rule,
or a `font-size` or `line-height` it needs for a line box that is not in px.

| Element                   | Value                                                | Default                                                                                               | From `PPTX_DEFAULTS`                                  |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| document                  | doctype                                              | `<!DOCTYPE html>` first                                                                               | (standards mode, [Document](#document))               |
| `<head>`                  | the shared stylesheet, when no `<style>` has `@page` | the stylesheet `toHtml()` writes, for the size `pdflapas-page-size` names, else Screen 16:9 Landscape | `presentation.layout` (`LAYOUT_16x9`)                 |
| `div.slide-container`     | `background-color`                                   | `#FFFFFF`                                                                                             | `slide.backgroundColor`                               |
| `.slide-text`             | `padding`                                            | `4.8…px 9.6…px 4.8…px 9.6…px` (0.05in 0.1in)                                                          | `text.marginIn`                                       |
|                           | `align-items`                                        | `center`                                                                                              | `text.valign` (`middle`)                              |
|                           | `white-space`, `overflow-wrap`                       | `pre-wrap`, `break-word`                                                                              | `text.wrap`                                           |
|                           | `data-text-fit`, `data-text-direction`               | `none`, `horizontal`                                                                                  | `text.fit`, `text.textDirection`                      |
|                           | `data-text-fit-*` on a `shrink` box                  | `step` `0.95`, `max-steps` `20`, `tolerance` `0.5`                                                    | `text.shrink`                                         |
| `.table-cell-text`        | as `.slide-text`, except `padding`                   | `4.8…px 9.6…px 4.8…px 9.6…px`                                                                         | `table.marginIn`                                      |
|                           | `align-items`                                        | `flex-start`                                                                                          | `table.valign` (`top`)                                |
| `.text-paragraph`         | `text-align`, `direction`                            | `left`, `ltr`                                                                                         | `text.align`, `text.rtlMode`                          |
|                           | `margin-top`, `margin-bottom`                        | `0px`                                                                                                 | (no `paraSpaceBefore`/`paraSpaceAfter`)               |
|                           | `tab-size`                                           | `96px`                                                                                                | `text.defaultTabStopIn`                               |
|                           | `line-height`                                        | 1.2 × the largest run `font-size` (after its own default)                                             | `text.singleLineEm`                                   |
|                           | `data-line-baseline`                                 | `line-height` − 0.2 × the largest run `font-size`                                                     | `text.lineDescentEm`                                  |
| `.text-run`               | `font-family`                                        | `"Calibri"`                                                                                           | `text.fontFace`                                       |
|                           | `font-size`                                          | `24px` (18pt); `16px` (12pt) in a table cell                                                          | `text.fontSizePt`, `table.fontSizePt`                 |
|                           | `color`                                              | `#000000`; `#0563C1` on `a.text-run`                                                                  | `text.color`, `table.color`, `theme.colors.hyperlink` |
|                           | `font-weight`, `font-style`                          | `normal`                                                                                              | `text.bold`, `text.italic`                            |
| `img.slide-image-content` | `data-image-sizing`                                  | `stretch`                                                                                             | (no `sizing` option)                                  |
|                           | `opacity`                                            | `1`                                                                                                   | `image.transparency`                                  |
| `td`                      | `colspan`, `rowspan`                                 | `1`                                                                                                   | (no `colspan`/`rowspan`)                              |
|                           | `border-top`, `-right`, `-bottom`, `-left`           | `0px none transparent`                                                                                | `table.border.type` (`none`)                          |

**Required**: everything else the reader requires stays required, because it is the deck's content
rather than a default: `<meta name="pdflapas-profile" content="2">` (or `<meta name="pdfdeck-profile" content="1">`); the element structure (`.text-content`,
`.slide-image-frame`, `<colgroup>`, `svg.shape-svg` with `<defs>` and `.shape-geometry`); each object's
`left` and `top`; a shape's `data-shape`, `viewBox` and geometry attributes (`fill`, `stroke`,
`stroke-width`, `rx`, `d`, …); an image's `src` as a `data:` URI and its box for `contain`, `cover` and
`crop`; column widths; bullets (`data-bullet-*` and the marker); and every optional value the profile
already omits at its default (`opacity` 1, no `transform`, …). The completion step adds only profile
values: layout CSS that `toHtml()` writes for Chromium (`.text-content { width: 100% }`, the image's
`width`/`height`, the cell's `padding: 0px`) is not filled, so a document that leaves it out can look
different in Puppeteer, which prints what the HTML says.

## Field mapping

Every model field has one row; `tests/htmlProfile.test.ts` reads this table and fails when a field of
`packages/model/src/types.ts` has no row, when a row names a field that no longer exists, or when a
status is not one of:

- **profile**: the value is recoverable from the HTML, where the row says.
- **gap**: lossy today; the row says why, with the code. After phase 2 only chart options and component
  props remain gaps: they stay an opaque subtree until phase 8.
- **not drawable**: the value does not change the drawing (already folded into another field, or
  provenance only).

Keys are `Type.field`. An anonymous object is named by its path (`NormalizedTextParagraph.lineBox`), a
union variant by its discriminant (`NormalizedSlideObject<text>`), an array element by `[]`. A row for an
object-valued field covers the field's presence; its own fields have their own rows.

### Presentation and slides

| Field                             | Status  | HTML                                                                         |
| --------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `NormalizedPresentation.pageSize` | profile | Stylesheet `@page` and `.slide-container` size.                              |
| `PageSize.width`                  | profile | `@page { size: <width>in … }`; `.slide-container { width: <width × 96>px }`. |
| `PageSize.height`                 | profile | `@page { size: … <height>in }`; `.slide-container { height }`.               |
| `PageSize.name`                   | profile | `<meta name="pdflapas-page-size" content="<name>">` in the head.             |
| `NormalizedPresentation.slides`   | profile | One `div.slide-container#slide-N` per slide that is not hidden, in order.    |
| `NormalizedPresentation.metadata` | profile | The [document properties](#document-properties) in the head (version 2).     |
| `PresentationMetadata.title`      | profile | `<title>`.                                                                   |
| `PresentationMetadata.author`     | profile | `<meta name="author" content>`.                                              |
| `PresentationMetadata.subject`    | profile | `<meta name="description" content>`.                                         |
| `PresentationMetadata.company`    | profile | `<meta name="pdflapas-company" content>`.                                    |
| `PresentationMetadata.revision`   | profile | `<meta name="pdflapas-revision" content>`.                                   |
| `NormalizedSlide.background`      | profile | `.slide-container` `background-color`.                                       |
| `NormalizedSlide.color`           | profile | `.slide-container` custom property `--slide-text-color` (verbatim).          |
| `NormalizedSlide.hidden`          | profile | A hidden slide has no `.slide-container`; the others keep their number N.    |
| `NormalizedSlide.objects`         | profile | The container's `.slide-element` children, in paint order.                   |

### Slide object variants

| Field                                           | Status  | HTML                                                                                     |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `NormalizedSlideObject<text>.kind`              | profile | Class `slide-text`.                                                                      |
| `NormalizedSlideObject<text>.style`             | profile | Common box on `.slide-text`; with a shape, fill, line and shadow move to the SVG.        |
| `NormalizedSlideObject<text>.text`              | profile | `.text-content` child.                                                                   |
| `NormalizedSlideObject<text>.shape`             | profile | `data-shape` on `.slide-text` and an `svg.shape-svg` first child.                        |
| `NormalizedSlideObject<shape>.kind`             | profile | Class `slide-shape`.                                                                     |
| `NormalizedSlideObject<shape>.style`            | profile | Box on `.slide-shape`; fill, line and shadow on the SVG.                                 |
| `NormalizedSlideObject<shape>.shape`            | profile | `data-shape` and the `svg.shape-svg` child.                                              |
| `NormalizedSlideObject<image>.kind`             | profile | Class `slide-image`.                                                                     |
| `NormalizedSlideObject<image>.style`            | profile | Common box on `.slide-image`.                                                            |
| `NormalizedSlideObject<image>.image`            | profile | `.slide-image-frame > img.slide-image-content`.                                          |
| `NormalizedSlideObject<table>.kind`             | profile | Class `slide-table-container`.                                                           |
| `NormalizedSlideObject<table>.style`            | profile | Common box on `.slide-table-container`.                                                  |
| `NormalizedSlideObject<table>.table`            | profile | `table.slide-table` child.                                                               |
| `NormalizedSlideObject<chart>.kind`             | profile | Class `slide-chart` (shared with `chartExtension`: both are an SVG subtree in the HTML). |
| `NormalizedSlideObject<chart>.style`            | profile | Common box on `.slide-chart`.                                                            |
| `NormalizedSlideObject<chart>.chart`            | gap     | Only the drawn SVG; see the `NormalizedChart` rows (`render/chart.ts:398-402`).          |
| `NormalizedSlideObject<chartExtension>.kind`    | profile | Class `slide-chart` (same as `chart`).                                                   |
| `NormalizedSlideObject<chartExtension>.style`   | profile | Common box on `.slide-chart`.                                                            |
| `NormalizedSlideObject<chartExtension>.svg`     | profile | The `svg` child (ids prefixed with the object name, `width`/`height` set to 100%).       |
| `NormalizedSlideObject<chartExtension>.altText` | profile | `aria-label` on `.slide-chart`, omitted when empty.                                      |
| `NormalizedSlideObject<component>.kind`         | profile | Class `slide-component`.                                                                 |
| `NormalizedSlideObject<component>.style`        | profile | Common box on `.slide-component`.                                                        |
| `NormalizedSlideObject<component>.component`    | profile | `data-component-*` and the rendered markup.                                              |
| `ComponentInput.type`                           | profile | `data-component-type`.                                                                   |
| `ComponentInput.version`                        | profile | `data-component-version`.                                                                |
| `ComponentInput.props`                          | gap     | Only the markup the definition rendered from them (`render/component.ts:11-21`).         |

### Object style

| Field                              | Status  | HTML                                                                                                                                                                        |
| ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NormalizedObjectStyle.geometry`   | profile | `left`, `top`, `width`, `height` on the `.slide-element`.                                                                                                                   |
| `NormalizedGeometry.x`             | profile | `left: <x>px`.                                                                                                                                                              |
| `NormalizedGeometry.y`             | profile | `top: <y>px`.                                                                                                                                                               |
| `NormalizedGeometry.width`         | profile | `width: <w>px`; omitted when undefined.                                                                                                                                     |
| `NormalizedGeometry.height`        | profile | `height: <h>px`; `min-height` with `height: auto` for text with `fit: resize`.                                                                                              |
| `NormalizedObjectStyle.transform`  | profile | `transform`, `opacity` (`transform-origin: center` always).                                                                                                                 |
| `NormalizedTransform.rotation`     | profile | `transform: rotate(<deg>deg)`, omitted at 0.                                                                                                                                |
| `NormalizedTransform.flipH`        | profile | `scaleX(-1)` in `transform`.                                                                                                                                                |
| `NormalizedTransform.flipV`        | profile | `scaleY(-1)` in `transform`.                                                                                                                                                |
| `NormalizedTransform.opacity`      | profile | `opacity`, omitted at 1.                                                                                                                                                    |
| `NormalizedObjectStyle.fill`       | profile | `background-color` on the box; SVG `fill` on the geometry for shapes and text with a shape.                                                                                 |
| `NormalizedFill.visible`           | profile | `background-color: transparent` or SVG `fill="none"` when false.                                                                                                            |
| `NormalizedFill.color`             | profile | `background-color`, SVG `fill`; a table cell's `td` `background-color`.                                                                                                     |
| `NormalizedObjectStyle.line`       | profile | SVG `stroke*` for shapes; `border-color`, `border-width`, `border-style` on other boxes.                                                                                    |
| `NormalizedLine.visible`           | profile | SVG `stroke="none"`, `stroke-width="0"`; `border-style: none`.                                                                                                              |
| `NormalizedLine.color`             | profile | SVG `stroke`; `border-color`; arrow marker `fill`.                                                                                                                          |
| `NormalizedLine.width`             | profile | SVG `stroke-width` (px, `vector-effect="non-scaling-stroke"`); `border-width`.                                                                                              |
| `NormalizedLine.style`             | profile | `border-style` on boxes; on SVG implied by `stroke-dasharray`.                                                                                                              |
| `NormalizedLine.dashArray`         | profile | SVG `stroke-dasharray` on the element that draws the outline, verbatim (the print step [rewrites](#renderer-workarounds) a gap-first one); `data-line-dash-array` on a box. |
| `NormalizedLine.beginArrow`        | profile | `data-line-begin-arrow` on the element that carries the line.                                                                                                               |
| `NormalizedLine.endArrow`          | profile | `data-line-end-arrow` on the element that carries the line.                                                                                                                 |
| `NormalizedLine.beginHeadPath`     | profile | `marker-start="url(#line-head-…)"`; the marker's `path d`.                                                                                                                  |
| `NormalizedLine.endHeadPath`       | profile | `marker-end="url(#line-head-…)"`; the marker's `path d`.                                                                                                                    |
| `NormalizedObjectStyle.shadow`     | profile | `box-shadow` on boxes; `filter: drop-shadow(…)` on `svg.shape-svg`.                                                                                                         |
| `NormalizedShadow.visible`         | profile | Presence of the `box-shadow`, `drop-shadow` or `text-shadow` entry.                                                                                                         |
| `NormalizedShadow.color`           | profile | Last part of the shadow value (`rgba()`, as in the model).                                                                                                                  |
| `NormalizedShadow.blur`            | profile | Third length of the shadow value, px.                                                                                                                                       |
| `NormalizedShadow.offsetX`         | profile | First length of the shadow value, px.                                                                                                                                       |
| `NormalizedShadow.offsetY`         | profile | Second length of the shadow value, px.                                                                                                                                      |
| `NormalizedShadow.inset`           | profile | `inset` in `box-shadow`; `data-shadow-inset` on the run, or on `svg.shape-svg` in hand-written HTML only (`addShape` throws on it).                                         |
| `NormalizedObjectStyle.objectName` | profile | `data-object-name`.                                                                                                                                                         |

### Text

| Field                                          | Status       | HTML                                                                                                                       |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `NormalizedTextBox.paragraphs`                 | profile      | `div.text-paragraph` children of `.text-content`.                                                                          |
| `NormalizedTextBox.margin`                     | profile      | `padding: <top>px <right>px <bottom>px <left>px` on the box.                                                               |
| `NormalizedTextBox.verticalAlign`              | profile      | `align-items: flex-start\|center\|flex-end`; also `vertical-align` on a table cell's `td`.                                 |
| `NormalizedTextBox.wrap`                       | profile      | `white-space: pre-wrap\|pre` (and `overflow-wrap`).                                                                        |
| `NormalizedTextBox.fit`                        | profile      | `data-text-fit`; a `shrink` box adds its rule, `data-text-fit-step`, `-max-steps` and `-tolerance`.                        |
| `NormalizedTextBox.direction`                  | profile      | `data-text-direction` (plus `writing-mode`/`text-orientation` on `.text-content`).                                         |
| `NormalizedTextBox.rtl`                        | profile      | `direction: rtl\|ltr` on the box.                                                                                          |
| `NormalizedTextParagraph.runs`                 | profile      | `.text-run` children (`span`, or `a` when linked).                                                                         |
| `NormalizedTextParagraph.align`                | profile      | `text-align`.                                                                                                              |
| `NormalizedTextParagraph.rtl`                  | profile      | `direction: rtl\|ltr` on the paragraph.                                                                                    |
| `NormalizedTextParagraph.lineHeight`           | not drawable | Input of `lineBox` (`normalize/text.ts:314-318`); the line box is what is drawn.                                           |
| `NormalizedTextParagraph.lineBox`              | profile      | `line-height` and `data-line-baseline` on the paragraph; the strut and the shift are [workarounds](#renderer-workarounds). |
| `NormalizedTextParagraph.lineBox.height`       | profile      | `line-height: <height>px` on the paragraph.                                                                                |
| `NormalizedTextParagraph.lineBox.baseline`     | profile      | `data-line-baseline` on the paragraph (px from the line top), verbatim; the target decides it (`spacedLineBaseline`).      |
| `NormalizedTextParagraph.spaceBefore`          | profile      | `margin-top`; the PowerPoint target adds the previous paragraph's space after, and has `0px` on the first paragraph.       |
| `NormalizedTextParagraph.spaceAfter`           | profile      | `margin-bottom`; `0px` on a box's last paragraph, and on every paragraph with the PowerPoint target, which adds the two.   |
| `NormalizedTextParagraph.tabStops`             | profile      | `data-tab-stops="<position>:<alignment>,…"`, omitted when empty.                                                           |
| `NormalizedTextParagraph.tabStops[].position`  | profile      | `<position>` in `data-tab-stops`, px.                                                                                      |
| `NormalizedTextParagraph.tabStops[].alignment` | profile      | `<alignment>` in `data-tab-stops`.                                                                                         |
| `NormalizedTextParagraph.defaultTabStop`       | profile      | `tab-size: <n>px`.                                                                                                         |
| `NormalizedTextParagraph.bullet`               | profile      | `span.text-bullet` first child and `data-bullet-*`.                                                                        |
| `NormalizedTextBullet.kind`                    | profile      | `data-bullet-type="bullet\|number"`.                                                                                       |
| `NormalizedTextBullet.marker`                  | profile      | `.text-bullet` text, minus the trailing U+00A0.                                                                            |
| `NormalizedTextBullet.indent`                  | profile      | `data-bullet-indent` (px), verbatim; the marker `width` and `padding-left` are `indent / (level + 1)` and its multiple.    |
| `NormalizedTextBullet.level`                   | profile      | `data-bullet-level`.                                                                                                       |
| `NormalizedTextBullet.start`                   | profile      | `data-bullet-start`; the marker text is already numbered from it.                                                          |
| `NormalizedTextBullet.numberType`              | profile      | `data-bullet-number-type`, the PptxGenJS name (`arabicPeriod`, `romanLcParenR`, …), omitted when unset.                    |
| `NormalizedTextRun.text`                       | profile      | Run text content. An empty run holds U+200B and has `data-empty`.                                                          |
| `NormalizedTextRun.fontFace`                   | profile      | `font-family`: only the face, a CSS string (unescape `\\` and `\"`); fallbacks are a [workaround](#renderer-workarounds).  |
| `NormalizedTextRun.fontSize`                   | profile      | `font-size: <n>px` (already the sub/superscript size).                                                                     |
| `NormalizedTextRun.color`                      | profile      | `color`.                                                                                                                   |
| `NormalizedTextRun.bold`                       | profile      | `font-weight: bold\|normal`.                                                                                               |
| `NormalizedTextRun.italic`                     | profile      | `font-style: italic\|normal`.                                                                                              |
| `NormalizedTextRun.decoration`                 | profile      | `text-decoration-*`.                                                                                                       |
| `NormalizedTextDecoration.underline`           | profile      | `underline` in `text-decoration-line`.                                                                                     |
| `NormalizedTextDecoration.underlineStyle`      | profile      | `text-decoration-style`; `data-underline-style` when `data-double-strike` replaced it with `double`.                       |
| `NormalizedTextDecoration.underlineColor`      | profile      | `text-decoration-color`.                                                                                                   |
| `NormalizedTextDecoration.strike`              | profile      | `line-through` in `text-decoration-line`.                                                                                  |
| `NormalizedTextDecoration.doubleStrike`        | profile      | `data-double-strike` on the run (`text-decoration-style: double` draws it).                                                |
| `NormalizedTextRun.verticalAlign`              | profile      | `data-vertical-align="sub                                                                                                  | super"`, omitted at `baseline`. |
| `NormalizedTextRun.baselineOffset`             | profile      | `position: relative; top: <-offset>px`, omitted at 0.                                                                      |
| `NormalizedTextRun.characterSpacing`           | profile      | `letter-spacing`, omitted at 0.                                                                                            |
| `NormalizedTextRun.kerning`                    | profile      | `font-kerning: none` when `false` (PowerPoint target), omitted when kerned.                                                |
| `NormalizedTextRun.highlight`                  | profile      | `background-color` on the run.                                                                                             |
| `NormalizedTextRun.outline`                    | profile      | `-webkit-text-stroke: <width>px <color>`.                                                                                  |
| `NormalizedTextRun.outline.color`              | profile      | Color of `-webkit-text-stroke`.                                                                                            |
| `NormalizedTextRun.outline.width`              | profile      | Width of `-webkit-text-stroke`, px.                                                                                        |
| `NormalizedTextRun.glow`                       | profile      | The `text-shadow` entry that `data-text-shadow` names `glow`.                                                              |
| `NormalizedTextRun.shadow`                     | profile      | The `text-shadow` entry that `data-text-shadow` names `shadow`.                                                            |
| `NormalizedTextRun.language`                   | profile      | `lang`.                                                                                                                    |
| `NormalizedTextRun.link`                       | profile      | The run is an `a`.                                                                                                         |
| `NormalizedTextLink.href`                      | profile      | `href`.                                                                                                                    |
| `NormalizedTextLink.tooltip`                   | profile      | `title`.                                                                                                                   |
| `NormalizedTextLink.slide`                     | profile      | `data-slide`.                                                                                                              |
| `NormalizedTextRun.softBreakBefore`            | profile      | `data-soft-break-before` on the run; a `<br>` before it unless it is the first run.                                        |

### Shapes

| Field                                                | Status       | HTML                                                                                          |
| ---------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `NormalizedShape.name`                               | profile      | `data-shape`.                                                                                 |
| `NormalizedShape.width`                              | profile      | SVG `viewBox` width; `data-shape-width` on the `svg` when the viewBox clamps it to 0.001.     |
| `NormalizedShape.height`                             | profile      | SVG `viewBox` height; `data-shape-height` on the `svg` when it is 0 (the viewBox uses 1).     |
| `NormalizedShape.geometry`                           | profile      | `.shape-geometry` element.                                                                    |
| `NormalizedShapeGeometry<rect>.kind`                 | profile      | `rect.shape-geometry`.                                                                        |
| `NormalizedShapeGeometry<rect>.radius`               | profile      | `rx` and `ry`.                                                                                |
| `NormalizedShapeGeometry<ellipse>.kind`              | profile      | `ellipse.shape-geometry` (`cx`, `cy`, `rx`, `ry` from the size).                              |
| `NormalizedShapeGeometry<line>.kind`                 | profile      | `path.shape-geometry` with a single `M … L …` segment and `fill="none"`.                      |
| `NormalizedShapeGeometry<line>.inverse`              | profile      | `d="M 0 H L W 0"` instead of `M 0 0 L W H`.                                                   |
| `NormalizedShapeGeometry<path>.kind`                 | profile      | `path.shape-geometry`, or `g.shape-geometry` with faces.                                      |
| `NormalizedShapeGeometry<path>.data`                 | profile      | `d` of `path.shape-geometry`.                                                                 |
| `NormalizedShapeGeometry<path>.transform`            | profile      | `transform` attribute of the path or group.                                                   |
| `NormalizedShapeGeometry<path>.faces`                | profile      | `path.shape-face` children of `g.shape-geometry`.                                             |
| `NormalizedShapeGeometry<path>.faces[].data`         | profile      | `d` of the face.                                                                              |
| `NormalizedShapeGeometry<path>.faces[].fillModifier` | profile      | `data-fill-modifier`; the face `fill` already applies it (#43).                               |
| `NormalizedShapeGeometry<path>.outlineData`          | profile      | `d` of `path.shape-outline`, which carries the stroke.                                        |
| `NormalizedShape.textInsets`                         | not drawable | The preset's ECMA-376 text rectangle (`presetTextInsets`), folded into the text box `margin`. |
| `NormalizedShape.link`                               | profile      | The `.slide-shape` is an `a`.                                                                 |
| `NormalizedShapeLink.href`                           | profile      | `href`.                                                                                       |
| `NormalizedShapeLink.tooltip`                        | profile      | `title`.                                                                                      |
| `NormalizedShapeLink.slide`                          | profile      | `data-slide`.                                                                                 |

### Images

| Field                                          | Status       | HTML                                                                          |
| ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `NormalizedImage.source`                       | profile      | `img` `src`, always a `data:` URI once `toHtml()` resolved it.                |
| `NormalizedImage.sourceKind`                   | not drawable | Provenance only: `toHtml()` inlines every image (`render/document.ts:37-45`). |
| `NormalizedImage.sizing`                       | profile      | `data-image-sizing` and the `img` box.                                        |
| `NormalizedImageSizing<stretch>.type`          | profile      | `data-image-sizing="stretch"`; `img` `width: 100%; height: 100%`.             |
| `NormalizedImageSizing<contain\|cover>.type`   | profile      | `data-image-sizing="contain\|cover"`.                                         |
| `NormalizedImageSizing<contain\|cover>.x`      | profile      | `img` `left`.                                                                 |
| `NormalizedImageSizing<contain\|cover>.y`      | profile      | `img` `top`.                                                                  |
| `NormalizedImageSizing<contain\|cover>.width`  | profile      | `img` `width`.                                                                |
| `NormalizedImageSizing<contain\|cover>.height` | profile      | `img` `height`.                                                               |
| `NormalizedImageSizing<crop>.type`             | profile      | `data-image-sizing="crop"`.                                                   |
| `NormalizedImageSizing<crop>.offsetX`          | profile      | `img` `left: <-offsetX>px`.                                                   |
| `NormalizedImageSizing<crop>.offsetY`          | profile      | `img` `top: <-offsetY>px`.                                                    |
| `NormalizedImageSizing<crop>.width`            | profile      | `img` `width`.                                                                |
| `NormalizedImageSizing<crop>.height`           | profile      | `img` `height`.                                                               |
| `NormalizedImage.rounding`                     | profile      | `border-radius: 50%` on the object and the frame.                             |
| `NormalizedImage.opacity`                      | profile      | `img` `opacity` (always written).                                             |
| `NormalizedImage.altText`                      | profile      | `img` `alt` and the object's `aria-label`.                                    |
| `NormalizedImage.link`                         | profile      | The `.slide-image` is an `a`.                                                 |
| `NormalizedImageLink.href`                     | profile      | `href`.                                                                       |
| `NormalizedImageLink.tooltip`                  | profile      | `title`.                                                                      |
| `NormalizedImageLink.slide`                    | profile      | `data-slide`.                                                                 |

### Tables

| Field                             | Status  | HTML                                                                                           |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `NormalizedTable.width`           | profile | `table.slide-table` `width`.                                                                   |
| `NormalizedTable.height`          | profile | `table.slide-table` `height`, omitted when undefined.                                          |
| `NormalizedTable.columns`         | profile | One `col` per column with `width: <n>px`.                                                      |
| `NormalizedTable.rows`            | profile | One `tr` per row.                                                                              |
| `NormalizedTable.contentRowSlack` | profile | Added to the `.table-cell-text` `padding` of rows without a height, by vertical anchor.        |
| `NormalizedTableRow.height`       | profile | `tr` `height`, omitted when undefined.                                                         |
| `NormalizedTableRow.cells`        | profile | `td` children.                                                                                 |
| `NormalizedTableCell.text`        | profile | `div.table-cell-text`, a text box as for text objects.                                         |
| `NormalizedTableCell.colspan`     | profile | `colspan`.                                                                                     |
| `NormalizedTableCell.rowspan`     | profile | `rowspan`.                                                                                     |
| `NormalizedTableCell.fill`        | profile | `td` `background-color`, omitted when hidden.                                                  |
| `NormalizedTableCell.borders`     | profile | `border-top`, `border-right`, `border-bottom`, `border-left` on the `td`, in that order.       |
| `NormalizedTableBorder.visible`   | profile | `<width>px <style> <color>` when true, `transparent` (from `0px none transparent`) when false. |
| `NormalizedTableBorder.color`     | profile | Color of the side's `border-*`.                                                                |
| `NormalizedTableBorder.width`     | profile | Width of the side's `border-*`, px.                                                            |
| `NormalizedTableBorder.style`     | profile | `solid\|dashed` in the side's `border-*`.                                                      |
| `NormalizedTableBorder.dashArray` | profile | `data-border-<side>-dash-array` on the `td`, verbatim (the CSS border is only `dashed`).       |

### Charts

The chart's options drive ECharts or the 3D bar renderer; the HTML keeps only the SVG they produce
(`render/chart.ts:398-402`). WASM draws that SVG ([Parsing (WASM)](#parsing-wasm)), not the options.

| Field                                      | Status  | HTML                                                         |
| ------------------------------------------ | ------- | ------------------------------------------------------------ |
| `NormalizedChart.altText`                  | profile | `aria-label` on `.slide-chart`, omitted when empty.          |
| `NormalizedChart.type`                     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.series`                   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.type`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.name`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.labels`             | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.values`             | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.sizes`              | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.colorIndex`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.varyColors`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartSeries.valueAxisIndex`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.colors`                   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.colorOpacity`             | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.showLegend`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.legendPosition`           | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.showTitle`                | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.title`                    | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.fontFace`                 | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.fontSize`                 | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.titleFontFace`            | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.titleFontSize`            | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.titleBold`                | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.titleColor`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.legendFontFace`           | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.legendFontSize`           | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.legendColor`              | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.barDirection`             | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.grouping`                 | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.barGapWidthPercent`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.barGapDepthPercent`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.bar3DShape`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.perspective3D`            | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.rightAngleAxes3D`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.rotationX3D`              | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.rotationY3D`              | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.gridLineColor`            | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.gridLineWidth`            | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.axisLineVisible`          | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.categoryMajorTickMark`    | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.valueAxisMinimum`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.valueAxisMaximum`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.valueAxes`                | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.minimum`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.maximum`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.hidden`          | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.showTitle`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.title`           | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.titleColor`      | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.titleFontFace`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.titleFontSize`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.titleRotate`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelColor`      | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelFontFace`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelFontSize`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelBold`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelItalic`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelRotate`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelPosition`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.labelFormatCode` | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.lineColor`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.lineWidth`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.lineStyle`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.lineVisible`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.majorTickMark`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.minorTickMark`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.majorUnit`       | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.logScaleBase`    | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.gridLineColor`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.gridLineWidth`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.gridLineStyle`   | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChartValueAxis.gridLineCap`     | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.doughnutHoleSize`         | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.firstSliceAngle`          | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.radarStyle`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.lineSmooth`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.lineSymbol`               | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.lineSymbolSize`           | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
| `NormalizedChart.lineSize`                 | gap     | Not in the HTML: only the drawn SVG (see [Charts](#charts)). |
