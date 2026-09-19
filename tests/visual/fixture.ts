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
}
