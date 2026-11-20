import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import type PptxGenJS from "pptxgenjs";
import PptxGenJSRuntime from "pptxgenjs";
import type { NormalizedTextRun } from "@pdflapas/model";
import { renderedPage } from "./renderedPage";
import { PPTX_DEFAULTS } from "../packages/pptxgenjs/src/defaults";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table/index";
import { normalizeText, paragraphLineBox } from "../packages/pptxgenjs/src/normalize/text";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { presentationCSS } from "../packages/pptxgenjs/src/render/slide";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";
import { pointsToPixels } from "@pdflapas/model";

describe("text normalization", () => {
    test("accepts numbers and preserves empty hard-line paragraphs", () => {
        expect(normalizeText(42).paragraphs[0]?.runs[0]?.text).toBe("42");

        const text = normalizeText("first\n\nthird");
        expect(text.paragraphs).toHaveLength(3);
        expect(text.paragraphs.map(paragraph => paragraph.runs[0]?.text)).toEqual(["first", "", "third"]);
    });

    // LibreOffice's PPTX line box is font-independent: 1.2em per line, baseline 0.2em above the line
    // bottom, measured for Arial, Carlito and Liberation Serif at 10/18/40pt (defaults.ts).
    test("places lines and baselines on LibreOffice's font-independent line box", () => {
        const box = (options: Parameters<typeof normalizeText>[1], input: Parameters<typeof normalizeText>[0] = "Text") => normalizeText(input, options).paragraphs[0]!.lineBox;
        const close = (actual: { height: number; baseline: number }, height: number, baseline: number) => {
            expect(actual.height).toBeCloseTo(height);
            expect(actual.baseline).toBeCloseTo(baseline);
        };
        // 18pt default = 24px: 28.8px line, baseline 1.0em below its top.
        close(box({}), 28.8, 24);
        // lineSpacingMultiple scales the 1.2em line; the extra height goes above the baseline.
        close(box({ lineSpacingMultiple: 1.5 }), 1.8 * 24, 1.8 * 24 - 4.8);
        close(box({ fontSize: 30, lineSpacingMultiple: 1.5 }), 72, 64);
        // The box without its paragraph: the runs and the spacing, a multiple of the largest font size.
        close(paragraphLineBox({ runs: normalizeText("Text", { fontSize: 30 }).paragraphs[0]!.runs, spacing: { em: 1.8 } }), 72, 64);
        close(box({ fontSize: 30, lineSpacingMultiple: 0.8 }), 38.4, 30.4);
        // lineSpacing is the exact line height (36pt = 48px); the baseline stays 0.2em above its bottom.
        close(box({ fontSize: 30, lineSpacing: 36 }), 48, 40);
        // Mixed sizes: the largest run sets the line box.
        close(box({ fontSize: 12 }, [{ text: "small" }, { text: "LARGE", options: { fontSize: 24 } }]), 38.4, 32);
    });

    // #278: lineSpacing and lineSpacingMultiple once shared one number, read as a multiple below 10 and px above, so
    // small exact spacings and large multiples swapped units. The oracle is the <a:lnSpc> PptxGenJS 4.0.1 writes:
    // <a:spcPts> in hundredths of a point, or <a:spcPct> in thousandths of a percent of the single line (1.2em).
    test("keeps lineSpacing in points and lineSpacingMultiple a multiple, whatever their size", async () => {
        const written = async (options: PptxGenJS.TextPropsOptions): Promise<string> => {
            const pptx = new PptxGenJSRuntime();
            pptx.addSlide().addText("Text", { x: 1, y: 1, w: 4, h: 2, ...options });
            // `as`: write() returns a Buffer for the nodebuffer output type.
            const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
            return (await zip.file("ppt/slides/slide1.xml")?.async("string"))?.match(/<a:lnSpc>(.*?)<\/a:lnSpc>/)?.[1] ?? "";
        };
        // The line height in points, as LibreOffice and PowerPoint (which rounds spcPts to whole points) read it.
        const single = 18 * PPTX_DEFAULTS.text.singleLineEm;
        const cases: ReadonlyArray<[PptxGenJS.TextPropsOptions, string, { libreoffice: number; powerpoint: number }]> = [
            [{ lineSpacing: 6 }, '<a:spcPts val="600"/>', { libreoffice: 6, powerpoint: 6 }],
            [{ lineSpacing: 0.9 }, '<a:spcPts val="90"/>', { libreoffice: 0.9, powerpoint: 1 }],
            [{ lineSpacing: 36 }, '<a:spcPts val="3600"/>', { libreoffice: 36, powerpoint: 36 }],
            [{ lineSpacingMultiple: 9 }, '<a:spcPct val="900000"/>', { libreoffice: 9 * single, powerpoint: 9 * single }],
            [{ lineSpacingMultiple: 8.34 }, '<a:spcPct val="834000"/>', { libreoffice: 8.34 * single, powerpoint: 8.34 * single }],
            [{ lineSpacingMultiple: 1.5 }, '<a:spcPct val="150000"/>', { libreoffice: 1.5 * single, powerpoint: 1.5 * single }],
        ];
        for (const [options, xml, heights] of cases) {
            expect({ options, xml: await written({ fontSize: 18, ...options }) }).toEqual({ options, xml });
            for (const target of ["libreoffice", "powerpoint"] as const) {
                const lineBox = normalizeText("Text", { fontSize: 18, ...options }, target).paragraphs[0]?.lineBox;
                expect({ options, target, height: lineBox?.height }).toEqual({ options, target, height: expect.closeTo(pointsToPixels(heights[target]), 9) });
                // Explicit spacing puts the baseline 0.2em above the line bottom (or the target's spacedLineBaseline).
                expect(lineBox?.markBaseline).toBeUndefined();
            }
        }
        // A 0 writes no <a:lnSpc>: single spacing.
        expect(await written({ fontSize: 18, lineSpacing: 0, lineSpacingMultiple: 0 })).toBe("");
        expect(normalizeText("Text", { fontSize: 18, lineSpacing: 0, lineSpacingMultiple: 0 }).paragraphs[0]?.lineBox).toEqual(normalizeText("Text", { fontSize: 18 }).paragraphs[0]!.lineBox);
    });

    // A run ending with line feeds keeps them inside its <a:t>; measured against PowerPoint's PDF export of synthetic decks
    // (and LibreOffice), the empty text after the last one adds nothing to the next run's paragraph: its lines keep the
    // next run's pitch. Alone (end of text, or before an align change) it stays an empty paragraph in the run's font.
    test("drops the empty text after a run's last line feed from a paragraph that has other runs", () => {
        const runs: Parameters<typeof normalizeText>[0] = [
            { text: "Head line.\n\n", options: { bold: true, fontSize: 16 } },
            { text: "Body text that wraps.\n\n", options: { fontSize: 8 } },
            { text: "More body.\n", options: { fontSize: 8 } },
        ];
        for (const target of ["libreoffice", "powerpoint"] as const) {
            const { paragraphs } = normalizeText(runs, { align: "justify", fontFace: "Arial" }, target);
            expect(paragraphs.map(paragraph => paragraph.runs.map(run => [run.text, run.fontSize, run.bold]))).toEqual([[["Head line.", 64 / 3, true]], [["", 64 / 3, true]], [["Body text that wraps.", 32 / 3, false]], [["", 32 / 3, false]], [["More body.", 32 / 3, false]], [["", 32 / 3, false]]]);
            // 1.2 x 8pt lines on every body paragraph, 1.2 x 16pt on the head and its empty paragraph.
            expect(paragraphs.map(paragraph => paragraph.lineBox.height)).toEqual([25.6, 25.6, 12.8, 12.8, 12.8, 12.8].map(height => expect.closeTo(height) as unknown as number));
        }

        // A lone tail before an align change keeps the run's font and its line box.
        const lone = normalizeText(
            [
                { text: "Left head.\n", options: { align: "left", fontSize: 16 } },
                { text: "Right body.", options: { align: "right", fontSize: 8 } },
            ],
            { fontFace: "Arial" },
        ).paragraphs;
        expect(lone.map(paragraph => [paragraph.runs.map(run => [run.text, run.fontSize]), paragraph.align, paragraph.lineBox.height])).toEqual([
            [[["Left head.", 64 / 3]], "left", expect.closeTo(25.6)],
            [[["", 64 / 3]], "left", expect.closeTo(25.6)],
            [[["Right body.", 32 / 3]], "right", expect.closeTo(12.8)],
        ]);
    });

    // PptxGenJS writes baseline="30000"/"-40000"; LibreOffice draws such runs at 58% of their size.
    test("resolves super- and subscript into LibreOffice's escapement size and shift", () => {
        const [sup, sub, custom] = normalizeText([
            { text: "sup", options: { superscript: true, fontSize: 30 } },
            { text: "sub", options: { subscript: true, fontSize: 30 } },
            { text: "custom", options: { subscript: true, baseline: 20, fontSize: 30 } },
        ]).paragraphs[0]!.runs;
        expect(sup!.fontSize).toBeCloseTo(40 * 0.58);
        expect(sup!.baselineOffset).toBeCloseTo(12);
        expect(sub!.fontSize).toBeCloseTo(40 * 0.58);
        expect(sub!.baselineOffset).toBeCloseTo(-16);
        // A custom baseline wins: baseline="1000", 1% of 40px, at the escapement size.
        expect(custom!.fontSize).toBeCloseTo(40 * 0.58);
        expect(custom!.baselineOffset).toBeCloseTo(0.4);
    });

    // #279: PptxGenJS 4.0.1 writes a custom baseline as baseline="Math.round(baseline * 50)", thousandths of a percent of
    // the run's font size. LibreOffice's PDF export (26.2, the visual image) of "HH" runs at 20pt and 40pt moves them
    // 30%, -30%, 10% and -50% of the full size for 600, -600, 200 and -1000 (6.01, 6.00, 2.01, 10.01pt at 20pt; 12.01,
    // 12.01, 4.01, 20.00pt at 40pt) and draws them at 58% (11.61pt, 23.2pt), as superscript (6.00, 12.00pt).
    test("moves a custom baseline by a percent of the run's font size, as PptxGenJS writes it", async () => {
        const written = async (baseline: number): Promise<string | undefined> => {
            const pptx = new PptxGenJSRuntime();
            pptx.addSlide().addText([{ text: "HH", options: { baseline } }], { x: 1, y: 1, w: 4, h: 1 });
            // `as`: write() returns a Buffer for the nodebuffer output type.
            const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
            return (await zip.file("ppt/slides/slide1.xml")?.async("string"))?.match(/<a:rPr[^>]* baseline="(-?\d+)"/)?.[1];
        };
        for (const [baseline, xml, fraction] of [
            [600, "30000", 0.3],
            [-600, "-30000", -0.3],
            [200, "10000", 0.1],
            [-1000, "-50000", -0.5],
        ] as const) {
            expect(await written(baseline)).toBe(xml);
            for (const fontSize of [20, 40]) {
                for (const target of ["libreoffice", "powerpoint"] as const) {
                    const run = normalizeText([{ text: "HH", options: { baseline } }], { fontSize }, target).paragraphs[0]!.runs[0]!;
                    expect({ baseline, fontSize, target, offset: run.baselineOffset }).toEqual({ baseline, fontSize, target, offset: expect.closeTo(fraction * pointsToPixels(fontSize), 9) });
                    // The same size a superscript has on the target.
                    expect(run.fontSize).toBe(normalizeText([{ text: "HH", options: { superscript: true } }], { fontSize }, target).paragraphs[0]!.runs[0]!.fontSize);
                }
            }
        }
        // baseline="0" moves nothing and keeps the full size.
        expect(await written(0.004)).toBe("0");
        const zero = normalizeText([{ text: "HH", options: { baseline: 0.004 } }], { fontSize: 20 }).paragraphs[0]!.runs[0]!;
        expect([zero.baselineOffset, zero.fontSize]).toEqual([0, pointsToPixels(20)]);
    });

    // PptxGenJS writes <a:tab pos="inch2Emu(position || 1)" algn="alignment || l"/>; its master sets defTabSz 1in.
    test("normalizes tab stops in position order with PptxGenJS's fallbacks and the 1in default spacing", () => {
        const paragraph = normalizeText("a\tb", {
            tabStops: [{ position: 3, alignment: "dec" }, { position: 0 }, { position: 2, alignment: "ctr" }],
        }).paragraphs[0]!;
        expect(paragraph.tabStops).toEqual([
            { position: 96, alignment: "left" },
            { position: 192, alignment: "center" },
            { position: 288, alignment: "decimal" },
        ]);
        expect(paragraph.defaultTabStop).toBe(96);
    });

    // PptxGenJS 4.0.1 writes [[" ", "Item"], ["Next"]] with a box align and [[" "], ["Item", "Next"]] without.
    test("groups bullet runs as PptxGenJS does with and without align", () => {
        const runs = [
            { text: " ", options: { bullet: { code: "2022" } } },
            { text: "Item", options: { bullet: true, breakLine: true } },
            { text: "Next", options: {} },
        ];
        const texts = (align?: "center") => normalizeText(runs, align ? { align } : {}).paragraphs.map(paragraph => paragraph.runs.map(run => run.text));
        expect(texts("center")).toEqual([[" ", "Item"], ["Next"]]);
        expect(texts()).toEqual([[" "], ["Item", "Next"]]);
    });

    test("groups rich runs using PptxGenJS break and alignment behavior", () => {
        const text = normalizeText(
            [
                { text: "one", options: { bold: true } },
                { text: "two", options: { breakLine: true } },
                { text: "three", options: { align: "right", softBreakBefore: true } },
            ],
            { fontFace: "Arial", color: "112233" },
        );

        expect(text.paragraphs).toHaveLength(2);
        expect(text.paragraphs[0]?.runs).toHaveLength(2);
        expect(text.paragraphs[1]?.align).toBe("right");
        expect(text.paragraphs[1]?.runs[0]?.softBreakBefore).toBe(true);
        expect(text.paragraphs[0]?.runs[0]).toMatchObject({
            bold: true,
            fontFace: "Arial",
            color: "#112233",
        });
    });

    test("keeps the space after of every paragraph but the last, which anchoring leaves out", () => {
        const text = normalizeText([
            { text: "First", options: { paraSpaceAfter: 9, breakLine: true } },
            { text: "Last", options: { paraSpaceAfter: 9 } },
        ]);
        expect(text.paragraphs.map(paragraph => paragraph.spaceAfter)).toEqual([12, 0]);
    });

    test("normalizes typography, spacing, directions, and the margin-order quirk", () => {
        const text = normalizeText("styled", {
            margin: [1, 2, 3, 4],
            fontSize: 18,
            transparency: 25,
            underline: { style: "dbl", color: "FF0000" },
            strike: "dblStrike",
            superscript: true,
            baseline: 20,
            charSpacing: 1.5,
            lineSpacing: 24,
            paraSpaceBefore: 6,
            paraSpaceAfter: 9,
            vert: "wordArtVert",
            rtlMode: true,
        });

        expect(text.margin).toEqual([(4 * 96) / 72, (2 * 96) / 72, (3 * 96) / 72, (1 * 96) / 72]);
        expect(text.direction).toBe("stacked");
        expect(text.rtl).toBe(true);
        expect(text.paragraphs[0]?.lineBox.height).toBe(32);
        expect(text.paragraphs[0]?.spaceBefore).toBe(8);
        // The last paragraph's space after is left out of the text height (PowerPoint, LibreOffice).
        expect(text.paragraphs[0]?.spaceAfter).toBe(0);
        expect(text.paragraphs[0]?.runs[0]).toMatchObject({
            // baseline 20 (baseline="1000") wins over superscript: 1% of 24px, drawn at LibreOffice's 58%.
            fontSize: 24 * 0.58,
            baselineOffset: 0.24,
            color: "rgba(0, 0, 0, 0.75)",
            verticalAlign: "super",
            characterSpacing: 2,
        });
        expect(text.paragraphs[0]?.runs[0]?.decoration).toMatchObject({
            underline: true,
            underlineStyle: "double",
            strike: true,
            doubleStrike: true,
        });
    });

    test("normalizes custom and numbered bullets", () => {
        const custom = normalizeText("custom", { bullet: { characterCode: "25BA", indent: 18 }, indentLevel: 1 });
        expect(custom.paragraphs[0]?.bullet).toMatchObject({ marker: "►", indent: 48, level: 1 });

        const numbered = normalizeText([
            { text: "first", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 }, breakLine: true } },
            { text: "second", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 } } },
        ]);
        // PptxGenJS 4.0.1 ignores the documented numberType field.
        expect(numbered.paragraphs.map(paragraph => paragraph.bullet?.marker)).toEqual(["3.", "4."]);

        const legacyStyle = normalizeText("Roman", {
            bullet: { type: "number", style: "romanLcParenR", numberStartAt: 3 },
        });
        expect(legacyStyle.paragraphs[0]?.bullet?.marker).toBe("iii)");
    });

    // PowerPoint starts a new list at its own startAt when <a:buAutoNum>'s type or startAt changes (sequenceIndex).
    describe("restarts the numbering when the scheme changes", () => {
        const item = (text: string, style: "arabicPeriod" | "alphaUcPeriod" | "alphaLcPeriod" | "romanUcPeriod", numberStartAt: number) => ({ text, options: { bullet: { type: "number" as const, style, numberStartAt }, breakLine: true } });
        const markers = (input: ReturnType<typeof item>[], target?: "powerpoint" | "libreoffice") => normalizeText(input, {}, target).paragraphs.map(paragraph => paragraph.bullet?.marker);

        test.each(["powerpoint", "libreoffice"] as const)("an arabic, alpha, arabic startAt 2 list (%s)", target => {
            const input = [item("Lorem ipsum", "arabicPeriod", 1), item("​", "arabicPeriod", 1), ...["a", "b", "c", "d"].map(text => item(`Dolor ${text}`, "alphaUcPeriod", 1)), item("Sit amet", "arabicPeriod", 2)];
            expect(markers(input, target)).toEqual(["1.", "2.", "A.", "B.", "C.", "D.", "2."]);
        });

        test("an alpha to arabic switch", () => {
            expect(markers([item("Lorem", "alphaLcPeriod", 1), item("Ipsum", "alphaLcPeriod", 1), item("Dolor", "arabicPeriod", 1)])).toEqual(["a.", "b.", "1."]);
        });

        test("a startAt change mid-list", () => {
            expect(markers([item("Lorem", "arabicPeriod", 1), item("Ipsum", "arabicPeriod", 1), item("Dolor", "arabicPeriod", 5), item("Sit", "arabicPeriod", 5)])).toEqual(["1.", "2.", "5.", "6."]);
        });

        test("continues a list whose scheme stays the same", () => {
            expect(markers([item("Lorem", "romanUcPeriod", 3), item("Ipsum", "romanUcPeriod", 3), item("Dolor", "romanUcPeriod", 3)])).toEqual(["III.", "IV.", "V."]);
        });
    });

    // Each indent level keeps its own list; a paragraph ends the deeper ones, and a bullet or unnumbered one its own
    // level's too (sequenceIndex). Markers from PowerPoint's PDF export of a synthetic deck, one text box per sequence.
    describe("numbers each indent level on its own", () => {
        type Kind = "num" | "alpha" | "bullet" | "none";
        const paragraph = ([indentLevel, kind]: readonly [number, Kind]): PptxGenJS.TextProps => ({
            text: `Lorem ${indentLevel} ${kind}`,
            options: { breakLine: true, indentLevel, bullet: kind === "num" ? { type: "number" } : kind === "alpha" ? { type: "number", style: "alphaLcParenR" } : kind === "bullet" },
        });
        const CASES: ReadonlyArray<[string, ReadonlyArray<readonly [number, Kind]>, ReadonlyArray<string | undefined>]> = [
            [
                "levels 0 0 1 1 0 1",
                [
                    [0, "num"],
                    [0, "num"],
                    [1, "num"],
                    [1, "num"],
                    [0, "num"],
                    [1, "num"],
                ],
                ["1.", "2.", "1.", "2.", "3.", "1."],
            ],
            [
                "arabic at 0, alpha at 1",
                [
                    [0, "num"],
                    [1, "alpha"],
                    [1, "alpha"],
                    [0, "num"],
                    [1, "alpha"],
                ],
                ["1.", "a)", "b)", "2.", "a)"],
            ],
            [
                "three levels down and back up",
                [
                    [0, "num"],
                    [1, "num"],
                    [2, "num"],
                    [1, "num"],
                    [2, "num"],
                    [0, "num"],
                ],
                ["1.", "1.", "1.", "2.", "1.", "2."],
            ],
            [
                "a bullet at the same level and deeper",
                [
                    [0, "num"],
                    [0, "bullet"],
                    [0, "num"],
                    [1, "bullet"],
                    [0, "num"],
                ],
                ["1.", PPTX_DEFAULTS.bullet.character, "1.", PPTX_DEFAULTS.bullet.character, "2."],
            ],
            [
                "an unnumbered paragraph at the same level and deeper",
                [
                    [0, "num"],
                    [0, "none"],
                    [0, "num"],
                    [1, "none"],
                    [0, "num"],
                ],
                ["1.", undefined, "1.", undefined, "2."],
            ],
            [
                "a list that starts deeper",
                [
                    [1, "num"],
                    [1, "num"],
                    [0, "num"],
                    [1, "num"],
                ],
                ["1.", "2.", "1.", "1."],
            ],
        ];

        test.each(CASES)("%s", (_name, sequence, expected) => {
            expect(normalizeText(sequence.map(paragraph), {}, "powerpoint").paragraphs.map(({ bullet }) => bullet?.marker)).toEqual([...expected]);
        });
    });
});

