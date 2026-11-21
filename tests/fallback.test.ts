import { describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import type { FontMetricsLookup, GlyphAdvances } from "../packages/pptxgenjs/src/defaults";
import { fallbackChain, fallbackSegments } from "../packages/pptxgenjs/src/normalize/fallback";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";

// Which of the measured characters each face maps, as their cmaps do (PMingLiU as SimSun, ⅐ in the Arial PowerPoint drew).
const COVERAGE: Readonly<Record<string, string>> = {
    Arial: " ax⅐",
    "Times New Roman": " ax⅐↉",
    "Cambria Math": "⇒①",
    "Segoe UI Symbol": "☆✓⭐😀①⇒🇯🇵",
    "Segoe UI Emoji": "✓⭐😀❤⇒🇯🇵",
    "MS Gothic": "是あア働込ｱ〜，☆①⇒❤",
    "Yu Gothic": "够是あア働込ｱ〜，↉☆①⇒",
    "Microsoft JhengHei": "够这是ㄅ，あ☆①",
    "Microsoft YaHei": "够这是ㄅ䶶，",
    "Malgun Gothic": "한국어是，☆①⇒",
    PMingLiU: "够这是ㄅ，",
    SimSun: "够这是ㄅ䶶，",
};
const advances = (characters: string): GlyphAdvances => ({ unitsPerEm: 1000, advances: new Map([...characters].map(character => [character.codePointAt(0) ?? 0, 1000])) });
const FONTS: FontMetricsLookup = Object.assign(() => undefined, { glyphAdvances: (face: string) => (Object.hasOwn(COVERAGE, face) ? advances(COVERAGE[face] ?? "") : undefined) });

/** The faces a renderer draws `text` in, in order: per character, the first of the run's face and its stretch's chain that has it. */
function drawn(text: string, fontFace = "Arial"): [string, string][] {
    const faces: [string, string][] = [];

    for (const { text: stretch, fallbackFaces } of fallbackSegments(text, fontFace, false, false, "powerpoint", FONTS)) {
        for (const character of stretch) {
            const face = [fontFace, ...fallbackFaces].find(candidate => COVERAGE[candidate]?.includes(character)) ?? "none";
            const last = faces.at(-1);

            if (last?.[1] === face) {
                last[0] += character;
            } else {
                faces.push([character, face]);
            }
        }
    }

    return faces;
}

describe("the PowerPoint target's fallback faces", () => {
    test("writes Arial's and Calibri's linked East Asian faces after its symbol faces, and Times New Roman's for other faces", () => {
        const linked = ["MS Gothic", "Yu Gothic", "Microsoft JhengHei", "Microsoft YaHei", "Malgun Gothic"];

        expect(fallbackChain("Arial", "powerpoint")).toEqual(["Cambria Math", "Segoe UI Symbol", ...linked]);
        expect(fallbackChain("CALIBRI", "powerpoint")).toEqual(["Arial", "Cambria Math", "Segoe UI Symbol", ...linked]);
        expect(fallbackChain("Times New Roman", "powerpoint")).toEqual(["Arial", "Cambria Math", "Segoe UI Symbol", "Yu Gothic", "PMingLiU", "SimSun", "Malgun Gothic"]);
        expect(fallbackChain("constructor", "powerpoint")).toEqual(fallbackChain("Times New Roman", "powerpoint"));
        expect(fallbackChain("Arial", "libreoffice")).toEqual([]);
    });

    // Measured against PowerPoint's PDF export of a synthetic deck: each line's faces in Arial (Calibri and Arial bold
    // alike) and in Times New Roman, at 14pt.
    test("keeps an East Asian character in the face of the one before it while that face has it, as PowerPoint does", () => {
        expect(drawn("够是够是")).toEqual([["够是够是", "Yu Gothic"]]);
        expect(drawn("这是这是")).toEqual([["这是这是", "Microsoft JhengHei"]]);
        expect(drawn("这够")).toEqual([["这够", "Microsoft JhengHei"]]);
        expect(drawn("够这")).toEqual([
            ["够", "Yu Gothic"],
            ["这", "Microsoft JhengHei"],
        ]);
        expect(drawn("ㄅ是")).toEqual([["ㄅ是", "Microsoft JhengHei"]]);
        expect(drawn("这，是")).toEqual([["这，是", "Microsoft JhengHei"]]);
        expect(drawn("䶶是")).toEqual([["䶶是", "Microsoft YaHei"]]);
        expect(drawn("한국어是")).toEqual([["한국어是", "Malgun Gothic"]]);
        expect(drawn("あア働込是")).toEqual([["あア働込是", "MS Gothic"]]);
        expect(drawn("ｱ〜是")).toEqual([["ｱ〜是", "MS Gothic"]]);
        // A space, a character of the run's face or another character starts over.
        expect(drawn("这 是")).toEqual([
            ["这", "Microsoft JhengHei"],
            [" ", "Arial"],
            ["是", "MS Gothic"],
        ]);
        expect(drawn("这a是")).toEqual([
            ["这", "Microsoft JhengHei"],
            ["a", "Arial"],
            ["是", "MS Gothic"],
        ]);
        expect(drawn("⅐是↉是")).toEqual([
            ["⅐", "Arial"],
            ["是", "MS Gothic"],
            ["↉", "Yu Gothic"],
            ["是", "MS Gothic"],
        ]);
        expect(drawn("够是", "Times New Roman")).toEqual([["够是", "Yu Gothic"]]);
        expect(drawn("这是 是", "Times New Roman")).toEqual([
            ["这是", "PMingLiU"],
            [" ", "Times New Roman"],
            ["是", "Yu Gothic"],
        ]);
        expect(drawn("䶶是", "Times New Roman")).toEqual([["䶶是", "SimSun"]]);
    });

    // Measured in the same export: "x<c>x yo" in Arial at 18pt and lines of emoji, drawn from Segoe UI Emoji at its
    // 1.373em advance; ☆ and ✓ (not Extended_Pictographic) stay in Segoe UI Symbol, ⇒ and ① in Cambria Math.
    test("draws an emoji the run's face lacks from Segoe UI Emoji, other symbols from the chain", () => {
        expect(drawn("x😀x")).toEqual([
            ["x", "Arial"],
            ["😀", "Segoe UI Emoji"],
            ["x", "Arial"],
        ]);
        expect(drawn("⭐❤🇯🇵")).toEqual([["⭐❤🇯🇵", "Segoe UI Emoji"]]);
        expect(drawn("x☆✓⇒①x")).toEqual([
            ["x", "Arial"],
            ["☆✓", "Segoe UI Symbol"],
            ["⇒①", "Cambria Math"],
            ["x", "Arial"],
        ]);
    });

    test("leaves the text whole when a face's characters are unknown, and on the LibreOffice target", () => {
        const unknown: FontMetricsLookup = Object.assign(() => undefined, { glyphAdvances: () => undefined });

        expect(fallbackSegments("够这", "Arial", false, false, "powerpoint", unknown)).toEqual([{ text: "够这", fallbackFaces: fallbackChain("Arial", "powerpoint") }]);
        expect(fallbackSegments("够这", "Arial", false, false, "libreoffice", FONTS)).toEqual([{ text: "够这", fallbackFaces: [] }]);
    });

    test("cuts a run into one run a stretch, the first keeping its soft break", () => {
        const runs = (input: PptxGenJS.TextProps[]) => normalizeText(input, { fontFace: "Arial", fontSize: 14 }, "powerpoint", FONTS).paragraphs.flatMap(paragraph => paragraph.runs.map(run => [run.text, run.fallbackFaces?.[0], run.softBreakBefore]));

        expect(runs([{ text: "a" }, { text: "够是", options: { softBreakBefore: true } }])).toEqual([
            ["a", "Cambria Math", false],
            ["够", "Cambria Math", true],
            ["是", "Yu Gothic", false],
        ]);
    });
});
