import type PptxGenJS from "pptxgenjs";
import type { PuppeteerGen } from "../../src/PuppeterrGen";

type Presentation = PptxGenJS | PuppeteerGen;

/**
 * One shared fixture is rendered by both engines. Keep all options here within
 * the supported PptxGenJS surface so each visual difference is meaningful.
 */
export function populateParityFixture(presentation: Presentation): void {
    const slide = presentation.addSlide();

    slide.addShape("rect", {
        x: 0,
        y: 0,
        w: 10,
        h: 0.75,
        fill: { color: "17365D" },
        line: { color: "17365D", transparency: 100 },
    });
    slide.addText("PuppeteerGen visual parity", {
        x: 0.5,
        y: 0.15,
        w: 9,
        h: 0.4,
        color: "FFFFFF",
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        margin: 0,
    });
    slide.addText("Same API calls, two renderers", {
        x: 0.75,
        y: 1.15,
        w: 8.5,
        h: 0.6,
        color: "17365D",
        fontFace: "Arial",
        fontSize: 26,
        bold: true,
        align: "center",
        valign: "middle",
        margin: 0,
    });
    slide.addText("Text positioning\nLine breaks and styling", {
        x: 0.75,
        y: 2.1,
        w: 3.8,
        h: 1.25,
        fontFace: "Arial",
        fontSize: 17,
        color: "363636",
        fill: { color: "D9EAF7" },
        margin: 8,
        valign: "middle",
    });
    slide.addShape("rect", {
        x: 5.45,
        y: 2.1,
        w: 3.8,
        h: 1.25,
        fill: { color: "E2F0D9" },
        line: { color: "70AD47", width: 1.5 },
    });
    slide.addText("Shape fill and border", {
        x: 5.45,
        y: 2.1,
        w: 3.8,
        h: 1.25,
        fontFace: "Arial",
        fontSize: 17,
        color: "375623",
        align: "center",
        valign: "middle",
        margin: 0,
    });

    const defaultsSlide = presentation.addSlide();
    defaultsSlide.addText("Mapped PptxGenJS defaults", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.6,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });

    defaultsSlide.addShape("rect", {
        x: 0.75, y: 1.15, w: 4, h: 1.25,
        fill: { color: "F2F2F2" },
        line: { color: "A6A6A6", width: 1 },
    });
    defaultsSlide.addText("Default inset and vertical alignment", {
        x: 0.75, y: 1.15, w: 4, h: 1.25,
    });

    defaultsSlide.addShape("rect", {
        x: 5.25, y: 1.15, w: 4, h: 1.25,
        fill: { color: "F2F2F2" },
        line: { color: "A6A6A6", width: 1 },
    });
    defaultsSlide.addText("Explicit zero margin", {
        x: 5.25, y: 1.15, w: 4, h: 1.25,
        margin: 0,
    });

    defaultsSlide.addTable([[
        { text: "Default table inset", options: { fill: { color: "D9EAF7" } } },
        { text: "Default 12pt text", options: { fill: { color: "E2F0D9" } } },
    ]], {
        x: 0.75, y: 3, w: 8.5, h: 1.1,
    });

    const primitivesSlide = presentation.addSlide();
    primitivesSlide.background = { color: "F2F2F2" };
    primitivesSlide.color = "17365D";
    primitivesSlide.addText("Shared Phase 1 primitives", {
        x: 0.5, y: 0.25, w: 9, h: 0.6,
        fontFace: "Arial", fontSize: 24, bold: true, margin: 0,
    });
    primitivesSlide.addText("Inherited slide color", {
        x: 0.75, y: 1.1, w: 3.5, h: 0.6,
        fontFace: "Arial", fontSize: 18, margin: 0,
    });
    primitivesSlide.addShape("rect", {
        x: 0.75, y: 2, w: 3.5, h: 1.5,
        fill: { color: "accent1", transparency: 15 },
        line: { color: "accent2", width: 2, dashType: "dash" },
        rotate: 5,
    });
    primitivesSlide.addShape("rect", {
        x: 5.5, y: 2, w: 3.5, h: 1.5,
        fill: { color: "E2F0D9" },
        line: { color: "70AD47", width: 1 },
        shadow: { type: "outer", color: "000000", opacity: 0.3, blur: 3, offset: 3, angle: 45 },
    });

    const paragraphsSlide = presentation.addSlide();
    paragraphsSlide.addText("Paragraph structure", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    paragraphsSlide.addText([
        { text: "Left paragraph", options: { breakLine: true, align: "left", paraSpaceAfter: 8 } },
        { text: "Centered with exact spacing", options: { breakLine: true, align: "center", lineSpacing: 24 } },
        { text: "Right paragraph", options: { align: "right", paraSpaceBefore: 8 } },
    ], {
        x: 0.75, y: 1, w: 8.5, h: 2.1,
        fontFace: "Arial", fontSize: 18, color: "363636",
        fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 1 }, margin: 8,
    });
    paragraphsSlide.addText("Top\n\nEmpty paragraph preserved", {
        x: 1.5, y: 3.5, w: 7, h: 1.4,
        fontFace: "Arial", fontSize: 15, color: "44546A", align: "center", valign: "middle", margin: 0,
    });

    const runsSlide = presentation.addSlide();
    runsSlide.addText("Mixed run typography", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    runsSlide.addText([
        { text: "Bold ", options: { bold: true, color: "4472C4" } },
        { text: "italic ", options: { italic: true, color: "ED7D31" } },
        { text: "underlined ", options: { underline: { style: "sng", color: "70AD47" } } },
        { text: "highlighted", options: { highlight: "FFF2CC", breakLine: true } },
        { text: "strike ", options: { strike: true } },
        { text: "super", options: { superscript: true, fontSize: 13 } },
        { text: " and ", options: {} },
        { text: "sub", options: { subscript: true, fontSize: 13 } },
    ], {
        x: 0.75, y: 1.2, w: 8.5, h: 2.2,
        fontFace: "Arial", fontSize: 20, color: "363636", margin: 6, valign: "middle",
    });
    runsSlide.addText([{ text: "PuppeteerGen link", options: { hyperlink: { url: "https://example.com" } } }], {
        x: 3, y: 4.1, w: 4, h: 0.6, fontFace: "Arial", fontSize: 17, align: "center", margin: 0,
    });

    const listsSlide = presentation.addSlide();
    listsSlide.addText("Bullets and numbering", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    listsSlide.addText([
        { text: "Default bullet", options: { bullet: true, breakLine: true } },
        { text: "Custom pointer", options: { bullet: { characterCode: "25BA", indent: 24 }, breakLine: true } },
        { text: "Nested bullet", options: { bullet: true, indentLevel: 1 } },
    ], {
        x: 0.75, y: 1, w: 4, h: 3.5, fontFace: "Arial", fontSize: 18, color: "363636", margin: 6,
    });
    listsSlide.addText([
        { text: "Third", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 }, breakLine: true } },
        { text: "Fourth", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 }, breakLine: true } },
        { text: "Fifth", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 } } },
    ], {
        x: 5.25, y: 1, w: 4, h: 3.5, fontFace: "Arial", fontSize: 18, color: "363636", margin: 6,
    });

    const effectsSlide = presentation.addSlide();
    effectsSlide.addText("Text and text-box effects", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    effectsSlide.addText("Rounded, filled, bordered, and shadowed", {
        x: 0.75, y: 1.15, w: 4, h: 1.5,
        fontFace: "Arial", fontSize: 17, color: "FFFFFF", bold: true, align: "center", valign: "middle",
        fill: { color: "4472C4" }, line: { color: "17365D", width: 2 }, shape: "roundRect", rectRadius: 0.2,
        shadow: { type: "outer", color: "000000", opacity: 0.25, blur: 3, offset: 3, angle: 45 }, margin: 6,
    });
    effectsSlide.addText([
        { text: "Transparent", options: { transparency: 35 } },
        { text: " and outlined", options: { outline: { color: "ED7D31", size: 0.75 } } },
    ], {
        x: 5.25, y: 1.15, w: 4, h: 1.5,
        fontFace: "Arial", fontSize: 20, color: "17365D", align: "center", valign: "middle", margin: 4,
    });

    const directionSlide = presentation.addSlide();
    directionSlide.addText("Rotation, direction, and RTL", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    directionSlide.addText("Rotated text", {
        x: 0.7, y: 1.5, w: 2.6, h: 1, rotate: -15,
        fontFace: "Arial", fontSize: 18, color: "4472C4", align: "center", margin: 0,
    });
    directionSlide.addText("VERTICAL", {
        x: 4.1, y: 1, w: 1.2, h: 3.5, vert: "vert",
        fontFace: "Arial", fontSize: 17, color: "ED7D31", align: "center", margin: 0,
    });
    directionSlide.addText("مرحبا بالعالم", {
        x: 6, y: 1.5, w: 3.2, h: 1.2, rtlMode: true,
        fontFace: "Arial", fontSize: 20, color: "375623", align: "right", margin: 4,
    });

    const overflowSlide = presentation.addSlide();
    overflowSlide.addText("Wrapping and overflow", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    overflowSlide.addText("This sentence wraps naturally inside a constrained text box.", {
        x: 0.75, y: 1.1, w: 2.5, h: 1.5,
        fontFace: "Arial", fontSize: 18, color: "363636", fill: { color: "D9EAF7" }, margin: 6,
    });
    overflowSlide.addText("This sentence stays on one line and is clipped at the edge.", {
        x: 3.75, y: 1.1, w: 2.5, h: 1.5, wrap: false,
        fontFace: "Arial", fontSize: 18, color: "363636", fill: { color: "FCE4D6" }, margin: 6,
    });
    overflowSlide.addText("Shrink this oversized text until it fits within the fixed box", {
        x: 6.75, y: 1.1, w: 2.5, h: 1.5, fit: "shrink",
        fontFace: "Arial", fontSize: 24, color: "363636", fill: { color: "E2F0D9" }, margin: 6,
    });
}