describe("text DOM rendering", () => {
    test("renders semantic rich runs, bullets, soft breaks, and links", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText(
            [
                { text: "Lead", options: { bold: true, highlight: "FFFF00" } },
                { text: "link", options: { softBreakBefore: true, hyperlink: { url: "https://example.com", tooltip: "Example" } } },
            ],
            { x: 1, y: 1, w: 4, h: 1, bullet: { characterCode: "25CF" } },
        );

        const box = renderedPage(presentation).querySelector<HTMLElement>(".slide-text");
        const paragraph = box?.querySelector<HTMLElement>(".text-paragraph");
        const runs = box?.querySelectorAll<HTMLElement>(".text-run");
        const link = box?.querySelector<HTMLAnchorElement>("a.text-run");
        expect(paragraph?.dataset.bulletType).toBe("bullet");
        // 18pt (24px) default: a 28.8px line box with its baseline at 24px. The strut and the shift that
        // draw it are not in the markup (stylesheet and Puppeteer print step).
        expect(parseFloat(paragraph?.style.lineHeight ?? "")).toBeCloseTo(28.8);
        expect(Number(paragraph?.dataset.lineBaseline)).toBeCloseTo(24);
        expect(paragraph?.style.getPropertyValue("tab-size")).toBe("96px");
        expect([paragraph?.style.fontSize, paragraph?.style.top, runs?.[0]?.style.lineHeight]).toEqual(["", "", ""]);
        expect(paragraph?.querySelector<HTMLElement>(".text-bullet")?.style.lineHeight).toBe("");
        expect(paragraph?.querySelector(".text-bullet")?.textContent).toContain("●");
        expect(paragraph?.querySelectorAll("br")).toHaveLength(1);
        expect(runs?.[0]?.style.fontWeight).toBe("bold");
        // The face alone: the Puppeteer print step appends Chromium's fallback list.
        expect(runs?.[0]?.style.fontFamily).toBe('"Calibri"');
        expect(runs?.[0]?.style.backgroundColor).toBe("rgb(255, 255, 0)");
        expect(link?.href).toBe("https://example.com/");
        expect(link?.title).toBe("Example");
    });

    test("writes one paragraph element per paragraph PptxGenJS groups (genXmlTextBody STEP 4/5)", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText([{ text: "Intro", options: { breakLine: true } }, { text: "\nTITLE", options: { bold: true, breakLine: false } }, { text: "Description", options: { breakLine: true } }, { text: "Tail" }], { x: 1, y: 1, w: 4, h: 2, fontFace: "Arial", fontSize: 12 });
        slide.addTable([[{ text: [{ text: "Heading", options: { bold: true } }, { text: "Body" }] }]], { x: 1, y: 3.5, w: 4, align: "left", fontFace: "Arial", fontSize: 12 });

        const [box, cell] = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".slide-text, td"), element => Array.from(element.querySelectorAll(".text-paragraph"), paragraph => paragraph.textContent?.replace("\u200b", "")));
        expect(box).toEqual(["Intro", "", "TITLE", "Description", "Tail"]);
        expect(cell).toEqual(["Heading", "Body"]);
    });

    test("writes no run for the empty text after a run's last line feed in the next run's paragraph", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText(
            [
                { text: "Head line.\n\n", options: { bold: true, fontSize: 16 } },
                { text: "Body text.\n", options: { fontSize: 8 } },
            ],
            { x: 1, y: 1, w: 4, h: 2, align: "justify", fontFace: "Arial" },
        );

        const paragraphs = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".text-paragraph"));
        const body = paragraphs[2];
        expect(body?.querySelectorAll(".text-run")).toHaveLength(1);
        expect(body?.querySelector<HTMLElement>(".text-run")?.style.fontWeight).not.toBe("bold");
        // 8pt: a 12.8px line, not the 16pt head's 25.6px.
        expect(parseFloat(body?.style.lineHeight ?? "")).toBeCloseTo(12.8);
    });

    test("writes the bullet indent, start and number type that the marker only shows as a result", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Roman", { x: 1, y: 1, w: 4, h: 1, bullet: { type: "number", style: "romanLcParenR", numberStartAt: 3 } });
        slide.addText("custom", { x: 1, y: 2, w: 4, h: 1, bullet: { characterCode: "25BA", indent: 18 }, indentLevel: 1 });

        const [numbered, custom] = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".text-paragraph"), paragraph => paragraph.dataset);
        expect(numbered).toMatchObject({ bulletType: "number", bulletStart: "3", bulletNumberType: "romanLcParenR" });
        // 18pt indent per level at level 1: 48px in the model, 24px marker width.
        expect(custom).toMatchObject({ bulletType: "bullet", bulletIndent: "48", bulletLevel: "1", bulletStart: "1", bulletNumberType: "arabicPeriod" });
    });

    test("hangs a bullet paragraph's wrapped lines under its first line's text, as PptxGenJS's marL and indent", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Level zero", { x: 1, y: 1, w: 4, h: 1, bullet: true });
        slide.addText("Level one", { x: 1, y: 2, w: 4, h: 1, bullet: { type: "number" }, indentLevel: 1 });

        const page = renderedPage(presentation);
        const [zero, one] = Array.from(page.querySelectorAll<HTMLElement>(".text-paragraph"), paragraph => paragraph.style);
        // 27pt (36px) per level: marL 36px / 72px, indent -36px at both levels.
        expect([zero?.paddingLeft, zero?.textIndent]).toEqual(["36px", "-36px"]);
        expect([one?.paddingLeft, one?.textIndent]).toEqual(["72px", "-36px"]);
        expect(page.querySelector<HTMLElement>(".text-bullet")?.style.width).toBe("36px");
        expect(presentationCSS(PAGE_SIZES.SCREEN_16X9.landscape)).toMatch(/\.text-bullet \{\s*text-indent: 0;/);
    });

    test("writes the run and line-box values CSS cannot state exactly as data attributes", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText(
            [
                { text: "glow", options: { glow: { size: 4, opacity: 0.5, color: "FF0000" }, breakLine: true } },
                { text: "", options: { breakLine: true } },
                { text: "a", options: { strike: "dblStrike", underline: { style: "wavy" } } },
                { text: "b", options: { superscript: true, softBreakBefore: true, shadow: { type: "outer", color: "000000" } } },
            ],
            { x: 1, y: 1, w: 4, h: 2 },
        );

        const paragraphs = renderedPage(presentation).querySelectorAll<HTMLElement>(".text-paragraph");
        const run = (paragraph: number, index = 0) => paragraphs[paragraph]?.querySelectorAll<HTMLElement>(".text-run")[index]?.dataset;
        // 18pt default: the baseline sits 0.2em above the bottom of a 1.2em line box, 24px from its top.
        expect(Number(paragraphs[0]?.dataset.lineBaseline)).toBeCloseTo(24);
        expect(run(0)?.textShadow).toBe("glow");
        expect(run(1)?.empty).toBe("");
        expect(run(0)?.empty).toBeUndefined();
        expect(run(2)).toMatchObject({ doubleStrike: "", underlineStyle: "wavy" });
        expect(run(2, 1)).toMatchObject({ verticalAlign: "super", softBreakBefore: "" });
        // PptxGenJS writes no run shadow (see below), so the run has no text-shadow entry to name.
        expect(run(2, 1)?.textShadow).toBeUndefined();
        expect(run(2)?.verticalAlign).toBeUndefined();
    });

    test("keeps text transparency off the box and exposes direction and fit", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Vertical", {
            x: 1,
            y: 1,
            w: 2,
            h: 2,
            transparency: 40,
            vert: "vert270",
            fit: "shrink",
            rectRadius: 0.4,
            shape: "roundRect",
        });

        const box = renderedPage(presentation).querySelector<HTMLElement>(".slide-text");
        const content = box?.querySelector<HTMLElement>(".text-content");
        const run = box?.querySelector<HTMLElement>(".text-run");
        expect(box?.style.opacity).toBe("");
        expect(box?.dataset.textDirection).toBe("vertical270");
        expect(box?.dataset.textFit).toBe("shrink");
        // The shrink rule is on the box, so both renderers apply PPTX_DEFAULTS.text.shrink and none decides its own.
        const { step, maxSteps, tolerancePx } = PPTX_DEFAULTS.text.shrink;
        expect({ step: box?.dataset.textFitStep, maxSteps: box?.dataset.textFitMaxSteps, tolerance: box?.dataset.textFitTolerance }).toEqual({ step: String(step), maxSteps: String(maxSteps), tolerance: String(tolerancePx) });
        expect(content?.style.writingMode).toBe("vertical-rl");
        expect(run?.style.color).toBe("rgba(0, 0, 0, 0.6)");
    });

    // PptxGenJS 4.0.1 writes cy="0" without `h`; a box shorter than its insets centres the text area on its midline.
    test("defaults a text box to zero height and collapses its insets onto the midline", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("No height", { x: 1, y: 1, w: 2 });
        slide.addText("Thin", { x: 1, y: 2, w: 2, h: 0.05, margin: [7, 2, 20, 7] });
        slide.addText("Tall", { x: 1, y: 3, w: 2, h: 1 });
        const [none, thin, tall] = presentation.getModel().slides[0]!.objects.map(object => (object.kind === "text" ? { height: Number(object.style.geometry.height?.toFixed(3)), margin: object.text.margin.map(value => Number(value.toFixed(3))) } : undefined));
        expect(none).toEqual({ height: 0, margin: [0, 9.6, 0, 9.6] });
        expect(thin).toEqual({ height: 4.8, margin: [2.4, 2.667, 2.4, 9.333] });
        expect(tall?.margin).toEqual([4.8, 9.6, 4.8, 9.6]);
    });

    // PptxGenJS writes no clip on a text body; PowerPoint and LibreOffice draw text past the box from its anchor.
    test("does not clip text boxes", () => {
        const rule = presentationCSS(PAGE_SIZES.SCREEN_16X9.landscape).match(/\n\.slide-text \{[^}]*\}/)?.[0];
        expect(rule).toContain("overflow: visible;");
        expect(rule).not.toContain("overflow: hidden");
    });

    test("allows unwrapped text to overflow its box like DrawingML wrap none", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText("This line is wider than its box", { x: 1, y: 1, w: 1, h: 1, wrap: false });

        const box = renderedPage(presentation).querySelector<HTMLElement>(".slide-text");
        expect(box?.style.whiteSpace).toBe("pre");
        expect(box?.style.overflowWrap).toBe("normal");
        expect(box?.style.overflow).toBe("visible");
    });

    test("renders arbitrary preset geometry behind text without duplicating object transforms", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Decision", {
            x: 1,
            y: 1,
            w: 2,
            h: 1.5,
            shape: "diamond",
            fill: { color: "4472C4", transparency: 10 },
            line: { color: "17365D", width: 2 },
            shadow: { type: "outer", color: "000000", opacity: 0.25, blur: 2, angle: 45, offset: 2 },
            rotate: 15,
            align: "center",
        });

        const box = renderedPage(presentation).querySelector<HTMLElement>(".slide-text");
        const svg = box?.querySelector<SVGSVGElement>(":scope > .shape-svg");
        const geometry = svg?.querySelector<SVGGElement>(".shape-geometry");
        const face = geometry?.querySelector<SVGPathElement>(".shape-face");
        expect(renderedPage(presentation).querySelectorAll(".slide-element")).toHaveLength(1);
        expect(box?.dataset.shape).toBe("diamond");
        expect(box?.style.width).toBe("192px");
        expect(box?.style.height).toBe("144px");
        expect(box?.style.transform).toBe("rotate(15deg)");
        expect(box?.style.backgroundColor).toBe("");
        expect(box?.style.boxShadow).toBe("");
        expect(svg?.getAttribute("viewBox")).toBe("0 0 192 144");
        expect(svg?.style.transform).toBe("");
        expect(svg?.style.filter).toContain("drop-shadow");
        expect(face?.getAttribute("d")).toBe("M 0 72 L 96 0 L 192 72 L 96 144 Z");
        expect(face?.getAttribute("fill")).toBe("rgba(68, 114, 196, 0.9)");
        expect(geometry?.querySelector(".shape-outline")?.getAttribute("stroke")).toBe("#17365D");
        expect(box?.lastElementChild?.classList.contains("text-content")).toBe(true);
        expect(box?.querySelector(".text-run")?.textContent).toBe("Decision");
    });

    test("preserves the pinned textDirection quirk", () => {
        expect(normalizeText("ignored", { textDirection: "vert" }).direction).toBe("horizontal");
    });

    // PptxGenJS 4.0.1 addTextDefinition: a numeric `inset` sets lIns/rIns/tIns/bIns in inches; the writer
    // then replaces all four with `margin` (points) when one is given, a zero margin included.
    test("reads the deprecated inset in inches unless a margin overrides it", () => {
        expect(normalizeText("inset", { inset: 0.5 }).margin).toEqual([48, 48, 48, 48]);
        expect(normalizeText("zero", { inset: 0 }).margin).toEqual([0, 0, 0, 0]);
        expect(normalizeText("margin wins", { inset: 0.5, margin: 0 }).margin).toEqual([0, 0, 0, 0]);
        expect(normalizeText("margin wins", { inset: 0.5, margin: [3, 6, 9, 12] }).margin).toEqual([16, 8, 12, 4]);
        expect(normalizeText("default", {}).margin).toEqual(normalizeText("not a number", { inset: Number.NaN }).margin);
    });

    // The roundRect outline is the shape's SVG path; the box itself stays square, so a radius never clips the text.
    test("keeps a rounded text box square", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText("Rounded", { x: 1, y: 1, w: 3, h: 1, shape: "roundRect", rectRadius: 0.4, fill: { color: "D9E2F3" } });
        const box = renderedPage(presentation).querySelector<HTMLElement>(".slide-text");
        expect(box?.getAttribute("style")).not.toContain("border-radius");
        expect(Number(box?.querySelector(".shape-geometry")?.getAttribute("rx"))).toBeCloseTo(38.4);
    });

    // PptxGenJS 4.0.1 declares these but draws nothing different for them: `isTextBox` only adds txBox="1"
    // (LibreOffice draws the box pixel-identical), and no text or shape writer reads the others.
    test("accepts the options PptxGenJS ignores and draws the same deck", () => {
        const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const deck = (extra: { text?: object; shape?: object }) => {
            const presentation = new PuppeteerGen();
            presentation
                .addSlide()
                .addText([{ text: "one", options: { bullet: { type: "number", numberType: "romanUcPeriod" } } }], { x: 1, y: 1, w: 3, h: 1, ...extra.text })
                .addShape("rect", { x: 1, y: 3, w: 2, h: 1, ...extra.shape });
            return presentation.getModel();
        };
        const ignored = deck({ text: { isTextBox: true, textDirection: "vert", data: PNG, path: "logo.png" }, shape: { align: "center" } });
        expect(ignored).toEqual(deck({}));
    });

    // PptxGenJS 4.0.1 genXmlTextRunProperties writes only `glow` into a run's <a:effectLst>: a run's shadow (outer or
    // inner) is in no OOXML, so PowerPoint and LibreOffice draw none. The text box's own shadow is written and drawn.
    test("draws no run shadow, as PptxGenJS writes none, and keeps the text box's", () => {
        const runShadow = { type: "outer", color: "0000FF", blur: 3, offset: 3, angle: 45, opacity: 0.8 } as const;
        const deck = (runOptions: object) => {
            const presentation = new PuppeteerGen();
            presentation.addSlide().addText(
                [
                    { text: "A", options: { ...runOptions } },
                    { text: "B", options: { glow: { size: 4, opacity: 0.5, color: "FF0000" }, ...runOptions } },
                ],
                { x: 1, y: 1, w: 4, h: 1, shadow: { type: "outer", color: "000000", blur: 3, offset: 3, angle: 45, opacity: 0.4 } },
            );
            return presentation;
        };
        const shadowed = deck({ shadow: runShadow });
        expect(shadowed.getModel()).toEqual(deck({}).getModel());
        expect(deck({ shadow: { ...runShadow, type: "inner" } }).getModel()).toEqual(deck({}).getModel());

        const [object] = shadowed.getModel().slides[0]?.objects ?? [];
        expect(object?.kind === "text" && object.text.paragraphs[0]?.runs.map(run => run.shadow)).toEqual([undefined, undefined]);
        expect(object?.style.shadow?.visible).toBe(true);

        const page = renderedPage(shadowed);
        const runs = [...page.querySelectorAll<HTMLElement>(".text-run")];
        expect(runs.map(run => run.dataset.textShadow)).toEqual([undefined, "glow"]);
        expect(runs.some(run => run.hasAttribute("data-shadow-inset"))).toBe(false);
        expect(page.querySelector<HTMLElement>(".slide-text")?.style.boxShadow).not.toBe("");
    });

    test("creates internal slide links and rejects empty hyperlink objects", () => {
        const presentation = new PuppeteerGen();
        const first = presentation.addSlide();
        presentation.addSlide();
        first.addText([{ text: "Next", options: { hyperlink: { slide: 2 } } }]);

        expect(renderedPage(presentation).querySelectorAll(".slide-container")[1]?.id).toBe("slide-2");
        expect(renderedPage(presentation).querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe("#slide-2");
        expect(() => normalizeText([{ text: "bad", options: { hyperlink: {} } }])).toThrow("hyperlink requires either url or slide");
    });
});

