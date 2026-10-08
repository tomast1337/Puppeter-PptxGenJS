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

## Custom HTML components

Register versioned application components on each presentation, then place them
with the same inch-based coordinates used by the standard drawing methods:

```typescript
import { z } from "zod";

const metricSchema = z.object({ label: z.string().default("Revenue"), value: z.number() });
const pres = new PuppeteerGen();
pres.registerComponent("acme/metric", 1, {
    schema: metricSchema,
    render(props, { document, width, height }) {
        const card = document.createElement("div");
        card.style.cssText = "height:100%;padding:12px;box-sizing:border-box;background:#eef2ff";
        // textContent safely represents data as text. Context dimensions are pixels.
        card.textContent = `${props.label}: ${props.value}`;
        return card;
    },
});
pres.addSlide().addComponent(
    { type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } },
    { x: 1, y: 1, w: 3, h: 1, objectName: "revenue-card" },
);
await pres.writeFile({ fileName: "metrics.pdf" });
```

`addComponent` is a PuppeteerGen extension. It returns the slide for chaining.
`x`, `y`, `w`, and `h` are required finite numbers in inches; dimensions must be
positive. Components follow insertion order and clip content to their box.
`objectName` is optional. Other drawing options (rotation, percentage geometry,
fill, etc.) are currently unsupported: style the inner HTML in the renderer.
Component default overflow is tracked in `src/defaults.ts`.

A component's type and positive integer version select an exact registration.
Different versions can coexist; duplicate registration and unknown versions
throw. Registries belong to a presentation and are also shared with its existing
and automatically created slides. Register definitions before calling
`addComponent` or replaying a recording. Components render synchronously when
added; registration changes do not retroactively redraw existing elements.

Props must be a plain JSON object (no functions, undefined, dates, cycles or DOM
nodes). They are copied before validation/rendering. The optional validator throws
on invalid application data. The renderer returns an HTML string or an HTMLElement
created with the supplied document; elements are cloned, so event listeners and
other runtime state are not part of the output. React/Vue hydration and async
renderers are not supported. Fetch data before generation.

HTML renderers are trusted application code, not a sandbox. Prefer DOM creation
and `textContent` for user data; sanitize any untrusted HTML before returning it.
Use inline styles or explicitly scoped CSS: components share the slide document,
so global selectors can affect other elements. `<img src>` paths and URLs enter
the normal image-resolution pipeline before PDF generation. Use embedded images
for portability. `srcset` is rejected; CSS background URLs, external stylesheets,
SVG external references and web fonts are not bundled by this API and should be
embedded or supplied by the application.

The `pptx-serializer` workspace package in `icap-dev-tools` records the same
`addComponent(input, options)` contract. Its document contains only type,
version, props and geometry—not renderer functions. Register definitions inside
the replay factory. Unknown types remain editable in saved data but fail clearly
when rendered without a matching registration. For changed props schemas, add a
new version and migrate documents explicitly. Standard PptxGenJS has no
`addComponent` method; replaying a component document into it requires an adapter.

## React components (optional)

Install matching React 19 packages in the consuming application:

```sh
npm install react@19 react-dom@19
# TypeScript applications also need their React types:
npm install --save-dev @types/react@19 @types/react-dom@19
```

The adapter is a separate package entrypoint. Importing `puppeteer-pptxgenjs`
without `/react` does not load or require React.

```tsx
import PuppeteerGen from "puppeteer-pptxgenjs";
import { registerReactComponent } from "puppeteer-pptxgenjs/react";

import { z } from "zod";

const metricSchema = z.object({ label: z.string().default("Revenue"), value: z.number() });
type MetricProps = z.output<typeof metricSchema>;

function MetricCard({ label, value }: MetricProps) {
    return (
        <div style={{ height: "100%", background: "#eef2ff", padding: 16, boxSizing: "border-box" }}>
            <strong>{label}</strong>
            <div>{value}</div>
        </div>
    );
}

const presentation = new PuppeteerGen();
registerReactComponent(presentation, "acme/metric", 1, MetricCard, {
    schema: metricSchema,
});
presentation.addSlide().addComponent(
    { type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } },
    { x: 1, y: 1, w: 3, h: 1 },
);
await presentation.writeFile({ fileName: "react-metrics.pdf" });
```

`registerReactComponent` returns the presentation and uses the existing versioned
component registry. Prefer `schema` with a shared Zod definition: its output type
must match the React props, and its defaults/refinements run before rendering.
The legacy `parseProps` callback remains supported; provide either `schema` or
`parseProps`. Without either, props are passed through without schema validation.

HTML `registerComponent` also accepts `schema`, inferring `render` and `validate`
props from its output. A legacy `validate` callback can add checks after parsing.
Input and parsed props must remain plain JSON objects. Schemas are synchronous;
async refinements/transforms are unsupported. Saved props are schema inputs and
are never overwritten with parsed outputs, so transforms run once per render.
Keep the same versioned schema in a shared package used by the editor, HTML and
React code; schemas and component functions never enter the serialized document.

The adapter renders function or class components with React's synchronous
`renderToStaticMarkup`. It automatically gives each render a distinct `useId`
prefix within the presentation. React components can be composed normally; wrap
them in another component to supply providers or application themes. Use inline
styles or supply the corresponding scoped CSS; importing a CSS module does not
bundle its stylesheet into the PDF.

Output is static HTML: event handlers, client effects, hydration and browser-only
APIs are not available. Load data before rendering. Suspense emits its fallback
rather than waiting for asynchronous content, so async components that need to
resolve before export are not supported by this adapter. React elements, callbacks
and component functions are not serializable props; keep those in registered code.

The serializer's `addComponent` data is unchanged. Register the React adapter in
the replay factory, then replay the document normally. The same React component
can later be mounted interactively by an editor, with the editor updating the
saved props; this adapter only handles static export.

Run the repository example with `bun run examples/react-component.ts`.
