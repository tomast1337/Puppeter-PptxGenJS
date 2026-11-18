import { afterAll, describe, expect, test } from "bun:test";
import type PptxGenJS from "pptxgenjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeBrowser, withBrowser } from "../packages/puppeteer/src/browser";
import DefaultExport, { PuppeteerGen, PuppeteerGenLibreOffice, PuppeteerGenPowerPoint } from "../packages/pptxgenjs/src/index";
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
        // Single spacing, explicit x1.0 included, keeps the single line box with both targets (#234 is its own rule).
        for (const options of [{ fontSize: 18 }, { fontSize: 18, lineSpacingMultiple: 1 }]) expect(box(options, "powerpoint")).toEqual([21.6, 18]);

        const baselines = async (presentation: PuppeteerGen) => {
            presentation.addSlide().addText("Line", { x: 1, y: 1, w: 3, h: 2, fontSize: 18, lineSpacingMultiple: 1.5 });
            return [...(await presentation.toHtml()).html.matchAll(/class="text-paragraph" data-line-baseline="([^"]*)"/g)].map(match => Number(match[1]));
        };
        // 32.4pt = 43.2px line: 32.4px with PowerPoint, 43.2 - 4.8 = 38.4px with LibreOffice.
        expect(await baselines(new PuppeteerGenPowerPoint())).toEqual([expect.closeTo(32.4, 6)]);
        expect(await baselines(new PuppeteerGenLibreOffice())).toEqual([expect.closeTo(38.4, 6)]);
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
