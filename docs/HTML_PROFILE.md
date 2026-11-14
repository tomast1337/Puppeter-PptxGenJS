# pdfdeck HTML profile, version 1

This document specifies the HTML that `toHtml()` emits as the mapping from each field of the JSON model
(`packages/model/src/types.ts`) to the element, class, CSS property or attribute that holds it. Version 1
describes today's output exactly, including the values it loses. It is phase 1 of #69; later phases
change the output and this document together.

Version 1 still changes while nothing reads it from outside: no package publishes it and there is no
public HTML entry yet. It is frozen when phase 7 (`renderHtml(html)` on both backends) ships; after
that, a change to the markup needs a new version number.

## Pipeline

The target pipeline (#69) has two intermediate representations in a line:

```text
PptxGenJS API -> JSON model (IR 1, getModel()) -> HTML (IR 2, this profile) -> Puppeteer -> PDF
                                                                            \-> WASM      -> PDF
```

The model is the public schema; the HTML is derived from it by one pure, deterministic function, and
both backends read only the HTML.

- **The model is the only source of truth.** Each `add*` call writes only the model. `toHtml()` is
  `modelToHtml(getModel())` (`render/document.ts`), exported from `@pdfdeck/pptxgenjs/html` for producers
  that build the model themselves: it writes the whole document at once as strings, without a DOM,
  inlines images through `resolveImage`, and renders components with the caller's registry. Only a
  component that reads `context.document` gets a document, from the caller's `createDocument`.
  `pres.page` is only the input document of `tableToSlides(tableId)`; slides are not written into it,
  so editing it changes neither the HTML nor the PDF.
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
  suffix in CSS and without a unit in SVG attributes. Only `@page` uses inches. Angles are `deg`;
  `border-radius` on text boxes is a percentage.
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
  `text-decoration-line` when there is none, `transform` when there is no rotation or flip.

## Document

```html
<!DOCTYPE html>
<html>
    <head>
        <meta name="pdfdeck-profile" content="1" />
        <meta name="pdfdeck-page-size" content="Screen 16:9 Landscape" />
        <style id="puppeteer-gen-styles">
            /* presentationCSS(pageSize), render/slide.ts:103 */
        </style>
    </head>
    <body>
        <div class="slide-container" id="slide-1" style="background-color: …; --slide-text-color: …" data-hidden="false">
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
- `<meta name="pdfdeck-profile" content="1">` names the profile version this document follows
  (`HTML_PROFILE_VERSION`, `render/slide.ts`).
- `<meta name="pdfdeck-page-size">` holds the page size's name (`PageSize.name`); the size itself is in
  the stylesheet.
- There is no `<title>`, `<script>` or external resource. Every image is a `data:` URI by the time
  `toHtml()` returns (`modelToHtml`, `render/document.ts`).

## Slide

`div.slide-container#slide-N` (N from 1) is one page: `position: relative`, `overflow: hidden`, the page
size from the stylesheet. Children are the slide's objects in model order, which is also paint order.

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
<div class="slide-element slide-text" style="…box…; padding; align-items; white-space; overflow-wrap; direction; border-radius" data-object-name="Text 1" data-text-fit="none" data-text-direction="horizontal">
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
height becomes `min-height` and `height: auto`. A soft break is a `<br>` before the run and
`data-soft-break-before` on it. A run is an `a` when it has a link, a `span` otherwise. Model values that
CSS cannot state exactly are `data-*` on the run: `data-vertical-align` (`sub`, `super`),
`data-text-shadow` (which `text-shadow` entry is the `glow` and which the `shadow`), `data-double-strike`
with `data-underline-style`, and `data-empty` on an empty run (its text is U+200B).

### Shape

```html
<div class="slide-element slide-shape" style="…box without fill, line or shadow…" data-object-name="Shape 0" data-shape="rect">
    <svg class="shape-svg" viewBox="0 0 W H" width="100%" height="100%" preserveAspectRatio="none" style="overflow: visible; --print-snap-offset: translate(…); filter: drop-shadow(…)">
        <defs>
            <marker id="line-head-…" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="…" fill="…" /></marker>
        </defs>
        <rect|ellipse|path|g class="shape-geometry" fill="…" stroke="…" stroke-width="…" vector-effect="non-scaling-stroke" stroke-dasharray="…" marker-start="url(#…)" marker-end="url(#…)" />
    </svg>
</div>
```

`render/shape.ts`. Fill, line and shadow live on the SVG, not in CSS. Geometry: `rect` with `rx`/`ry`,
`ellipse`, a `path` for lines (`M 0 0 L W H`, or `M 0 H L W 0` when inverse) and preset or custom paths
(`d`, optional `transform`). A multi-face preset is a `g` with one `path.shape-face` per face (its final
fill already computed, plus `data-fill-modifier`) and a `path.shape-outline` that carries the stroke.
Arrow heads are markers whose id spells out the color and path, so equal heads share one id.

A text object with a shape is a `.slide-text` with `data-shape` whose first child is the same
`svg.shape-svg`, drawn behind `.text-content`; the box itself then has no fill, border or shadow.

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
    <table class="slide-table" style="width; height; table-layout: fixed; border-collapse: collapse; border-spacing: 0px; position: relative; left; top">
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

`render/table.ts`. A cell's text box is the text renderer's output on `.table-cell-text`. Borders are
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
in the HTML. Component images are resolved to `data:` URIs like slide images.

## Renderer workarounds

Chromium needs declarations that LibreOffice does not to print what LibreOffice draws. They are not deck
content: each is derived from a value the profile states once, so it lives outside the markup, either in
the shared stylesheet (driven by profile classes and attributes) or in the Puppeteer print step,
`applyPrintWorkarounds` (`packages/puppeteer/src/printWorkarounds.ts`), which runs once in the page after
`setContent` and before shrink-to-fit and `page.pdf()`. Opening the HTML in a browser shows the
stylesheet rules but not the print step. A parser of this profile never sees either.

| Workaround     | Derived from                                                     | Where it lives                                                                                                                                                |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line-box strut | `line-height` on `.text-paragraph`                               | Stylesheet: `.text-paragraph { font-size: 0 }` and `.text-run, .text-bullet { line-height: 0 }`, so each line is exactly `line-height` tall, baseline centred |
| Baseline shift | `line-height` and `data-line-baseline` on a horizontal paragraph | Print step: `position: relative; top: <baseline - line-height / 2>px`, read from the raw `style` attribute at full precision                                  |

These are still inline and **move out in phase 6**; a parser accepts and ignores them:

| Workaround   | Where in the HTML                                                                            | Code                                        |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Print snap   | `--print-snap-offset` on `svg.shape-svg`, applied by `@media print .shape-svg { transform }` | `render/shape.ts:97-128`, `render/slide.ts` |
| Dash rewrite | `stroke-dasharray` + `stroke-dashoffset` when a dash pattern starts with a gap               | `render/shape.ts:148-156`                   |
| Table offset | `table.slide-table` `position: relative; left/top: -<max border width / 2>px`                | `render/table.ts:19-26`                     |

Other Chromium-specific details that phase 2 or 6 revisits: the font fallback list in `font-family`
(`render/text.ts:10-17`), `z-index: 0` stacking contexts (stylesheet), the clamped `viewBox` and
`height="1"` for zero-height lines (`render/shape.ts:117-119`), U+200B for empty runs
(`render/text.ts:70`).

## Parsing (WASM)

`Renderer::render_html` (`renderHtml` in `crates/pdf-wasm`, `WasmRenderer.render(document)` in
`@pdfdeck/wasm`) reads version 1 with a hand-written tokenizer, not a general HTML parser
(`crates/pdf-core/src/profile/`: `dom.rs` tokenizes, `style.rs` reads inline CSS, one file per object kind
maps the elements onto the `model.rs` structs the drawing code reads). It is the only input of the WASM
backend.

- **Version.** `<meta name="pdfdeck-profile" content="1">` is required; a missing tag or another version
  is an error.
- **Markup is what the serializer writes.** Every element is closed by its own end tag, `/>` only ends void
  and SVG elements, attributes are not repeated, character references are `&amp; &lt; &gt; &quot; &apos;
&nbsp;` and numeric ones. HTML a browser would repair (a stray end tag, `<td>` outside `<tr>`, text
  between objects) is an error. Nesting depth does not recurse, so deep input cannot overflow the stack.
- **Only the profile.** Each element accepts the attributes and inline CSS properties this document lists
  for it (including the [renderer workarounds](#renderer-workarounds) still inline, which are accepted and ignored) and
  reads each value from its one place. Any other attribute, property, element, enumerated value or a
  repeated property is an error. Numbers are JSON numbers with their unit (`px`, `deg`, `in`); `NaN`,
  infinities and values outside `f32` are errors.
- **Images are `data:` URIs.** The parser fetches nothing; a path or URL in `src` is an error (`toHtml()`
  always inlines images).
- **Charts and components are opaque.** `.slide-chart` and `.slide-component` subtrees are only checked for
  well-formed markup and reported through `warnings()` as `object kind 'chart'` / `'component'` not
  rendered. `addChartExtension()` objects are `.slide-chart` too, so they are
  reported as `'chart'` rather than `'chartExtension'`.
- **Errors name the place.** Every error is prefixed `invalid pdfdeck HTML:` and names the slide, the object
  (its `data-object-name`, else `#<index>` on the slide) and the attribute or property; malformed markup
  names its byte offset. For example:

    ```text
    invalid pdfdeck HTML: slide 1: object 'Title': CSS property 'filter' on <div> is not in profile v1
    invalid pdfdeck HTML: pdfdeck profile version '2' is not supported (this renderer reads version 1)
    invalid pdfdeck HTML: slide 2: object 'Table 0': row 1: cell 1: attribute 'rowspan' is missing
    invalid pdfdeck HTML: malformed HTML at byte 6488: </body> closes <p>
    ```

- **No PptxGenJS rules.** A value missing from the HTML is an error, never a default. Multi-face presets keep
  the base fill only on their unshaded face; a hand-written preset whose every face is shaded has no base
  fill and is rejected (#43).

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
| `PageSize.name`                   | profile | `<meta name="pdfdeck-page-size" content="<name>">` in the head.              |
| `NormalizedPresentation.slides`   | profile | One `div.slide-container#slide-N` per slide, in order.                       |
| `NormalizedSlide.background`      | profile | `.slide-container` `background-color`.                                       |
| `NormalizedSlide.color`           | profile | `.slide-container` custom property `--slide-text-color` (verbatim).          |
| `NormalizedSlide.hidden`          | profile | `.slide-container` `data-hidden="true\|false"`.                              |
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
| `NormalizedLine.dashArray`         | profile | `data-line-dash-array` on the element that carries the line (`svg.shape-svg` or the box), verbatim; the drawn `stroke-dasharray` may be [rewritten](#renderer-workarounds). |
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
| `NormalizedShadow.inset`           | profile | `inset` keyword in `box-shadow`; `data-shadow-inset` on `svg.shape-svg` or the run, whose `drop-shadow()` / `text-shadow` cannot say it.                                    |
| `NormalizedObjectStyle.objectName` | profile | `data-object-name`.                                                                                                                                                         |

### Text

| Field                                          | Status       | HTML                                                                                                                       |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `NormalizedTextBox.paragraphs`                 | profile      | `div.text-paragraph` children of `.text-content`.                                                                          |
| `NormalizedTextBox.margin`                     | profile      | `padding: <top>px <right>px <bottom>px <left>px` on the box.                                                               |
| `NormalizedTextBox.verticalAlign`              | profile      | `align-items: flex-start\|center\|flex-end`; also `vertical-align` on a table cell's `td`.                                 |
| `NormalizedTextBox.wrap`                       | profile      | `white-space: pre-wrap\|pre` (and `overflow-wrap`).                                                                        |
| `NormalizedTextBox.fit`                        | profile      | `data-text-fit`.                                                                                                           |
| `NormalizedTextBox.direction`                  | profile      | `data-text-direction` (plus `writing-mode`/`text-orientation` on `.text-content`).                                         |
| `NormalizedTextBox.rtl`                        | profile      | `direction: rtl\|ltr` on the box.                                                                                          |
| `NormalizedTextBox.borderRadius`               | profile      | `border-radius: <n>%` on the box.                                                                                          |
| `NormalizedTextParagraph.runs`                 | profile      | `.text-run` children (`span`, or `a` when linked).                                                                         |
| `NormalizedTextParagraph.align`                | profile      | `text-align`.                                                                                                              |
| `NormalizedTextParagraph.rtl`                  | profile      | `direction: rtl\|ltr` on the paragraph.                                                                                    |
| `NormalizedTextParagraph.lineHeight`           | not drawable | Input of `lineBox` (`normalize/text.ts:314-318`); the line box is what is drawn.                                           |
| `NormalizedTextParagraph.lineBox`              | profile      | `line-height` and `data-line-baseline` on the paragraph; the strut and the shift are [workarounds](#renderer-workarounds). |
| `NormalizedTextParagraph.lineBox.height`       | profile      | `line-height: <height>px` on the paragraph.                                                                                |
| `NormalizedTextParagraph.lineBox.baseline`     | profile      | `data-line-baseline` on the paragraph (px from the line top), verbatim.                                                    |
| `NormalizedTextParagraph.spaceBefore`          | profile      | `margin-top`.                                                                                                              |
| `NormalizedTextParagraph.spaceAfter`           | profile      | `margin-bottom`.                                                                                                           |
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
| `NormalizedTextRun.fontFace`                   | profile      | First family of `font-family`, a CSS string (unescape `\\` and `\"`); the fallback list after it is renderer-only.         |
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

| Field                                                | Status       | HTML                                                                                      |
| ---------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `NormalizedShape.name`                               | profile      | `data-shape`.                                                                             |
| `NormalizedShape.width`                              | profile      | SVG `viewBox` width; `data-shape-width` on the `svg` when the viewBox clamps it to 0.001. |
| `NormalizedShape.height`                             | profile      | SVG `viewBox` height; `data-shape-height` on the `svg` when it is 0 (the viewBox uses 1). |
| `NormalizedShape.geometry`                           | profile      | `.shape-geometry` element.                                                                |
| `NormalizedShapeGeometry<rect>.kind`                 | profile      | `rect.shape-geometry`.                                                                    |
| `NormalizedShapeGeometry<rect>.radius`               | profile      | `rx` and `ry`.                                                                            |
| `NormalizedShapeGeometry<ellipse>.kind`              | profile      | `ellipse.shape-geometry` (`cx`, `cy`, `rx`, `ry` from the size).                          |
| `NormalizedShapeGeometry<line>.kind`                 | profile      | `path.shape-geometry` with a single `M … L …` segment and `fill="none"`.                  |
| `NormalizedShapeGeometry<line>.inverse`              | profile      | `d="M 0 H L W 0"` instead of `M 0 0 L W H`.                                               |
| `NormalizedShapeGeometry<path>.kind`                 | profile      | `path.shape-geometry`, or `g.shape-geometry` with faces.                                  |
| `NormalizedShapeGeometry<path>.data`                 | profile      | `d` of `path.shape-geometry`.                                                             |
| `NormalizedShapeGeometry<path>.transform`            | profile      | `transform` attribute of the path or group.                                               |
| `NormalizedShapeGeometry<path>.faces`                | profile      | `path.shape-face` children of `g.shape-geometry`.                                         |
| `NormalizedShapeGeometry<path>.faces[].data`         | profile      | `d` of the face.                                                                          |
| `NormalizedShapeGeometry<path>.faces[].fillModifier` | profile      | `data-fill-modifier`; the face `fill` already applies it (#43).                           |
| `NormalizedShapeGeometry<path>.outlineData`          | profile      | `d` of `path.shape-outline`, which carries the stroke.                                    |
| `NormalizedShape.textInsets`                         | not drawable | Folded into the text box `margin` during normalization (`normalize/shape.ts:2253-2255`).  |
| `NormalizedShape.link`                               | profile      | The `.slide-shape` is an `a`.                                                             |
| `NormalizedShapeLink.href`                           | profile      | `href`.                                                                                   |
| `NormalizedShapeLink.tooltip`                        | profile      | `title`.                                                                                  |
| `NormalizedShapeLink.slide`                          | profile      | `data-slide`.                                                                             |

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
(`render/chart.ts:398-402`). Phase 8 decides how charts reach WASM (SVG subtrees, #69).

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
