# Quick Reference Guide

## Import

```typescript
import { PuppeteerGen } from "./src/PuppeterrGen";
import { PAGE_SIZES } from "./src/pageLayouts";
```

## Create Presentation

```typescript
// With default size (16:9 landscape)
const pres = new PuppeteerGen();

// With specific page size
const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
const pres = new PuppeteerGen(PAGE_SIZES.A4.portrait);
const pres = new PuppeteerGen(PAGE_SIZES.LETTER.landscape);
```

## Page Sizes

| Name | Landscape | Portrait |
|------|-----------|----------|
| SCREEN_16X9 | 10" × 5.625" | 5.625" × 10" |
| SCREEN_4X3 | 10" × 7.5" | 7.5" × 10" |
| SCREEN_16X10 | 10" × 6.25" | 6.25" × 10" |
| LETTER | 11" × 8.5" | 8.5" × 11" |
| LEGAL | 14" × 8.5" | 8.5" × 14" |
| A4 | 11.69" × 8.27" | 8.27" × 11.69" |
| A3 | 16.54" × 11.69" | 11.69" × 16.54" |
| TABLOID | 17" × 11" | 11" × 17" |

## Add Slide

```typescript
const slide = pres.addSlide();
```

## Add Text

```typescript
// Simple text
slide.addText("Hello", { x: 1, y: 1 });

// Styled text
slide.addText("Hello", { 
    x: 1,           // inches from left
    y: 1,           // inches from top
    w: 6,           // width in inches
    h: 1,           // height in inches
    fontSize: 28,   // points
    fontFace: "Arial",
    bold: true,
    italic: true,
    underline: true,
    color: "#FF0000",
    fill: { color: "#FFFF00" },
    align: "center",    // left, center, right, justify
    valign: "middle"    // top, middle, bottom
});

// Multi-part text
slide.addText([
    { text: "Regular ", options: {} },
    { text: "Bold ", options: { bold: true } },
    { text: "Red", options: { color: "#FF0000" } }
], { x: 1, y: 1 });
```

## Add Table

```typescript
// Simple table
slide.addTable([
    ["Header 1", "Header 2"],
    ["Cell 1", "Cell 2"]
], { x: 1, y: 2, w: 8, h: 2 });

// Styled table
slide.addTable([
    [
        { text: "Header", options: { 
            bold: true, 
            fill: "#4472C4", 
            color: "#FFFFFF" 
        }}
    ],
    [
        { text: "Data", options: { 
            align: "right",
            color: "#00AA00" 
        }}
    ]
], { x: 1, y: 2, w: 8, h: 2 });
```

## Add Shape

```typescript
slide.addShape("rect", {
    x: 1,
    y: 1,
    w: 3,
    h: 2,
    fill: { color: "#0066CC" },
    line: { color: "#000000" }
});
```

## Add Image

```typescript
slide.addImage({
    path: "image.png",  // or data: "base64..."
    x: 1,
    y: 1,
    w: 4,
    h: 3
});
```

## Custom Layout

```typescript
pres.defineLayout({
    name: "Custom",
    width: 12,
    height: 6
});

// Or
pres.setPageSize({
    width: 8,
    height: 8,
    name: "Square"
});
```

## Generate PDF

```typescript
await pres.writeFile({ fileName: "output.pdf" });
```

## Complete Example

```typescript
import { PuppeteerGen } from "./src/PuppeterrGen";
import { PAGE_SIZES } from "./src/pageLayouts";

const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Title slide
const slide1 = pres.addSlide();
slide1.addText("My Presentation", { 
    x: 1, y: 2, w: 8, 
    fontSize: 48, bold: true, align: "center" 
});

// Content slide
const slide2 = pres.addSlide();
slide2.addText("Key Points", { 
    x: 1, y: 0.5, fontSize: 36, bold: true 
});
slide2.addText("• Point 1\n• Point 2\n• Point 3", { 
    x: 1.5, y: 1.5, fontSize: 24 
});

// Table slide
const slide3 = pres.addSlide();
slide3.addTable([
    [
        { text: "Name", options: { bold: true }},
        { text: "Value", options: { bold: true }}
    ],
    [{ text: "Item 1" }, { text: "100" }],
    [{ text: "Item 2" }, { text: "200" }]
], { x: 1, y: 1, w: 8, h: 3 });

await pres.writeFile({ fileName: "presentation.pdf" });
```

## Common Patterns

### Centered Title

```typescript
slide.addText("Title", {
    x: 1,
    y: 2,
    w: 8,  // assuming 10" wide slide, 1" margins
    h: 1,
    fontSize: 48,
    bold: true,
    align: "center"
});
```

### Two-Column Layout

```typescript
// Left column
slide.addText("Left Content", { 
    x: 0.5, y: 1, w: 4.5, h: 4 
});

// Right column
slide.addText("Right Content", { 
    x: 5, y: 1, w: 4.5, h: 4 
});
```

### Header and Footer

```typescript
// Header
slide.addText("Header", { 
    x: 0.5, y: 0.25, w: 9, h: 0.5,
    fontSize: 14, color: "#666666" 
});

// Footer
slide.addText("Footer", { 
    x: 0.5, y: 5, w: 9, h: 0.3,
    fontSize: 12, color: "#999999" 
});
```

### Colored Box with Text

```typescript
slide.addText("Important", {
    x: 1,
    y: 2,
    w: 8,
    h: 1,
    fontSize: 24,
    bold: true,
    color: "#FFFFFF",
    fill: { color: "#CC0000" },
    align: "center",
    valign: "middle"
});
```

## Run Examples

```bash
# Basic example
bun run src/index.ts

# Comprehensive examples
bun run examples/comprehensive-example.ts
```

## More Info

- Full documentation: [USAGE.md](./USAGE.md)
- Implementation details: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- Project overview: [README.md](./README.md)

