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

## Installation

```bash
npm install puppeteer-pptxgenjs
```

The published package supports Node.js 22 and newer. Bun remains supported as
both a runtime and the development toolchain used by this repository.

Build the consumable package entrypoint and TypeScript declarations:

```bash
bun run build
```

The build writes the bundled ESM entrypoint, source map, and declaration files
to `dist/`. Runtime dependencies remain external so Puppeteer can locate its
installed browser correctly. The pinned PptxGenJS package is used only while
developing to audit its API types; the build vendors its declaration file and
license, so consumers neither install nor execute PptxGenJS. Package tarballs
run this build automatically.

Verify the packed artifact in a clean temporary consumer project with:

```bash
bun run test:package
```

## Quick Start

```typescript
import PuppeteerGen, { PAGE_SIZES } from "puppeteer-pptxgenjs";

// Create a presentation with 16:9 layout
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Add a slide
const slide = pres.addSlide();

// Add text with positioning and styling
slide.addText("Hello World!", { 
    x: 1,           // 1 inch from left
    y: 1,           // 1 inch from top
    fontSize: 32,
    bold: true,
    color: "#0066CC"
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
    align: "center"
});
```

### Tables

```typescript
slide.addTable([
    [
        { text: "Header 1", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
        { text: "Header 2", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }}
    ],
    [
        { text: "Row 1 Col 1" },
        { text: "Row 1 Col 2", options: { align: "right", color: "#00AA00" }}
    ]
], {
    x: 1,
    y: 2,
    w: 8,
    h: 2
});
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

## Documentation

For detailed documentation, see [USAGE.md](./USAGE.md) which covers:
- Complete API reference
- Positioning and sizing guide
- Text styling options
- Table formatting
- Custom layouts
- CSS and print layout details
- Best practices and troubleshooting

See [DEFAULTS.md](./DEFAULTS.md) for the measured PptxGenJS/PowerPoint defaults
that PuppeteerGen reproduces and the current compatibility status.

## Project Structure

```
├── src/
│   ├── PuppeterrGen.ts    # Main implementation
│   ├── pageLayouts.ts     # Page size definitions
│   ├── utils.ts           # Utility functions
│   ├── pptx.ts            # Type definitions
│   └── exports.ts         # Public API exports
├── examples/
│   ├── test.ts                   # Basic example
│   └── comprehensive-example.ts  # Feature demonstrations
├── tests/                       # Unit, DOM, and visual parity tests
├── USAGE.md               # Detailed documentation
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
3. Launches Puppeteer browser
4. Renders HTML to PDF with correct page size
5. Outputs PDF file

## Compatibility

- Targets the PptxGenJS 4.0.1 API and observed runtime behavior
- Works with Node.js 22+ and Bun
- Requires Puppeteer for PDF generation
- Uses jsdom for HTML document manipulation
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
