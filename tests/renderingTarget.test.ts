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
    // exact 30 22.6, exact 18 13.6, exact 12 9.0, 12pt x1.5 16.25; 0.75 H is 12.96, 24.3, 32.4, 22.5, 13.5, 9.0, 16.2.
    test("with explicit line spacing the PowerPoint target puts the baseline at 0.75 of the line height; LibreOffice at 0.2em above its bottom", async () => {
        const box = (options: Parameters<typeof normalizeText>[1], target?: Parameters<typeof normalizeText>[2]) => {
            const { height, baseline } = normalizeText("Line", options, target).paragraphs[0]!.lineBox;
            return [height, baseline].map(px => Math.round(px * 0.75 * 1000) / 1000);
        };
        const cases: [Parameters<typeof normalizeText>[1], number, number, number][] = [
            // options, H (pt), PowerPoint baseline (0.75 H), LibreOffice baseline (H - 0.2em)
            [{ fontSize: 18, lineSpacingMultiple: 0.8 }, 17.28, 12.96, 13.68],
            [{ fontSize: 18, lineSpacingMultiple: 1.5 }, 32.4, 24.3, 28.8],
            [{ fontSize: 18, lineSpacingMultiple: 2 }, 43.2, 32.4, 39.6],
            [{ fontSize: 18, lineSpacing: 30 }, 30, 22.5, 26.4],
            [{ fontSize: 18, lineSpacing: 18 }, 18, 13.5, 14.4],
            [{ fontSize: 18, lineSpacing: 12 }, 12, 9, 8.4],
            [{ fontSize: 12, lineSpacingMultiple: 1.5 }, 21.6, 16.2, 19.2],
        ];
        for (const [options, height, powerPoint, libreOffice] of cases) {
            expect(box(options, "powerpoint")).toEqual([height, powerPoint]);
            expect(box(options, "libreoffice")).toEqual([height, libreOffice]);
            expect(box(options)).toEqual(box(options, "libreoffice"));
        }
        // Single spacing, explicit x1.0 included, keeps the 1.2em line and the font's baseline (next test): Calibri.
        for (const options of [{ fontSize: 18 }, { fontSize: 18, lineSpacingMultiple: 1 }]) expect(box(options, "powerpoint")).toEqual([21.6, 16.848]);

        const baselines = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Line", { x: 1, y: 1, w: 3, h: 2, fontSize: 18, lineSpacingMultiple: 1.5 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
        };
        // 32.4pt = 43.2px line: 32.4px with PowerPoint, 43.2 - 4.8 = 38.4px with LibreOffice.
        expect(await baselines(new PuppeteerGenPowerPoint())).toEqual([expect.closeTo(32.4, 6)]);
        expect(await baselines(new PuppeteerGenLibreOffice())).toEqual([expect.closeTo(38.4, 6)]);
    });

    // Measured against PowerPoint's PDF export (#234; baseline below the line top): Arial 0.972-0.975em, Calibri
    // 0.936-0.939em, Arial 12/32/18 on one line 31.1pt, an Arial and a Calibri 18pt run on one line 17.04pt.
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
            ["Line", { fontFace: "Arial", fontSize: 18 }, 21.6, 17.503], // 0.9724em
            ["Line", { fontFace: "ARIAL", fontSize: 18 }, 21.6, 17.503],
            ["Line", { fontSize: 18 }, 21.6, 16.848], // Calibri, 0.936em
            ["Line", { fontFace: "Calibri", fontSize: 36 }, 43.2, 33.696],
            ["Line", { fontFace: "Times New Roman", fontSize: 18 }, 21.6, 17.381],
            ["Line", { fontFace: "Courier New", fontSize: 18 }, 21.6, 15.874],
            ["Line", { fontFace: "Cambria", fontSize: 18 }, 21.6, 17.507],
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
                31.116,
            ],
            // Arial's ascent and Calibri's descent overflow the line: scaled back into it.
            [
                [
                    { text: "a", options: { fontFace: "Arial" } },
                    { text: "b", options: { fontFace: "Calibri" } },
                ],
                { fontSize: 18 },
                21.6,
                16.988,
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
        // 18pt = 24px on a 28.8px line: 28.8 x 1854/2288 = 23.337px with PowerPoint, 24px with LibreOffice.
        expect(await baselines(new PuppeteerGenPowerPoint())).toEqual([expect.closeTo(23.337, 3)]);
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

        // 21.6 x 17.503 / (17.503 + 4.752): Arial's ascent and the Calibri mark's descent scaled back into the line.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18 })).toEqual([[17.503, 16.988, undefined]]);
        const [[baseline = 0, mark = 0]] = boxes("Line", { fontFace: "Arial", fontSize: 32 }) as [number[]];
        expect([38.4 - baseline + mark, 38.4 - mark + baseline]).toEqual([expect.closeTo(37.485, 2), expect.closeTo(39.315, 2)]);
        // The mark in the line's own font, or in a theme font of the same metrics, moves nothing.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18 }, "powerpoint", "Arial")).toEqual([[17.503, undefined, undefined]]);
        expect(boxes("Line", { fontSize: 18 })).toEqual([[16.848, undefined, undefined]]);
        // The last run's size, not the 12pt PptxGenJS writes on the second paragraph's <a:endParaRPr>.
        const paragraphs: PptxGenJS.TextProps[] = [
            { text: "Small", options: { fontSize: 12, breakLine: true } },
            { text: "Big", options: { fontSize: 32 } },
        ];
        expect(boxes(paragraphs, { fontFace: "Arial" })).toEqual([
            [11.669, 11.325, undefined],
            [31.116, 30.201, undefined],
        ]);
        // A break takes the size of the run before it: 28pt after Times New Roman, 12pt (no change) after Arial 12.
        const times: PptxGenJS.TextProps[] = [
            { text: "Times", options: { fontFace: "Times New Roman", fontSize: 28 } },
            { text: "Arial", options: { fontFace: "Arial", fontSize: 12, softBreakBefore: true } },
        ];
        expect(boxes(times, {})).toEqual([[27.037, undefined, 26.386]]);
        const rising: PptxGenJS.TextProps[] = [
            { text: "small", options: { fontSize: 12 } },
            { text: "Big", options: { fontSize: 28, softBreakBefore: true } },
        ];
        expect(boxes(rising, { fontFace: "Arial" })).toEqual([[27.227, 26.425, undefined]]);
        // Explicit spacing keeps 0.75 H on every line, and LibreOffice one baseline.
        expect(boxes("Line", { fontFace: "Arial", fontSize: 18, lineSpacingMultiple: 1.5 })).toEqual([[24.3, undefined, undefined]]);
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
        // mark, Calibri at 28pt, pull both lines to 35.181px.
        expect(await attributes(new PuppeteerGenPowerPoint(undefined, { resolveFontMetrics: null }))).toMatch(/^class="text-paragraph" data-line-baseline="36\.04\d*" data-mark-baseline="35\.18\d*" data-break-baseline="35\.18\d*"$/);
        expect(await attributes(new PuppeteerGenLibreOffice())).toMatch(/^class="text-paragraph" data-line-baseline="37\.333\d*"$/);
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
        // 28.8px line: Arial alone 23.337px; the Calibri break scales it back to 22.650px.
        expect(await paragraphs([single, broken])).toEqual([expect.stringMatching(/^ data-line-baseline="23\.33\d*"$/), expect.stringMatching(/^ data-line-baseline="23\.33\d*" data-break-baseline="22\.65\d*"$/)]);
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

    test("an unknown target throws and names the valid ones", () => {
        expect(() => new PuppeteerGen(undefined, { target: "keynote" as "powerpoint" })).toThrow('`target` must be one of "libreoffice", "powerpoint", got "keynote"');
    });
});

describe("rendering targets in Chromium", () => {
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

    test("with the PowerPoint target a line under 12pt is the sum of its unkerned advances; from 12pt it is kerned as with LibreOffice", async () => {
        const powerPoint = await measure(kerningDeck(new PuppeteerGenPowerPoint(), false));
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
        const powerPoint = await measure(kerningDeck(new PuppeteerGenPowerPoint(), true));
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
