import { afterAll, describe, expect, test } from "bun:test";
import { PuppeteerGen } from "../packages/pptxgenjs/src/node";
import { paragraphAlign, type VerticalAlignSource, verticalAlign } from "../packages/pptxgenjs/src/normalize/alignment";
import { styleAttribute } from "../packages/pptxgenjs/src/render/css";
import { closeBrowser } from "../packages/puppeteer/src/browser";
import { PuppeteerPdfRenderer } from "../packages/puppeteer/src/puppeteerPdf";

afterAll(closeBrowser);

// GHSA-c8m6-398f-qcxr: an alignment written into inline CSS as it was given added a declaration that loads a URL.
const PAYLOAD = "left;background-image:url(http://127.0.0.1:9/x)";
const ALIGN_ERROR = `Text option \`align\` is ${JSON.stringify(PAYLOAD)}; use one of left, center, right, justify`;
const VALIGN_ERROR = `Text option \`valign\` is ${JSON.stringify(PAYLOAD)}; use one of top, middle, bottom`;

describe("alignment options", () => {
    test("keep PptxGenJS's values and read valign as PptxGenJS 4.0.1 reads it in each place", () => {
        for (const align of ["left", "center", "right", "justify"] as const) {
            expect(paragraphAlign(align)).toBe(align);
        }

        expect(paragraphAlign(undefined)).toBeUndefined();
        expect(paragraphAlign("")).toBeUndefined();
        const accepted: Record<VerticalAlignSource, ReadonlyArray<readonly [string, string]>> = {
            // genXmlTextBody step 2: the lower-cased first letter.
            textBox: [
                ["top", "top"],
                ["TOP", "top"],
                ["t", "top"],
                ["middle", "middle"],
                ["Middle", "middle"],
                ["mid", "middle"],
                ["m", "middle"],
                ["bottom", "bottom"],
                ["Bottom", "bottom"],
                ["base", "bottom"],
                ["btm", "bottom"],
            ],
            // genXmlTable's replace chain: /^c$/i and /^m$/i ignore case, the other replacements do not.
            tableCell: [
                ["top", "top"],
                ["t", "top"],
                ["middle", "middle"],
                ["center", "middle"],
                ["ctr", "middle"],
                ["c", "middle"],
                ["C", "middle"],
                ["m", "middle"],
                ["M", "middle"],
                ["bottom", "bottom"],
                ["btm", "bottom"],
                ["b", "bottom"],
            ],
            // genXmlSlideNumber: top, middle and bottom replaced; an anchor value passes as it is.
            slideNumber: [
                ["top", "top"],
                ["middle", "middle"],
                ["bottom", "bottom"],
                ["t", "top"],
                ["ctr", "middle"],
                ["b", "bottom"],
            ],
        };

        for (const [source, cases] of Object.entries(accepted) as Array<[VerticalAlignSource, ReadonlyArray<readonly [string, string]>]>) {
            for (const [valign, expected] of cases) {
                expect([source, valign, verticalAlign(valign, source)]).toEqual([source, valign, expected]);
            }

            expect(verticalAlign(undefined, source)).toBeUndefined();
            expect(verticalAlign("", source)).toBeUndefined();
        }
    });

    test("refuse anything else, naming the option, the value and the allowed values", () => {
        expect(() => paragraphAlign(PAYLOAD)).toThrow(ALIGN_ERROR);
        // PptxGenJS 4.0.1 writes no algn for these: they are not alignments it knows.
        expect(() => paragraphAlign("ctr")).toThrow('Text option `align` is "ctr"');
        expect(() => paragraphAlign("Center")).toThrow('Text option `align` is "Center"');
        expect(() => paragraphAlign("toString")).toThrow('Text option `align` is "toString"');
        expect(() => paragraphAlign(1)).toThrow("Text option `align` is 1");
        const refused: Record<VerticalAlignSource, readonly unknown[]> = {
            // No anchor written: the first letter is not t, m or b.
            textBox: [PAYLOAD, "center", "ctr", "x", 1],
            // An anchor that is not t, ctr or b.
            tableCell: [PAYLOAD, "Top", "Middle", "BOTTOM", "mid", "topp", "xcenter", "toString", 1],
            slideNumber: [PAYLOAD, "center", "c", "m", "Top", "btm"],
        };

        for (const [source, values] of Object.entries(refused) as Array<[VerticalAlignSource, readonly unknown[]]>) {
            for (const value of values) {
                expect(() => verticalAlign(value, source)).toThrow(`Text option \`valign\` is ${JSON.stringify(value)}; use one of top, middle, bottom`);
            }
        }
    });

    test("a text box's valign reaches the HTML as the model's value, never as given", async () => {
        const pres = new PuppeteerGen();

        pres.addSlide().addText("A", { x: 1, y: 1, w: 4, h: 1, valign: "bottom;background-image:url(http://127.0.0.1:9/x)" as "bottom" });
        const { html } = await pres.toHtml();

        expect(html).not.toContain("url(http");
        expect(html).toContain("align-items: flex-end;");
    });

    const evil = PAYLOAD as "left";
    const evilV = PAYLOAD as "top";
    const box = { x: 1, y: 1, w: 4, h: 1 };
    const cases: Array<[string, (pres: PuppeteerGen) => void, string]> = [
        ["a text box's align", pres => pres.addSlide().addText("A", { ...box, align: evil }), ALIGN_ERROR],
        ["a text box's valign", pres => pres.addSlide().addText("A", { ...box, valign: evilV }), VALIGN_ERROR],
        ["a text box's align that every run overrides", pres => pres.addSlide().addText([{ text: "A", options: { align: "left" } }], { ...box, align: evil }), ALIGN_ERROR],
        ["a text run's align", pres => pres.addSlide().addText([{ text: "A", options: { align: evil } }], box), ALIGN_ERROR],
        ["a table cell's align", pres => pres.addSlide().addTable([[{ text: "A", options: { align: evil } }]], { x: 1, y: 1, w: 4 }), ALIGN_ERROR],
        ["a table cell's valign", pres => pres.addSlide().addTable([[{ text: "A", options: { valign: evilV } }]], { x: 1, y: 1, w: 4 }), VALIGN_ERROR],
        ["a run's align in a table cell", pres => pres.addSlide().addTable([[{ text: [{ text: "A", options: { align: evil } }] }]], { x: 1, y: 1, w: 4 }), ALIGN_ERROR],
        ["a table's align, inherited by its cells", pres => pres.addSlide().addTable([[{ text: "A" }]], { x: 1, y: 1, w: 4, align: evil }), ALIGN_ERROR],
        ["a table's valign, inherited by its cells", pres => pres.addSlide().addTable([[{ text: "A" }]], { x: 1, y: 1, w: 4, valign: evilV }), VALIGN_ERROR],
        ["tableToSlides' valign", pres => pres.tableToSlides("<table><tr><td>A</td></tr></table>", { valign: evilV } as never), VALIGN_ERROR],
        [
            "a slide number's valign",
            pres => {
                pres.addSlide().slideNumber = { x: 1, y: 1, valign: evilV };
            },
            VALIGN_ERROR,
        ],
    ];

    for (const [name, add, error] of cases) {
        test(`refuse ${name} before it reaches the HTML`, async () => {
            const pres = new PuppeteerGen();

            // Some objects are normalized when added, others when the HTML is built.
            await expect(
                (async () => {
                    add(pres);
                    await pres.toHtml();
                })(),
            ).rejects.toThrow(error);
        });
    }

    test("a deck with valid and aliased alignments still builds", async () => {
        const pres = new PuppeteerGen();
        const slide = pres.addSlide();

        slide.addText([{ text: "A", options: { align: "justify" } }], { x: 1, y: 1, w: 4, h: 1, align: "center", valign: "Bottom" as "bottom" });
        slide.addTable([[{ text: "A", options: { valign: "C" as "middle", align: "right" } }]], { x: 1, y: 3, w: 4, valign: "bottom" });
        const { html } = await pres.toHtml();

        expect(html).toContain("text-align: justify;");
        expect(html).toContain("vertical-align: middle;");
        expect(html).toContain("text-align: right;");
    });
});