/** The underline forms PptxGenJS 4.0.1 accepts at runtime: the declared object, and the deprecated string and boolean. */
const UNDERLINE_FORMS: [string, unknown][] = [
    ["string heavy", "heavy"],
    ["string sng", "sng"],
    ["string dash", "dash"],
    ["string dbl", "dbl"],
    ["string none", "none"],
    ["empty string", ""],
    ["object sng", { style: "sng" }],
    ["object without style", { color: "FF0000" }],
    ["object none", { style: "none" }],
    ["true", true],
    ["false", false],
];

type UnderlinePlace = (slide: PptxGenJS.Slide, underline: unknown) => void;

// `as`: the string and boolean forms are runtime-only; PptxGenJS's types declare only the object form.
const UNDERLINE_PLACES: Record<string, UnderlinePlace> = {
    box: (slide, underline) => slide.addText("Sample", { x: 1, y: 1, w: 3, h: 1, ...({ underline } as PptxGenJS.TextPropsOptions) }),
    run: (slide, underline) => slide.addText([{ text: "Sample", options: { underline } as PptxGenJS.TextPropsOptions }], { x: 1, y: 1, w: 3, h: 1 }),
    "run in an underlined box": (slide, underline) => slide.addText([{ text: "Sample" }], { x: 1, y: 1, w: 3, h: 1, ...({ underline } as PptxGenJS.TextPropsOptions) }),
    shape: (slide, underline) => slide.addText("Sample", { shape: "rect", x: 1, y: 1, w: 3, h: 1, ...({ underline } as PptxGenJS.TextPropsOptions) }),
    link: (slide, underline) => slide.addText([{ text: "Sample", options: { underline, hyperlink: { url: "https://example.com" } } as PptxGenJS.TextPropsOptions }], { x: 1, y: 1, w: 3, h: 1 }),
    cell: (slide, underline) => slide.addTable([[{ text: "Sample", options: { underline } as PptxGenJS.TableCellProps }]], {}),
    "cell in an underlined table": (slide, underline) => slide.addTable([[{ text: "Sample" }]], { underline } as PptxGenJS.TableProps),
};

