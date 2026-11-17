// Images: data URIs, file paths, sizing, and the `imageSources` limits that guard where images come from.
// Run: bun run examples/images.ts (writes images.pdf to the working directory; no network access).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "@pdflapas/pptxgenjs";

// A 1x1 gray PNG and a small SVG, as PptxGenJS `data` strings.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#dddddd"/><circle cx="50" cy="30" r="20" fill="#666666"/></svg>`;

// A file path needs a file: this one is written to a temporary directory, which also serves as `baseDir`.
const dir = await mkdtemp(join(tmpdir(), "pdflapas-images-"));
await writeFile(join(dir, "pixel.png"), Buffer.from(png, "base64"));

// imageSources (a PdfLapas option, not in PptxGenJS) bounds image loading: a fetch timeout, a size limit,
// relative paths resolved inside `baseDir` (a path outside it throws), and no http(s) URLs at all.
const options = { imageSources: { timeoutMs: 5_000, maxBytes: 1_000_000, baseDir: dir, allowRemote: false } };
const pres = new pptxgen(undefined, options);
const slide = pres.addSlide();

slide.addImage({ data: `image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, x: 0.5, y: 0.5, w: 3, h: 1.8 });
slide.addImage({ data: `data:image/png;base64,${png}`, x: 4, y: 0.5, w: 1.8, h: 1.8, rounding: true });
// The relative path resolves against baseDir (without baseDir, against the working directory, as PptxGenJS does).
slide.addImage({ path: "pixel.png", x: 6.3, y: 0.5, w: 3, h: 1.8, transparency: 50 });
// `sizing` fits the image in a box: contain, cover or crop.
slide.addImage({ data: `image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, x: 0.5, y: 2.8, w: 4, h: 2.4, sizing: { type: "contain", w: 4, h: 2.4 } });

try {
    console.log(`Wrote ${await pres.writeFile({ fileName: "images.pdf" })}`);

    // With allowRemote: false a URL is rejected before any request is made.
    const remote = new pptxgen(undefined, options);
    remote.addSlide().addImage({ path: "https://example.com/logo.png", x: 1, y: 1, w: 2, h: 1 });
    const rejection = await remote.toHtml().then(
        () => undefined,
        (error: unknown) => error,
    );
    if (!(rejection instanceof Error)) throw new Error("expected allowRemote: false to reject the URL");
    console.log(`Rejected as configured: ${rejection.message}`);
} finally {
    await rm(dir, { recursive: true, force: true });
}
