import { describe, expect, test } from "bun:test";
import PptxGenJSRuntime from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import type { NormalizedTextBox } from "@pdflapas/model";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { pointsToPixels } from "@pdflapas/model";

/** The calls a deck makes, run on PptxGenJS and on PuppeteerGen alike. */
type Deck = (pres: PptxGenJS | PuppeteerGen) => void;

interface Paragraph {
    align: string;
    spaceBefore: number;
    spaceAfter: number;
    bullet: boolean;
    runs: Array<{ text: string; size: number; bold: boolean; italic: boolean; color: string | undefined }>;
}

const XML_ALIGN: Record<string, string> = { l: "left", ctr: "center", r: "right", just: "justify" };
const DEFAULT_SIZE = 18;

/** Each `<a:p>` PptxGenJS 4.0.1 writes, slide by slide and object by object, as the properties PowerPoint reads from it. */
async function pptxGenJsParagraphs(deck: Deck): Promise<Paragraph[]> {
    const pptx = new PptxGenJSRuntime();
    deck(pptx);
    // Stored, not deflated, so the slide XML can be read from the archive bytes without a zip reader.
    const archive = Buffer.from((await pptx.write({ outputType: "nodebuffer", compression: false })) as Uint8Array).toString("utf8");
    const slides = [...archive.matchAll(/<p:sld [\s\S]*?<\/p:sld>/g)].map(([xml]) => xml);
    return slides.flatMap(xml =>
        [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].flatMap(([, body = ""]) => {
            const runs = [...body.matchAll(/<a:r><a:rPr([^>]*)>([\s\S]*?)<\/a:rPr><a:t>([\s\S]*?)<\/a:t><\/a:r>/g)].map(([, attributes = "", children = "", text = ""]) => ({
                text,
                size: Number(/ sz="(\d+)"/.exec(attributes)?.[1] ?? DEFAULT_SIZE * 100) / 100,
                bold: attributes.includes(' b="1"'),
                italic: attributes.includes(' i="1"'),
                // A linked run's color is the theme's hyperlink color in the model (normalizeTextRun), whatever PptxGenJS writes.
                color: children.includes("<a:hlinkClick") ? undefined : `#${/<a:srgbClr val="(\w+)"/.exec(children)?.[1] ?? "000000"}`,
            }));
            if (runs.length === 0) return [];
            const pPr = /<a:pPr([^>]*)>([\s\S]*?)<\/a:pPr>/.exec(body);
            const spacing = (tag: string) => Number(new RegExp(`<a:${tag}><a:spcPts val="(\\d+)"`).exec(pPr?.[2] ?? "")?.[1] ?? 0) / 100;
            return [
                {
                    align: XML_ALIGN[/algn="(\w+)"/.exec(pPr?.[1] ?? "")?.[1] ?? "l"] ?? "left",
                    spaceBefore: spacing("spcBef"),
                    spaceAfter: spacing("spcAft"),
                    bullet: /<a:bu(Char|AutoNum)/.test(pPr?.[2] ?? ""),
                    runs,
                },
            ];
        }),
    );
}

/** The model's paragraphs in the same order. The first and last paragraph of a box keep their XML spacing out of the model, so they are compared as written. */
function modelParagraphs(deck: Deck): Paragraph[] {
    const pres = new PuppeteerGen();
    deck(pres);
    const boxes = pres.getModel().slides.flatMap(slide =>
        slide.objects.flatMap((object): NormalizedTextBox[] => {
            if (object.kind === "text") return [object.text];
            if (object.kind === "table") return object.table.rows.flatMap(row => row.cells.map(cell => cell.text));
            return [];
        }),
    );
    const px = pointsToPixels(1);
    return boxes.flatMap(box =>
        box.paragraphs.map(paragraph => ({
            align: paragraph.align,
            spaceBefore: paragraph.spaceBefore / px,
            spaceAfter: paragraph.spaceAfter / px,
            bullet: Boolean(paragraph.bullet),
            runs: paragraph.runs.map(run => ({ text: run.text, size: Math.round((run.fontSize / px) * 100) / 100, bold: run.bold, italic: run.italic, color: run.link ? undefined : run.color })),
        })),
    );
}

/** The model leaves a box's first space before and last space after out (normalizeText), so those are not compared. */
function comparable(paragraphs: Paragraph[], boxSizes: number[]): Paragraph[] {
    let start = 0;
    return boxSizes.flatMap(size => {
        const box = paragraphs.slice(start, (start += size));
        return box.map((paragraph, index) => ({ ...paragraph, ...(index === 0 ? { spaceBefore: 0 } : {}), ...(index === box.length - 1 ? { spaceAfter: 0 } : {}) }));
    });
}

