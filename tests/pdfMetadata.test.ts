import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { withDocumentInfo } from "../packages/puppeteer/src/pdfInfo";

const KEYS = ["author", "company", "revision", "subject", "title"] as const;
const hasPdfinfo = spawnSync("pdfinfo", ["-v"]).status === 0;

afterAll(closeBrowser);

/** pdfinfo's "Key: value" lines, as a map. */
async function pdfinfo(pdf: Uint8Array): Promise<Map<string, string>> {
    const directory = await mkdtemp(join(tmpdir(), "pdfdeck-info-"));
    try {
        const path = join(directory, "deck.pdf");
        await writeFile(path, pdf);
        const result = spawnSync("pdfinfo", ["-enc", "UTF-8", path], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`pdfinfo failed: ${result.stderr}`);
        return new Map(
            result.stdout.split("\n").flatMap(line => {
                const match = /^([^:]+):\s+(.*)$/.exec(line);
                return match?.[1] && match[2] !== undefined ? [[match[1], match[2]] as const] : [];
            }),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe("presentation metadata", () => {
    test("defaults and setters match PptxGenJS 4.0.1", () => {
        const ours = new PuppeteerGen();
        const reference = new pptxgen();
        for (const key of KEYS) expect({ key, value: ours[key] }).toEqual({ key, value: reference[key] });
        for (const key of KEYS) {
            ours[key] = `${key} value`;
            expect(ours[key]).toBe(`${key} value`);
        }
        expect(ours.getModel().metadata).toEqual({ author: "author value", company: "company value", revision: "revision value", subject: "subject value", title: "title value" });
    });

    test("a value that is not a string throws a TypeError naming the property", () => {
        const pres = new PuppeteerGen();
        expect(() => {
            pres.revision = 2 as unknown as string;
        }).toThrow("pres.revision must be a string, got number; an empty string leaves it out of the PDF");
    });

    test("toHtml() writes them to <head> as profile version 2, escaped, leaving empty ones out", async () => {
        const pres = new PuppeteerGen();
        pres.title = "Q3 <plan> & review";
        pres.author = 'Ana "A"';
        pres.subject = "";
        pres.company = "Acme";
        pres.revision = "7";
        pres.addSlide();
        const { html } = await pres.toHtml();
        expect(html).toContain('<meta name="pdfdeck-profile" content="2">');
        expect(html).toContain('<title>Q3 &lt;plan&gt; &amp; review</title><meta name="author" content="Ana &quot;A&quot;"><meta name="pdfdeck-company" content="Acme"><meta name="pdfdeck-revision" content="7"><style');
        expect(html).not.toContain('name="description"');
    });
});

describe("Puppeteer PDF document information", () => {
    test("without entries the PDF is returned as is; a PDF Chromium did not write throws naming the problem", () => {
        const bytes = new TextEncoder().encode("not a pdf");
        expect(withDocumentInfo(bytes, { Title: "" })).toBe(bytes);
        expect(() => withDocumentInfo(bytes, { Title: "T" })).toThrow("Chromium's PDF is not in the shape expected (its startxref does not point at a cross-reference table)");
    });

    test.skipIf(!hasPdfinfo)(
        "Title, Author and Subject reach the PDF; Chromium's Creator and Producer stay",
        async () => {
            const pres = new PuppeteerGen();
            pres.title = "Q3 plan – ü";
            pres.author = "Ana (A)";
            pres.subject = "Sales";
            pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
            const info = await pdfinfo(await pres.toPdf());
            expect([info.get("Title"), info.get("Author"), info.get("Subject"), info.get("Creator"), info.get("Pages")]).toEqual(["Q3 plan – ü", "Ana (A)", "Sales", "Chromium", "1"]);
            expect(info.get("Producer")).toStartWith("Skia/PDF");
        },
        60_000,
    );
});
