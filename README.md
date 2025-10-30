# PuppeteerGen - PptxGenJS Interface for PDF Generation

A TypeScript library that implements the PptxGenJS interface to generate PDFs using Puppeteer. Create presentations and documents with the familiar PptxGenJS API, but output to PDF instead of PowerPoint.

## Features

- **PptxGenJS-compatible API** - Drop-in replacement for PDF output
- **Multiple page sizes** - 16:9, 4:3, 16:10, Letter, A4, A3, Legal, Tabloid
- **Landscape and Portrait** - All page sizes available in both orientations
- **Inch-based positioning** - Precise element placement using inches
- **Rich text formatting** - Bold, italic, underline, colors, fonts, alignment
- **Tables** - Full table support with cell styling
- **Multiple slides** - Create multi-page PDFs
- **Custom layouts** - Define your own page dimensions
- **Print-optimized CSS** - Automatic CSS generation for perfect PDF output

## Installation

```bash
bun install
```

## Quick Start

```typescript
import { PuppeteerGen } from "./src/PuppeterrGen";
import { PAGE_SIZES } from "./src/pageLayouts";

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
bun run src/index.ts
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

## Documentation

For detailed documentation, see [USAGE.md](./USAGE.md) which covers:
- Complete API reference
- Positioning and sizing guide
- Text styling options
- Table formatting
- Custom layouts
- CSS and print layout details
- Best practices and troubleshooting

## Project Structure

```
├── src/
│   ├── index.ts           # Basic example
│   ├── PuppeterrGen.ts    # Main implementation
│   ├── pageLayouts.ts     # Page size definitions
│   ├── utils.ts           # Utility functions
│   ├── pptx.ts            # Type definitions
│   └── exports.ts         # Public API exports
├── examples/
│   └── comprehensive-example.ts  # Feature demonstrations
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

- Compatible with PptxGenJS interface
- Works with Bun runtime
- Requires Puppeteer for PDF generation
- Uses jsdom for HTML document manipulation

## Limitations

Currently implemented:
- Text with full styling
- Tables with cell styling
- Images (basic support)
- Shapes (basic support)
- Multiple slides
- Custom layouts

Not yet implemented:
- Charts
- Slide masters
- Sections

Not Planned:
- Media (audio/video)
- Notes