describe("inline CSS", () => {
    test("is written as given when it holds only quoted names and the render code's functions", () => {
        const css = new Map([
            ["font-family", '"Odd \\"Face\\" ; url(x) {}", "Arial"'],
            ["transform", "rotate(30deg) scaleX(-1) scaleY(-1)"],
            ["filter", "drop-shadow(1px 2px 3px rgba(0, 0, 0, 0.5))"],
            ["width", "12.5px"],
        ]);

        expect(styleAttribute(css)).toEqual(["style", 'font-family: "Odd \\"Face\\" ; url(x) {}", "Arial"; transform: rotate(30deg) scaleX(-1) scaleY(-1); filter: drop-shadow(1px 2px 3px rgba(0, 0, 0, 0.5)); width: 12.5px;']);
    });

    test("refuses a value that could add a declaration or load a URL", () => {
        for (const value of [PAYLOAD, "url(http://127.0.0.1:9/x)", "URL(x)", 'image-set("http://127.0.0.1:9/x" 1x)', "red}", "a{", "u\\72l(x)", "'x'", '"open', '"line\nbreak"', "(x)"]) {
            expect(() => styleAttribute(new Map([["text-align", value]]))).toThrow(`Refusing inline CSS text-align: ${JSON.stringify(value)}`);
        }
    });
});

