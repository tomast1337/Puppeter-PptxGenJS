import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { withLinkUris } from "../packages/puppeteer/src/pdfLinks";

const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
const PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Each one Chromium canonicalizes differently from what the deck gives (but the parentheses, which test escaping).
const URLS = [
    "https://example.com",
    "https://EXAMPLE.com/Path",
    "HTTPS://example.com/x",
    "https://example.com:443/a",
    "http://example.com:80",
    "https://bücher.example/x",
    "https://example.com/a b",
    "https://example.com?q=1",
    "https://example.com#frag",
    "https://example.com/%7euser/%41",
    "https://example.com/a/../b/./c",
    "https://example.com/ü?q=ü",
    "https://example.com/a(b)\\c",
    "mailto:Team@Example.com",
    "mailto:a@b.com?subject=Hi there",
];

afterAll(closeBrowser);

/** The /URI strings of the PDF's link annotations, as qpdf resolves its incremental updates (and finds no error in it), decoded from UTF-8. */
async function linkUris(pdf: Uint8Array): Promise<string[]> {
    const directory = await mkdtemp(join(tmpdir(), "pdflapas-links-"));
    try {
        const path = join(directory, "deck.pdf");
        await writeFile(path, pdf);
        const qdf = spawnSync("qpdf", ["--qdf", "--object-streams=disable", path, "-"]);
        if (qdf.status !== 0) throw new Error(`qpdf failed: ${qdf.stderr}`);
        const text = qdf.stdout.toString("latin1");
        return Array.from(text.matchAll(/\/URI \(((?:\\.|[^\\)])*)\)/g), match => Buffer.from((match[1] ?? "").replace(/\\(.)/g, "$1"), "latin1").toString("utf8"));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe.skipIf(!hasQpdf)("Chromium PDF link URLs", () => {
    test("are the URLs the deck gives on text runs, shapes and images, not Chromium's canonical forms", async () => {
        const pres = new PuppeteerGen();
        const text = pres.addSlide();
        const shapes = pres.addSlide();
        const images = pres.addSlide();
        URLS.forEach((url, index) => {
            const y = 0.1 + index * 0.35;
            text.addText([{ text: `Link ${index}`, options: { hyperlink: { url } } }], { x: 0.5, y, w: 2, h: 0.3 });
            shapes.addShape("rect", { x: 0.5, y, w: 2, h: 0.3, fill: { color: "0088CC" }, hyperlink: { url } });
            images.addImage({ data: PNG, x: 0.5, y, w: 0.3, h: 0.3, hyperlink: { url } });
        });
        const pdf = await pres.toPdf();
        expect((await linkUris(pdf)).sort()).toEqual([...URLS, ...URLS, ...URLS].sort());
    }, 60_000);
});

describe("withLinkUris", () => {
    test("returns a PDF without link annotations as it is, and throws on a placeholder that names no link", () => {
        const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<</A <</S /URI /URI (https://pdflapas.invalid/3)>>>>\nendobj\n", "latin1");
        expect(withLinkUris(pdf, [])).toBe(pdf);
        // Every link clipped off its page: no annotation to rewrite.
        const clipped = Buffer.from("%PDF-1.4\n", "latin1");
        expect(withLinkUris(clipped, ["https://example.com"])).toBe(clipped);
        expect(() => withLinkUris(pdf, ["https://example.com"])).toThrow("its link placeholder 3 names no link of the document");
    });
});
