# Components

`addComponent` places application-defined HTML (or React) content on a slide. It is a pdfdeck
extension: standard PptxGenJS has no such method. Components are drawn by the Puppeteer backend and
the `/html` entry; the WASM backend reports them as not drawn (see [BACKENDS.md](./BACKENDS.md)).

## Custom HTML components

Register versioned application components on each presentation, then place them
with the same inch-based coordinates used by the standard drawing methods:

```typescript
import PuppeteerGen from "@pdfdeck/pptxgenjs";
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
pres.addSlide().addComponent({ type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } }, { x: 1, y: 1, w: 3, h: 1, objectName: "revenue-card" });
await pres.writeFile({ fileName: "metrics.pdf" });
```

`addComponent` is a PuppeteerGen extension. It returns the slide for chaining.
`x`, `y`, `w`, and `h` are required finite numbers in inches; dimensions must be
positive. Components follow insertion order and clip content to their box.
`objectName` is optional. Other drawing options (rotation, percentage geometry,
fill, etc.) are currently unsupported: style the inner HTML in the renderer.
Component default overflow is tracked in `packages/pptxgenjs/src/defaults.ts`.

A component's type and positive integer version select an exact registration.
Different versions can coexist; duplicate registration and unknown versions
throw. Registries belong to a presentation and are also shared with its existing
and automatically created slides. Register definitions before calling
`addComponent` or replaying a recording. `addComponent` renders the component once
so that validation and render errors throw there, then records only its type,
version and props; `toHtml()` and `toPdf()` render it again from that record, in
a fresh document. Keep renderers pure: the same props must give the same markup.
`context.idPrefix` is unique in the deck and the same on every render of the
object; prefix element ids with it.

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
npm install @pdfdeck/react react@19 react-dom@19
# TypeScript applications also need their React types:
npm install --save-dev @types/react@19 @types/react-dom@19
```

The adapter is a separate package, `@pdfdeck/react`. Importing
`@pdfdeck/pptxgenjs` alone does not load or require React.

```tsx
import PuppeteerGen from "@pdfdeck/pptxgenjs";
import { registerReactComponent } from "@pdfdeck/react";

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
presentation.addSlide().addComponent({ type: "acme/metric", version: 1, props: { label: "Revenue", value: 42 } }, { x: 1, y: 1, w: 3, h: 1 });
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
`renderToStaticMarkup`. It gives each component's tree its own `useId` prefix
from `context.idPrefix`, so ids are unique in the deck and the same on every
render. React components can be composed normally; wrap
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
