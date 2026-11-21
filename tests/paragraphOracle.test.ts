import { describe, expect, test } from "bun:test";
import PptxGenJSRuntime from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import { normalizeTable } from "../packages/pptxgenjs/src/normalize/table";
import { normalizeText } from "../packages/pptxgenjs/src/normalize/text";
import { PAGE_SIZES } from "../packages/pptxgenjs/src/pageLayouts";

const PAGE = PAGE_SIZES.SCREEN_16X9.landscape;
const FONT = { fontFace: "Arial", fontSize: 12 } as const;

type Deck = { kind: "text"; text: () => PptxGenJS.TextProps[]; options: PptxGenJS.TextPropsOptions } | { kind: "table"; cell: () => PptxGenJS.TableCell[]; options: PptxGenJS.TableProps };

/**
 * The text of each `<a:p>` PptxGenJS 4.0.1 writes for the deck's one text body. A line feed it keeps inside an
 * `<a:t>` (a run whose text ends with "\n") is split off as a paragraph, as PowerPoint draws it.
 */
async function pptxGenJsParagraphs(deck: Deck): Promise<string[]> {
    const pptx = new PptxGenJSRuntime();

    pptx.layout = "LAYOUT_16x9";
    const slide = pptx.addSlide();

    if (deck.kind === "text") {
        slide.addText(deck.text(), { ...deck.options });
    } else {
        slide.addTable([[{ text: deck.cell() }]], { ...deck.options });
    }

    // Stored, not deflated, so the slide XML can be read from the archive bytes without a zip reader.
    const archive = Buffer.from((await pptx.write({ outputType: "nodebuffer", compression: false })) as Uint8Array).toString("utf8");
    const slideXml = /<p:sld [\s\S]*?<\/p:sld>/.exec(archive)?.[0] ?? "";

    return [...slideXml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].flatMap(([, body = ""]) =>
        [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map(([, text = ""]) => text)
            .join("")
            .split("\r\n"),
    );
}

function modelParagraphs(deck: Deck): string[] {
    const text = deck.kind === "text" ? normalizeText(deck.text(), { ...deck.options }) : normalizeTable([[{ text: deck.cell() }]], { ...deck.options }, PAGE).rows[0]?.cells[0]?.text;

    return (text?.paragraphs ?? []).map(paragraph => paragraph.runs.map(run => run.text).join(""));
}

const DECKS: Record<string, Deck> = {
    // #241: splitting on an inner "\n" sets breakLine on every piece, overriding the run's breakLine: false.
    "inner line feed ends every piece": {
        kind: "text",
        text: () => [{ text: "Intro", options: { breakLine: true } }, { text: "\nTITLE", options: { bold: true, breakLine: false } }, { text: "Description", options: { breakLine: true } }, { text: "Tail" }],
        options: { x: 1, y: 1, w: 4, h: 2, ...FONT },
    },
    // #239: a cell's option-less runs share the cell's options, align included.
    "cell runs without options next to a run with options": {
        kind: "table",
        cell: () => [{ text: "Alpha one.\n\n" }, { text: "Beta two.\n" }, { text: "Gamma bold.", options: { bold: true } }],
        options: { x: 0.5, y: 0.5, w: 6, align: "left", ...FONT },
    },
    "cell run with options before runs without": {
        kind: "table",
        cell: () => [{ text: "Heading bold:\n", options: { bold: true } }, { text: "Delta body.\n\n" }, { text: "Epsilon end." }],
        options: { x: 0.5, y: 0.5, w: 6, align: "left", ...FONT },
    },
    "cell align change without line feeds": {
        kind: "table",
        cell: () => [{ text: "Heading", options: { bold: true } }, { text: "Body" }],
        options: { x: 0.5, y: 0.5, w: 6, align: "left", ...FONT },
    },
    "inner line feed in one option-less cell run breaks all of them": {
        kind: "table",
        cell: () => [{ text: "A" }, { text: "B\nC" }, { text: "D" }, { text: "E", options: { bold: true } }, { text: "F", options: { bold: true } }, { text: "G" }],
        options: { x: 0.5, y: 0.5, w: 6, align: "left", ...FONT },
    },
    "numbered runs with a leading line feed": {
        kind: "text",
        text: () => [{ text: "Intro", options: { breakLine: true } }, ...["One", "Two", "Three"].map(item => ({ text: `\nItem ${item}`, options: { bullet: { type: "number" as const, style: "romanUcPeriod" as const } } }))],
        options: { x: 1, y: 1, w: 4, h: 3, ...FONT },
    },
    "numbered cell runs with a leading line feed": {
        kind: "table",
        cell: () => [{ text: "Intro", options: { breakLine: true } }, ...["One", "Two"].map(item => ({ text: `\nItem ${item}`, options: { bullet: { type: "number" as const } } }))],
        options: { x: 0.5, y: 0.5, w: 6, ...FONT },
    },
    // The empty text after a run's last line feed belongs to the next run's paragraph, or is one of its own at the end.
    "runs ending with line feeds in a justified box": {
        kind: "text",
        text: () => [
            { text: "Head line.\n\n", options: { bold: true, fontSize: 16 } },
            { text: "Body text that wraps.\n\n", options: { fontSize: 8 } },
            { text: "More body.\n", options: { fontSize: 8 } },
        ],
        options: { x: 1, y: 1, w: 4, h: 2, align: "justify", ...FONT },
    },
    "run ending with a line feed before an align change": {
        kind: "text",
        text: () => [
            { text: "Left head.\n", options: { align: "left", fontSize: 16 } },
            { text: "Right body.", options: { align: "right", fontSize: 8 } },
        ],
        options: { x: 1, y: 1, w: 4, h: 2, ...FONT },
    },
    // Control: a run ending with "\n" is written whole; PowerPoint draws its line feed as a new paragraph.
    "line feed kept inside a bullet run": {
        kind: "text",
        text: () => [
            { text: "Intro", options: { breakLine: true } },
            { text: "Item one\n", options: { bullet: true } },
            { text: "Item two", options: { bullet: true } },
        ],
        options: { x: 1, y: 1, w: 4, h: 2, ...FONT },
    },
};

describe("paragraphs match the <a:p> list PptxGenJS 4.0.1 writes (genXmlTextBody STEP 4/5)", () => {
    test.each(Object.keys(DECKS))("%s", async name => {
        const deck = DECKS[name];

        if (!deck) {
            throw new Error(`no deck ${name}`);
        }

        expect(modelParagraphs(deck)).toEqual(await pptxGenJsParagraphs(deck));
    });

    test("the issue repros give the paragraphs PptxGenJS writes", () => {
        const paragraphs = (name: string) => {
            const deck = DECKS[name];

            if (!deck) {
                throw new Error(`no deck ${name}`);
            }

            return modelParagraphs(deck);
        };

        expect(paragraphs("inner line feed ends every piece")).toEqual(["Intro", "", "TITLE", "Description", "Tail"]);
        expect(paragraphs("cell runs without options next to a run with options")).toEqual(["Alpha one.", "", "Beta two.", "", "Gamma bold."]);
        expect(paragraphs("cell align change without line feeds")).toEqual(["Heading", "Body"]);
        expect(paragraphs("inner line feed in one option-less cell run breaks all of them")).toEqual(["A", "B", "C", "D", "EF", "G"]);
        expect(paragraphs("runs ending with line feeds in a justified box")).toEqual(["Head line.", "", "Body text that wraps.", "", "More body.", ""]);
        expect(paragraphs("run ending with a line feed before an align change")).toEqual(["Left head.", "", "Right body."]);
    });
});