/** The `u` attribute of the first run PptxGenJS 4.0.1 writes, or undefined when it writes none. */
async function pptxGenJsUnderline(place: UnderlinePlace, underline: unknown): Promise<string | undefined> {
    const pptx = new PptxGenJSRuntime();
    place(pptx.addSlide(), structuredClone(underline));
    // `as`: write() returns a Buffer for the nodebuffer output type.
    const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    return xml.match(/<a:r><a:rPr[^>]*? u="([^"]*)"/)?.[1];
}

function ourUnderline(place: UnderlinePlace, underline: unknown): NormalizedTextRun["decoration"] | undefined {
    const presentation = new PuppeteerGen();
    place(presentation.addSlide(), structuredClone(underline));
    const object = presentation.getModel().slides[0]?.objects[0];
    const text = object?.kind === "table" ? object.table.rows[0]?.cells[0]?.text : object?.kind === "text" ? object.text : undefined;
    return text?.paragraphs[0]?.runs[0]?.decoration;
}

const UNDERLINE_STYLES: Record<string, NormalizedTextRun["decoration"]["underlineStyle"]> = { sng: "solid", heavy: "solid", dash: "dashed", dbl: "double" };

describe("underline forms (the `u` PptxGenJS 4.0.1 genXmlTextRunProperties writes)", () => {
    const cases = UNDERLINE_FORMS.flatMap(([form, underline]) => Object.keys(UNDERLINE_PLACES).map(place => [form, place, underline] as const));
    test.each(cases)("%s on a %s draws what PptxGenJS writes", async (_form, place, underline) => {
        const build = UNDERLINE_PLACES[place];
        if (!build) throw new Error(`no underline place ${place}`);
        const u = await pptxGenJsUnderline(build, underline);
        const decoration = ourUnderline(build, underline);
        expect(decoration?.underline).toBe(Boolean(u) && u !== "none");
        if (u && UNDERLINE_STYLES[u]) expect(decoration?.underlineStyle).toBe(UNDERLINE_STYLES[u]);
    });

    test("the HTML underlines a deprecated string underline in its style", () => {
        const presentation = new PuppeteerGen();
        // `as`: PptxGenJS's types declare only the object form; the deprecated string form is still written.
        const run = (text: string, underline: string): PptxGenJS.TextProps => ({ text, options: { underline } as unknown as PptxGenJS.TextPropsOptions });
        presentation.addSlide().addText([run("heavy", "heavy"), run("dash", "dash"), run("none", "none")], { x: 1, y: 1, w: 4, h: 1 });
        const runs = [...renderedPage(presentation).querySelectorAll<HTMLElement>(".text-run")];
        expect(runs.map(element => [element.textContent, element.style.textDecorationLine.includes("underline"), element.style.textDecorationStyle])).toEqual([
            ["heavy", true, "solid"],
            ["dash", true, "dashed"],
            ["none", false, "solid"],
        ]);
    });
});