test("the advisory's deck sends no request: refused at the API, and blocked by the print page if it got through", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
            requests.push(new URL(request.url).pathname);

            return new Response("x");
        },
    });

    try {
        const origin = `http://127.0.0.1:${server.port}`;
        const pres = new PuppeteerGen(undefined, { imageSources: { allowRemote: false } });
        const slide = pres.addSlide();

        expect(() => slide.addText([{ text: "hello", options: { align: `left;background-image:url(${origin}/run-align)` as "left" } }], { x: 1, y: 1, w: 4, h: 1 })).toThrow("Text option `align`");
        expect(() => slide.addTable([[{ text: "cell", options: { valign: `top;background-image:url(${origin}/cell-valign)` as "top" } }]], { x: 1, y: 3, w: 4 })).toThrow("Text option `valign`");
        expect(() => slide.addTable([[{ text: "cell", options: { align: `left;background-image:url(${origin}/cell-align)` as "left" } }]], { x: 1, y: 3, w: 4 })).toThrow("Text option `align`");
        await pres.toPdf();
        expect(requests).toEqual([]);

        // The HTML the advisory's deck gave before the options were checked: the print page still fetches nothing.
        const valid = new PuppeteerGen();
        const validSlide = valid.addSlide();

        validSlide.addText([{ text: "hello", options: { align: "left" } }], { x: 1, y: 1, w: 4, h: 1 });
        validSlide.addTable([[{ text: "cell", options: { valign: "top", align: "left" } }]], { x: 1, y: 3, w: 4 });
        const document = await valid.toHtml();
        const html = document.html.replaceAll("text-align: left;", `text-align: left;background-image:url(${origin}/align);`).replaceAll("vertical-align: top;", `vertical-align: top;background-image:url(${origin}/valign);`);

        expect(html).toContain(`url(${origin}/align)`);
        expect(html).toContain(`url(${origin}/valign)`);
        const pdf = await new PuppeteerPdfRenderer().render({ ...document, html });

        expect(new TextDecoder("latin1").decode(pdf.subarray(0, 5))).toBe("%PDF-");
        expect(requests).toEqual([]);
    } finally {
        await server.stop(true);
    }
});
