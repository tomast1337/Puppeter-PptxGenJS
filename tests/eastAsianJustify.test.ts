import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";

afterAll(closeBrowser);

// Justified paragraphs measured against PowerPoint's PDF export of a synthetic deck: 10pt, no `lang`, margin 0, 3.33in
// (239.76pt) boxes. Each case's lines as PowerPoint broke them, and whether it widened them to the edge.
const SIZE_PT = 10;
const BOX_PT = 239.76;
type Run = { text: string; face: string };
const CASES: readonly { label: string; runs: readonly Run[]; lines: readonly string[]; justified: boolean }[] = [
    {
        label: "Han only",
        runs: [{ text: "这是用于测量文字间距的示例内容我们需要足够长的一行来读出每个字符的宽度以及整行比较不同字号下的结果", face: "SimSun" }],
        lines: ["这是用于测量文字间距的示例内容我们需要足够长的", "一行来读出每个字符的宽度以及整行比较不同字号下", "的结果"],
        justified: false,
    },
    {
        label: "Han and Latin words",
        runs: [{ text: "这是用于测量 Alpha 文字间距的示例 Beta 内容我们需要 Gamma 足够长的一行来 Delta 读出每个字符的宽度 Omega 以及整行比较", face: "SimSun" }],
        lines: ["这是用于测量 Alpha 文字间距的示例 Beta 内容我们", "需要 Gamma 足够长的一行来 Delta 读出每个字符的", "宽度 Omega 以及整行比较"],
        justified: true,
    },
    {
        label: "one space a line",
        runs: [{ text: "这是用于测量文字间距的示 例内容我们需要足够长的一行来读出每个字 符的宽度以及整行比较不同字号下的结 果", face: "SimSun" }],
        lines: ["这是用于测量文字间距的示 例内容我们需要足够长的", "一行来读出每个字 符的宽度以及整行比较不同字号下", "的结 果"],
        justified: true,
    },
    {
        label: "full-width punctuation",
        runs: [{ text: "这是用于测量，文字间距的示例（内容）我们需要“足够长”的一行。来读出每个字符的宽度、以及整行比较；不同字号下的结果", face: "SimSun" }],
        lines: ["这是用于测量，文字间距的示例（内容）我们需要“", "足够长”的一行。来读出每个字符的宽度、以及整行", "比较；不同字号下的结果"],
        justified: false,
    },
    {
        label: "Arial and SimSun runs",
        runs: ["这是用于测量", " Alpha ", "文字间距的示例", " Beta ", "内容我们需要", " Gamma ", "足够长的一行来", " Delta ", "读出每个字符的宽度", " Omega ", "以及整行比较"].map((text, index) => ({ text, face: index % 2 ? "Arial" : "SimSun" })),
        lines: ["这是用于测量 Alpha 文字间距的示例 Beta 内容我们需", "要 Gamma 足够长的一行来 Delta 读出每个字符的宽度", "Omega 以及整行比较"],
        justified: true,
    },
];
const HAN = /^\p{Script=Han}+$/u;
const INVISIBLE = /[\u200b\u2060\u3000]/gu;

describe("justification on the PowerPoint target", () => {
    const paragraph = (presentation: PuppeteerGenPowerPoint | PuppeteerGenLibreOffice, align: "justify" | "left") => {
        presentation.addSlide().addText("示例 text", { x: 0, y: 0, w: 2, h: 1, align });
        const object = presentation.getModel().slides[0]?.objects[0];
        return object?.kind === "text" ? object.text.paragraphs[0] : undefined;
    };

    test("states inter-word justification on a justified PowerPoint paragraph only", async () => {
        expect(paragraph(new PuppeteerGenPowerPoint(), "justify")?.textJustify).toBe("inter-word");
        expect(paragraph(new PuppeteerGenPowerPoint(), "left")?.textJustify).toBeUndefined();
        expect(paragraph(new PuppeteerGenLibreOffice(), "justify")?.textJustify).toBeUndefined();
        const presentation = new PuppeteerGenPowerPoint();
        presentation.addSlide().addText("示例 text", { x: 0, y: 0, w: 2, h: 1, align: "justify" });
        expect((await presentation.toHtml()).html).toContain("text-align: justify; text-justify: inter-word;");
    });
});