type TextPlace = (slide: PptxGenJS.Slide) => void;
// Each builds its options afresh, so the PptxGenJS pass and the fresh pass never share an object.
const NULLED_TEXT_PLACES: Record<string, () => TextPlace> = {
    runs: () => {
        const runs: PptxGenJS.TextProps[] = [{ text: "One", options: { breakLine: true } }, { text: "Two\n" }, { text: "Three" }];
        const options: PptxGenJS.TextPropsOptions = { x: 1, y: 1, w: 4, h: 2, fontSize: 12 };
        return slide => slide.addText(runs, options);
    },
    "runs in a spaced box": () => {
        const runs: PptxGenJS.TextProps[] = [{ text: "One", options: { breakLine: true, lineSpacingMultiple: 1.5 } }, { text: "Two" }];
        const options: PptxGenJS.TextPropsOptions = { x: 1, y: 1, w: 4, h: 2, fontSize: 12, lineSpacing: 20 };
        return slide => slide.addText(runs, options);
    },
    string: () => {
        const options: PptxGenJS.TextPropsOptions = { x: 1, y: 1, w: 4, h: 2, fontSize: 12 };
        return slide => slide.addText("One\nTwo", options);
    },
    shape: () => {
        const options: PptxGenJS.TextPropsOptions = { shape: "rect", x: 1, y: 1, w: 4, h: 2, fontSize: 12 };
        return slide => slide.addText("One\nTwo", options);
    },
};

