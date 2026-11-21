// A long document on A4 paper: a fictional clinic's laboratory report, about ten pages. Lab tables split over
// pages with `autoPage` and repeat their header row; out-of-range values are flagged in colour and bold.
// Every name, number and result here is invented, and nothing in it is medical advice.
// Run: bun run examples/medical-report.ts (writes medical-report.pdf and medical-report.html to the working directory).
import { writeFile } from "node:fs/promises";
import pptxgen from "@pdflapas/pptxgenjs";
import type PptxGenJS from "pptxgenjs";

const NAVY = "1F3A5F";
const TEAL = "1A9E8F";
const GREY = "5B6770";
const RULE = "C8CED6";
const PALE = "EEF2F6";
const ALERT = "C62828";
const ALERT_FILL = "FDECEA";
const FONT = "Arial";
// A4 portrait in inches (210 x 297 mm), with half-inch side margins.
const PAGE = { w: 8.27, h: 11.69, margin: 0.5 } as const;
const CONTENT_W = PAGE.w - 2 * PAGE.margin;
// Pages autoPage adds start their table below the header band. It stops half an inch above the bottom
// edge (its default slide margin), so the footer sits in that half inch.
const BODY_TOP = 1.3;

type NumericResult = { test: string; value: number; unit: string; low: number; high: number };
type TextResult = { test: string; result: string; expected: string };
type Panel = { name: string; rows: readonly (NumericResult | TextResult)[] };