describe("the measured justified boxes, in both renderers", () => {
    const pdftotext = Bun.which("pdftotext");
    const ready = pdftotext !== null && ["SimSun", "Arial"].every(face => resolveInstalledGlyphAdvances(face, false, false) !== undefined);
    const deck = (presentation: PuppeteerGenPowerPoint) => {
        for (const { runs } of CASES)
            presentation.addSlide().addText(
                runs.map(({ text, face }) => ({ text, options: { fontFace: face, fontSize: SIZE_PT } })),
                { x: 1, y: 0.5, w: BOX_PT / 72, h: 2, margin: 0, valign: "top", align: "justify", fontSize: SIZE_PT },
            );
        return presentation;
    };
    /** Each page's lines: their words (pdftotext -bbox) with x in pt from the box's left edge. */
    const drawnLines = async (pdf: Uint8Array) => {
        const directory = await mkdtemp(join(tmpdir(), "east-asian-justify-"));
        try {
            const file = join(directory, "deck.pdf");
            await writeFile(file, pdf);
            const html = Bun.spawnSync([pdftotext ?? "pdftotext", "-bbox", "-enc", "UTF-8", file, "-"]).stdout.toString();
            return html
                .split("<page ")
                .slice(1)
                .map(page => {
                    const words = Array.from(page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g), ([, xMin = "", yMin = "", xMax = "", yMax = "", text = ""]) => ({
                        text: text.replace(INVISIBLE, ""),
                        raw: text,
                        left: Number(xMin) - 72,
                        right: Number(xMax) - 72,
                        middle: (Number(yMin) + Number(yMax)) / 2,
                    })).filter(({ text }) => text);
                    // A word is on the line before while its middle is within a quarter of the 12pt line pitch: faces differ in height.
                    const lines: (typeof words)[] = [];
                    for (const word of words.sort((a, b) => a.middle - b.middle || a.left - b.left)) {
                        const line = lines[lines.length - 1];
                        if (line && Math.abs((line[0]?.middle ?? 0) - word.middle) < 3) line.push(word);
                        else lines.push([word]);
                    }
                    return lines.map(line => line.sort((a, b) => a.left - b.left));
                });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    };
    const check = (pages: Awaited<ReturnType<typeof drawnLines>>) =>
        CASES.forEach(({ label, lines, justified }, index) => {
            const drawn = pages[index] ?? [];
            // Without spaces: pdftotext also splits words at the U+200B the target writes around full-width punctuation.
            expect({ label, lines: drawn.map(words => words.map(({ text }) => text).join("")) }).toEqual({ label, lines: lines.map(line => line.replaceAll(" ", "")) });
            drawn.slice(0, -1).forEach(words => {
                const end = words[words.length - 1]?.right ?? 0;
                // PowerPoint: to the edge with a space on the line, else short of it, where the left-aligned line ends (a
                // word's box takes in the U+200B after it, drawn with no advance).
                expect({ label, end: justified ? Math.abs(end - BOX_PT) < 0.3 : end < BOX_PT - 1 }).toEqual({ label, end: true });
                // Every Han word keeps its advances, 1em a character in SimSun (a word without a U+200B, whose box adds to it).
                for (const { text, left, right } of words.filter(({ raw }) => HAN.test(raw))) expect({ label, text, width: Math.abs(right - left - [...text].length * SIZE_PT) < 0.15 }).toEqual({ label, text, width: true });
            });
        });

    test.skipIf(!ready)("widens only the spaces of each line, in Chromium", async () => check(await drawnLines(await deck(new PuppeteerGenPowerPoint()).toPdf())), 60_000);

    test.skipIf(!ready)(
        "widens only the spaces of each line, in the WASM renderer",
        async () => {
            const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
            // The second line of "Arial and SimSun runs" fills its box to 0.01pt over four run boundaries (#370).
            check(await drawnLines(await deck(new PuppeteerGenPowerPoint(undefined, { renderer })).toPdf()));
        },
        60_000,
    );
});

describe("the spacing pass moves no line break", () => {
    const pdftotext = Bun.which("pdftotext");
    const ready = pdftotext !== null && ["Calibri", "Microsoft JhengHei"].every(face => resolveInstalledGlyphAdvances(face, false, false) !== undefined);
    // Placeholder phrases: Han with 。 and full-width brackets, and runs of two or three English words.
    const HAN_PHRASES = ["這是用於測量", "文字間距的範例", "內容我們需要", "足夠長的一行", "來讀出每個字元的寬度", "以及整行比較。", "範例（內容）", "測量。"];
    const LATIN_PHRASES = ["Alpha Beta", "Gamma Delta Omega", "Sample Text", "Open Source Tool", "Test Case Value"];
    const deck = (align: "justify" | "left") => {
        const presentation = new PuppeteerGenPowerPoint();
        for (let index = 0; index < 24; index++) {
            const runs = Array.from({ length: 24 }, (_, piece) =>
                piece % 2 ? { text: ` ${LATIN_PHRASES[(index * 7 + piece) % LATIN_PHRASES.length]} `, options: { fontFace: "Calibri", bold: (index + piece) % 5 === 0 } } : { text: HAN_PHRASES[(index * 3 + piece) % HAN_PHRASES.length] ?? "", options: { fontFace: "Microsoft JhengHei" } },
            );
            presentation.addSlide().addText(runs, { lang: "zh-TW", x: 0.5, y: 0.3, w: 2 + (index % 8) * 0.37, h: 6, margin: 0.05, valign: "top", align, fontSize: [8, 9, 10, 10.5, 11, 12][index % 6] });
        }
        return presentation.toPdf();
    };
    const lines = async (pdf: Uint8Array) => {
        const directory = await mkdtemp(join(tmpdir(), "east-asian-justify-"));
        try {
            const file = join(directory, "deck.pdf");
            await writeFile(file, pdf);
            return Bun.spawnSync([pdftotext ?? "pdftotext", "-raw", "-enc", "UTF-8", file, "-"])
                .stdout.toString()
                .replaceAll(" ", "")
                .split("\n");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    };

    // The pass lays a paragraph out left-aligned and only then widens its spaces, so its lines are the left-aligned ones.
    test.skipIf(!ready)("breaks a justified paragraph of Han and English words where the left-aligned one breaks", async () => expect(await lines(await deck("justify"))).toEqual(await lines(await deck("left"))), 60_000);
});
