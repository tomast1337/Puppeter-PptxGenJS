// Text and rich text: runs, bullets, alignment, insets, line spacing and fitting text into a box.
// Run: bun run examples/text.ts (writes text.pdf to the working directory).
import pptxgen from "@pdflapas/pptxgenjs";

const pres = new pptxgen();
const slide = pres.addSlide();

// A run array: each run carries its own options; `breakLine` ends the paragraph after the run.
slide.addText([{ text: "Bold, ", options: { bold: true } }, { text: "italic, ", options: { italic: true } }, { text: "underlined, ", options: { underline: { style: "sng" } } }, { text: "gray", options: { color: "888888", breakLine: true } }, { text: "Superscript x" }, { text: "2", options: { superscript: true } }], {
    x: 0.5,
    y: 0.3,
    w: 4.5,
    h: 1.2,
    fontSize: 18,
    fontFace: "Arial",
    color: "333333",
});

// Bullets: plain, indented, numbered and a custom character (a Unicode code point).
slide.addText(
    [
        { text: "Plain bullet", options: { bullet: true, breakLine: true } },
        { text: "Indented bullet", options: { bullet: true, indentLevel: 1, breakLine: true } },
        { text: "Numbered one", options: { bullet: { type: "number" }, breakLine: true } },
        { text: "Numbered two", options: { bullet: { type: "number" }, breakLine: true } },
        { text: "Custom character", options: { bullet: { code: "2013" } } },
    ],
    { x: 5.2, y: 0.3, w: 4.3, h: 1.8, fontSize: 14, color: "333333", paraSpaceAfter: 4 },
);

// Alignment: horizontal `align`, vertical `valign`, and `margin` (the inset, in points).
const box = { w: 2.9, h: 1, fontSize: 14, color: "333333", fill: { color: "EEEEEE" } } as const;
slide.addText("Left, top", { ...box, x: 0.5, y: 2.3, align: "left", valign: "top" });
slide.addText("Center, middle", { ...box, x: 3.55, y: 2.3, align: "center", valign: "middle" });
slide.addText("Right, bottom, 12pt margin", { ...box, x: 6.6, y: 2.3, align: "right", valign: "bottom", margin: 12 });

// Line spacing (points), and `fit: "shrink"`, which scales the text down until it fits the box.
const long = "Placeholder text that is longer than its box. ".repeat(6);
slide.addText(long, { x: 0.5, y: 3.6, w: 4.4, h: 1.6, fontSize: 16, lineSpacing: 22, color: "333333", fill: { color: "EEEEEE" } });
slide.addText(long, { x: 5.1, y: 3.6, w: 4.4, h: 1.6, fontSize: 16, fit: "shrink", color: "333333", fill: { color: "EEEEEE" } });

console.log(`Wrote ${await pres.writeFile({ fileName: "text.pdf" })}`);