const LAB_TABLES: readonly { title: string; panels: readonly Panel[] }[] = [
    {
        title: "Haematology, chemistry and urinalysis",
        panels: [
            {
                name: "Complete blood count (CBC)",
                rows: [
                    { test: "White blood cells", value: 6.8, unit: "10^9/L", low: 4, high: 11 },
                    { test: "Red blood cells", value: 4.42, unit: "10^12/L", low: 4.2, high: 5.9 },
                    { test: "Haemoglobin", value: 12.6, unit: "g/dL", low: 13, high: 17 },
                    { test: "Haematocrit", value: 38.4, unit: "%", low: 38, high: 50 },
                    { test: "Mean cell volume (MCV)", value: 86.9, unit: "fL", low: 80, high: 100 },
                    { test: "Mean cell haemoglobin (MCH)", value: 28.5, unit: "pg", low: 27, high: 33 },
                    { test: "MCH concentration (MCHC)", value: 32.8, unit: "g/dL", low: 32, high: 36 },
                    { test: "Red cell distribution width", value: 15.1, unit: "%", low: 11.5, high: 14.5 },
                    { test: "Platelets", value: 262, unit: "10^9/L", low: 150, high: 400 },
                    { test: "Mean platelet volume", value: 10.1, unit: "fL", low: 7.5, high: 11.5 },
                    { test: "Neutrophils", value: 3.9, unit: "10^9/L", low: 2, high: 7.5 },
                    { test: "Lymphocytes", value: 2.1, unit: "10^9/L", low: 1, high: 4 },
                    { test: "Monocytes", value: 0.5, unit: "10^9/L", low: 0.2, high: 1 },
                    { test: "Eosinophils", value: 0.24, unit: "10^9/L", low: 0, high: 0.5 },
                    { test: "Basophils", value: 0.04, unit: "10^9/L", low: 0, high: 0.2 },
                ],
            },
            {
                name: "Comprehensive metabolic panel",
                rows: [
                    { test: "Glucose, fasting", value: 104, unit: "mg/dL", low: 70, high: 99 },
                    { test: "Urea nitrogen (BUN)", value: 15, unit: "mg/dL", low: 7, high: 20 },
                    { test: "Creatinine", value: 0.94, unit: "mg/dL", low: 0.6, high: 1.2 },
                    { test: "eGFR", value: 88, unit: "mL/min/1.73m2", low: 60, high: 140 },
                    { test: "Sodium", value: 139, unit: "mmol/L", low: 135, high: 145 },
                    { test: "Potassium", value: 4.2, unit: "mmol/L", low: 3.5, high: 5.1 },
                    { test: "Chloride", value: 102, unit: "mmol/L", low: 98, high: 107 },
                    { test: "Bicarbonate", value: 25, unit: "mmol/L", low: 22, high: 29 },
                    { test: "Calcium", value: 9.4, unit: "mg/dL", low: 8.6, high: 10.3 },
                    { test: "Total protein", value: 7.1, unit: "g/dL", low: 6, high: 8.3 },
                    { test: "Albumin", value: 4.3, unit: "g/dL", low: 3.5, high: 5 },
                    { test: "Bilirubin, total", value: 0.7, unit: "mg/dL", low: 0.1, high: 1.2 },
                    { test: "Alkaline phosphatase", value: 82, unit: "U/L", low: 44, high: 147 },
                    { test: "Alanine aminotransferase", value: 48, unit: "U/L", low: 7, high: 40 },
                    { test: "Aspartate aminotransferase", value: 36, unit: "U/L", low: 10, high: 40 },
                ],
            },
            {
                name: "Urinalysis",
                rows: [
                    { test: "Colour", result: "Yellow", expected: "Yellow" },
                    { test: "Clarity", result: "Clear", expected: "Clear" },
                    { test: "Specific gravity", value: 1.018, unit: "", low: 1.005, high: 1.03 },
                    { test: "pH", value: 6, unit: "", low: 4.5, high: 8 },
                    { test: "Protein", result: "Negative", expected: "Negative" },
                    { test: "Glucose", result: "Negative", expected: "Negative" },
                    { test: "Ketones", result: "Negative", expected: "Negative" },
                    { test: "Blood", result: "Trace", expected: "Negative" },
                    { test: "Nitrite", result: "Negative", expected: "Negative" },
                    { test: "Leukocyte esterase", result: "Negative", expected: "Negative" },
                    { test: "White cells (microscopy)", value: 2, unit: "/HPF", low: 0, high: 5 },
                    { test: "Red cells (microscopy)", value: 4, unit: "/HPF", low: 0, high: 2 },
                ],
            },
        ],
    },
    {
        title: "Lipids, endocrine, micronutrients and coagulation",
        panels: [
            {
                name: "Lipid panel",
                rows: [
                    { test: "Total cholesterol", value: 228, unit: "mg/dL", low: 0, high: 199 },
                    { test: "LDL cholesterol", value: 151, unit: "mg/dL", low: 0, high: 99 },
                    { test: "HDL cholesterol", value: 47, unit: "mg/dL", low: 40, high: 100 },
                    { test: "Triglycerides", value: 148, unit: "mg/dL", low: 0, high: 149 },
                    { test: "Non-HDL cholesterol", value: 181, unit: "mg/dL", low: 0, high: 129 },
                    { test: "Cholesterol / HDL ratio", value: 4.9, unit: "ratio", low: 0, high: 5 },
                ],
            },
            {
                name: "Endocrine",
                rows: [
                    { test: "Thyroid stimulating hormone", value: 2.1, unit: "mIU/L", low: 0.4, high: 4 },
                    { test: "Free thyroxine (FT4)", value: 1.2, unit: "ng/dL", low: 0.8, high: 1.8 },
                    { test: "Haemoglobin A1c", value: 5.9, unit: "%", low: 4, high: 5.6 },
                    { test: "Insulin, fasting", value: 11, unit: "uIU/mL", low: 2.6, high: 24.9 },
                    { test: "Cortisol, morning", value: 14.2, unit: "ug/dL", low: 6.2, high: 19.4 },
                ],
            },
            {
                name: "Iron studies and micronutrients",
                rows: [
                    { test: "Iron", value: 58, unit: "ug/dL", low: 60, high: 170 },
                    { test: "Ferritin", value: 24, unit: "ng/mL", low: 30, high: 400 },
                    { test: "Transferrin saturation", value: 19, unit: "%", low: 20, high: 50 },
                    { test: "Total iron binding capacity", value: 362, unit: "ug/dL", low: 250, high: 450 },
                    { test: "Vitamin B12", value: 412, unit: "pg/mL", low: 200, high: 900 },
                    { test: "Folate", value: 9.8, unit: "ng/mL", low: 3, high: 20 },
                    { test: "Vitamin D, 25-hydroxy", value: 21, unit: "ng/mL", low: 30, high: 100 },
                    { test: "Magnesium", value: 2.0, unit: "mg/dL", low: 1.7, high: 2.2 },
                    { test: "Phosphate", value: 3.6, unit: "mg/dL", low: 2.5, high: 4.5 },
                ],
            },
            {
                name: "Coagulation and inflammation",
                rows: [
                    { test: "Prothrombin time", value: 12.1, unit: "s", low: 11, high: 13.5 },
                    { test: "INR", value: 1.0, unit: "", low: 0.8, high: 1.2 },
                    { test: "Activated partial thromboplastin time", value: 31, unit: "s", low: 25, high: 35 },
                    { test: "Fibrinogen", value: 3.1, unit: "g/L", low: 2, high: 4 },
                    { test: "C-reactive protein", value: 2.4, unit: "mg/L", low: 0, high: 3 },
                    { test: "Erythrocyte sedimentation rate", value: 12, unit: "mm/h", low: 0, high: 20 },
                ],
            },
            {
                name: "Additional chemistry",
                rows: [
                    { test: "Uric acid", value: 5.8, unit: "mg/dL", low: 3.5, high: 7.2 },
                    { test: "Gamma-glutamyl transferase", value: 41, unit: "U/L", low: 8, high: 61 },
                    { test: "Lactate dehydrogenase", value: 182, unit: "U/L", low: 140, high: 280 },
                    { test: "Creatine kinase", value: 121, unit: "U/L", low: 22, high: 198 },
                    { test: "Amylase", value: 64, unit: "U/L", low: 28, high: 100 },
                    { test: "Lipase", value: 38, unit: "U/L", low: 13, high: 60 },
                    { test: "Bilirubin, direct", value: 0.2, unit: "mg/dL", low: 0, high: 0.3 },
                    { test: "Globulin", value: 2.8, unit: "g/dL", low: 2, high: 3.5 },
                    { test: "Albumin / globulin ratio", value: 1.5, unit: "ratio", low: 1.1, high: 2.5 },
                ],
            },
        ],
    },
];

