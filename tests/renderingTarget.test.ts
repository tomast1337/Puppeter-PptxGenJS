import { afterAll, describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import DefaultExport, { PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "../packages/pptxgenjs/src/index";
import { FONT_WIN_METRICS } from "../packages/pptxgenjs/src/defaults";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { KERNING_CASES } from "./visual/fixture";

afterAll(closeBrowser);

/** 10pt text in a text box, a table cell and a slide number (every place runs come from), then a 14pt run with and without charSpacing. */
function deck(presentation: PuppeteerGen): PuppeteerGen {
    const slide = presentation.addSlide();
    slide.addText("Text box", { x: 1, y: 1, w: 3, h: 1, fontSize: 10 });
    slide.addTable([[{ text: "Cell" }]], { x: 1, y: 2.5, w: 3, fontSize: 10 });
    slide.slideNumber = { x: 9, y: 5, fontSize: 10 };
    slide.addText(
        [
            { text: "Kerned", options: { fontSize: 14 } },
            { text: "Spaced", options: { fontSize: 14, charSpacing: 1 } },
        ],
        { x: 1, y: 4, w: 3, h: 1 },
    );
    return presentation;
}

const runStyles = async (presentation: PuppeteerGen) => [...(await presentation.toHtml()).html.matchAll(/class="text-run"[^>]*style="([^"]*)"/g)].map(match => match[1]);

describe("rendering targets", () => {
    test("the default export and PuppeteerGen keep the LibreOffice target; both named targets are PuppeteerGen subclasses", async () => {
        expect(DefaultExport).toBe(PuppeteerGen);
        for (const Target of [PuppeteerGenLibreOffice, PuppeteerGenPowerPoint]) expect(new Target()).toBeInstanceOf(PuppeteerGen);
        expect(await runStyles(deck(new PuppeteerGenLibreOffice()))).toEqual(await runStyles(deck(new PuppeteerGen())));
    });

    // PptxGenJS inherits kern="1200" (presentation.xml defaultTextStyle) and writes kern="0" with charSpacing.
    test("the PowerPoint target writes font-kerning: none on runs under 12pt or with charSpacing, the LibreOffice target on none", async () => {
        const unkerned = (await runStyles(deck(new PuppeteerGenPowerPoint()))).map(style => style?.includes("font-kerning: none;"));
        // Text box, table cell, 14pt run, 14pt run with charSpacing, slide number (written last).
        expect(unkerned).toEqual([true, true, false, true, true]);
        for (const style of await runStyles(deck(new PuppeteerGenLibreOffice()))) expect(style).not.toContain("font-kerning");
        expect((await deck(new PuppeteerGenPowerPoint()).toHtml()).html).not.toContain('name="pdflapas-target"');
    });

    test("normalization marks runs unkerned only for the PowerPoint target", () => {
        const run = (options: Parameters<typeof normalizeText>[1], target?: Parameters<typeof normalizeText>[2]) => normalizeText("x", options, target).paragraphs[0]?.runs[0];
        expect(run({ fontSize: 11.5 }, "powerpoint")?.kerning).toBe(false);
        expect(run({ fontSize: 12 }, "powerpoint")).not.toHaveProperty("kerning");
        // The 18pt default is kerned; charSpacing turns kerning off at any size.
        expect(run({}, "powerpoint")).not.toHaveProperty("kerning");
        expect(run({ fontSize: 40, charSpacing: 2 }, "powerpoint")?.kerning).toBe(false);
        for (const options of [{ fontSize: 8 }, { charSpacing: 2 }]) {
            expect(run(options, "libreoffice")).not.toHaveProperty("kerning");
            expect(run(options)).not.toHaveProperty("kerning");
        }
    });

    // Measured against PowerPoint's PDF export: 18pt Arial with paraSpaceBefore 6 and paraSpaceAfter 18 has a
    // 45.6pt pitch (21.6 + 6 + 18), where collapsing CSS margins gave 39.6pt (21.6 + 18).
    test("the PowerPoint target adds a paragraph's space after to the next one's space before; LibreOffice keeps both", async () => {
        const spacing = (target?: Parameters<typeof normalizeText>[2]) => normalizeText("Para one\nPara two\nPara three", { fontSize: 18, paraSpaceBefore: 6, paraSpaceAfter: 18 }, target).paragraphs.map(({ spaceBefore, spaceAfter }) => [spaceBefore, spaceAfter]);
        // The first paragraph's space before is dropped too (next test).
        expect(spacing("powerpoint")).toEqual([
            [0, 0],
            [32, 0],
            [32, 0],
        ]);
        expect(spacing("libreoffice")).toEqual([
            [8, 24],
            [8, 24],
            [8, 0],
        ]);
        expect(spacing()).toEqual(spacing("libreoffice"));

        const margins = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Para one\nPara two", { x: 1, y: 1, w: 3, h: 2, fontSize: 18, paraSpaceBefore: 6, paraSpaceAfter: 18 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph"[^>]*margin-top: ([^;]*); margin-bottom: ([^;]*);/g)].map(match => `${match[1]} ${match[2]}`);
        };
        expect(await margins(new PuppeteerGenPowerPoint())).toEqual(["0px 0px", "32px 0px"]);
        expect(await margins(new PuppeteerGenLibreOffice())).toEqual(["8px 24px", "8px 0px"]);
    });

    // Measured against PowerPoint's PDF export: 18pt Arial with paraSpaceBefore 12 has its first baseline 17.05pt
    // below the top inset, as without it, where PdfLapas drew it 29.95pt below; the next ones stay 33.6pt apart.
    test("the PowerPoint target drops the first paragraph's space before, whatever the anchor; LibreOffice keeps it", async () => {
        const before = (valign: "top" | "middle" | "bottom", target?: Parameters<typeof normalizeText>[2]) => normalizeText("Para one\nPara two\nPara three", { fontSize: 18, paraSpaceBefore: 12, valign }, target).paragraphs.map(paragraph => paragraph.spaceBefore);
        for (const valign of ["top", "middle", "bottom"] as const) {
            expect(before(valign, "powerpoint")).toEqual([0, 16, 16]);
            expect(before(valign, "libreoffice")).toEqual([16, 16, 16]);
            expect(before(valign)).toEqual(before(valign, "libreoffice"));
        }
        // Table cells go through the same text normalization. PptxGenJS writes a cell's paraSpaceBefore (genXmlTextBody)
        // although its TableCellProps type leaves it out.
        const options: PptxGenJS.TableCellProps & { paraSpaceBefore: number } = { paraSpaceBefore: 12 };
        const cell = (presentation: PuppeteerGen) => {
            presentation.addSlide().addTable([[{ text: "One\nTwo", options }]], { x: 1, y: 1, w: 3 });
            return presentation.getModel().slides[0]?.objects.flatMap(object => (object.kind === "table" ? object.table.rows.flatMap(row => row.cells.flatMap(cell => cell.text.paragraphs.map(paragraph => paragraph.spaceBefore))) : []));
        };
        expect(cell(new PuppeteerGenPowerPoint())).toEqual([0, 16]);
        expect(cell(new PuppeteerGenLibreOffice())).toEqual([16, 16]);

        const margins = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Para one\nPara two", { x: 1, y: 1, w: 3, h: 2, fontSize: 18, paraSpaceBefore: 12 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph"[^>]*margin-top: ([^;]*);/g)].map(match => match[1]);
        };
        expect(await margins(new PuppeteerGenPowerPoint())).toEqual(["0px", "16px"]);
        expect(await margins(new PuppeteerGenLibreOffice())).toEqual(["16px", "16px"]);
    });

    // Runs ending with "\n" share one <a:p>, PptxGenJS writes an <a:pPr> before each and keeps the line feeds in <a:t>.
    // Measured against PowerPoint's PDF export of synthetic decks (12pt Arial): paraSpaceAfter 12 on the first run puts
    // 26.4pt between all four lines, on a middle or the last run none (14.4pt); paraSpaceBefore and lineSpacing 30 on a
    // later run change nothing; only the last line sits 0.36pt higher, from the paragraph mark in the theme font.
    test("the PowerPoint target gives each paragraph an <a:p>'s line feeds make the first run's properties; LibreOffice the line's first run's", async () => {
        const runs = (): PptxGenJS.TextProps[] => [{ text: "One\n", options: { paraSpaceAfter: 9 } }, { text: "Two\n", options: { paraSpaceBefore: 6, lineSpacing: 30 } }, { text: "Three" }];
        const text = (target: Parameters<typeof normalizeText>[2]) => normalizeText(runs(), { fontSize: 12, fontFace: "Arial", align: "left" }, target).paragraphs;
        const props = (target: Parameters<typeof normalizeText>[2]) => text(target).map(({ spaceBefore, spaceAfter, lineHeight }) => [spaceBefore, spaceAfter, lineHeight]);
        expect(props("powerpoint")).toEqual([
            [0, 0, undefined],
            [12, 0, undefined],
            [12, 0, undefined],
        ]);
        expect(props("libreoffice")).toEqual([
            [0, 12, undefined],
            [8, 0, 40],
            [0, 0, undefined],
        ]);
        // A line feed ends its line in the run's font: only the <a:p>'s last line holds the paragraph mark.
        expect(text("powerpoint").map(paragraph => paragraph.lineBox.markBaseline !== undefined)).toEqual([false, false, true]);
        // The bullet is in the first <a:pPr> too.
        const bullets = normalizeText([{ text: "Item\n", options: { bullet: true } }, { text: "more" }], {}, "powerpoint").paragraphs.map(paragraph => paragraph.bullet?.marker);
        expect(bullets).toEqual(["•", "•"]);

        const html = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText(runs(), { x: 1, y: 1, w: 3, h: 2, fontSize: 12, fontFace: "Arial", align: "left" });
            const page = (await presentation.toHtml()).html;
            return [...page.matchAll(/class="text-paragraph"[^>]*margin-top: ([^;]*);/g)].map(match => match[1]).concat(String(page.match(/data-mark-baseline/g)?.length ?? 0));
        };
        expect(await html(new PuppeteerGenPowerPoint())).toEqual(["0px", "12px", "12px", "1"]);
        expect(await html(new PuppeteerGenLibreOffice())).toEqual(["0px", "8px", "0px", "0"]);
    });

    // Measured against PowerPoint's PDF export (baseline below the line top, pt): 18pt x0.8 13.0, x1.5 24.4, x2.0 32.4,
    // exact 30 22.6, exact 18 13.6, exact 12 9.0, 12pt x1.5 16.25; 0.75 H is 12.96, 24.3, 32.4, 22.5, 13.5, 9.0, 16.2,
    // and on the 0.12pt baseline grid (RENDERING_TARGETS.baselineGridPerInch) 12.96, 24.36, 32.4, 22.56, 13.56, 9.0, 16.2.
    test("with explicit line spacing the PowerPoint target puts the baseline at 0.75 of the line height; LibreOffice at 0.2em above its bottom", async () => {
        const box = (options: Parameters<typeof normalizeText>[1], target?: Parameters<typeof normalizeText>[2]) => {
            const { height, baseline } = normalizeText("Line", options, target).paragraphs[0]!.lineBox;
            return [height, baseline].map(px => Math.round(px * 0.75 * 1000) / 1000);
        };
        const cases: [Parameters<typeof normalizeText>[1], number, number, number][] = [
            // options, H (pt), PowerPoint baseline (0.75 H on the grid), LibreOffice baseline (H - 0.2em)
            [{ fontSize: 18, lineSpacingMultiple: 0.8 }, 17.28, 12.96, 13.68],
            [{ fontSize: 18, lineSpacingMultiple: 1.5 }, 32.4, 24.36, 28.8],
            [{ fontSize: 18, lineSpacingMultiple: 2 }, 43.2, 32.4, 39.6],
            [{ fontSize: 18, lineSpacing: 30 }, 30, 22.56, 26.4],
            [{ fontSize: 18, lineSpacing: 18 }, 18, 13.56, 14.4],
            [{ fontSize: 18, lineSpacing: 12 }, 12, 9, 8.4],
            [{ fontSize: 12, lineSpacingMultiple: 1.5 }, 21.6, 16.2, 19.2],
        ];
        for (const [options, height, powerPoint, libreOffice] of cases) {
            expect(box(options, "powerpoint")).toEqual([height, powerPoint]);
            expect(box(options, "libreoffice")).toEqual([height, libreOffice]);
            expect(box(options)).toEqual(box(options, "libreoffice"));
        }
        // Single spacing, explicit x1.0 included, keeps the 1.2em line and the font's baseline (next test): Calibri, 16.848
        // on the grid.
        for (const options of [{ fontSize: 18 }, { fontSize: 18, lineSpacingMultiple: 1 }]) expect(box(options, "powerpoint")).toEqual([21.6, 16.8]);

        const baselines = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Line", { x: 1, y: 1, w: 3, h: 2, fontSize: 18, lineSpacingMultiple: 1.5 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
        };
        // 32.4pt = 43.2px line: 32.4px with PowerPoint, 32.48px (203/600 in) on its grid; 43.2 - 4.8 = 38.4px with LibreOffice.
        expect(await baselines(new PuppeteerGenPowerPoint())).toEqual([32.48]);
        expect(await baselines(new PuppeteerGenLibreOffice())).toEqual([expect.closeTo(38.4, 6)]);
    });

    // Measured against PowerPoint's PDF export of synthetic decks (12pt Arial): paraSpaceAfter 0.25 -> 0pt, 0.49 -> 0,
    // 0.5 -> 1, 1.25 -> 1, 1.5 -> 2, 2.4 -> 2, 2.5 -> 3, 2.6 -> 3, 5.5 -> 6, paraSpaceBefore the same; after 0.5 then
    // before 0.5 add 2pt (1 + 1); lineSpacing 12.5 gives a 13pt pitch. PptxGenJS writes spcPts val = round(pt * 100).
    test("the PowerPoint target rounds paragraph spacing and point line spacing half-up to whole points; LibreOffice keeps them", async () => {
        const measured: [number, number][] = [
            [0.25, 0],
            [0.49, 0],
            [0.5, 1],
            [1.25, 1],
            [1.5, 2],
            [2.4, 2],
            [2.5, 3],
            [2.6, 3],
            [5.5, 6],
        ];
        const pt = (px: number | undefined) => (px === undefined ? undefined : Math.round(px * 0.75 * 1000) / 1000);
        const gap = (options: PptxGenJS.TextPropsOptions, target: "libreoffice" | "powerpoint") => pt(normalizeText("One\nTwo", { fontSize: 12, ...options }, target).paragraphs[1]?.spaceBefore);
        for (const [points, powerPoint] of measured) {
            expect(gap({ paraSpaceAfter: points }, "powerpoint")).toBe(powerPoint);
            expect(gap({ paraSpaceBefore: points }, "powerpoint")).toBe(powerPoint);
            expect(gap({ paraSpaceBefore: points }, "libreoffice")).toBe(points);
            expect(pt(normalizeText("One\nTwo", { fontSize: 12, paraSpaceAfter: points }, "libreoffice").paragraphs[0]?.spaceAfter)).toBe(points);
        }
        // Each value on its own: 0.5 + 0.5 is 1 + 1, not round(1).
        expect(gap({ paraSpaceAfter: 0.5, paraSpaceBefore: 0.5 }, "powerpoint")).toBe(2);
        const lineHeight = (options: PptxGenJS.TextPropsOptions, target: "libreoffice" | "powerpoint") => pt(normalizeText("Line", { fontSize: 12, ...options }, target).paragraphs[0]?.lineHeight);
        expect(lineHeight({ lineSpacing: 12.5 }, "powerpoint")).toBe(13);
        expect(lineHeight({ lineSpacing: 12.5 }, "libreoffice")).toBe(12.5);
        // spcPct is not rounded.
        expect(normalizeText("Line", { lineSpacingMultiple: 1.13 }, "powerpoint").paragraphs[0]?.lineHeight).toBeCloseTo(1.2 * 1.13);
        // Table cells go through the same normalization. PptxGenJS writes a cell's paraSpaceAfter although its
        // TableCellProps type leaves it out.
        const options: PptxGenJS.TableCellProps & { paraSpaceAfter: number } = { paraSpaceAfter: 2.5 };
        const cell = (presentation: PuppeteerGen) => {
            presentation.addSlide().addTable([[{ text: "One\nTwo", options }]], { x: 1, y: 1, w: 3 });
            const table = presentation.getModel().slides[0]?.objects[0];
            return table?.kind === "table" ? table.table.rows[0]?.cells[0]?.text.paragraphs.map(paragraph => pt(paragraph.spaceBefore)) : undefined;
        };
        expect(cell(new PuppeteerGenPowerPoint())).toEqual([0, 3]);
        expect(cell(new PuppeteerGenLibreOffice())).toEqual([0, 0]);

        // Shape text: 13pt = 17.333px lines; 2pt = 2.667px on the second paragraph with PowerPoint, 1.5pt = 2px after the
        // first with LibreOffice.
        const margins = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("One\nTwo", { shape: "rect", x: 1, y: 1, w: 3, h: 2, fontSize: 12, paraSpaceAfter: 1.5, lineSpacing: 12.5 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph"[^>]*?margin-top: ([^;]*); margin-bottom: ([^;]*); line-height: ([^;]*);/g)].map(match => match.slice(1).join(" "));
        };
        expect(await margins(new PuppeteerGenPowerPoint())).toEqual([expect.stringMatching(/^0px 0px 17\.333\d*px$/), expect.stringMatching(/^2\.666\d*px 0px 17\.333\d*px$/)]);
        expect(await margins(new PuppeteerGenLibreOffice())).toEqual([expect.stringMatching(/^0px 2px 16\.666\d*px$/), expect.stringMatching(/^0px 0px 16\.666\d*px$/)]);
    });

    // Measured against PowerPoint's PDF export (#234; baseline below the line top): Arial 0.972-0.975em, Calibri
    // 0.936-0.939em, Arial 12/32/18 on one line 31.1pt, an Arial and a Calibri 18pt run on one line 17.04pt. Each value
    // is the rule's (in the comments) on the 0.12pt baseline grid.
    test("with single spacing the PowerPoint target puts the baseline at the fonts' winAscent share of the line; LibreOffice at 1em", async () => {
        expect(FONT_WIN_METRICS.arial).toEqual({ unitsPerEm: 2048, winAscent: 1854, winDescent: 434, pairKerning: true });
        expect(FONT_WIN_METRICS.calibri).toEqual({ unitsPerEm: 2048, winAscent: 1950, winDescent: 550, pairKerning: true });
        type Input = Parameters<typeof normalizeText>[0];
        type Options = Parameters<typeof normalizeText>[1];
        const box = (input: Input, options: Options, target: "libreoffice" | "powerpoint") => {
            const { height, baseline } = normalizeText(input, options, target).paragraphs[0]!.lineBox;
            return [height, baseline].map(px => Math.round(px * 0.75 * 1000) / 1000);
        };
        const cases: [Input, Options, number, number][] = [
            // input, options, H (pt), PowerPoint baseline (pt)
            ["Line", { fontFace: "Arial", fontSize: 18 }, 21.6, 17.52], // 0.9724em, 17.503
            ["Line", { fontFace: "ARIAL", fontSize: 18 }, 21.6, 17.52],
            ["Line", { fontSize: 18 }, 21.6, 16.8], // Calibri, 0.936em, 16.848
            ["Line", { fontFace: "Calibri", fontSize: 36 }, 43.2, 33.72], // 33.696
            ["Line", { fontFace: "Times New Roman", fontSize: 18 }, 21.6, 17.4], // 17.381
            ["Line", { fontFace: "Courier New", fontSize: 18 }, 21.6, 15.84], // 15.874
            ["Line", { fontFace: "Cambria", fontSize: 18 }, 21.6, 17.52], // 17.507
            // Not in the table: the font-independent 1em.
            ["Line", { fontFace: "Verdana", fontSize: 18 }, 21.6, 18],
            // Mixed sizes: the largest run's ascent and descent fill the line.
            [
                [
                    { text: "a", options: { fontSize: 12 } },
                    { text: "b", options: { fontSize: 32 } },
                    { text: "c", options: { fontSize: 18 } },
                ],
                { fontFace: "Arial" },
                38.4,
                31.08, // 31.116
            ],
            // Arial's ascent and Calibri's descent overflow the line: scaled back into it.
            [
                [
                    { text: "a", options: { fontFace: "Arial" } },
                    { text: "b", options: { fontFace: "Calibri" } },
                ],
                { fontSize: 18 },
                21.6,
                17.04, // 16.988
            ],
        ];
        for (const [input, options, height, powerPoint] of cases) {
            expect(box(input, options, "powerpoint")).toEqual([height, powerPoint]);
            // LibreOffice: 0.2em above the line bottom, whatever the font.
            expect(box(input, options, "libreoffice")).toEqual([height, Math.round((height / 1.2) * 1000) / 1000]);
        }

        const baselines = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Line", { x: 1, y: 1, w: 3, h: 2, fontFace: "Arial", fontSize: 18 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
        };
        // 18pt = 24px on a 28.8px line: 28.8 x 1854/2288 = 23.337px with PowerPoint, 23.36px (146/600 in) on its grid;
        // 24px with LibreOffice.
        expect(await baselines(new PuppeteerGenPowerPoint())).toEqual([23.36]);
        expect(await baselines(new PuppeteerGenLibreOffice())).toEqual([expect.closeTo(24, 6)]);
    });

    // Measured against PowerPoint's PDF export (#234; baselines below the line top, pt): with the default theme (Calibri)
    // 18pt Arial sits at 17.05 on a paragraph's last line and 17.5 on a wrapped one; at 32pt the pitch is 37.55 from a
    // wrapped line to the last one and 39.25 across paragraphs. A 32pt paragraph whose <a:endParaRPr> says 12pt, and a
    // line ending in a break after 28pt Times New Roman (26.42), still count a mark and a break of their runs' size.
    test("the PowerPoint target counts the paragraph mark on the last line and a soft break on its line, in the theme font at the run's size", () => {
        type Input = Parameters<typeof normalizeText>[0];
        type Options = Parameters<typeof normalizeText>[1];
        const pt = (px: number | undefined) => (px === undefined ? undefined : Math.round(px * 0.75 * 1000) / 1000);
        const boxes = (input: Input, options: Options, target: "libreoffice" | "powerpoint" = "powerpoint", themeFontFace?: string) => normalizeText(input, options, target, undefined, themeFontFace).paragraphs.map(({ lineBox }) => [pt(lineBox.baseline), pt(lineBox.markBaseline), pt(lineBox.breakBaseline)]);

        // 21.6 x 17.503 / (17.503 + 4.752) = 16.988: Arial's ascent and the Calibri mark's descent scaled back into the
        // line. Every baseline below is the rule's on the 0.12pt grid (the rule's in the comments): 17.503 and 16.988 here.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18 })).toEqual([[17.52, 17.04, undefined]]);
        const [[baseline = 0, mark = 0]] = boxes("Line", { fontFace: "Arial", fontSize: 32 }) as [number[]];
        // The rule gives 37.485 and 39.315; on the grid 37.56 and 39.24 against PowerPoint's 37.55 and 39.25.
        expect([38.4 - baseline + mark, 38.4 - mark + baseline]).toEqual([expect.closeTo(37.56, 6), expect.closeTo(39.24, 6)]);
        // The mark in the line's own font, or in a theme font of the same metrics, moves nothing.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18 }, "powerpoint", "Arial")).toEqual([[17.52, undefined, undefined]]);
        expect(boxes("Line", { fontSize: 18 })).toEqual([[16.8, undefined, undefined]]);
        // The last run's size, not the 12pt PptxGenJS writes on the second paragraph's <a:endParaRPr>.
        const paragraphs: PptxGenJS.TextProps[] = [
            { text: "Small", options: { fontSize: 12, breakLine: true } },
            { text: "Big", options: { fontSize: 32 } },
        ];
        expect(boxes(paragraphs, { fontFace: "Arial" })).toEqual([
            [11.64, 11.28, undefined], // 11.669, 11.325
            [31.08, 30.24, undefined], // 31.116, 30.201
        ]);
        // A break takes the size of the run before it: 28pt after Times New Roman, 12pt (no change) after Arial 12.
        const times: PptxGenJS.TextProps[] = [
            { text: "Times", options: { fontFace: "Times New Roman", fontSize: 28 } },
            { text: "Arial", options: { fontFace: "Arial", fontSize: 12, softBreakBefore: true } },
        ];
        expect(boxes(times, {})).toEqual([[27, undefined, 26.4]]); // 27.037, 26.386
        const rising: PptxGenJS.TextProps[] = [
            { text: "small", options: { fontSize: 12 } },
            { text: "Big", options: { fontSize: 28, softBreakBefore: true } },
        ];
        expect(boxes(rising, { fontFace: "Arial" })).toEqual([[27.24, 26.4, undefined]]); // 27.227, 26.425
        // Explicit spacing keeps 0.75 H on every line, and LibreOffice one baseline.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18, lineSpacingMultiple: 1.5 })).toEqual([[24.36, undefined, undefined]]); // 24.3
        expect(boxes(times, {}, "libreoffice")).toEqual([[28, undefined, undefined]]);
    });

    test("toHtml() writes data-mark-baseline and data-break-baseline only where they differ, and only for the PowerPoint target", async () => {
        const attributes = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText(
                [
                    { text: "Times", options: { fontFace: "Times New Roman", fontSize: 28 } },
                    { text: "Second", options: { fontFace: "Times New Roman", fontSize: 28, softBreakBefore: true } },
                ],
                { x: 1, y: 1, w: 3, h: 2 },
            );
            return (await presentation.toHtml()).html.match(/class="text-paragraph"( data-[a-z-]*="[^"]*")*/)?.[0];
        };
        // From FONT_WIN_METRICS (no installed-font lookup): a 44.8px line, Times New Roman at 36.049px; the break and the
        // mark, Calibri at 28pt, pull both lines to 35.181px. On the 1/600 in grid: 36px and 35.2px.
        expect(await attributes(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null }))).toBe('class="text-paragraph" data-line-baseline="36" data-mark-baseline="35.2" data-break-baseline="35.2"');
        expect(await attributes(new PuppeteerGenLibreOffice())).toMatch(/^class="text-paragraph" data-line-baseline="37\.333\d*"$/);
    });

    // Measured against PowerPoint's PDF export of synthetic decks (12pt Arial, top-anchored, margin 0): a 24pt superscript
    // is drawn at 15.96pt (12pt at 8.04), its baseline 7.2pt above the line's; inside a 12pt line it puts the line's
    // baseline 4.3pt below a plain line's, a subscript too. A paragraph whose only run is a 24pt superscript is a 28.8pt
    // line (12pt lines around it 43.2pt apart), and "Next" after the second "3\n" superscript of the case below sits
    // 30.36pt below "Label two" (14.4 + 1 + 14.4 + 1, the empty paragraph after the line feed a full 12pt line).
    test("the PowerPoint target draws super- and subscripts at 2/3 of their size, counted so in the line, and keeps the paragraph mark at full size", async () => {
        type Input = Parameters<typeof normalizeText>[0];
        const pt = (px: number) => Math.round(px * 0.75 * 1000) / 1000;
        /** The baseline of each paragraph's last line below the text top, in pt. */
        const baselines = (input: Input, target: "libreoffice" | "powerpoint") => {
            let top = 0;
            return normalizeText(input, { fontFace: "Arial", fontSize: 12 }, target).paragraphs.map(({ spaceBefore, spaceAfter, lineBox }) => {
                const baseline = top + spaceBefore + (lineBox.markBaseline ?? lineBox.baseline);
                top += spaceBefore + lineBox.height + spaceAfter;
                return pt(baseline);
            });
        };
        const escaped = (target: "libreoffice" | "powerpoint", fontSize: number, options: PptxGenJS.TextPropsOptions) => normalizeText([{ text: "2", options: { fontSize, ...options } }], {}, target).paragraphs[0]!.runs[0]!;
        for (const [fontSize, powerPoint] of [
            [24, 16],
            [12, 8],
        ] as const) {
            expect(pt(escaped("powerpoint", fontSize, { superscript: true }).fontSize)).toBe(powerPoint);
            expect(pt(escaped("libreoffice", fontSize, { superscript: true }).fontSize)).toBe(pt(fontSize * 0.58 * (4 / 3)));
        }
        // The offset is of the full size on both targets: 0.3 x 24pt up, 0.4 x 24pt down (PptxGenJS's baseline="-40000").
        for (const target of ["libreoffice", "powerpoint"] as const) {
            expect(pt(escaped(target, 24, { superscript: true }).baselineOffset)).toBe(7.2);
            expect(pt(escaped(target, 24, { subscript: true }).baselineOffset)).toBe(-9.6);
        }

        const plain = baselines("Text more", "powerpoint")[0]!;
        for (const escapement of [{ superscript: true }, { subscript: true }]) {
            const line: Input = [{ text: "Text " }, { text: "2", options: { fontSize: 24, ...escapement } }, { text: " more" }];
            expect(baselines(line, "powerpoint")[0]! - plain).toBeCloseTo(4.3, 0);
            // 0.58 gave 2.21.
            expect(baselines(line, "libreoffice")[0]! - baselines("Text more", "libreoffice")[0]!).toBeCloseTo(13.92 - 12, 2);
        }

        const alone: Input = [{ text: "Before", options: { breakLine: true } }, { text: "X", options: { superscript: true, fontSize: 24, breakLine: true } }, { text: "After" }];
        const [before = 0, , after = 0] = baselines(alone, "powerpoint");
        expect(after - before).toBeCloseTo(43.2, 1);
        const labels: Input = [{ text: "Label: ", options: { bold: true, paraSpaceAfter: 0.5 } }, { text: "value" }, { text: "3\n", options: { superscript: true } }, { text: "Label two", options: { bold: true } }, { text: "value" }, { text: "3\n", options: { superscript: true, breakLine: true } }, { text: "Next" }];
        const lines = baselines(labels, "powerpoint");
        expect(lines).toHaveLength(4);
        expect(lines[3]! - lines[1]!).toBeCloseTo(30.36, 0);
        // The empty paragraph after the line feed: a 12pt line holding the superscript's empty run.
        const tail = normalizeText(labels, { fontFace: "Arial", fontSize: 12 }, "powerpoint").paragraphs[2]!;
        expect([pt(tail.lineBox.height), pt(tail.runs[0]!.fontSize)]).toEqual([14.4, 8]);
        expect(pt(normalizeText(labels, { fontFace: "Arial", fontSize: 12 }, "libreoffice").paragraphs[2]!.lineBox.height)).toBe(pt(12 * 0.58 * 1.2 * (4 / 3)));

        const html = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText(alone, { x: 1, y: 1, w: 3, h: 2, fontFace: "Arial", fontSize: 12, margin: 0, valign: "top" });
            const page = (await presentation.toHtml()).html;
            return [...page.matchAll(/class="text-paragraph"[^>]*?line-height: ([^;]*);[^>]*>(?:<span class="text-run"[^>]*?font-size: ([^;]*);)?/g)].map(match => match.slice(1).join(" "));
        };
        expect(await html(new PuppeteerGenPowerPoint())).toEqual(["19.2px 16px", "38.4px 21.333333333333332px", "19.2px 16px"]);
        expect(await html(new PuppeteerGenLibreOffice())).toEqual(["19.2px 16px", expect.stringMatching(/^22\.272\d*px 18\.56\d*px$/), "19.2px 16px"]);
    });

    // Measured against PowerPoint's PDF export: 18pt Arial in a cell sits where an Arial mark puts it (0.08pt above
    // PowerPoint's, a Calibri mark puts it 0.55 above), and a line ending in a soft break 0.12 above (0.35 below without
    // the Calibri break). PptxGenJS writes the cell's fontFace on <a:endParaRPr>, never on <a:br/>.
    test("in a table cell the paragraph mark takes the cell's fontFace and a soft break the theme font", async () => {
        const paragraphs = async (cells: PptxGenJS.TableCell[]) => {
            const presentation = new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null });
            presentation.addSlide().addTable([cells], { x: 1, y: 1, w: 6 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph"((?: data-[a-z-]*="[^"]*")*)/g)].map(([, attributes]) => attributes);
        };
        const single = { text: "Line", options: { fontFace: "Arial", fontSize: 18 } };
        const broken = { text: [{ text: "Before" }, { text: "After", options: { softBreakBefore: true } }], options: { fontFace: "Arial", fontSize: 18 } };
        // 28.8px line: Arial alone 23.337px; the Calibri break scales it back to 22.650px. On the grid 23.36 and 22.72px.
        expect(await paragraphs([single, broken])).toEqual([' data-line-baseline="23.36"', ' data-line-baseline="23.36" data-break-baseline="22.72"']);
    });

    // Measured against PowerPoint's PDF export of a synthetic deck: one line "Hxg" in Arial, top anchored, its first
    // baseline below the top inset in pt, in a text box (Calibri theme mark) and in a one-cell table (Arial mark), with
    // margin 0 and the default margins alike. The line box gives 5.663 ... 17.503; PowerPoint draws it on 1/600 in.
    test("the PowerPoint target puts each baseline on a 1/600 in grid; LibreOffice leaves it where the line box puts it", () => {
        const measured: [number, number, number][] = [
            // size (pt), text box, table cell
            [6, 5.64, 5.88],
            [7, 6.6, 6.84],
            [8, 7.56, 7.8],
            [9, 8.52, 8.76],
            [9.5, 9, 9.24],
            [10, 9.48, 9.72],
            [12, 11.28, 11.64],
            [14, 13.2, 13.56],
            [16, 15.12, 15.6],
            [18, 17.04, 17.52],
        ];
        const lastLine = (fontSize: number, target: "libreoffice" | "powerpoint", markFontFace?: string) => {
            const { baseline, markBaseline = baseline } = normalizeText("Hxg", { fontFace: "Arial", fontSize }, target, undefined, undefined, markFontFace).paragraphs[0]!.lineBox;
            return Math.round(markBaseline * 0.75 * 1000) / 1000;
        };
        for (const [size, box, cell] of measured) {
            expect([lastLine(size, "powerpoint"), lastLine(size, "powerpoint", "Arial")]).toEqual([box, cell]);
            // LibreOffice: 1em below the line top, off the grid at 9.5pt.
            expect(lastLine(size, "libreoffice")).toBe(size);
        }
    });

    // Measured against PowerPoint's PDF export and LibreOffice's: neither draws a marker on a paragraph PptxGenJS writes
    // without a run. PowerPoint numbers only paragraphs with text; LibreOffice restarts after a run-less one.
    test("a run-less paragraph has no marker; PowerPoint numbers only paragraphs with text, LibreOffice restarts after a run-less one", async () => {
        const numbered = { bullet: { type: "number" as const, style: "romanUcPeriod" as const } };
        const leading: PptxGenJS.TextProps[] = [{ text: "Intro", options: { breakLine: true } }, ...["One", "Two", "Three"].map(item => ({ text: `\nItem ${item}`, options: numbered }))];
        const trailing: PptxGenJS.TextProps[] = [
            { text: "Item one\n", options: { bullet: { type: "number" } } },
            { text: "Item two", options: { bullet: { type: "number" } } },
        ];
        const markers = (input: PptxGenJS.TextProps[], target: "libreoffice" | "powerpoint") => normalizeText(input, {}, target).paragraphs.map(paragraph => paragraph.bullet?.marker ?? "");
        expect(markers(leading, "powerpoint")).toEqual(["", "", "I.", "", "II.", "", "III."]);
        expect(markers(leading, "libreoffice")).toEqual(["", "", "I.", "", "I.", "", "I."]);
        // A line feed kept inside <a:t> makes an empty paragraph with a run: PowerPoint draws its number without advancing.
        expect(markers(trailing, "powerpoint")).toEqual(["1.", "2.", "2."]);
        expect(markers(trailing, "libreoffice")).toEqual(["1.", "2.", "3."]);

        const presentation = new PuppeteerGenPowerPoint();
        presentation.addSlide().addTable([[{ text: leading }]], { x: 1, y: 1, w: 4 });
        const paragraphs = [...(await presentation.toHtml()).html.matchAll(/<div class="text-paragraph"[^>]*>(.*?)<\/div>/g)].map(([, body = ""]) => body.match(/class="text-bullet"[^>]*>([^&<]*)/)?.[1] ?? "");
        expect(paragraphs).toEqual(["", "", "I.", "", "II.", "", "III."]);
    });

    test("the target classes keep the other constructor options and stay subclassable and proxyable", async () => {
        const rendered: string[] = [];
        const renderer = { render: async ({ html }: { html: string }) => (rendered.push(html), new Uint8Array([1])) };
        class AppDeck extends PuppeteerGenPowerPoint {
            addTitle(text: string) {
                this.addSlide().addText(text, { x: 1, y: 1, w: 4, h: 1, fontSize: 10 });
                return this;
            }
        }
        const app = new Proxy(new AppDeck(undefined, { renderer }), {});
        await app.addTitle("Title").toPdf();
        expect(rendered[0]).toContain("font-kerning: none;");
        expect(app).toBeInstanceOf(PuppeteerGen);
    });

    // The OOXML the PowerPoint target follows, read from the pinned PptxGenJS runtime.
    test('PptxGenJS inherits kern="1200" from defaultTextStyle and writes kern="0" with charSpacing', () => {
        const source = readFileSync(fileURLToPath(import.meta.resolve("pptxgenjs")), "utf8");
        expect(source).toContain(`'<a:defRPr sz="1800" kern="1200">`);
        expect(source).toContain('runProps += opts.charSpacing ? ` spc="${Math.round(opts.charSpacing * 100)}" kern="0"` : \'\';');
        expect(source).not.toMatch(/runProps \+=[^\n]*kern="(?!0")/);
    });

    // Measured against PowerPoint's PDF export of a synthetic deck (Arial 10pt): no break in ")(" or "%(", where UAX #14
    // (Chromium, LibreOffice) has one (RENDERING_TARGETS.powerpoint.joinsOpeningBracket).
    test("the PowerPoint target joins an opening bracket to a closing bracket or % before it with U+2060; LibreOffice keeps the text", () => {
        const texts = (input: Parameters<typeof normalizeText>[0], target: "libreoffice" | "powerpoint") => normalizeText(input, { fontFace: "Arial", fontSize: 10 }, target).paragraphs.map(paragraph => paragraph.runs.map(run => run.text));
        const joined = ["word)(word", "100%(word", "Consectetur)(elit", "word]{word", "word}[word", "a)((b"];
        const untouched = ["word)word", "word(word", "word/word", "word,word", "word;word", "word%word", "word“word", "word+word", "word&word", "word-word", "word–word", "word) (word", "(word)"];
        for (const token of [...joined, ...untouched]) expect(texts(`lorem ${token}`, "libreoffice")).toEqual([[`lorem ${token}`]]);
        expect(joined.map(token => texts(token, "powerpoint")[0]?.[0])).toEqual(["word)⁠(word", "100%⁠(word", "Consectetur)⁠(elit", "word]⁠{word", "word}⁠[word", "a)⁠((b"]);
        for (const token of untouched) expect(texts(token, "powerpoint")).toEqual([[token]]);
        // Across runs of one line too, but not across a soft break or a line feed.
        const runs: PptxGenJS.TextProps[] = [{ text: "word)" }, { text: "(word", options: { bold: true } }, { text: "100%" }, { text: "(word", options: { softBreakBefore: true } }];
        expect(texts(runs, "powerpoint")).toEqual([["word)", "⁠(word", "100%", "(word"]]);
        expect(texts("word)\n(word", "powerpoint")).toEqual([["word)"], ["(word"]]);
    });

    test("an unknown target throws and names the valid ones", () => {
        expect(() => new PuppeteerGen(undefined, { target: "keynote" as "powerpoint" })).toThrow('`target` must be one of "libreoffice", "powerpoint", got "keynote"');
    });
});

