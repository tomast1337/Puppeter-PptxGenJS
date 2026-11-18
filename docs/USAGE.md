# PuppeteerGen Usage Guide

PuppeteerGen is a library that implements the PptxGenJS interface to generate PDFs using Puppeteer instead of PowerPoint files. It provides the same familiar API with support for positioning elements in inches, styling, and multiple page layouts.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Page Sizes and Layouts](#page-sizes-and-layouts)
- [Positioning and Sizing](#positioning-and-sizing)
- [Text Styling](#text-styling)
- [Tables](#tables)
- [Multiple Slides](#multiple-slides)
- [Custom Layouts](#custom-layouts)
- [API Reference](#api-reference)

## Installation

```bash
bun install
```

## Quick Start

```typescript
import { PAGE_SIZES, PuppeteerGen } from "@pdflapas/pptxgenjs";

// Create a new presentation
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Add a slide
const slide = pres.addSlide();

// Add text to the slide
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

## Page Sizes and Layouts

PuppeteerGen supports multiple predefined page sizes in both landscape and portrait orientations:

### Available Page Sizes

```typescript
import { PAGE_SIZES } from "@pdflapas/pptxgenjs";

// Presentation formats
PAGE_SIZES.SCREEN_4X3.landscape; // 10" × 7.5"
PAGE_SIZES.SCREEN_4X3.portrait; // 7.5" × 10"
PAGE_SIZES.SCREEN_16X9.landscape; // 10" × 5.625" (default)
PAGE_SIZES.SCREEN_16X9.portrait; // 5.625" × 10"
PAGE_SIZES.SCREEN_16X10.landscape; // 10" × 6.25"
PAGE_SIZES.SCREEN_16X10.portrait; // 6.25" × 10"

// Document formats
PAGE_SIZES.LETTER.landscape; // 11" × 8.5"
PAGE_SIZES.LETTER.portrait; // 8.5" × 11"
PAGE_SIZES.LEGAL.landscape; // 14" × 8.5"
PAGE_SIZES.LEGAL.portrait; // 8.5" × 14"
PAGE_SIZES.A4.landscape; // 11.69" × 8.27"
PAGE_SIZES.A4.portrait; // 8.27" × 11.69"
PAGE_SIZES.A3.landscape; // 16.54" × 11.69"
PAGE_SIZES.A3.portrait; // 11.69" × 16.54"
PAGE_SIZES.TABLOID.landscape; // 17" × 11"
PAGE_SIZES.TABLOID.portrait; // 11" × 17"
```

### Usage Examples

```typescript
// Create 16:9 presentation (widescreen)
const pres1 = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Create A4 document
const pres2 = new PuppeteerGen(PAGE_SIZES.A4.portrait);

// Create Letter size document
const pres3 = new PuppeteerGen(PAGE_SIZES.LETTER.landscape);

// Use default (16:9 landscape)
const pres4 = new PuppeteerGen();
```

## Positioning and Sizing

All positioning and sizing in PuppeteerGen uses **inches** as the unit of measurement, consistent with PptxGenJS.

### Position Properties

- `x`: Horizontal position from left edge (in inches)
- `y`: Vertical position from top edge (in inches)
- `w`: Width (in inches)
- `h`: Height (in inches)

### Example

```typescript
const slide = pres.addSlide();

// Position text at specific coordinates
slide.addText("Top Left", {
    x: 0.5, // 0.5 inches from left
    y: 0.5, // 0.5 inches from top
    w: 3, // 3 inches wide
    h: 0.5, // 0.5 inches tall
});

// Center text horizontally (assuming 10" wide slide)
slide.addText("Centered", {
    x: 2.5, // (10 - 5) / 2 = 2.5
    y: 2,
    w: 5,
    h: 1,
    align: "center",
});
```

## Text Styling

PuppeteerGen supports rich text formatting options:

### Basic Styling

```typescript
slide.addText("Styled Text", {
    x: 1,
    y: 1,
    fontSize: 24, // Font size in points
    fontFace: "Arial", // Font family
    bold: true, // Bold text
    italic: true, // Italic text
    underline: true, // Underlined text
    color: "FF0000", // Text color: 6-digit hex RGB ("#" optional) or a scheme color such as "accent1"; anything else throws
    fill: { color: "#FFFF00" }, // Background color
});
```

### Text Alignment

```typescript
// Horizontal alignment
slide.addText("Left aligned", { x: 1, y: 1, w: 8, align: "left" });
slide.addText("Center aligned", { x: 1, y: 2, w: 8, align: "center" });
slide.addText("Right aligned", { x: 1, y: 3, w: 8, align: "right" });

// Vertical alignment
slide.addText("Top", { x: 1, y: 1, w: 2, h: 2, valign: "top" });
slide.addText("Middle", { x: 4, y: 1, w: 2, h: 2, valign: "middle" });
slide.addText("Bottom", { x: 7, y: 1, w: 2, h: 2, valign: "bottom" });
```

### Multi-part Text

```typescript
slide.addText(
    [
        { text: "Regular ", options: {} },
        { text: "Bold ", options: { bold: true } },
        { text: "Colored", options: { color: "#FF0000" } },
    ],
    {
        x: 1,
        y: 1,
    },
);
```

## Tables

Create tables with custom styling for cells:

### Basic Table

```typescript
slide.addTable(
    [
        ["Header 1", "Header 2", "Header 3"],
        ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"],
        ["Row 2 Col 1", "Row 2 Col 2", "Row 2 Col 3"],
    ],
    {
        x: 1,
        y: 1,
        w: 8,
        h: 3,
    },
);
```

### Styled Table

```typescript
slide.addTable(
    [
        [
            { text: "Product", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" } },
            { text: "Price", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" } },
            { text: "Stock", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" } },
        ],
        [{ text: "Widget A" }, { text: "$19.99", options: { align: "right" } }, { text: "150", options: { align: "center", color: "#00AA00" } }],
        [{ text: "Widget B" }, { text: "$29.99", options: { align: "right" } }, { text: "25", options: { align: "center", color: "#FF0000" } }],
        [
            { text: "Total", options: { bold: true, fill: "#D9E2F3" } },
            { text: "$49.98", options: { bold: true, align: "right", fill: "#D9E2F3" } },
            { text: "175", options: { bold: true, align: "center", fill: "#D9E2F3" } },
        ],
    ],
    {
        x: 1,
        y: 2,
        w: 8,
        h: 3,
    },
);
```

### Tables from HTML (`tableToSlides`)

`tableToSlides()` reads an HTML `<table>` (column widths, colors, fonts, padding and borders from its
computed styles) and adds as many slides as its rows need, as PptxGenJS does. Besides PptxGenJS's
element id, PdfLapas takes the `<table>` element or HTML markup holding one:

```typescript
// PptxGenJS form: the id of a table in the global `document` (the page; in Node, a jsdom you install).
pres.tableToSlides("orders", { autoPageRepeatHeader: true });
// The element itself, from any document with a window (the page, jsdom).
pres.tableToSlides(document.querySelector("table#orders") as HTMLTableElement);
// HTML markup: a string starting with `<`, parsed with `createDocument` (jsdom in the Node entry).
pres.tableToSlides(`<table><tr><td style="width:2in">Widget</td><td>$19.99</td></tr></table>`);
```

Table options such as `h`, `rowH`, `fontSize` or `margin` only decide how many rows fit on each slide, as in
PptxGenJS 4.0.1: each slide's table gets just its position and column widths, so its rows size to their content
and its cells keep the styles read from the HTML.

The markup form needs a document with a window to compute styles: the Node entry's jsdom has one, a
browser's default does not, so in a browser insert the table into the page and pass the element or its id.

**`pres.page` is removed** (#112). `tableToSlides(id)` looks the id up in the global `document` only, as
PptxGenJS does; a table put into `pres.page` before now goes in the global `document`, or pass the element or
its HTML.

## Multiple Slides

Add multiple slides to create a complete presentation:

```typescript
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Title slide
const slide1 = pres.addSlide();
slide1.addText("My Presentation", {
    x: 1,
    y: 2,
    w: 8,
    fontSize: 48,
    bold: true,
    align: "center",
});

// Content slide
const slide2 = pres.addSlide();
slide2.addText("Content", {
    x: 1,
    y: 0.5,
    fontSize: 36,
    bold: true,
});
slide2.addText("• Point 1\n• Point 2\n• Point 3", {
    x: 1.5,
    y: 1.5,
    fontSize: 24,
});

// Generate PDF with all slides
await pres.writeFile({ fileName: "multi-slide.pdf" });
```

## Custom Layouts

PptxGenJS's layout names work: `pres.layout = "LAYOUT_WIDE"` (13⅓" × 7.5"), `LAYOUT_4x3`,
`LAYOUT_16x10` or `LAYOUT_16x9` (the default). Define custom page dimensions:

```typescript
const pres = new PuppeteerGen();

// Set custom dimensions (12" wide × 6" tall); `pres.layout = "Custom Wide"` selects it again later
pres.defineLayout({
    name: "Custom Wide",
    width: 12,
    height: 6,
});

const slide = pres.addSlide();
slide.addText("Custom Layout", { x: 1, y: 2, fontSize: 36 });

await pres.writeFile({ fileName: "custom.pdf" });
```

Or set the page size directly:

```typescript
const pres = new PuppeteerGen();

pres.setPageSize({
    width: 8,
    height: 8,
    name: "Square",
});
```

## API Reference

### PuppeteerGen Class

#### Constructor

```typescript
new PuppeteerGen(pageSize?: PageSize, options?: PuppeteerGenOptions)
```

Creates a new PuppeteerGen instance with the specified page size (default: 16:9 landscape).
`options` injects the `renderer`, `resolveImage` and `createDocument`; see [BACKENDS.md](./BACKENDS.md).
`options.target` picks the rendering target, `"libreoffice"` (the default) or `"powerpoint"`.

**Image paths and URLs from untrusted input.** Like PptxGenJS, the default resolver reads any image path
the process can read and fetches any http(s) URL, following redirects. It stops a fetch after 30 s and
rejects an image (remote body or file) over 50 MiB (`IMAGE_SOURCE_LIMITS`), and `toHtml()` resolves at
most 8 sources at once. A service that renders decks built from user input should confine it with
`options.imageSources`:

```typescript
new PuppeteerGen(undefined, {
    imageSources: {
        baseDir: "/srv/tenants/acme/images", // relative paths resolve here; paths outside it (symlinks followed) throw
        allowRemote: false, // http(s) URLs throw; data URIs still work
        timeoutMs: 10_000,
        maxBytes: 10 * 1024 * 1024,
    },
});
```

`imageSources` configures the default resolver only, so it cannot be combined with `resolveImage`. The
default resolver does not filter hosts: to fetch remote images while blocking internal addresses, pass
your own `resolveImage`.

`PuppeteerGenLibreOffice` and `PuppeteerGenPowerPoint` are `PuppeteerGen` subclasses with the target set,
taking the same arguments: use them to match LibreOffice or PowerPoint rendering. They can be extended
and wrapped like `PuppeteerGen`. See "Choosing a rendering target" in [MIGRATION.md](./MIGRATION.md).

**Font metrics for the PowerPoint target.** PowerPoint places a single-spaced line's baseline from its
font's `head.unitsPerEm` and `OS/2` `usWinAscent` and `usWinDescent`, read from the installed font the
face name resolves to. The Node entry does the same by default: for each face a deck's text uses, it asks
fontconfig (`fc-match`) for the face's regular font, as Chromium does on Linux, and reads the three values
from that file. A face fontconfig answers with a different family for (a substitute) is not installed and
does not count. PdfLapas also knows the values for Arial, Calibri, Cambria, Courier New and Times New Roman
(`FONT_WIN_METRICS` in `defaults.ts`); text in a face that is neither installed nor listed keeps the
font-independent baseline and sits about 0.03 to 0.05em low against PowerPoint. A face's metrics come from,
in order:

1. `options.fontMetrics`, keyed by face name (case-insensitive);
2. `options.resolveFontMetrics(face)`, by default the installed font on Node;
3. `FONT_WIN_METRICS`;
4. the font-independent baseline, 1em below the line top.

Pass the metrics of faces that are not installed where you render, or to override what is installed, with
`options.fontMetrics`:

```typescript
import { readFileSync } from "node:fs";
import { PuppeteerGenPowerPoint, readFontWinMetrics } from "@pdflapas/pptxgenjs";

const pres = new PuppeteerGenPowerPoint(undefined, {
    fontMetrics: {
        "My Brand Sans": { unitsPerEm: 1000, winAscent: 950, winDescent: 250 },
        // or read them from the font file (TrueType, OpenType or a .ttc's face, the first by default; not WOFF):
        "My Brand Serif": readFontWinMetrics(readFileSync("fonts/MyBrandSerif-Regular.ttf")),
    },
});
```

An entry may also carry `pairKerning: boolean`: whether PowerPoint pair-kerns the face. PowerPoint
kerns a font with a `kern` table from that table alone, so only when it is Microsoft-format (version 0)
with a horizontal format 0 subtable; a face whose only pair kerning is an Apple-format `kern` table plus
GPOS is drawn unkerned at every size. A font with no `kern` table is kerned from its GPOS table. PowerPoint
kerns text from 12pt only in a face it kerns, and the PowerPoint target draws a face with
`pairKerning: false` unkerned at every size. Left out, the face is kerned from 12pt. `readFontWinMetrics`
(and so the default resolver) reads it from the font: true for a version 0 `kern` table as above, else,
without a `kern` table, when the font has a GPOS table. `FONT_WIN_METRICS` sets it for Arial and Calibri.

The constructor checks each entry: `unitsPerEm` a positive integer, `winAscent` and `winDescent`
non-negative integers with a positive sum, `pairKerning` a boolean if present, and no other field. An
invalid entry throws a `TypeError` naming the face and field. `readFontWinMetrics(bytes, faceIndex = 0)` is browser-safe (it takes bytes,
not a path) and throws `FontFileError` on bytes that are not a readable TrueType or OpenType font. The
LibreOffice target ignores `fontMetrics` and `resolveFontMetrics`, as LibreOffice's line box does not
depend on the font; it never calls the resolver.

`resolveFontMetrics` takes a face name and returns its metrics, or `undefined` to fall through to
`FONT_WIN_METRICS`. It is called at most once per face per presentation, only for the PowerPoint target and
only for faces `fontMetrics` does not list; a result that is not valid metrics throws a `TypeError` naming
the face. Pass your own to look fonts up elsewhere, or `null` to turn the lookup off:

```typescript
// The same HTML on every machine: no installed font is read.
const pres = new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null });
```

The default resolver caches each face's result for the life of the process (a font installed later is seen
by a new process). It needs fontconfig's `fc-match` on the `PATH`: Linux has it; on macOS and Windows
without fontconfig every face falls through to `FONT_WIN_METRICS`. A font file it cannot read (truncated,
WOFF) is skipped with a `console.warn` naming the face and file, and the face falls through the same way.
The `@pdflapas/pptxgenjs/html` entry has no default resolver.

**Determinism.** With the default resolver, the PowerPoint target's `toHtml()` and `getModel()` depend on
the fonts installed where they run, as the PDF already does: the same deck gives the same bytes on machines
with the same fonts. Pass `resolveFontMetrics: null` (with `fontMetrics` for the faces you need) when the
HTML must be identical across machines, for example in snapshot tests. The LibreOffice target does not
read installed fonts.

#### Methods

- `addSlide(props?: AddSlideProps): PptxSlide`
    - Adds a new slide to the presentation

- `defineLayout(layout: PresLayout): void`
    - Defines a custom page layout with width and height

- `setPageSize(pageSize: PageSize): void`
    - Changes the page size of the presentation

- `tableToSlides(source: string | HTMLTableElement, props?: TableToSlidesProps): void`
    - Adds slides holding an HTML table: its id, the element or HTML markup; see
      [Tables from HTML](#tables-from-html-tabletoslides)

- `writeFile(props: WriteFileProps): Promise<string>`
    - Writes the PDF to disk (Node) or downloads it (browser) and returns the file name. A trailing
      `.pptx` becomes `.pdf`, a `.pdf` name is kept and any other name gets `.pdf` appended. `fileName`
      is required: without it `writeFile()` throws a `TypeError` (PptxGenJS would use `Presentation.pptx`)

### PuppeteerSlide Class

#### Methods

- `addText(text: string | TextProps[], options?: TextPropsOptions): Slide`
    - Adds text to the slide with optional styling

- `addTable(rows: TableRow[], options?: TableProps): Slide`
    - Adds a table to the slide

- `addImage(options: ImageProps): Slide`
    - Adds an image to the slide

- `addShape(shapeName: SHAPE_NAME, options?: ShapeProps): Slide`
    - Adds a shape to the slide

#### Properties

- `background: BackgroundProps`
    - `{ color }`, or a picture `{ path }` / `{ data }` stretched over the whole slide under every object
- `hidden: boolean`
    - `true` leaves the slide out of the PDF; the other slides keep their numbers
- `slideNumber: SlideNumberProps`
    - Prints the slide's number (hidden slides counted) in a text box at `{ x, y, w?, h? }`. As in
      PptxGenJS, size, color, font, `valign` and `margin` (points) left unset come from the
      `slideNumber` set last on any slide; see [DEFAULTS.md](./DEFAULTS.md#slide-numbers)

### Common Options

#### TextPropsOptions

- `x`: number - X position in inches
- `y`: number - Y position in inches
- `w`: number - Width in inches
- `h`: number - Height in inches
- `fontSize`: number - Font size in points
- `fontFace`: string - Font family name
- `bold`: boolean - Bold text
- `italic`: boolean - Italic text
- `underline`: `{ style?, color? }` - Underlined text; `style` is an OOXML underline type (`"sng"`,
  `"dbl"`, `"heavy"`, `"dash"`, ...). The deprecated string form (`underline: "heavy"`) and `true`
  (`"sng"`) work as in PptxGenJS; in a table cell PptxGenJS writes nothing for `true`, so it draws none.
- `color`: string - Text color
- `fill`: { color: string } - Background color
- `align`: "left" | "center" | "right" | "justify" - Horizontal alignment
- `valign`: "top" | "middle" | "bottom" - Vertical alignment

#### TableProps

- `x`: number - X position in inches
- `y`: number - Y position in inches
- `w`: number - Width in inches
- `h`: number - Height in inches

#### TableCellProps

- `text`: string - Cell text content
- `options`: object - Cell styling options
    - `bold`: boolean
    - `color`: string
    - `fill`: string
    - `fontSize`: number
    - `align`: "left" | "center" | "right"

## CSS and Print Layout

PuppeteerGen automatically generates CSS that:

- Sets the correct page dimensions using `@page` CSS
- Positions elements absolutely using the slide-container class
- Handles page breaks between slides
- Ensures proper print output

The CSS is automatically injected into the document and handles:

- Slide containers with proper dimensions
- Absolute positioning of elements
- Text styling and alignment
- Table formatting
- Print media queries for PDF generation

## Examples

See the `examples/comprehensive-example.ts` file for complete working examples of all features.

Run the examples:

```bash
bun run examples/comprehensive-example.ts
```

This will generate several PDF files demonstrating different features:

- `example-16x9-landscape.pdf` - 16:9 presentation format
- `example-a4-portrait.pdf` - A4 document format
- `example-letter-landscape.pdf` - Letter document format
- `example-positioning.pdf` - Positioning examples
- `example-text-styling.pdf` - Text styling examples
- `example-tables.pdf` - Table formatting examples
- `example-multiple-slides.pdf` - Multi-slide presentation
- `example-custom-layout.pdf` - Custom page dimensions

## Tips and Best Practices

1. **Choose the right page size**: Use presentation formats (SCREEN_*) for slides and document formats (LETTER, A4) for reports.

2. **Use consistent units**: All measurements are in inches for compatibility with PptxGenJS.

3. **Plan your layout**: Know your page dimensions and plan element positions accordingly.

4. **Test positioning**: Start with simple layouts and gradually add complexity.

5. **Use tables for structured data**: Tables automatically handle borders and cell formatting.

6. **Leverage multi-part text**: Use TextProps arrays for inline styling within a single text block.

7. **Check alignment**: Use alignment properties instead of manual positioning when possible.

## Troubleshooting

### Text is cut off

Make sure the `w` and `h` properties are large enough for your content.

### Elements overlap

Check your positioning values - elements use absolute positioning and won't automatically avoid each other.

### PDF looks different than expected

Verify that you're using the correct page size and that your position/size values are appropriate for that page size.

### Puppeteer won't launch

Make sure all dependencies are installed and that you have the necessary system libraries for Puppeteer.
Chromium is launched without its sandbox by default; to change the launch options (for example to keep the sandbox,
or to point `executablePath` at another Chromium), see the Puppeteer backend section of `docs/BACKENDS.md`.