const VISITS = ["Jan 2026", "Mar 2026", "May 2026", "Jul 2026", "Sep 2026", "Nov 2026"];
const VITALS = [
    { name: "Systolic BP (mmHg)", values: [138, 135, 131, 133, 128, 126] },
    { name: "Diastolic BP (mmHg)", values: [88, 87, 84, 85, 82, 80] },
    { name: "Heart rate (bpm)", values: [78, 76, 74, 75, 72, 71] },
    { name: "Weight (kg)", values: [84.2, 83.5, 82.9, 82.1, 81.4, 80.8] },
];

/** The header band (a logo drawn from shapes, the clinic and the section), the footer and the page number. */
function decoratePage(slide: PptxGenJS.PresSlide, section: string): void {
    slide.addShape("rect", { x: 0, y: 0, w: PAGE.w, h: 1, fill: { color: NAVY } });
    slide.addShape("ellipse", { x: PAGE.margin, y: 0.2, w: 0.6, h: 0.6, fill: { color: "FFFFFF" } });
    slide.addShape("plus", { x: PAGE.margin + 0.12, y: 0.32, w: 0.36, h: 0.36, fill: { color: TEAL } });
    slide.addText(
        [
            { text: "Fictitious Valley Health Clinic", options: { fontSize: 15, bold: true, color: "FFFFFF", breakLine: true } },
            { text: "100 Imaginary Lane, Sampletown  |  Sample data only", options: { fontSize: 8.5, color: "C9D6E3" } },
        ],
        { x: 1.25, y: 0.2, w: 4.2, h: 0.6, fontFace: FONT, valign: "middle", margin: 0 },
    );
    slide.addText(section, { x: 5.2, y: 0.2, w: CONTENT_W + PAGE.margin - 5.2, h: 0.6, fontFace: FONT, fontSize: 10, color: "FFFFFF", align: "right", valign: "middle", margin: 0 });
    slide.addShape("line", { x: PAGE.margin, y: PAGE.h - 0.44, w: CONTENT_W, h: 0, line: { color: RULE, width: 0.75 } });
    slide.addText("Patient: Rowan Example  |  MRN 000-TEST-0427  |  Fictional sample report, not for clinical use", {
        x: PAGE.margin,
        y: PAGE.h - 0.4,
        w: 6,
        h: 0.35,
        fontFace: FONT,
        fontSize: 8,
        color: GREY,
        margin: 0,
        valign: "middle",
    });
    slide.slideNumber = { x: PAGE.w - PAGE.margin - 1, y: PAGE.h - 0.4, w: 1, h: 0.35, fontFace: FONT, fontSize: 8, color: GREY, align: "right", valign: "middle", margin: 0 };
}

