import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PDF_PRODUCER } from "../packages/model/src/index";
import { pdfDate, withDocumentInfo } from "../packages/puppeteer/src/pdfInfo";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";

const KEYS = ["author", "company", "revision", "subject", "title"] as const;
const hasPdfinfo = spawnSync("pdfinfo", ["-v"]).status === 0;
const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
const wasmBuilt = await Bun.file(resolve(import.meta.dir, "../packages/wasm/src/pdf_wasm_bg.wasm")).exists();
const systemFonts = wasmBuilt ? await loadSystemFonts().catch(() => []) : [];

afterAll(closeBrowser);

/** The PDF's document information dictionary as pdfinfo -custom prints it (standard and custom keys), and qpdf's check. */
async function documentInfo(pdf: Uint8Array): Promise<Record<string, string>> {
    const directory = await mkdtemp(join(tmpdir(), "pdflapas-info-"));

    try {
        const path = join(directory, "deck.pdf");

        await writeFile(path, pdf);
        if (hasQpdf) {
            const check = spawnSync("qpdf", ["--check", path], { encoding: "utf8" });

            if (check.status !== 0) {
                throw new Error(`qpdf --check failed: ${check.stdout}${check.stderr}`);
            }
        }

        const result = spawnSync("pdfinfo", ["-custom", "-isodates", "-enc", "UTF-8", path], { encoding: "utf8" });

        if (result.status !== 0) {
            throw new Error(`pdfinfo failed: ${result.stderr}`);
        }

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

/** A one-slide deck with every document property set, non-ASCII (Latin and CJK) and PDF string delimiters included. */
function fullDeck(renderer?: ConstructorParameters<typeof PuppeteerGen>[1]): PuppeteerGen {
    const pres = new PuppeteerGen(undefined, renderer);

    pres.title = "Q3 plan – é 漢";
    pres.author = "Ana (A)";
    pres.subject = "Sales";
    pres.company = "Acme <Labs>";
    pres.revision = "7";
    pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });

    return pres;
}

// Both renderers name PdfLapas as Creator and Producer, as PowerPoint's export names itself, and write no dates.
const PRODUCER_INFO = { Creator: PDF_PRODUCER, Producer: PDF_PRODUCER };
const FULL_INFO = { Title: "Q3 plan – é 漢", Author: "Ana (A)", Subject: "Sales", Company: "Acme <Labs>", Revision: "7", ...PRODUCER_INFO };

/** `pdfMetadata` with every property, non-ASCII included, and two different dates (local-time constructors on purpose: written in UTC). */
const PDF_METADATA = {
    creator: "Ação App 漢",
    producer: "Lib (v2) ü",
    keywords: "q3, vendas, 漢字",
    creationDate: new Date("2026-01-02T03:04:05.678Z"),
    modificationDate: new Date("2026-11-19T23:59:59+05:00"),
};
const PDF_METADATA_INFO = { Creator: "Ação App 漢", Producer: "Lib (v2) ü", Keywords: "q3, vendas, 漢字", CreationDate: "2026-01-02T03:04:05Z", ModDate: "2026-11-19T18:59:59Z" };

/** A one-slide deck with the given `pdfMetadata` and no `pres.*` properties. */
function pdfMetadataDeck(options: ConstructorParameters<typeof PuppeteerGen>[1]): PuppeteerGen {
    const pres = new PuppeteerGen(undefined, options);

    pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });

    return pres;
}

describe("presentation metadata", () => {
    test("nothing is set by default, unlike PptxGenJS's branding defaults; setters read back", () => {
        const ours = new PuppeteerGen();
        // PptxGenJS 4.0.1 reads "PptxGenJS" or "PptxGenJS Presentation" (revision "1") before anything is set.
        const reference = new pptxgen();

        for (const key of KEYS) {
            expect({ key, ours: ours[key], reference: reference[key] !== "" }).toEqual({ key, ours: "", reference: true });
        }

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

        expect(html).toContain('<meta name="pdflapas-profile" content="2">');
        expect(html).toContain('<title>Q3 &lt;plan&gt; &amp; review</title><meta name="author" content="Ana &quot;A&quot;"><meta name="pdflapas-company" content="Acme"><meta name="pdflapas-revision" content="7"><style');
        expect(html).not.toContain('name="description"');

        const unset = new PuppeteerGen();

        unset.addSlide();
        expect((await unset.toHtml()).html).toMatch(/<meta name="pdflapas-page-size" content="[^"]*"><style/);
    });
});