describe("options PptxGenJS 4.0.1 has written once", () => {
    test.each(Object.keys(NULLED_TEXT_PLACES))("%s: its null lineSpacing and lineSpacingMultiple leave the text as fresh options do", async place => {
        const build = NULLED_TEXT_PLACES[place];
        if (!build) throw new Error(`no text place ${place}`);
        // The text only: PptxGenJS also writes `line: {}` into the box, which draws an outline here (a separate gap).
        const text = (add: TextPlace) => {
            const presentation = new PuppeteerGen();
            add(presentation.addSlide());
            const object = presentation.getModel().slides[0]?.objects[0];
            return object?.kind === "text" ? object.text : undefined;
        };
        const written = build();
        const pptx = new PptxGenJSRuntime();
        written(pptx.addSlide());
        await pptx.write({ outputType: "nodebuffer" });
        const fresh = text(build());
        if (!fresh) throw new Error(`${place} made no text`);
        expect(text(written)).toEqual(fresh);
    });

    test("PptxGenJS writes null line spacing into the options it is given", () => {
        const options: PptxGenJS.TextPropsOptions = { x: 1, y: 1, w: 4, h: 2 };
        new PptxGenJSRuntime().addSlide().addText("Text", options);
        expect(options).toMatchObject({ lineSpacing: null, lineSpacingMultiple: null });
    });

    test("a null run or box lineSpacing is unset, so the line keeps its single height", () => {
        // `as`: PptxGenJS's types leave out the null it writes itself.
        const unset = { lineSpacing: null, lineSpacingMultiple: null } as unknown as PptxGenJS.TextPropsOptions;
        const single = normalizeText("Text", { fontSize: 12 }).paragraphs[0];
        expect(normalizeText("Text", { fontSize: 12, ...unset }).paragraphs[0]).toEqual(single!);
        expect(normalizeText([{ text: "Text", options: unset }], { fontSize: 12 }).paragraphs[0]).toEqual(single!);
        // A null run value inherits the box's, as PptxGenJS's `run.lineSpacing || box.lineSpacing` does.
        expect(normalizeText([{ text: "Text", options: unset }], { fontSize: 12, lineSpacing: 20 }).paragraphs[0]?.lineBox.height).toBeCloseTo(pointsToPixels(20));
        for (const target of ["libreoffice", "powerpoint"] as const) {
            expect(normalizeText("Text", { fontSize: 12, ...unset }, target).paragraphs[0]?.lineBox).toEqual(normalizeText("Text", { fontSize: 12 }, target).paragraphs[0]!.lineBox);
        }
    });
});