/** A section heading in the body of a page. */
function addHeading(slide: PptxGenJS.PresSlide, text: string, y: number): void {
    slide.addText(text, { x: PAGE.margin, y, w: CONTENT_W, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, margin: 0, valign: "bottom" });
    slide.addShape("line", { x: PAGE.margin, y: y + 0.45, w: CONTENT_W, h: 0, line: { color: TEAL, width: 1.5 } });
}

/** The report, built on `pres`. Exported so the same report can be rendered with another backend. */
export function buildMedicalReport(pres: pptxgen): pptxgen {
    pres.defineLayout({ name: "A4", width: PAGE.w, height: PAGE.h });
    pres.layout = "A4";
    pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
    pres.title = "Laboratory and clinical summary report (fictional)";
    pres.author = "Fictitious Valley Health Clinic";

    const cellBorder = { type: "solid", pt: 0.5, color: RULE } as const;
    const label = { bold: true, color: NAVY, fill: { color: PALE } } as const;

    // Page 1: patient and visit details, vital signs and their trend.
    const summary = pres.addSlide();

    decoratePage(summary, "Laboratory and clinical summary");
    summary.addText("Laboratory and clinical summary report", { x: PAGE.margin, y: 1.2, w: CONTENT_W, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: NAVY, margin: 0 });
    summary.addText("Report RPT-2026-11-0427  |  Issued 21 November 2026  |  Status: final", { x: PAGE.margin, y: 1.7, w: CONTENT_W, h: 0.3, fontFace: FONT, fontSize: 9.5, color: GREY, margin: 0 });
    summary.addTable(
        [
            [{ text: "Patient", options: label }, { text: "Rowan Example" }, { text: "Visit date", options: label }, { text: "14 November 2026" }],
            [{ text: "Date of birth", options: label }, { text: "01 January 1980 (46 y)" }, { text: "Visit type", options: label }, { text: "Annual review, outpatient" }],
            [{ text: "Sex", options: label }, { text: "Not stated" }, { text: "Requested by", options: label }, { text: "Dr. Juniper Notreal, MD" }],
            [{ text: "MRN", options: label }, { text: "000-TEST-0427" }, { text: "Specimens", options: label }, { text: "Blood, urine; collected 08:10" }],
            [{ text: "Insurance", options: label }, { text: "Sample Mutual, plan 0000" }, { text: "Laboratory", options: label }, { text: "In-house laboratory, bench 3" }],
            [{ text: "Contact", options: label }, { text: "+00 000 000 0000" }, { text: "Fasting", options: label }, { text: "Yes, 12 hours" }],
        ],
        { x: PAGE.margin, y: 2.15, w: CONTENT_W, colW: [1.25, 2.4, 1.25, 2.37], fontFace: FONT, fontSize: 9.5, border: cellBorder, margin: [3, 5, 3, 5] },
    );
    addHeading(summary, "Reason for visit", 4.2);
    summary.addText(
        [
            { text: "Scheduled annual review with routine blood and urine panels. The patient reports " },
            { text: "no new symptoms", options: { bold: true } },
            { text: " since the last visit and follows the diet and activity plan agreed in January. " },
            { text: "All values in this report are invented for a software example.", options: { italic: true, color: GREY } },
        ],
        { x: PAGE.margin, y: 4.75, w: CONTENT_W, h: 0.75, fontFace: FONT, fontSize: 10, valign: "top", margin: 0, lineSpacingMultiple: 1.15 },
    );
    addHeading(summary, "Vital signs", 5.5);

    const vitalsHeader: PptxGenJS.TableRow = [{ text: "Measure", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } }];

    for (const visit of VISITS) {
        vitalsHeader.push({ text: visit, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "center" } });
    }

    const vitalsRows: PptxGenJS.TableRow[] = [vitalsHeader];

    for (const vital of VITALS) {
        const row: PptxGenJS.TableRow = [{ text: vital.name, options: { bold: true } }];

        for (const value of vital.values) {
            row.push({ text: String(value), options: { align: "center" } });
        }

        vitalsRows.push(row);
    }

    summary.addTable(vitalsRows, { x: PAGE.margin, y: 6.05, w: CONTENT_W, colW: [1.97, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88], fontFace: FONT, fontSize: 9, border: cellBorder, margin: [3, 5, 3, 5] });

    const bloodPressure = [];

    for (const vital of VITALS.slice(0, 2)) {
        bloodPressure.push({ name: vital.name, labels: VISITS, values: vital.values });
    }

    summary.addChart("line", bloodPressure, {
        x: PAGE.margin,
        y: 7.75,
        w: CONTENT_W,
        h: 3.0,
        fontFace: FONT,
        fontSize: 8,
        chartColors: [NAVY, TEAL],
        lineSize: 2,
        lineDataSymbol: "circle",
        lineDataSymbolSize: 6,
        showTitle: true,
        title: "Blood pressure trend, 2026",
        titleFontFace: FONT,
        titleFontSize: 11,
        titleColor: NAVY,
        showLegend: true,
        legendPos: "b",
        legendFontSize: 8,
        valAxisMinVal: 60,
        valAxisMaxVal: 160,
        valAxisMajorUnit: 20,
        showValAxisTitle: true,
        valAxisTitle: "mmHg",
        valAxisTitleFontSize: 8,
        valGridLine: { color: "E1E5EA", size: 0.5 },
    });

    // The lab tables: each starts on a new page and autoPage continues it over as many pages as it needs,
    // repeating the header row. Out-of-range values are bold and red on a tinted row.
    const header = [];

    for (const title of ["Test", "Result", "Unit", "Reference range", "Flag"]) {
        header.push({ text: title, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: title === "Test" ? "left" : "center" } as const });
    }

    for (const table of LAB_TABLES) {
        const page = pres.addSlide();
        const rows: PptxGenJS.TableRow[] = [header];

        decoratePage(page, table.title);
        addHeading(page, table.title, 1.15);

        for (const panel of table.panels) {
            rows.push([{ text: panel.name, options: { colspan: 5, bold: true, color: TEAL, fill: { color: PALE } } }]);

            for (const row of panel.rows) {
                const numeric = "value" in row;
                const flag = numeric ? (row.value < row.low ? "L" : row.value > row.high ? "H" : "") : row.result === row.expected ? "" : "A";
                const style = flag ? { bold: true, color: ALERT, fill: { color: ALERT_FILL } } : {};

                rows.push([
                    { text: row.test, options: flag ? { fill: { color: ALERT_FILL } } : {} },
                    { text: numeric ? String(row.value) : row.result, options: { ...style, align: "center" } },
                    { text: numeric ? row.unit : "", options: { ...style, bold: false, color: GREY, align: "center" } },
                    { text: numeric ? `${row.low} - ${row.high}` : row.expected, options: { ...style, bold: false, color: GREY, align: "center" } },
                    { text: flag, options: { ...style, align: "center" } },
                ]);
            }
        }

        page.addTable(rows, {
            x: PAGE.margin,
            y: 1.75,
            w: CONTENT_W,
            colW: [2.87, 1.0, 1.3, 1.5, 0.6],
            fontFace: FONT,
            fontSize: 10,
            border: cellBorder,
            valign: "middle",
            // In inches: PptxGenJS's autoPage reads a table-level margin as inches whatever its size, so
            // [2, 5, 2, 5] (points to the drawn cell) would count 4in of margins per row and page every 3 rows.
            margin: [0.05, 0.07, 0.05, 0.07],
            autoPage: true,
            autoPageRepeatHeader: true,
            autoPageHeaderRows: 1,
            autoPageSlideStartY: BODY_TOP,
        });

        // The pages autoPage added get the same header band, footer and page number.
        for (const continued of page.newAutoPagedSlides) {
            decoratePage(continued, `${table.title} (continued)`);
        }
    }

    // Results history: every numeric blood test over the six visits of the year, out-of-range cells flagged. The
    // earlier values are a synthetic drift from today's, so the example needs no second data set.
    const history = pres.addSlide();
    const historyHeader: PptxGenJS.TableRow = [
        { text: "Test", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
        { text: "Unit", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "center" } },
    ];

    for (const visit of VISITS) {
        historyHeader.push({ text: visit, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "center" } });
    }

    const historyRows: PptxGenJS.TableRow[] = [historyHeader];

    for (const table of LAB_TABLES) {
        for (const panel of table.panels) {
            for (const row of panel.rows) {
                if (!("value" in row) || panel.name === "Urinalysis") {
                    continue;
                }

                const decimals = String(row.value).split(".")[1]?.length ?? 0;
                const cells: PptxGenJS.TableRow = [{ text: row.test }, { text: row.unit, options: { color: GREY, align: "center" } }];

                for (let visit = 0; visit < VISITS.length; visit++) {
                    const drift = 1 + (VISITS.length - 1 - visit) * (row.test.length % 2 ? 0.012 : -0.01);
                    const value = Number((row.value * drift).toFixed(decimals));
                    const outOfRange = value < row.low || value > row.high;

                    cells.push({ text: value.toFixed(decimals), options: outOfRange ? { bold: true, color: ALERT, fill: { color: ALERT_FILL }, align: "center" } : { align: "center" } });
                }

                historyRows.push(cells);
            }
        }
    }

    decoratePage(history, "Results history");
    addHeading(history, "Results history, 2026", 1.15);
    history.addTable(historyRows, {
        x: PAGE.margin,
        y: 1.75,
        w: CONTENT_W,
        colW: [2.45, 1.12, 0.62, 0.62, 0.62, 0.62, 0.62, 0.6],
        fontFace: FONT,
        fontSize: 9,
        border: cellBorder,
        valign: "middle",
        margin: [0.04, 0.06, 0.04, 0.06],
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: BODY_TOP,
    });

    for (const continued of history.newAutoPagedSlides) {
        decoratePage(continued, "Results history (continued)");
    }

    // Findings and assessment: rich text with headings, bullets, numbered items and mixed runs.
    const findings = pres.addSlide();
    const body = { fontFace: FONT, fontSize: 10.5, valign: "top", margin: 0, paraSpaceAfter: 5 } as const;

    decoratePage(findings, "Findings and assessment");
    addHeading(findings, "Findings", 1.15);
    findings.addText(
        [
            { text: "Results outside the reference range are listed below; every other value is within range.", options: { breakLine: true } },
            { text: "Haemoglobin ", options: { bullet: true } },
            { text: "12.6 g/dL", options: { bold: true, color: ALERT } },
            { text: " is slightly below range, with a ", options: {} },
            { text: "raised red cell distribution width", options: { italic: true } },
            { text: " (15.1 %).", options: { breakLine: true } },
            { text: "Iron studies: ", options: { bullet: true } },
            { text: "iron, ferritin and transferrin saturation", options: { bold: true, color: ALERT } },
            { text: " are each just under their lower limits.", options: { breakLine: true } },
            { text: "Fasting glucose ", options: { bullet: true } },
            { text: "104 mg/dL", options: { bold: true, color: ALERT } },
            { text: " and HbA1c ", options: {} },
            { text: "5.9 %", options: { bold: true, color: ALERT } },
            { text: " are above range; both were lower than at the previous visit.", options: { breakLine: true } },
            { text: "Lipids: ", options: { bullet: true } },
            { text: "total, LDL and non-HDL cholesterol", options: { bold: true, color: ALERT } },
            { text: " are above the desirable limits; HDL and triglycerides are within range.", options: { breakLine: true } },
            { text: "Alanine aminotransferase ", options: { bullet: true } },
            { text: "48 U/L", options: { bold: true, color: ALERT } },
            { text: " is mildly raised; aspartate aminotransferase is within range.", options: { breakLine: true } },
            { text: "Vitamin D ", options: { bullet: true } },
            { text: "21 ng/mL", options: { bold: true, color: ALERT } },
            { text: " is below range.", options: { breakLine: true } },
            { text: "Urinalysis shows ", options: { bullet: true } },
            { text: "trace blood", options: { bold: true, color: ALERT } },
            { text: " and 4 red cells per high-power field; the rest of the dipstick is negative.", options: { breakLine: true } },
            { text: "Blood pressure has fallen steadily over six visits, from 138/88 to ", options: {} },
            { text: "126/80 mmHg", options: { bold: true, color: TEAL } },
            { text: ", alongside a weight change of " },
            { text: "-3.4 kg", options: { bold: true, color: TEAL } },
            { text: "." },
        ],
        { ...body, x: PAGE.margin, y: 1.75, w: CONTENT_W, h: 3.7, lineSpacingMultiple: 1.1 },
    );
    addHeading(findings, "Assessment", 5.6);
    findings.addText(
        [
            { text: "Mild anaemia pattern with low iron stores. ", options: { bullet: { type: "number" }, bold: true } },
            { text: "Consistent with the iron studies; the cause is to be reviewed at follow-up.", options: { breakLine: true } },
            { text: "Glucose values above range. ", options: { bullet: { type: "number" }, bold: true } },
            { text: "Improving since January, still above the reference limits.", options: { breakLine: true } },
            { text: "Raised LDL and non-HDL cholesterol. ", options: { bullet: { type: "number" }, bold: true } },
            { text: "Unchanged from the previous panel.", options: { breakLine: true } },
            { text: "Low vitamin D. ", options: { bullet: { type: "number" }, bold: true } },
            { text: "A seasonal low is likely; recheck after supplementation.", options: { breakLine: true } },
            { text: "Isolated urinalysis findings. ", options: { bullet: { type: "number" }, bold: true } },
            { text: "Repeat the sample before any further work-up.", options: { breakLine: true } },
            { text: "Overall: ", options: { italic: true, color: GREY } },
            { text: "stable, with ", options: { italic: true, color: GREY } },
            { text: "improving", options: { italic: true, bold: true, color: TEAL } },
            { text: " blood pressure and weight.", options: { italic: true, color: GREY } },
        ],
        { ...body, x: PAGE.margin, y: 6.2, w: CONTENT_W, h: 3.6, lineSpacingMultiple: 1.1 },
    );

    // Plan, medications and the signature block.
    const plan = pres.addSlide();

    decoratePage(plan, "Plan and sign-off");
    addHeading(plan, "Plan", 1.15);
    plan.addText(
        [
            { text: "Investigations", options: { bullet: { type: "number" }, bold: true, color: NAVY } },
            { text: " (within 4 weeks)", options: { color: GREY, breakLine: true } },
            { text: "Repeat CBC and iron studies.", options: { bullet: true, indentLevel: 1, breakLine: true } },
            { text: "Repeat urinalysis on a mid-stream sample.", options: { bullet: true, indentLevel: 1, breakLine: true } },
            { text: "Treatment", options: { bullet: { type: "number" }, bold: true, color: NAVY, breakLine: true } },
            { text: "Oral iron supplement, as prescribed by the requesting clinician.", options: { bullet: true, indentLevel: 1, breakLine: true } },
            { text: "Vitamin D supplement for 12 weeks.", options: { bullet: true, indentLevel: 1, breakLine: true } },
            { text: "Lifestyle", options: { bullet: { type: "number" }, bold: true, color: NAVY, breakLine: true } },
            { text: "Continue the diet and activity plan; ", options: { bullet: true, indentLevel: 1 } },
            { text: "it is working", options: { bold: true, color: TEAL } },
            { text: ".", options: { breakLine: true } },
            { text: "Dietitian referral for the lipid results.", options: { bullet: true, indentLevel: 1, breakLine: true } },
            { text: "Follow-up", options: { bullet: { type: "number" }, bold: true, color: NAVY, breakLine: true } },
            { text: "Review visit in ", options: { bullet: true, indentLevel: 1 } },
            { text: "3 months", options: { bold: true } },
            { text: " with fasting glucose, HbA1c and a lipid panel.", options: { breakLine: true } },
            { text: "Earlier review if new symptoms appear.", options: { bullet: true, indentLevel: 1, italic: true } },
        ],
        { ...body, x: PAGE.margin, y: 1.75, w: CONTENT_W, h: 3.5, lineSpacingMultiple: 1.1 },
    );
    addHeading(plan, "Current medications", 5.4);
    plan.addTable(
        [
            [
                { text: "Medication", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
                { text: "Dose", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
                { text: "Since", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
                { text: "Note", options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } },
            ],
            [{ text: "Examplomab (fictional)" }, { text: "10 mg daily" }, { text: "Jan 2025" }, { text: "Continue" }],
            [{ text: "Placebonol (fictional)" }, { text: "5 mg daily" }, { text: "Jun 2024" }, { text: "Continue" }],
            [{ text: "Iron supplement" }, { text: "As prescribed" }, { text: "Nov 2026" }, { text: "New", options: { bold: true, color: TEAL } }],
            [{ text: "Vitamin D supplement" }, { text: "As prescribed" }, { text: "Nov 2026" }, { text: "New, 12 weeks", options: { bold: true, color: TEAL } }],
        ],
        { x: PAGE.margin, y: 6.0, w: CONTENT_W, colW: [2.6, 1.5, 1.2, 1.97], fontFace: FONT, fontSize: 9.5, border: cellBorder, margin: [3, 5, 3, 5] },
    );

    // Signature block.
    plan.addShape("rect", { x: PAGE.margin, y: 8.6, w: CONTENT_W, h: 1.9, fill: { color: PALE }, line: { color: RULE, width: 0.75 } });
    plan.addText(
        [
            { text: "Reviewed and electronically signed by", options: { fontSize: 9, color: GREY, breakLine: true } },
            { text: "Dr. Juniper Notreal, MD", options: { fontSize: 13, bold: true, color: NAVY, breakLine: true } },
            { text: "Internal medicine, Fictitious Valley Health Clinic", options: { fontSize: 9.5, breakLine: true } },
            { text: "21 November 2026, 16:42", options: { fontSize: 9.5, italic: true, color: GREY } },
        ],
        { x: PAGE.margin + 0.2, y: 8.75, w: 3.6, h: 1.6, fontFace: FONT, valign: "top", margin: 0, paraSpaceAfter: 3 },
    );
    plan.addShape("line", { x: 4.6, y: 9.85, w: 2.9, h: 0, line: { color: NAVY, width: 1 } });
    plan.addText("Signature", { x: 4.6, y: 9.9, w: 2.9, h: 0.3, fontFace: FONT, fontSize: 8.5, color: GREY, align: "center", margin: 0 });
    plan.addText("This report contains invented data for a software example. It is not a medical record and must not be used for diagnosis or treatment.", {
        x: PAGE.margin,
        y: 10.55,
        w: CONTENT_W,
        h: 0.35,
        fontFace: FONT,
        fontSize: 8,
        italic: true,
        color: GREY,
        margin: 0,
        valign: "top",
    });

    return pres;
}

if (import.meta.main) {
    const report = buildMedicalReport(new pptxgen());
    const { html } = await report.toHtml();

    await writeFile("medical-report.html", html);
    console.log(`Wrote medical-report.html and ${await report.writeFile({ fileName: "medical-report.pdf" })} (${report.getModel().slides.length} pages)`);
}