const BOX = { h: 1, w: 2, fontFace: "Arial", valign: "top" } as const;

const DECKS: Record<string, Deck> = {
    "options shared across two boxes keep the first box's size and spacing": pres => {
        const slide = pres.addSlide();
        const title = { color: "0077AA", italic: true, breakLine: true, paraSpaceAfter: 5 };
        const item = { breakLine: true, paraSpaceAfter: 3 };
        slide.addText(
            [
                { text: "Column A", options: title },
                { text: "Alpha", options: item },
                { text: "Beta", options: item },
            ],
            { ...BOX, x: 1, y: 1, fontSize: 12, color: "000000", align: "left" },
        );
        slide.addText(
            [
                { text: "Column B", options: title },
                { text: "Gamma", options: item },
                { text: "Delta", options: item },
            ],
            { ...BOX, x: 3.2, y: 1, fontSize: 10, color: "000000", align: "left" },
        );
    },
    "options shared across slides": pres => {
        const item = { breakLine: true };
        pres.addSlide().addText(
            [
                { text: "One", options: item },
                { text: "Two", options: item },
            ],
            { ...BOX, x: 1, y: 1, fontSize: 14, bold: true, align: "center", lineSpacing: 20, paraSpaceBefore: 4 },
        );
        pres.addSlide().addText(
            [
                { text: "Three", options: item },
                { text: "Four", options: item },
            ],
            { ...BOX, x: 1, y: 1, fontSize: 9, align: "right", paraSpaceBefore: 8 },
        );
    },
    "falsy run values are filled from the box and carried on": pres => {
        const slide = pres.addSlide();
        const item = { bold: false, fontSize: 0, paraSpaceAfter: 0, breakLine: true };
        slide.addText(
            [
                { text: "A1", options: item },
                { text: "A2", options: item },
            ],
            { ...BOX, x: 1, y: 1, fontSize: 16, bold: true, paraSpaceAfter: 6 },
        );
        slide.addText(
            [
                { text: "B1", options: item },
                { text: "B2", options: item },
            ],
            { ...BOX, x: 4, y: 1, fontSize: 8, paraSpaceAfter: 2 },
        );
    },
    "the first box's color, or the slide's, sticks to runs without one": pres => {
        const red = pres.addSlide();
        red.color = "AA0000";
        const item = { breakLine: true };
        red.addText(
            [
                { text: "Red", options: item },
                { text: "Also red", options: { italic: true } },
            ],
            { ...BOX, x: 1, y: 1, fontSize: 12 },
        );
        pres.addSlide().addText([{ text: "Still red", options: item }, { text: "Blue" }], { ...BOX, x: 1, y: 1, fontSize: 12, color: "0000AA" });
    },
    "a reused run without options shares the options PptxGenJS gives it": pres => {
        const slide = pres.addSlide();
        const runs = [{ text: "Reused", options: undefined }, { text: "Fresh" }];
        slide.addText(runs, { ...BOX, x: 1, y: 1, fontSize: 20, color: "00AA00" });
        slide.addText(runs, { ...BOX, x: 4, y: 1, fontSize: 10, color: "0000AA" });
    },
    "a box without a size sizes later runs from its first sized run": pres => {
        pres.addSlide().addText([{ text: "Big", options: { fontSize: 20 } }, { text: "Also big" }, { text: "Own", options: { fontSize: 9 } }], { ...BOX, x: 1, y: 1 });
    },
    "a box's bullet sticks to its first run": pres => {
        const slide = pres.addSlide();
        const head = { breakLine: true };
        slide.addText([{ text: "Bulleted", options: head }], { ...BOX, x: 1, y: 1, fontSize: 12, bullet: true });
        slide.addText([{ text: "Still bulleted", options: head }, { text: "Plain" }], { ...BOX, x: 4, y: 1, fontSize: 12 });
    },
    "a split run's line break sticks to its options": pres => {
        const slide = pres.addSlide();
        const item = { bold: true };
        slide.addText([{ text: "Two\nlines", options: item }], { ...BOX, x: 1, y: 1, fontSize: 12 });
        slide.addText([{ text: "Ends a paragraph", options: item }, { text: "Next" }], { ...BOX, x: 4, y: 1, fontSize: 12 });
    },
    "linked runs carry their size but not the box's color": pres => {
        const slide = pres.addSlide();
        const link = { hyperlink: { url: "https://example.com" }, breakLine: true };
        slide.addText([{ text: "Link", options: link }, { text: "After" }], { ...BOX, x: 1, y: 1, fontSize: 15, color: "AA0000" });
        slide.addText([{ text: "Link", options: link }, { text: "After" }], { ...BOX, x: 4, y: 1, fontSize: 9, color: "0000AA" });
    },
    "run options shared across table cells and tables": pres => {
        const slide = pres.addSlide();
        const item = { breakLine: true };
        const cell = (text: string) => ({ text: [{ text, options: item }, { text: `${text} tail` }] });
        slide.addTable([[cell("T1"), cell("T2")]], { x: 1, y: 1, w: 4, fontFace: "Arial", fontSize: 14, color: "AA0000", align: "right", bold: true });
        slide.addTable([[cell("T3")]], { x: 1, y: 3, w: 4, fontFace: "Arial", fontSize: 8, color: "0000AA", align: "left" });
    },
    "run options shared between a text box and a table": pres => {
        const slide = pres.addSlide();
        const item = { breakLine: true };
        slide.addText([{ text: "Box", options: item }, { text: "Box tail" }], { ...BOX, x: 1, y: 1, fontSize: 16, color: "AA0000" });
        slide.addTable([[{ text: [{ text: "Cell", options: item }, { text: "Cell tail" }] }]], { x: 1, y: 3, w: 4, fontFace: "Arial", fontSize: 8, color: "0000AA" });
    },
};

