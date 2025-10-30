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
import { PuppeteerGen } from "./src/PuppeterrGen";
import { PAGE_SIZES } from "./src/pageLayouts";

// Create a new presentation
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Add a slide
const slide = pres.addSlide();

// Add text to the slide
slide.addText("Hello World!", { 
    x: 1,        // 1 inch from left
    y: 1,        // 1 inch from top
    fontSize: 32,
    bold: true,
    color: "#0066CC"
});

// Generate PDF
await pres.writeFile({ fileName: "presentation.pdf" });
```

## Page Sizes and Layouts

PuppeteerGen supports multiple predefined page sizes in both landscape and portrait orientations:

### Available Page Sizes

```typescript
import { PAGE_SIZES } from "./src/pageLayouts";

// Presentation formats
PAGE_SIZES.SCREEN_4X3.landscape      // 10" × 7.5"
PAGE_SIZES.SCREEN_4X3.portrait       // 7.5" × 10"
PAGE_SIZES.SCREEN_16X9.landscape     // 10" × 5.625" (default)
PAGE_SIZES.SCREEN_16X9.portrait      // 5.625" × 10"
PAGE_SIZES.SCREEN_16X10.landscape    // 10" × 6.25"
PAGE_SIZES.SCREEN_16X10.portrait     // 6.25" × 10"

// Document formats
PAGE_SIZES.LETTER.landscape          // 11" × 8.5"
PAGE_SIZES.LETTER.portrait           // 8.5" × 11"
PAGE_SIZES.LEGAL.landscape           // 14" × 8.5"
PAGE_SIZES.LEGAL.portrait            // 8.5" × 14"
PAGE_SIZES.A4.landscape              // 11.69" × 8.27"
PAGE_SIZES.A4.portrait               // 8.27" × 11.69"
PAGE_SIZES.A3.landscape              // 16.54" × 11.69"
PAGE_SIZES.A3.portrait               // 11.69" × 16.54"
PAGE_SIZES.TABLOID.landscape         // 17" × 11"
PAGE_SIZES.TABLOID.portrait          // 11" × 17"
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
    x: 0.5,    // 0.5 inches from left
    y: 0.5,    // 0.5 inches from top
    w: 3,      // 3 inches wide
    h: 0.5     // 0.5 inches tall
});

// Center text horizontally (assuming 10" wide slide)
slide.addText("Centered", { 
    x: 2.5,    // (10 - 5) / 2 = 2.5
    y: 2,
    w: 5,
    h: 1,
    align: "center"
});
```

## Text Styling

PuppeteerGen supports rich text formatting options:

### Basic Styling

```typescript
slide.addText("Styled Text", {
    x: 1,
    y: 1,
    fontSize: 24,           // Font size in points
    fontFace: "Arial",      // Font family
    bold: true,             // Bold text
    italic: true,           // Italic text
    underline: true,        // Underlined text
    color: "#FF0000",       // Text color (hex, RGB, or named)
    fill: { color: "#FFFF00" }  // Background color
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
slide.addText([
    { text: "Regular ", options: {} },
    { text: "Bold ", options: { bold: true } },
    { text: "Colored", options: { color: "#FF0000" } }
], {
    x: 1,
    y: 1
});
```

## Tables

Create tables with custom styling for cells:

### Basic Table

```typescript
slide.addTable([
    ["Header 1", "Header 2", "Header 3"],
    ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"],
    ["Row 2 Col 1", "Row 2 Col 2", "Row 2 Col 3"]
], {
    x: 1,
    y: 1,
    w: 8,
    h: 3
});
```

### Styled Table

```typescript
slide.addTable([
    [
        { text: "Product", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
        { text: "Price", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
        { text: "Stock", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }}
    ],
    [
        { text: "Widget A" },
        { text: "$19.99", options: { align: "right" }},
        { text: "150", options: { align: "center", color: "#00AA00" }}
    ],
    [
        { text: "Widget B" },
        { text: "$29.99", options: { align: "right" }},
        { text: "25", options: { align: "center", color: "#FF0000" }}
    ],
    [
        { text: "Total", options: { bold: true, fill: "#D9E2F3" }},
        { text: "$49.98", options: { bold: true, align: "right", fill: "#D9E2F3" }},
        { text: "175", options: { bold: true, align: "center", fill: "#D9E2F3" }}
    ]
], {
    x: 1,
    y: 2,
    w: 8,
    h: 3
});
```

## Multiple Slides

Add multiple slides to create a complete presentation:

```typescript
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Title slide
const slide1 = pres.addSlide();
slide1.addText("My Presentation", { 
    x: 1, y: 2, w: 8, 
    fontSize: 48, bold: true, align: "center" 
});

// Content slide
const slide2 = pres.addSlide();
slide2.addText("Content", { 
    x: 1, y: 0.5, fontSize: 36, bold: true 
});
slide2.addText("• Point 1\n• Point 2\n• Point 3", { 
    x: 1.5, y: 1.5, fontSize: 24 
});

// Generate PDF with all slides
await pres.writeFile({ fileName: "multi-slide.pdf" });
```

## Custom Layouts

Define custom page dimensions:

```typescript
const pres = new PuppeteerGen();

// Set custom dimensions (12" wide × 6" tall)
pres.defineLayout({
    name: "Custom Wide",
    width: 12,
    height: 6
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
    name: "Square"
});
```

## API Reference

### PuppeteerGen Class

#### Constructor

```typescript
new PuppeteerGen(pageSize?: PageSize)
```

Creates a new PuppeteerGen instance with the specified page size (default: 16:9 landscape).

#### Methods

- `addSlide(props?: AddSlideProps): PptxSlide`
  - Adds a new slide to the presentation

- `defineLayout(layout: PresLayout): void`
  - Defines a custom page layout with width and height

- `setPageSize(pageSize: PageSize): void`
  - Changes the page size of the presentation

- `writeFile(props: WriteFileProps): Promise<string>`
  - Generates the PDF file and writes it to disk

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
- `underline`: boolean - Underlined text
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