describe("pdfMetadata option", () => {
    test("reaches the model as plain JSON, dates as UTC ISO strings, next to the pres.* properties", () => {
        const pres = new PuppeteerGen(undefined, { pdfMetadata: { ...PDF_METADATA, keywords: "" } });

        pres.title = "T";
        const metadata = pres.getModel().metadata;

        expect(metadata).toEqual({ title: "T", creator: "Ação App 漢", producer: "Lib (v2) ü", creationDate: "2026-01-02T03:04:05.678Z", modificationDate: "2026-11-19T18:59:59.000Z" });
        expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
    });

    test("toHtml() writes each set one as a meta tag after the PptxGenJS properties, the same for the same options", async () => {
        const html = async () => (await pdfMetadataDeck({ pdfMetadata: PDF_METADATA }).toHtml()).html;
        const first = await html();

        expect(first).toContain(
            '<meta name="keywords" content="q3, vendas, 漢字"><meta name="pdflapas-creator" content="Ação App 漢"><meta name="pdflapas-producer" content="Lib (v2) ü"><meta name="pdflapas-creation-date" content="2026-01-02T03:04:05.678Z"><meta name="pdflapas-modification-date" content="2026-11-19T18:59:59.000Z"><style',
        );
        expect(await html()).toBe(first);
        // An empty object, or empty strings, write nothing: the HTML of a deck without the option.
        const plain = (await pdfMetadataDeck({}).toHtml()).html;

        expect((await pdfMetadataDeck({ pdfMetadata: { creator: "", keywords: "" } }).toHtml()).html).toBe(plain);
        expect(plain).not.toContain("pdflapas-creator");
    });

    test("invalid input throws naming the option and the fix", () => {
        const make = (pdfMetadata: unknown) => () => new PuppeteerGen(undefined, { pdfMetadata: pdfMetadata as never });

        expect(make({ creationDate: new Date("nope") })).toThrow("PuppeteerGen option `pdfMetadata.creationDate` is an Invalid Date; pass a Date built from a valid time");
        expect(make({ modificationDate: "2026-01-01" })).toThrow("PuppeteerGen option `pdfMetadata.modificationDate` must be a Date, got string");
        expect(make({ creationDate: new Date(Date.UTC(10000, 0, 1)) })).toThrow("`pdfMetadata.creationDate` is in the year 10000; a PDF date needs a year from 0 to 9999");
        expect(make({ creator: 3 })).toThrow("PuppeteerGen option `pdfMetadata.creator` must be a string, got number");
        expect(make({ author: "A" })).toThrow("`pdfMetadata.author` is not a PDF property PdfLapas writes; use one of creator, producer, keywords, creationDate, modificationDate");
        expect(make("x")).toThrow("PuppeteerGen option `pdfMetadata` must be an object, got string");
    });

    test("a profile date that is not UTC ISO cannot reach the Puppeteer Info dictionary", () => {
        expect(pdfDate("2026-11-19T12:34:56.789Z")).toBe("(D:20261119123456Z)");
        expect(() => pdfDate("2026-11-19T12:34:56+01:00")).toThrow('Cannot write the PDF dates: "2026-11-19T12:34:56+01:00" is not a UTC date such as 2026-11-19T12:34:56.000Z');
    });
});

test("the Rust renderer's PRODUCER is PDF_PRODUCER", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../crates/pdf-core/src/document_info.rs")).text();

    expect(/const PRODUCER: &str = "([^"]*)";/.exec(source)?.[1]).toBe(PDF_PRODUCER);
});