describe("run options shared between boxes take what PptxGenJS 4.0.1 wrote onto them (genXmlTextBody STEP 6)", () => {
    test.each(Object.keys(DECKS))("%s", async name => {
        const deck = DECKS[name];
        if (!deck) throw new Error(`no deck ${name}`);
        const written = await pptxGenJsParagraphs(deck);
        const pres = new PuppeteerGen();
        deck(pres);
        const sizes = pres.getModel().slides.flatMap(slide => slide.objects.flatMap(object => (object.kind === "text" ? [object.text.paragraphs.length] : object.kind === "table" ? object.table.rows.flatMap(row => row.cells.map(cell => cell.text.paragraphs.length)) : [])));
        expect(comparable(modelParagraphs(deck), sizes)).toEqual(comparable(written, sizes));
    });

    test("the issue's second box draws at 12pt, as PowerPoint does", () => {
        const deck = DECKS["options shared across two boxes keep the first box's size and spacing"];
        if (!deck) throw new Error("no deck");
        const second = modelParagraphs(deck).slice(3);
        expect(second.flatMap(paragraph => paragraph.runs.map(run => run.size))).toEqual([12, 12, 12]);
        // The model leaves the last paragraph's space after out of the text height.
        expect(second.map(paragraph => paragraph.spaceAfter)).toEqual([5, 3, 0]);
    });

    test("an option the caller sets between two boxes stays, and one it clears takes the first box's", async () => {
        // PptxGenJS writes every box after the last call, so the first box reads the caller's later values too; the
        // second box is the one PdfLapas matches.
        const deck: Deck = pres => {
            const slide = pres.addSlide();
            const item: PptxGenJS.TextPropsOptions = { breakLine: true };
            slide.addText([{ text: "A", options: item }], { ...BOX, x: 1, y: 1, fontSize: 20, italic: true });
            item.fontSize = 11;
            item.italic = false;
            slide.addText([{ text: "B", options: item }], { ...BOX, x: 4, y: 1, fontSize: 8 });
        };
        const second = (await pptxGenJsParagraphs(deck)).at(-1);
        expect(second?.runs).toEqual([{ text: "B", size: 11, bold: false, italic: true, color: "#000000" }]);
        expect(modelParagraphs(deck).at(-1)?.runs).toEqual(second?.runs ?? []);
    });

    test("the caller's options are left as they were", () => {
        const item = { breakLine: true };
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();
        slide.addText([{ text: "A", options: item }], { x: 1, y: 1, fontSize: 20, color: "AA0000" });
        slide.addTable([[{ text: [{ text: "B", options: item }] }]], { x: 1, y: 3, fontSize: 8 });
        expect(item).toEqual({ breakLine: true });
    });

    test("each presentation keeps its own record", () => {
        const item = { breakLine: true };
        const sizes = [20, 8].map(fontSize => {
            const pres = new PuppeteerGen();
            pres.addSlide().addText([{ text: "A", options: item }], { x: 1, y: 1, fontSize });
            return pres.getModel().slides[0]?.objects[0];
        });
        expect(sizes.map(object => (object?.kind === "text" ? object.text.paragraphs[0]?.runs[0]?.fontSize : undefined))).toEqual([pointsToPixels(20), pointsToPixels(8)]);
    });
});
