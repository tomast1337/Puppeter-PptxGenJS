import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointsToPixels } from "@pdflapas/model";
import type { GlyphAdvances } from "../packages/pptxgenjs/src/defaults";
import { PuppeteerGenPowerPoint, resolveInstalledGlyphAdvances } from "../packages/pptxgenjs/src/node";
import { advanceGridWordSpacing, fullWidthStretches, type GridCursor } from "../packages/pptxgenjs/src/normalize/advanceGrid";
import { RENDERING_TARGETS } from "../packages/pptxgenjs/src/target";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { createWasmRenderer, loadSystemFonts } from "../packages/wasm/src/node";
import { type FitVariant, fullWidthFitCases, fullWidthFitDeck } from "./fullWidthFitCases";

afterAll(() => closeBrowser());

const GRID = RENDERING_TARGETS.powerpoint.advanceGridPt ?? 0;
/** A Latin face with Arial's digit and space and no Han, as a fallback face draws it. */
const LATIN: GlyphAdvances = { unitsPerEm: 2048, advances: new Map([[" ".codePointAt(0) ?? 0, 569], ..."0123456789".split("").map(digit => [digit.codePointAt(0) ?? 0, 1139] as const)]) };

describe("Han next to Latin text on the advance grid", () => {
    test("cuts a run where it goes from Han and full-width marks to other characters and back", () => {
        expect(fullWidthStretches("根据条款(ii)将会执行", LATIN)).toEqual(["根据条款", "(ii)", "将会执行"]);
        expect(fullWidthStretches("参见Alpha「Beta」，1999", LATIN)).toEqual(["参见", "Alpha", "「", "Beta", "」，", "1999"]);
        expect(fullWidthStretches("Alpha Beta", LATIN)).toEqual(["Alpha Beta"]);
        // A break marker stays with the stretch before it, and a face that maps Han draws it itself: no cut.
        expect(fullWidthStretches("​参见​1999​（", LATIN)).toEqual(["​参见​", "1999​", "（"]);
        const han: GlyphAdvances = { ...LATIN, advances: new Map([...LATIN.advances, ["参".codePointAt(0) ?? 0, 2048]]) };
        expect(fullWidthStretches("参1999", han)).toEqual(["参1999"]);
    });

    test("counts Han and full-width marks the face does not map as 1em, as the fallback face draws them", () => {
        const cursor: GridCursor = { rounded: 0, laidOut: 0 };
        advanceGridWordSpacing("示例，", 10, LATIN, GRID, 0, false, cursor);
        expect(cursor.rounded).toBeCloseTo(pointsToPixels(30), 9);
        // A character neither mapped nor full-width still counts 0.
        advanceGridWordSpacing("́", 10, LATIN, GRID, 0, false, cursor);
        expect(cursor.rounded).toBeCloseTo(pointsToPixels(30), 9);
    });

    test("does not go on with a word from digits into Han or a full-width mark in the next run, or back", () => {
        const spaced = (text: string, after: string) => {
            const cursor: GridCursor = { rounded: 0, laidOut: 0 };
            return { spacing: advanceGridWordSpacing(text, 10, LATIN, GRID, 0, false, cursor, after), word: cursor.word };
        };
        expect(spaced("1999", "，然后")).toEqual(spaced("1999", ""));
        expect(spaced("然后", "1999")).toEqual(spaced("然后", ""));
        expect(spaced("1999", "2000").word).toBeDefined();
    });
});

/** The lines of the first `pages` pages, as pdftotext reads them, by their number of characters other than white space and U+200B. */
async function drawnLines(pdf: Uint8Array, pages: number, pdftotext: string): Promise<number[][]> {
    const directory = await mkdtemp(join(tmpdir(), "full-width-fit-"));
    try {
        const file = join(directory, "deck.pdf");
        await writeFile(file, pdf);
        const text = Bun.spawnSync([pdftotext, "-raw", "-enc", "UTF-8", file, "-"]).stdout.toString();
        return text
            .split("\f")
            .slice(0, pages)
            .map(page =>
                page
                    .split("\n")
                    .map(line => [...line.replace(/[\s　​⁠]/gu, "")].length)
                    .filter(Boolean),
            );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe("the measured boxes of Han next to digits, Latin words and ASCII parentheses, in both renderers", () => {
    const arial = resolveInstalledGlyphAdvances("Arial", false, false);
    const times = resolveInstalledGlyphAdvances("Times New Roman", false, false);
    const pdftotext = Bun.which("pdftotext");
    const cases = fullWidthFitCases();
    const expected = cases.map(({ label, lines }) => ({ label, lines: [...lines] }));
    const drawn = (lines: number[][]) => cases.map(({ label }, index) => ({ label, lines: lines[index] }));
    const fonts = (fontFace: FitVariant["fontFace"]) => {
        const font = fontFace === "Arial" ? arial : times;
        if (!font) throw new Error(`${fontFace} is not installed: the measured boxes need its advances`);
        return font;
    };

    test.skipIf(!arial || !times || !pdftotext)(
        "breaks each box where PowerPoint does, in Chromium",
        async () => {
            const pdf = await fullWidthFitDeck(new PuppeteerGenPowerPoint(), cases, fonts).toPdf();
            expect(drawn(await drawnLines(pdf, cases.length, pdftotext ?? "pdftotext"))).toEqual(expected);
        },
        120_000,
    );

    test.skipIf(!arial || !times || !pdftotext)(
        "breaks each box where PowerPoint does, in the WASM renderer",
        async () => {
            const renderer = await createWasmRenderer({ fonts: await loadSystemFonts() });
            const pdf = await fullWidthFitDeck(new PuppeteerGenPowerPoint(undefined, { renderer }), cases, fonts).toPdf();
            expect(drawn(await drawnLines(pdf, cases.length, pdftotext ?? "pdftotext"))).toEqual(expected);
        },
        120_000,
    );
});