describe("Puppeteer PDF document information", () => {
    test("a PDF Chromium did not write throws naming the problem", () => {
        const bytes = new TextEncoder().encode("not a pdf");

        expect(() => withDocumentInfo(bytes, { Title: "T" })).toThrow("Chromium's PDF is not in the shape expected (its startxref does not point at a cross-reference table)");
    });

    test("Chromium's per-run dates and /ID do not reach the bytes; the new /ID is the MD5 of the content (#321)", () => {
        // `withDocumentInfo` on a PDF in the shape Chromium prints: Info dictionary (object 1, dated `date`, its title
        // holding "endobj"), a catalog, `page` as object 3, a cross-reference table and a trailer with `/ID [<id><id>]`,
        // as Skia writes it in PDF/A mode.
        const updated = (date: string, id: string, page = "<</Type /Page>>") => {
            const objects = [`<</Title (endobj) /Producer (Skia/PDF m138) /CreationDate (D:${date}+00'00') /ModDate (D:${date}+00'00')>>`, "<</Type /Catalog>>", page];
            let text = "%PDF-1.4\n";
            const offsets: number[] = [];

            for (const [index, body] of objects.entries()) {
                offsets.push(text.length);
                text += `${index + 1} 0 obj\n${body}\nendobj\n`;
            }

            const xref = text.length;

            text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
            text += `trailer\n<</Size ${objects.length + 1} /Root 2 0 R /Info 1 0 R /ID [<${id}><${id}>]>>\nstartxref\n${xref}\n%%EOF\n`;

            return withDocumentInfo(Buffer.from(text, "latin1"), { Title: "T" });
        };
        const pdf = updated("20261120003421", "a143976c799f57ec00f5a8445a2f0963");

        expect(updated("20261120003422", "e7146a3a6508b33edb91c8ce2bdf5e58")).toEqual(pdf);
        const text = new TextDecoder("latin1").decode(pdf);

        expect(text).not.toContain("D:2026");
        expect(text).not.toContain("a143976c");
        // The title holds "endobj": the next object's offset bounds the blanked Info object, so object 2 survives.
        expect(text).toContain("1 0 obj<<>>     ");
        expect(text).toContain("2 0 obj\n<</Type /Catalog>>");
        // A new document: both halves are the same.
        const [, id = "", instance] = /\/ID \[<([0-9a-f]{32})><([0-9a-f]{32})>\]>>\nstartxref\n\d+\n%%EOF\n$/.exec(text) ?? [];

        expect(id).toHaveLength(32);
        expect(instance).toBe(id);
        const page = updated("20261120003421", "a143976c799f57ec00f5a8445a2f0963", "<</Type /Page /Rotate 90>>");

        expect(new TextDecoder("latin1").decode(page)).not.toContain(id);
    });

    test("the same deck prints to the same bytes in two pages, across a change of the wall-clock second", async () => {
        const deck = () => {
            const pres = new PuppeteerGen();

            pres.addSlide().addText("Same bytes", { x: 1, y: 1, w: 3, h: 1 });

            return pres.toPdf();
        };
        const first = await deck();

        // Chromium dates its Info dictionary to the second.
        await Bun.sleep(1100 - (Date.now() % 1000));
        expect(await deck()).toEqual(first);
    }, 60_000);

    test.skipIf(!hasPdfinfo)(
        "every property reaches the Info dictionary, Company and Revision as custom keys; Chromium's own entries are replaced",
        async () => {
            expect(await documentInfo(await fullDeck().toPdf())).toEqual(FULL_INFO);
        },
        60_000,
    );

    test.skipIf(!hasPdfinfo)(
        "a deck that sets none, or sets an empty title, gets only the Creator and Producer",
        async () => {
            const pres = new PuppeteerGen();

            pres.title = "";
            pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
            expect(await documentInfo(await pres.toPdf())).toEqual(PRODUCER_INFO);
        },
        60_000,
    );

    test.skipIf(!hasPdfinfo)(
        "pdfMetadata's creator, producer, keywords and dates replace the defaults; one date is both",
        async () => {
            expect(await documentInfo(await pdfMetadataDeck({ pdfMetadata: PDF_METADATA }).toPdf())).toEqual(PDF_METADATA_INFO);
            const created = { creationDate: PDF_METADATA.creationDate };

            expect(await documentInfo(await pdfMetadataDeck({ pdfMetadata: created }).toPdf())).toEqual({ ...PRODUCER_INFO, CreationDate: "2026-01-02T03:04:05Z", ModDate: "2026-01-02T03:04:05Z" });
        },
        60_000,
    );
});

describe.skipIf(!hasPdfinfo || systemFonts.length === 0)("WASM PDF document information", () => {
    test("the same entries as the Puppeteer renderer, and only the Creator and Producer for a deck that sets none", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });

        expect(await documentInfo(await fullDeck({ renderer }).toPdf())).toEqual(FULL_INFO);
        const pres = new PuppeteerGen(undefined, { renderer });

        pres.title = "";
        pres.addSlide().addText("Hi", { x: 1, y: 1, w: 3, h: 1 });
        expect(await documentInfo(await pres.toPdf())).toEqual(PRODUCER_INFO);
    });

    test("the same pdfMetadata entries as the Puppeteer renderer, alone and with Company, and the same bytes twice", async () => {
        const renderer = await createWasmRenderer({ fonts: systemFonts });
        const pdf = await pdfMetadataDeck({ renderer, pdfMetadata: PDF_METADATA }).toPdf();

        expect(await documentInfo(pdf)).toEqual(PDF_METADATA_INFO);
        expect(await pdfMetadataDeck({ renderer, pdfMetadata: PDF_METADATA }).toPdf()).toEqual(pdf);
        const created = { creationDate: PDF_METADATA.creationDate };

        expect(await documentInfo(await pdfMetadataDeck({ renderer, pdfMetadata: created }).toPdf())).toEqual({ ...PRODUCER_INFO, CreationDate: "2026-01-02T03:04:05Z", ModDate: "2026-01-02T03:04:05Z" });
        expect(await documentInfo(await fullDeck({ renderer, pdfMetadata: PDF_METADATA }).toPdf())).toEqual({ ...FULL_INFO, ...PDF_METADATA_INFO });
    });
});
