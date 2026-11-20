import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedTextRun } from "@pdflapas/model";
import { PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { breakAroundQuotes, chineseLineBreak, hangingMarkRuns, hangingSegments } from "../packages/pptxgenjs/src/normalize/chineseLineBreak";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import { type ChineseBreakCase, chineseBreakCases, chineseBreakDeck } from "./chineseBreakCases";

afterAll(closeBrowser);

const MARKS = RENDERING_TARGETS.powerpoint.hangingMarks;

describe("Chinese line breaks on the PowerPoint target", () => {
    test("applies to zh runs only", () => {
        expect(["zh", "zh-CN", "zh-TW", "ZH-hk"].map(chineseLineBreak)).toEqual([true, true, true, true]);
        expect(["en-US", "ja-JP", "zhx", ""].map(chineseLineBreak)).toEqual([false, false, false, false]);
    });

    test("cuts out a closing mark before a Han character or the line's end, and only then", () => {
        expect(hangingSegments("内容，其他", undefined, MARKS)).toEqual([
            { text: "内容", hangs: false },
            { text: "，", hangs: true },
            { text: "其他", hangs: false },
        ]);
        // "）" before "。" stays: only the last of two marks hangs.
        expect(hangingSegments("（第一）。", undefined, MARKS)).toEqual([
            { text: "（第一）", hangs: false },
            { text: "。", hangs: true },
        ]);
        // Before a Latin letter, unmeasured: kept. Across a run boundary, the next run's first character decides.
        expect(hangingSegments("内容，A", undefined, MARKS)).toEqual([{ text: "内容，A", hangs: false }]);
        expect(hangingSegments("内容，", "A", MARKS)).toEqual([{ text: "内容，", hangs: false }]);
        expect(hangingSegments("内容，", "其", MARKS)).toEqual([
            { text: "内容", hangs: false },
            { text: "，", hangs: true },
        ]);
        expect(hangingSegments("", undefined, MARKS)).toEqual([{ text: "", hangs: false }]);
        expect(hangingSegments("内容，其他", undefined, "")).toEqual([{ text: "内容，其他", hangs: false }]);
    });

    /** A model run of "，" at 10pt, as normalization gives it on the LibreOffice target (no hang). */
    const modelRun = (): NormalizedTextRun => {
        const presentation = new PuppeteerGenLibreOffice();
        presentation.addSlide().addText("，", { x: 0, y: 0, w: 2, h: 1, fontSize: 10 });
        const object = presentation.getModel().slides[0]?.objects[0];
        const run = object?.kind === "text" ? object.text.paragraphs[0]?.runs[0] : undefined;
        if (!run) throw new Error("The deck has no text run.");
        return run;
    };
    const mark: NormalizedTextRun = { ...modelRun(), characterSpacing: 0.25, softBreakBefore: true };
    const size = mark.fontSize;

    test("draws a hanging mark with no advance, then a U+3000 as wide as the mark was laid out", () => {
        // 1em from U+2000 without the face's advances; the advance grid spacing (0.25) stays in the pair's width.
        expect(hangingMarkRuns(mark, undefined)).toEqual([
            { ...mark, characterSpacing: -size },
            { ...mark, text: "\u3000", characterSpacing: 0.25, softBreakBefore: false },
        ]);
        // The face's advances when known: a half-width mark followed by a 1em U+3000.
        const font = {
            unitsPerEm: 256,
            advances: new Map([
                [0x29, 128],
                [0x3000, 256],
            ]),
        };
        expect(hangingMarkRuns({ ...mark, text: ")" }, font)).toEqual([
            { ...mark, text: ")", characterSpacing: -size / 2 },
            { ...mark, text: "\u3000", characterSpacing: 0.25 - size / 2, softBreakBefore: false },
        ]);
        // A narrow mark whose advance is not known is left as it is.
        expect(hangingMarkRuns({ ...mark, text: ")" }, undefined)).toEqual([{ ...mark, text: ")" }]);
    });

    test("breaks before a left double quote after Han, and around an ASCII quote between Han characters", () => {
        expect(breakAroundQuotes("他说“这是”然后", "", "")).toBe("他说\u200b“这是”然后");
        expect(breakAroundQuotes('他说"示例"很好', "", "")).toBe('他说\u200b"\u200b示例\u200b"\u200b很好');
        expect(breakAroundQuotes('"示例', "说", "")).toBe('\u200b"\u200b示例');
        expect(breakAroundQuotes('A"B', "", "")).toBe('A"B');
        expect(breakAroundQuotes("say “this”", "", "")).toBe("say “this”");
    });

    test("writes the hang and the breaks in a zh run's text on the PowerPoint target, not on LibreOffice or in en-US", async () => {
        const text = (presentation: PuppeteerGenPowerPoint | PuppeteerGenLibreOffice, lang: string) => {
            presentation.addSlide().addText('他说"示例"，其他', { x: 0, y: 0, w: 2, h: 1, fontFace: "SimSun", lang });
            return presentation.getModel().slides[0]?.objects.flatMap(object => (object.kind === "text" ? object.text.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.text)) : []));
        };
        expect(text(new PuppeteerGenPowerPoint(), "zh-CN")).toEqual(['他说\u200b"\u200b示例"', "，", "\u3000", "其他"]);
        expect(text(new PuppeteerGenLibreOffice(), "zh-CN")).toEqual(['他说"示例"，其他']);
        expect(text(new PuppeteerGenPowerPoint(), "en-US")).toEqual(['他说"示例"，其他']);
    });
});

