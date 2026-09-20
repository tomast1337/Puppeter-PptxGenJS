import { describe, expect, test } from "bun:test";
import { normalizeText } from "../src/normalize/text";
import { PuppeteerGen } from "../src/PuppeterrGen";

describe("text normalization", () => {
    test("accepts numbers and preserves empty hard-line paragraphs", () => {
        expect(normalizeText(42).paragraphs[0]?.runs[0]?.text).toBe("42");

        const text = normalizeText("first\n\nthird");
        expect(text.paragraphs).toHaveLength(3);
        expect(text.paragraphs.map(paragraph => paragraph.runs[0]?.text)).toEqual(["first", "", "third"]);
    });

    test("groups rich runs using PptxGenJS break and alignment behavior", () => {
        const text = normalizeText([
            { text: "one", options: { bold: true } },
            { text: "two", options: { breakLine: true } },
            { text: "three", options: { align: "right", softBreakBefore: true } },
        ], { fontFace: "Arial", color: "112233" });

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

        expect(text.margin).toEqual([4 * 96 / 72, 2 * 96 / 72, 3 * 96 / 72, 1 * 96 / 72]);
        expect(text.direction).toBe("stacked");
        expect(text.rtl).toBe(true);
        expect(text.paragraphs[0]?.lineHeight).toBe(32);
        expect(text.paragraphs[0]?.spaceBefore).toBe(8);
        expect(text.paragraphs[0]?.runs[0]).toMatchObject({
            fontSize: 24,
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
});

describe("text DOM rendering", () => {
    test("renders semantic rich runs, bullets, soft breaks, and links", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText([
            { text: "Lead", options: { bold: true, highlight: "FFFF00" } },
            { text: "link", options: { softBreakBefore: true, hyperlink: { url: "https://example.com", tooltip: "Example" } } },
        ], { x: 1, y: 1, w: 4, h: 1, bullet: { characterCode: "25CF" } });

        const box = presentation.page.querySelector<HTMLElement>(".slide-text");
        const paragraph = box?.querySelector<HTMLElement>(".text-paragraph");
        const runs = box?.querySelectorAll<HTMLElement>(".text-run");
        const link = box?.querySelector<HTMLAnchorElement>("a.text-run");
        expect(paragraph?.dataset.bulletType).toBe("bullet");
        expect(paragraph?.style.lineHeight).toBe("1.2");
        expect(paragraph?.querySelector(".text-bullet")?.textContent).toContain("●");
        expect(paragraph?.querySelectorAll("br")).toHaveLength(1);
        expect(runs?.[0]?.style.fontWeight).toBe("bold");
        expect(runs?.[0]?.style.fontFamily).toBe('"Calibri", "Noto Sans", Arial, "Liberation Sans", sans-serif');
        expect(runs?.[0]?.style.backgroundColor).toBe("rgb(255, 255, 0)");
        expect(link?.href).toBe("https://example.com/");
        expect(link?.title).toBe("Example");
    });

    test("keeps text transparency off the box and exposes direction and fit", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Vertical", {
            x: 1, y: 1, w: 2, h: 2,
            transparency: 40,
            vert: "vert270",
            fit: "shrink",
            rectRadius: 0.4,
            shape: "roundRect",
        });

        const box = presentation.page.querySelector<HTMLElement>(".slide-text");
        const content = box?.querySelector<HTMLElement>(".text-content");
        const run = box?.querySelector<HTMLElement>(".text-run");
        expect(box?.style.opacity).toBe("");
        expect(box?.dataset.textDirection).toBe("vertical270");
        expect(box?.dataset.textFit).toBe("shrink");
        expect(box?.style.borderRadius).toBe("20%");
        expect(content?.style.writingMode).toBe("vertical-rl");
        expect(run?.style.color).toBe("rgba(0, 0, 0, 0.6)");
    });

    test("renders arbitrary preset geometry behind text without duplicating object transforms", () => {
        const presentation = new PuppeteerGen();
        const slide = presentation.addSlide();
        slide.addText("Decision", {
            x: 1, y: 1, w: 2, h: 1.5,
            shape: "diamond",
            fill: { color: "4472C4", transparency: 10 },
            line: { color: "17365D", width: 2 },
            shadow: { type: "outer", color: "000000", opacity: 0.25, blur: 2, angle: 45, offset: 2 },
            rotate: 15,
            align: "center",
        });

        const box = presentation.page.querySelector<HTMLElement>(".slide-text");
        const svg = box?.querySelector<SVGSVGElement>(":scope > .shape-svg");
        const geometry = svg?.querySelector<SVGPathElement>(".shape-geometry");
        expect(presentation.page.querySelectorAll(".slide-element")).toHaveLength(1);
        expect(box?.dataset.shape).toBe("diamond");
        expect(box?.style.width).toBe("192px");
        expect(box?.style.height).toBe("144px");
        expect(box?.style.transform).toBe("rotate(15deg)");
        expect(box?.style.backgroundColor).toBe("");
        expect(box?.style.boxShadow).toBe("");
        expect(svg?.getAttribute("viewBox")).toBe("0 0 192 144");
        expect(svg?.style.transform).toBe("");
        expect(svg?.style.filter).toContain("drop-shadow");
        expect(geometry?.getAttribute("d")).toBe("M 96 0 L 192 72 L 96 144 L 0 72 Z");
        expect(geometry?.getAttribute("fill")).toBe("rgba(68, 114, 196, 0.9)");
        expect(geometry?.getAttribute("stroke")).toBe("#17365D");
        expect(box?.lastElementChild?.classList.contains("text-content")).toBe(true);
        expect(box?.querySelector(".text-run")?.textContent).toBe("Decision");
    });

    test("preserves the pinned textDirection and rounded-shape quirks", () => {
        expect(normalizeText("ignored", { textDirection: "vert" }).direction).toBe("horizontal");
        expect(normalizeText("plain", { rectRadius: 0.5 }).borderRadius).toBe(0);
        expect(normalizeText("rounded", { shape: "roundRect", rectRadius: 0.5 }).borderRadius).toBe(25);
    });

    test("creates internal slide links and rejects empty hyperlink objects", () => {
        const presentation = new PuppeteerGen();
        const first = presentation.addSlide();
        presentation.addSlide();
        first.addText([{ text: "Next", options: { hyperlink: { slide: 2 } } }]);

        expect(presentation.page.querySelectorAll(".slide-container")[1]?.id).toBe("slide-2");
        expect(presentation.page.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe("#slide-2");
        expect(() => normalizeText([{ text: "bad", options: { hyperlink: {} } }])).toThrow("hyperlink requires either url or slide");
    });
});
