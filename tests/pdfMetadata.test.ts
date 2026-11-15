import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { withDocumentInfo } from "../packages/puppeteer/src/pdfInfo";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";

const KEYS = ["author", "company", "revision", "subject", "title"] as const;
const hasPdfinfo = spawnSync("pdfinfo", ["-v"]).status === 0;
const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
const wasmBuilt = await Bun.file(resolve(import.meta.dir, "../packages/wasm/src/pdf_wasm_bg.wasm")).exists();
const systemFonts = wasmBuilt ? await loadSystemFonts().catch(() => []) : [];

afterAll(closeBrowser);

/** The PDF's document information dictionary as pdfinfo -custom prints it (standard and custom keys), and qpdf's check. */
async function documentInfo(pdf: Uint8Array): Promise<Record<string, string>> {
    const directory = await mkdtemp(join(tmpdir(), "pdfdeck-info-"));
    try {
        const path = join(directory, "deck.pdf");
        await writeFile(path, pdf);
        if (hasQpdf) {
            const check = spawnSync("qpdf", ["--check", path], { encoding: "utf8" });
            if (check.status !== 0) throw new Error(`qpdf --check failed: ${check.stdout}${check.stderr}`);
        }
        const result = spawnSync("pdfinfo", ["-custom", "-enc", "UTF-8", path], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`pdfinfo failed: ${result.stderr}`);
        return Object.fromEntries(
            result.stdout.split("\n").flatMap(line => {
                const match = /^([^:]+):\s+(.*)$/.exec(line);
                return match?.[1] && match[2] !== undefined ? [[match[1], match[2]] as const] : [];
            }),
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

/** A one-slide deck with every document property set, non-ASCII and PDF string delimiters included. */
function fullDeck(renderer?: ConstructorParameters<typeof PuppeteerGen>[1]): PuppeteerGen {
    const pres = new PuppeteerGen(undefined, renderer);
    pres.title = "Q3 plan – ü";
    pres.author = "Ana (A)";
    pres.subject = "Sales";
    pres.company = "Acme <Labs>";
    pres.revision = "7";
    pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
    return pres;
}

const FULL_INFO = { Title: "Q3 plan – ü", Author: "Ana (A)", Subject: "Sales", Company: "Acme <Labs>", Revision: "7" };
// Entries Chromium writes on its own; the WASM renderer writes none.
const CHROMIUM_KEYS = ["CreationDate", "Creator", "ModDate", "Producer"];
const userEntries = (info: Record<string, string>) => Object.fromEntries(Object.entries(info).filter(([key]) => !CHROMIUM_KEYS.includes(key)));

describe("presentation metadata", () => {
    test("nothing is set by default, unlike PptxGenJS's branding defaults; setters read back", () => {
        const ours = new PuppeteerGen();
        // PptxGenJS 4.0.1 reads "PptxGenJS" or "PptxGenJS Presentation" (revision "1") before anything is set.
        const reference = new pptxgen();
        for (const key of KEYS) expect({ key, ours: ours[key], reference: reference[key] !== "" }).toEqual({ key, ours: "", reference: true });
        expect(ours.getModel().metadata).toEqual({});
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

    test("toHtml() writes the set ones to <head> as profile version 2, escaped, and nothing for the others", async () => {
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

        const unset = new PuppeteerGen();
        unset.addSlide();
        expect((await unset.toHtml()).html).toMatch(/<meta name="pdfdeck-page-size" content="[^"]*"><style/);
    });
});

describe("Puppeteer PDF document information", () => {
    test("without entries the PDF is returned as is; a PDF Chromium did not write throws naming the problem", () => {
        const bytes = new TextEncoder().encode("not a pdf");
        expect(withDocumentInfo(bytes, { Title: "" })).toBe(bytes);
        expect(() => withDocumentInfo(bytes, { Title: "T" })).toThrow("Chromium's PDF is not in the shape expected (its startxref does not point at a cross-reference table)");
    });

    test.skipIf(!hasPdfinfo)(
        "every property reaches the Info dictionary, Company and Revision as custom keys; Chromium's own entries stay",
        async () => {
            const info = await documentInfo(await fullDeck().toPdf());
            expect(userEntries(info)).toEqual(FULL_INFO);
            expect(info.Creator).toBe("Chromium");
            expect(info.Producer).toStartWith("Skia/PDF");
        },
        60_000,
    );

    test.skipIf(!hasPdfinfo)(
        "a deck that sets none gets no Title, Author, Subject, Company or Revision",
        async () => {
            const pres = new PuppeteerGen();
            pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
            expect(userEntries(await documentInfo(await pres.toPdf()))).toEqual({});
        },
        60_000,
    );
});

describe.skipIf(!hasPdfinfo || systemFonts.length === 0)("WASM PDF document information", () => {
    test("the same entries as the Puppeteer renderer, and none for a deck that sets none", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        expect(await documentInfo(await fullDeck({ renderer }).toPdf())).toEqual(FULL_INFO);
        const pres = new PuppeteerGen(undefined, { renderer });
        pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
        expect(await documentInfo(await pres.toPdf())).toEqual({});
    });
});
