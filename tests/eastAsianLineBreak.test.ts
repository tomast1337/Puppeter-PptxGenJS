import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedTextRun } from "@pdflapas/model";
import { PuppeteerGenLibreOffice, PuppeteerGenPowerPoint, resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { breakAroundHanPunctuation, hangingMarkRuns, hangingSegments, languageHangingMarks } from "../packages/pptxgenjs/src/normalize/eastAsianLineBreak";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import { type EastAsianBreakCase, eastAsianBreakCases, eastAsianBreakDeck } from "./eastAsianBreakCases";

afterAll(closeBrowser);

const HANGING_MARKS = RENDERING_TARGETS.powerpoint.hangingMarks;
const MARKS = HANGING_MARKS.zh ?? "";

describe("East Asian line breaks on the PowerPoint target", () => {
    test("hangs marks by the run's primary language: zh and ja, not en-US, ko or none", () => {
        expect(["zh", "zh-CN", "zh-TW", "ZH-hk"].map(language => languageHangingMarks(language, HANGING_MARKS))).toEqual([MARKS, MARKS, MARKS, MARKS]);
        expect(languageHangingMarks("ja-JP", HANGING_MARKS)).toBe("，。");
        expect(["en-US", "ko-KR", "zhx", ""].map(language => languageHangingMarks(language, HANGING_MARKS))).toEqual([undefined, undefined, undefined, undefined]);
    });

    test("cuts out a closing mark unless another one or a dash follows it", () => {
        expect(hangingSegments("内容，其他", undefined, MARKS)).toEqual([
            { text: "内容", hangs: false },
            { text: "，", hangs: true },
            { text: "其他", hangs: false },
        ]);
        // "）" before "。" stays: only the last of two marks hangs. Before a dash, none hangs.
        expect(hangingSegments("（第一）。", undefined, MARKS)).toEqual([
            { text: "（第一）", hangs: false },
            { text: "。", hangs: true },
        ]);
        expect(hangingSegments("（甲）——", undefined, MARKS)).toEqual([{ text: "（甲）——", hangs: false }]);
        // Before a Latin letter, and across a run boundary, where the next run's first character decides.
        expect(hangingSegments("内容，A", undefined, MARKS)).toEqual([
            { text: "内容", hangs: false },
            { text: "，", hangs: true },
            { text: "A", hangs: false },
        ]);
        expect(hangingSegments("内容，", "。", MARKS)).toEqual([{ text: "内容，", hangs: false }]);
        expect(hangingSegments("内容，", "A", MARKS)).toEqual([
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

    test("in a language with hanging marks, breaks before “ after Han, between Han and an ASCII quote, and between two dashes only", () => {
        expect(breakAroundHanPunctuation("他说“这是”然后", "", "", true)).toBe("他说\u200b“这是”然后");
        expect(breakAroundHanPunctuation('他说"示例"很好', "", "", true)).toBe('他说\u200b"\u200b示例\u200b"\u200b很好');
        expect(breakAroundHanPunctuation('我们使用"Alpha"方案', "", "", true)).toBe('我们使用\u200b"Alpha"\u200b方案');
        expect(breakAroundHanPunctuation('"示例', "说", "", true)).toBe('\u200b"\u200b示例');
        expect(breakAroundHanPunctuation("如下——全部", "", "", true)).toBe("如下\u2060—\u200b—全部");
        expect(breakAroundHanPunctuation("示例，然后", "", "", true)).toBe("示例，然后");
        expect(breakAroundHanPunctuation('A"B say “this”', "", "", true)).toBe('A"B say “this”');
    });

    test("in any other language, breaks on either side of full-width punctuation next to Han, and between Han and an ASCII quote", () => {
        expect(breakAroundHanPunctuation("示例，然后", "", "", false)).toBe("示例\u200b，\u200b然后");
        expect(breakAroundHanPunctuation("材料（甲）。", "", "", false)).toBe("材料\u200b（\u200b甲\u200b）\u200b。");
        expect(breakAroundHanPunctuation("如下——全部", "", "", false)).toBe("如下\u200b—\u200b—\u200b全部");
        expect(breakAroundHanPunctuation('都说"样本"', "", "", false)).toBe('都说\u200b"\u200b样本\u200b"');
        expect(breakAroundHanPunctuation("，", "例", "然", false)).toBe("\u200b，\u200b");
        expect(breakAroundHanPunctuation('A"B say “this”—that', "", "", false)).toBe('A"B say “this”—that');
    });

    test("writes the hang and the breaks in the run text on the PowerPoint target by its language, and nothing on LibreOffice", async () => {
        const text = (presentation: PuppeteerGenPowerPoint | PuppeteerGenLibreOffice, lang?: string) => {
            presentation.addSlide().addText('他说"示例"，其他', { x: 0, y: 0, w: 2, h: 1, fontFace: "SimSun", ...(lang ? { lang } : {}) });
            return presentation.getModel().slides[0]?.objects.flatMap(object => (object.kind === "text" ? object.text.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.text)) : []));
        };
        expect(text(new PuppeteerGenPowerPoint(), "zh-CN")).toEqual(['他说\u200b"\u200b示例\u200b"', "，", "\u3000", "其他"]);
        expect(text(new PuppeteerGenPowerPoint(), "ja-JP")).toEqual(['他说\u200b"\u200b示例\u200b"', "，", "\u3000", "其他"]);
        expect(text(new PuppeteerGenPowerPoint())).toEqual(['他说\u200b"\u200b示例\u200b"，\u200b其他']);
        expect(text(new PuppeteerGenPowerPoint(), "ko-KR")).toEqual(['他说\u200b"\u200b示例\u200b"，\u200b其他']);
        expect(text(new PuppeteerGenLibreOffice(), "zh-CN")).toEqual(['他说"示例"，其他']);
        expect(text(new PuppeteerGenLibreOffice())).toEqual(['他说"示例"，其他']);
    });
});

describe("the measured East Asian boxes, in both renderers", () => {
    const simSun = resolveInstalledGlyphAdvances("SimSun", false, false);
    const pdftotext = Bun.which("pdftotext");
    const cases = eastAsianBreakCases();
    /** Each page's lines, as pdftotext reads them, by their number of characters other than white space and U+200B. */
    const drawnLines = async (pdf: Uint8Array) => {
        const directory = await mkdtemp(join(tmpdir(), "east-asian-break-"));
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
    const expected = (selected: readonly EastAsianBreakCase[]) => selected.map(({ label, lines }) => ({ label, lines: [...lines] }));
    const drawn = (selected: readonly EastAsianBreakCase[], lines: number[][]) => selected.map(({ label }, index) => ({ label, lines: lines[index] }));
    // Measured against PowerPoint's PDF export of the same decks.
    const measured = cases;
    const ready = simSun !== undefined && pdftotext !== null;

    test.skipIf(!ready)(
        "breaks each box where PowerPoint does, in Chromium",
        async () => {
            const pdf = await eastAsianBreakDeck(new PuppeteerGenPowerPoint(), measured).toPdf();
            expect(drawn(measured, await drawnLines(pdf))).toEqual(expected(measured));
        },
        60_000,
    );

    test.skipIf(!ready)(
        "breaks each box where PowerPoint does, in the WASM renderer",
        async () => {
            const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
            const pdf = await eastAsianBreakDeck(new PuppeteerGenPowerPoint(undefined, { renderer }), measured).toPdf();
            expect(drawn(measured, await drawnLines(pdf))).toEqual(expected(measured));
        },
        60_000,
    );
});