describe("the measured Chinese boxes, in both renderers", () => {
    const simSun = resolveInstalledGlyphAdvances("SimSun", false, false);
    const pdftotext = Bun.which("pdftotext");
    const cases = chineseBreakCases();
    /** Each page's lines, as pdftotext reads them, by their number of characters other than white space and U+200B. */
    const drawnLines = async (pdf: Uint8Array) => {
        const directory = await mkdtemp(join(tmpdir(), "chinese-break-"));
        try {
            const file = join(directory, "deck.pdf");
            await writeFile(file, pdf);
            const text = Bun.spawnSync([pdftotext ?? "pdftotext", "-raw", "-enc", "UTF-8", file, "-"]).stdout.toString();
            return text
                .split("\f")
                .slice(0, cases.length)
                .map(page =>
                    page
                        .split("\n")
                        .map(line => [...line.replace(/[\s\u3000\u200b⁠]/gu, "")].length)
                        .filter(Boolean),
                );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    };
    const expected = (selected: readonly ChineseBreakCase[]) => selected.map(({ label, lines }) => ({ label, lines: [...lines] }));
    const drawn = (selected: readonly ChineseBreakCase[], lines: number[][]) => selected.map(({ label }, index) => ({ label, lines: lines[index] }));
    // Measured against PowerPoint's PDF export of the same deck. "——" (28b, 28c) keeps UAX #14: see target/powerpoint.ts.
    const measured = cases.filter(({ label }) => !/ 28[bc]$/.test(label));
    const ready = simSun !== undefined && pdftotext !== null;

    test.skipIf(!ready)(
        "breaks each box where PowerPoint does, in Chromium",
        async () => {
            const pdf = await chineseBreakDeck(new PuppeteerGenPowerPoint(), measured).toPdf();
            expect(drawn(measured, await drawnLines(pdf))).toEqual(expected(measured));
        },
        60_000,
    );

    test.skipIf(!ready)(
        "breaks each box where PowerPoint does, in the WASM renderer",
        async () => {
            const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
            const pdf = await chineseBreakDeck(new PuppeteerGenPowerPoint(undefined, { renderer }), measured).toPdf();
            expect(drawn(measured, await drawnLines(pdf))).toEqual(expected(measured));
        },
        60_000,
    );
});
