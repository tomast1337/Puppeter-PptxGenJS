// Migrating from PptxGenJS: the slide code below is unchanged PptxGenJS 4.0.1 code; only the import differs.
// Run: bun run examples/migration.ts (writes migration.pdf to the working directory).
//
// Before:  import pptxgen from "pptxgenjs";
// After:
import pptxgen from "@pdflapas/pptxgenjs";

const pres = new pptxgen();

pres.layout = "LAYOUT_WIDE";
pres.title = "Migration sample";

const slide = pres.addSlide();

slide.background = { color: "F5F5F5" };
slide.addText("Same calls, PDF output", { x: 0.5, y: 0.4, w: 12.3, h: 0.8, fontSize: 32, bold: true, color: "333333" });
slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 1.4, w: 12.3, h: 0.05, fill: { color: "666666" } });
slide.addText(
    [
        { text: "Keep your existing slide code.", options: { bullet: true, breakLine: true } },
        { text: "Change the import.", options: { bullet: true, breakLine: true } },
        { text: "writeFile() now writes a PDF.", options: { bullet: true } },
    ],
    { x: 0.5, y: 1.8, w: 6, h: 2, fontSize: 20, color: "444444" },
);
slide.addTable(
    [
        [
            { text: "Item", options: { bold: true, fill: { color: "DDDDDD" } } },
            { text: "Value", options: { bold: true, fill: { color: "DDDDDD" } } },
        ],
        [{ text: "Alpha" }, { text: "10" }],
        [{ text: "Beta" }, { text: "20" }],
    ],
    { x: 7, y: 1.8, w: 5.8, border: { type: "solid", pt: 1, color: "999999" } },
);

// A ".pptx" file name is turned into ".pdf", so this call needs no change either: it writes migration.pdf.
const fileName = await pres.writeFile({ fileName: "migration.pptx" });

console.log(`Wrote ${fileName}`);