describe("rendering targets in Chromium", () => {
    // The kerning cases compare natural advances, so the PowerPoint advance grid (tests/advanceGrid.test.ts) stays off.
    const NATURAL_ADVANCES = { resolveGlyphAdvances: null };
    // Every case from the visual fixture: its box is narrower than the unkerned line and wider than the kerned one.
    function kerningDeck(presentation: PuppeteerGen, wrap: boolean): PuppeteerGen {
        presentation.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
        presentation.layout = "PARITY";
        const slide = presentation.addSlide();
        for (const { text, options } of KERNING_CASES) slide.addText(text, { fontFace: "Arial", ...options, wrap });
        return presentation;
    }

    /** Each run: its width, the sum of its characters' widths measured one at a time (no pair to kern), and its line count. */
    async function measure(presentation: PuppeteerGen) {
        const { html } = await presentation.toHtml();
        return withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent(html);
                return await page.evaluate(() =>
                    Array.from(document.querySelectorAll<HTMLElement>(".text-run"), run => {
                        // Canvas text in the run's font, one character at a time: no neighbour, so no kerning pair.
                        const context = document.createElement("canvas").getContext("2d");
                        if (!context) throw new Error("no 2d canvas context");
                        // Not the `font` shorthand: it carries the strut's line-height, which canvas rejects.
                        const style = getComputedStyle(run);
                        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                        const advances = Array.from(run.textContent ?? "").reduce((sum, character) => sum + context.measureText(character).width, 0);
                        const lines = new Set(Array.from(run.getClientRects(), rect => Math.round(rect.top))).size;
                        return { width: run.getBoundingClientRect().width, advances, lines };
                    }),
                );
            } finally {
                await page.close();
            }
        });
    }

    test("Chromium lays the PowerPoint target's paragraphs 21.6 + 6 + 18 = 45.6pt apart, the first at the top of the text", async () => {
        const presentation = new PuppeteerGenPowerPoint();
        presentation.addSlide().addText("Para one\nPara two\nPara three", { x: 1, y: 1, w: 3, h: 3, fontSize: 18, paraSpaceBefore: 6, paraSpaceAfter: 18 });
        const { html } = await presentation.toHtml();
        const tops = await withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent(html);
                // The text content's top first: the first paragraph has no space before.
                return await page.evaluate(() => Array.from(document.querySelectorAll(".text-content, .text-paragraph"), element => element.getBoundingClientRect().top));
            } finally {
                await page.close();
            }
        });
        expect(tops.slice(1).map((top, index) => top - tops[index]!)).toEqual([0, 60.8, 60.8].map(px => expect.closeTo(px, 1)));
    });

    test("Chromium breaks the PowerPoint target's 'lorem word)(word' and 'lorem 100%(word' before the token, and LibreOffice's inside it", async () => {
        // Each text box's lines, from the top of every character's rectangle.
        async function lines(presentation: PuppeteerGen): Promise<string[][]> {
            const slide = presentation.addSlide();
            for (const [index, token] of ["word)(word", "100%(word", "Consectetur)(elit"].entries()) slide.addText(`lorem ${token}`, { x: 0.5, y: 0.5 + index, w: 0.85, h: 0.5, margin: 0, fontFace: "Arial", fontSize: 10, valign: "top" });
            const { html } = await presentation.toHtml();
            return withBrowser(async browser => {
                const page = await browser.newPage();
                try {
                    await page.setContent(html);
                    return await page.evaluate(() =>
                        Array.from(document.querySelectorAll(".text-content"), content => {
                            const byTop = new Map<number, string>();
                            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
                            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                                for (let offset = 0; offset < (node.textContent ?? "").length; offset++) {
                                    const range = document.createRange();
                                    range.setStart(node, offset);
                                    range.setEnd(node, offset + 1);
                                    const rect = range.getClientRects()[0];
                                    if (!rect) continue;
                                    const top = Math.round(rect.top);
                                    byTop.set(top, `${byTop.get(top) ?? ""}${node.textContent?.[offset] ?? ""}`);
                                }
                            }
                            return Array.from(byTop.values(), line => line.replaceAll("⁠", "").trim());
                        }),
                    );
                } finally {
                    await page.close();
                }
            });
        }
        expect(await lines(new PuppeteerGenPowerPoint())).toEqual([
            ["lorem", "word)(word"],
            ["lorem", "100%(word"],
            // Wider than the line: broken where the line fills, as PowerPoint does.
            ["lorem", "Consectetur)(", "elit"],
        ]);
        expect(await lines(new PuppeteerGenLibreOffice())).toEqual([
            ["lorem word)", "(word"],
            ["lorem 100%", "(word"],
            ["lorem", "Consectetur)", "(elit"],
        ]);
    });

    test("Chromium gives the PowerPoint target's paragraph of a lone 24pt superscript a full 28.8pt line", async () => {
        const presentation = new PuppeteerGenPowerPoint();
        const runs: PptxGenJS.TextProps[] = [{ text: "Before", options: { breakLine: true } }, { text: "X", options: { superscript: true, fontSize: 24, breakLine: true } }, { text: "After" }];
        presentation.addSlide().addText(runs, { x: 1, y: 1, w: 3, h: 2, fontFace: "Arial", fontSize: 12, margin: 0, valign: "top" });
        const { html } = await presentation.toHtml();
        const tops = await withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent(html);
                return await page.evaluate(() => Array.from(document.querySelectorAll(".text-paragraph"), element => element.getBoundingClientRect().top));
            } finally {
                await page.close();
            }
        });
        // 14.4pt = 19.2px, then 28.8pt = 38.4px.
        expect(tops.slice(1).map((top, index) => top - tops[index]!)).toEqual([19.2, 38.4].map(px => expect.closeTo(px, 1)));
    });

    test("with the PowerPoint target a line under 12pt is the sum of its unkerned advances; from 12pt it is kerned as with LibreOffice", async () => {
        const powerPoint = await measure(kerningDeck(new PuppeteerGenPowerPoint(undefined, NATURAL_ADVANCES), false));
        const libreOffice = await measure(kerningDeck(new PuppeteerGenLibreOffice(), false));
        expect(powerPoint).toHaveLength(KERNING_CASES.length);
        for (const [index, { options }] of KERNING_CASES.entries()) {
            const run = powerPoint[index]!;
            const kerned = libreOffice[index]!;
            // A font without kerning pairs (a fallback for Arial) lays both out alike; one with pairs makes the kerned line narrower.
            expect(kerned.width).toBeLessThanOrEqual(kerned.advances + 0.05);
            if (options.fontSize < 12) expect(Math.abs(run.width - run.advances)).toBeLessThan(0.05);
            else expect(run.width).toBe(kerned.width);
        }
    });

    test("a line that fits its box kerned wraps with the PowerPoint target under 12pt when the font kerns it", async () => {
        const unwrapped = await measure(kerningDeck(new PuppeteerGenLibreOffice(), false));
        const powerPoint = await measure(kerningDeck(new PuppeteerGenPowerPoint(undefined, NATURAL_ADVANCES), true));
        const libreOffice = await measure(kerningDeck(new PuppeteerGenLibreOffice(), true));
        for (const [index, { fontSize, w }] of KERNING_CASES.map(({ options }) => options).entries()) {
            const kerned = unwrapped[index]!;
            // shortcut: the box widths are tuned for Liberation Sans (Arial's metric twin); with another fallback, skip the wrap check.
            const tuned = kerned.width < w * 96 && kerned.advances > w * 96;
            if (!tuned) continue;
            expect([fontSize, libreOffice[index]!.lines]).toEqual([fontSize, 1]);
            expect([fontSize, powerPoint[index]!.lines]).toEqual([fontSize, fontSize < 12 ? 2 : 1]);
        }
    });
});
