import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { objectOffsets, pdfText } from "../packages/puppeteer/src/pdfUpdate";
import { withType1CFonts } from "../packages/puppeteer/src/type3Fonts";

// An installed face with CFF outlines (an OpenType OTTO face), which Skia would draw as a Type 3 font: URW Gothic is the
// one #347 found it with, Noto Sans CJK the one the visual Docker image has.
const CFF_FACE = ["URW Gothic", "Nimbus Sans", "Noto Sans CJK SC"].find(face => spawnSync("fc-list", [`:family=${face}:fontformat=CFF`, "family"], { encoding: "utf8" }).stdout?.trim());
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;
const WORDS = ["Lorem", "ipsum", "dolor", "sit", "amet"];
const FONT_SIZE = 18;
const WORD_BOX = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;

afterAll(closeBrowser);

/** The newest version of every font dictionary of `pdf`, across its incremental updates. */
function fontDictionaries(pdf: Uint8Array): string[] {
    const text = pdfText(pdf);
    return [...objectOffsets(text, problem => new Error(problem)).values()].map(offset => text.slice(offset, text.indexOf("endobj", offset))).filter(body => /\/Type \/Font\b/.test(body));
}

async function cffDeck(): Promise<Uint8Array> {
    const pptx = new PuppeteerGen();
    pptx.addSlide().addText(WORDS.join(" "), { x: 1, y: 1, w: 6, h: 1, fontFace: CFF_FACE, fontSize: FONT_SIZE });
    return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}

describe.skipIf(!CFF_FACE)(`a deck in a CFF face (${CFF_FACE})`, () => {
    test("embeds the face as a Type 1 font with a CFF program, no Type 3 font, the same bytes on every render", async () => {
        const pdf = await cffDeck();
        const fonts = fontDictionaries(pdf);
        expect(fonts.length).toBeGreaterThan(0);
        expect(fonts.filter(font => font.includes("/Subtype /Type3"))).toEqual([]);
        expect(fonts.some(font => font.includes("/Subtype /Type1\n"))).toBe(true);
        expect(pdfText(pdf)).toContain("/Subtype /Type1C");
        expect(await cffDeck()).toEqual(pdf);
    });

    test.skipIf(!hasPdftotext)("keeps its words extractable, each boxed on its line at the font size", async () => {
        const directory = await mkdtemp(join(tmpdir(), "pdflapas-cff-"));
        try {
            const path = join(directory, "deck.pdf");
            await writeFile(path, await cffDeck());
            const result = spawnSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" });
            const boxes = [...result.stdout.matchAll(WORD_BOX)].map(([, , yMin = "", , yMax = "", word]) => ({ word, top: Number(yMin), bottom: Number(yMax) }));
            expect(boxes.map(box => box.word)).toEqual(WORDS);
            // The Type 3 box ran from Skia's y-down font bounding box; a font's box spans about its ascent and descent.
            for (const { top, bottom } of boxes) {
                expect(bottom - top).toBeGreaterThan(FONT_SIZE * 0.8);
                expect(bottom - top).toBeLessThan(FONT_SIZE * 1.6);
                expect(top).toBe(boxes[0]?.top ?? Number.NaN);
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

/** A one-page PDF in Chromium's layout whose Type 3 font has one glyph, drawn by `procedure`. */
function type3Pdf(procedure: string): Uint8Array {
    const objects = [
        "<</Type /Catalog /Pages 2 0 R>>",
        "<</Type /Pages /Kids [3 0 R] /Count 1>>",
        "<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <</Font <</F1 4 0 R>>>> /Contents 7 0 R>>",
        "<</Type /Font\n/Subtype /Type3\n/FontMatrix [.00100000005 0 0 -.00100000005 0 0]\n/FirstChar 0\n/LastChar 1\n/FontBBox [0 100 500 -700]\n/FontDescriptor 5 0 R\n/Widths [0 500]\n/Encoding <</Type /Encoding\n/Differences [0 /g0 /g1]>>\n/CharProcs <</g1 6 0 R>>>>",
        "<</Type /FontDescriptor\n/FontName /AAAAAA+Test\n/CapHeight -700\n/Flags 4>>",
        stream(procedure),
        stream("BT /F1 12 Tf 1 0 0 -1 10 50 Tm <01> Tj ET"),
    ];
    let body = "%PDF-1.4\n";
    const offsets = objects.map((object, index) => {
        const offset = body.length;
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${body.length}\n%%EOF\n`;
    return Buffer.from(body, "latin1");
}

function stream(content: string): string {
    return `<</Length ${content.length}>> stream\n${content}\nendstream`;
}

describe("withType1CFonts", () => {
    test("rewrites a Type 3 font of filled outlines as Type 1C, upright, its heights positive", () => {
        const pdf = withType1CFonts(type3Pdf("500 0 0 -700 500 0 d1\n0 0 m\n500 0 l\n500 -700 l\nh\nf"));
        expect(fontDictionaries(pdf).find(font => font.includes("/BaseFont /AAAAAA+Test"))).toContain("/Subtype /Type1\n");
        expect(pdfText(pdf)).toContain("/CapHeight 700\n/FontBBox [0 -100 500 700]\n/Ascent 700\n/Descent -100\n/FontFile3 ");
    });

    test("leaves a Type 3 font alone when a glyph is not a nonzero-filled outline", () => {
        for (const procedure of ["500 0 0 -700 500 0 d1\n0 0 m\n500 0 l\n500 -700 l\nh\nf*", "500 0 d0\nq 500 0 0 700 0 -700 cm /X0 Do Q", "500 0 0 -700 500 0 d1\n0 0 m\n500 0 l\nS"]) {
            const pdf = type3Pdf(procedure);
            expect(withType1CFonts(pdf)).toBe(pdf);
        }
    });
});