// PptxGenJS 4.0.1 writes an empty run, or the empty line between two line feeds, as an <a:p> with only <a:endParaRPr>;
// PowerPoint and LibreOffice draw it one line at the size written there.
describe("paragraphs without a run", () => {
    const heading = { text: "Heading", options: { fontSize: 12, bold: true, breakLine: true } };
    const body = { text: "Body", options: { fontSize: 12 } };
    const CASES: ReadonlyArray<{ name: string; runs: PptxGenJS.TextProps[]; options: PptxGenJS.TextPropsOptions; size: number }> = [
        // The box's or cell's fontSize, not the 12pt runs around it.
        { name: "line feeds, 8pt parent", runs: [{ text: "Heading\n\nBody", options: { fontSize: 12 } }], options: { fontSize: 8 }, size: 8 },
        { name: "empty run, 8pt parent", runs: [heading, { text: "", options: { breakLine: true } }, body], options: { fontSize: 8 }, size: 8 },
        // The empty run's own size is never written: the parent's comes first.
        { name: "empty run of its own 20pt, 8pt parent", runs: [heading, { text: "", options: { breakLine: true, fontSize: 20 } }, body], options: { fontSize: 8 }, size: 8 },
        // Without one, the first run size PptxGenJS met so far, set on the shared options (genXmlTextBody step 6 E).
        { name: "empty run of its own 20pt, no parent size", runs: [heading, { text: "", options: { breakLine: true, fontSize: 20 } }, body], options: {}, size: 12 },
        { name: "leading empty run of its own 20pt", runs: [{ text: "", options: { breakLine: true, fontSize: 20 } }, body], options: {}, size: 20 },
        // Nothing written: the default size.
        { name: "leading empty run, no size", runs: [{ text: "", options: { breakLine: true } }, body], options: {}, size: PPTX_DEFAULTS.text.fontSizePt },
    ];

    /** The `sz` PptxGenJS writes on the `<a:endParaRPr>` of the first run-less `<a:p>` of a text box, in points. */
    async function writtenMarkSize(runs: PptxGenJS.TextProps[], options: PptxGenJS.TextPropsOptions): Promise<number | undefined> {
        const pptx = new PptxGenJSRuntime();
        pptx.addSlide().addText(structuredClone(runs), { x: 1, y: 1, w: 4, h: 2, ...options });
        const zip = await JSZip.loadAsync((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
        const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
        const runless = xml.split("<a:p>").find(paragraph => paragraph.includes("<a:endParaRPr") && !paragraph.includes("<a:r>"));
        const size = runless?.match(/<a:endParaRPr[^>]* sz="(\d+)"/)?.[1];
        return size === undefined ? undefined : Number(size) / 100;
    }

    test("take the size PptxGenJS writes on the paragraph mark, in a text box", async () => {
        for (const { name, runs, options, size } of CASES) {
            expect({ name, size: (await writtenMarkSize(runs, options)) ?? PPTX_DEFAULTS.text.fontSizePt }).toEqual({ name, size });
            for (const target of ["libreoffice", "powerpoint"] as const) {
                const empty = normalizeText(structuredClone(runs), options, target).paragraphs.find(paragraph => paragraph.runs.every(run => !run.text));
                expect({ name, target, size: empty?.runs[0]?.fontSize }).toEqual({ name, target, size: pointsToPixels(size) });
                // One single line of that size: 1.2x, the line box the HTML writes as line-height.
                expect(empty?.lineBox.height).toBeCloseTo(pointsToPixels(1.2 * size), 9);
            }
        }
    });

    test("take the size PptxGenJS writes on the paragraph mark, in a table cell", () => {
        const cell = (runs: PptxGenJS.TextProps[], table: PptxGenJS.TableProps) => {
            const text = normalizeTable([[{ text: structuredClone(runs) as PptxGenJS.TableCell[] }]], { x: 1, y: 1, w: 4, ...table }, PAGE_SIZES.SCREEN_16X9.landscape).rows[0]?.cells[0]?.text;
            return text?.paragraphs.map(paragraph => paragraph.lineBox.height);
        };
        const lines = (...points: number[]) => points.map(size => expect.closeTo(pointsToPixels(1.2 * size), 9));
        // A table fontSize reaches the cell's <a:endParaRPr>; autoPage rebuilds the runs and keeps it.
        expect(cell([{ text: "Heading\n\nBody", options: { fontSize: 12 } }], { fontSize: 8 })).toEqual(lines(12, 8, 12));
        expect(cell([{ text: "Heading\n\nBody", options: { fontSize: 12 } }], { fontSize: 8, autoPage: true })).toEqual(lines(12, 8, 12));
        expect(cell([heading, { text: "", options: { breakLine: true, fontSize: 20 } }, body], { fontSize: 8 })).toEqual(lines(12, 8, 12));
        expect(cell([heading, { text: "", options: { breakLine: true } }, body], {})).toEqual(lines(12, 12, 12));
    });

    test("write the mark's line height into the HTML", () => {
        const presentation = new PuppeteerGen();
        presentation.addSlide().addText([{ text: "Heading\n\nBody", options: { fontSize: 12 } }], { x: 1, y: 1, w: 4, h: 2, fontSize: 8 });
        const heights = Array.from(renderedPage(presentation).querySelectorAll<HTMLElement>(".text-paragraph"), paragraph => parseFloat(paragraph.style.lineHeight));
        expect(heights.map(height => Number(height.toFixed(6)))).toEqual([19.2, 12.8, 19.2]);
    });
});
