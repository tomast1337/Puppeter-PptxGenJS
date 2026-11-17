// Tables: cell styling, a long table split over slides with `autoPage`, and `tableToSlides()` from HTML.
// Run: bun run examples/tables.ts (writes tables.pdf to the working directory).
import pptxgen from "@pdflapas/pptxgenjs";

const pres = new pptxgen();
const border = { type: "solid", pt: 1, color: "999999" } as const;
const header = ["Id", "Name", "Status", "Amount"].map(text => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: "555555" } } }));

// A styled table: per-cell options, a merged cell (`colspan`), borders and column widths.
pres.addSlide().addTable(
    [
        header,
        [{ text: "1" }, { text: "Alpha" }, { text: "Open" }, { text: "10.00", options: { align: "right" } }],
        [{ text: "2" }, { text: "Beta" }, { text: "Closed" }, { text: "20.00", options: { align: "right" } }],
        [
            { text: "Total", options: { colspan: 3, bold: true, fill: { color: "EEEEEE" } } },
            { text: "30.00", options: { bold: true, align: "right", fill: { color: "EEEEEE" } } },
        ],
    ],
    { x: 0.5, y: 0.5, colW: [1, 4, 2, 2], fontSize: 14, border },
);

// autoPage: rows that do not fit continue on new slides, with the header row repeated on each one.
const rows = Array.from({ length: 40 }, (_, i) => [{ text: `${i + 1}` }, { text: `Item ${i + 1}` }, { text: i % 2 ? "Open" : "Closed" }, { text: `${(i + 1) * 5}.00` }]);
pres.addSlide().addTable([header, ...rows], { x: 0.5, y: 0.5, colW: [1, 4, 2, 2], fontSize: 12, border, autoPage: true, autoPageRepeatHeader: true });

// tableToSlides: PptxGenJS takes the id of a <table> in the page; PdfLapas also takes HTML markup
// (parsed with jsdom in Node), so no global `document` is needed here.
const bodyRows = Array.from({ length: 30 }, (_, i) => `<tr><td>Row ${i + 1}</td><td>${i * 3}</td></tr>`).join("");
const th = `style="width: 2in; background: #555555; color: #ffffff"`;
pres.tableToSlides(`<table><thead><tr><th ${th}>Name</th><th ${th}>Value</th></tr></thead><tbody>${bodyRows}</tbody></table>`, { autoPageRepeatHeader: true });

console.log(`Wrote ${await pres.writeFile({ fileName: "tables.pdf" })}`);
