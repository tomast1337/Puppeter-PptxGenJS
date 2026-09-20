import type PptxGenJS from "pptxgenjs";
import { PuppeteerGen } from "../../src/PuppeterrGen";
import { GENERATED_PRESET_NAMES } from "../../src/normalize/generatedPreset";
import { Buffer } from "node:buffer";

type Presentation = PptxGenJS | PuppeteerGen;

function installTableToSlidesFixture(presentation: Presentation): void {
    const document = presentation instanceof PuppeteerGen ? presentation.page : globalThis.document;
    const host = document.createElement("div");
    const cellStyle = "font-family:Arial;font-size:12px;color:#363636;padding:4px;border:1px solid #9EADBA";
    host.innerHTML = `
        <table id="visual-html-table" style="width:600px;border-collapse:collapse">
            <thead><tr>
                <th style="width:100px;${cellStyle};padding:6px;background:#4472C4;color:#FFFFFF;text-align:center">ID</th>
                <th style="width:300px;${cellStyle};padding:6px;background:#4472C4;color:#FFFFFF;text-align:center">HTML description</th>
                <th style="width:200px;${cellStyle};padding:6px;background:#4472C4;color:#FFFFFF;text-align:center">State</th>
            </tr></thead>
            <tbody>${Array.from({ length: 22 }, (_, index) => {
                const fill = index % 2 ? "background:#EAF2F8;" : "background:#FFFFFF;";
                return `<tr>
                    <td style="width:100px;${cellStyle};${fill};text-align:center">${String(index + 1).padStart(2, "0")}</td>
                    <td style="width:300px;${cellStyle};${fill}">Imported HTML row ${index + 1}</td>
                    <td style="width:200px;${cellStyle};${fill};text-align:center;color:${index % 3 === 2 ? "#C65911" : "#548235"};font-weight:bold">${index % 3 === 2 ? "Review" : "Ready"}</td>
                </tr>`;
            }).join("")}</tbody>
        </table>`;
    document.body.appendChild(host);
}

const CURVED_SHAPES = ["curvedRightArrow", "curvedLeftArrow", "curvedUpArrow", "curvedDownArrow"] as const;
const CURVED_CASES = CURVED_SHAPES.flatMap((shape, index) => [
    { page: 17, name: shape, shape, x: 0.6 + index * 1.85, y: 1, w: 1.4, h: 2.1 },
    ...[
        { label: "wide", y: 0.95, w: 2, h: 0.7 },
        { label: "square", y: 2.05, w: 1.2, h: 1.2 },
        { label: "tall", y: 3.8, w: 0.7, h: 1.3 },
    ].map(size => ({ page: 18, name: `${shape}-${size.label}`, shape, x: 0.6 + index * 2.35, ...size })),
]);
const CIRCULAR_CASES: Array<{
    page: number;
    name: string;
    shape: PptxGenJS.SHAPE_NAME;
    x: number; y: number; w: number; h: number;
    options?: Pick<PptxGenJS.ShapeProps, "angleRange" | "arcThicknessRatio">;
}> = [
    ["arc", 0.55, 1], ["pie", 3.55, 1], ["chord", 6.55, 1],
    ["blockArc", 0.55, 3.15], ["donut", 3.55, 3.15], ["pieWedge", 6.55, 3.15],
].map(([shape, x, y]) => ({ page: 19, name: String(shape), shape: shape as PptxGenJS.SHAPE_NAME, x: Number(x), y: Number(y), w: 2.2, h: 1.45 }));
CIRCULAR_CASES.push(
    { page: 20, name: "arc-custom", shape: "arc", x: 0.6, y: 1.1, w: 2.2, h: 1.5, options: { angleRange: [30, 250] } },
    { page: 20, name: "pie-custom", shape: "pie", x: 3.9, y: 1.1, w: 2.2, h: 1.5, options: { angleRange: [210, 80] } },
    { page: 20, name: "blockArc-thin", shape: "blockArc", x: 0.6, y: 3.3, w: 2.2, h: 1.5, options: { angleRange: [25, 300], arcThicknessRatio: 0.2 } },
    { page: 20, name: "blockArc-thick", shape: "blockArc", x: 3.9, y: 3.3, w: 2.2, h: 1.5, options: { angleRange: [25, 300], arcThicknessRatio: 0.8 } },
);
const FLOWCHART_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "flowChartAlternateProcess", "flowChartCollate", "flowChartConnector", "flowChartDecision",
    "flowChartDelay", "flowChartDisplay", "flowChartExtract", "flowChartInputOutput",
    "flowChartInternalStorage", "flowChartManualInput", "flowChartManualOperation", "flowChartMerge",
    "flowChartOffpageConnector", "flowChartOr", "flowChartPredefinedProcess", "flowChartPreparation",
    "flowChartProcess", "flowChartSort", "flowChartSummingJunction", "flowChartTerminator",
    "flowChartDocument", "flowChartMagneticDisk", "flowChartMagneticDrum", "flowChartMagneticTape",
    "flowChartMultidocument", "flowChartOfflineStorage", "flowChartOnlineStorage",
    "flowChartPunchedCard", "flowChartPunchedTape",
];
const FLOWCHART_CASES = FLOWCHART_NAMES.map((shape, index) => ({
    page: 21 + Math.floor(index / 10), name: shape, shape,
    x: 0.35 + (index % 5) * 1.95,
    y: index % 10 < 5 ? 1.05 : 3.15,
    w: 1.45, h: 1.25,
}));
const BRACE_BRACKET_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "leftBrace", "rightBrace", "bracePair", "leftBracket", "rightBracket", "bracketPair",
];
const BRACE_BRACKET_CASES = BRACE_BRACKET_NAMES.flatMap((shape, index) => [
    { page: 24, name: shape, shape, x: 0.45 + index * 1.55, y: 1.25, w: 1.05, h: 2.6 },
    { page: 25, name: `${shape}-wide`, shape, x: 0.4 + index * 1.6, y: 1, w: 1.25, h: 0.5 },
    { page: 25, name: `${shape}-square`, shape, x: 0.65 + index * 1.6, y: 2.15, w: 0.75, h: 0.75 },
    { page: 25, name: `${shape}-tall`, shape, x: 0.75 + index * 1.6, y: 3.55, w: 0.55, h: 1.35 },
]);
const RIBBON_SCROLL_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "ribbon", "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon",
    "horizontalScroll", "verticalScroll",
];
const RIBBON_SCROLL_CASES = RIBBON_SCROLL_NAMES.flatMap((shape, index) => [
    {
        page: 26, name: shape, shape,
        x: 0.4 + (index % 4) * 2.4, y: 0.95 + Math.floor(index / 4) * 2.1, w: 1.9, h: 1.25,
    },
    { page: 27 + Math.floor(index / 4), name: `${shape}-wide`, shape, x: 0.25 + (index % 4) * 2.375, y: 0.875, w: 2, h: 0.75 },
    { page: 27 + Math.floor(index / 4), name: `${shape}-square`, shape, x: 0.625 + (index % 4) * 2.375, y: 2, w: 1.125, h: 1.125 },
    { page: 27 + Math.floor(index / 4), name: `${shape}-tall`, shape, x: 0.75 + (index % 4) * 2.375, y: 3.375, w: 0.875, h: 1.5 },
]);
const ACTION_BUTTON_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "actionButtonBackPrevious", "actionButtonBeginning", "actionButtonBlank", "actionButtonDocument",
    "actionButtonEnd", "actionButtonForwardNext", "actionButtonHelp", "actionButtonHome",
    "actionButtonInformation", "actionButtonMovie", "actionButtonReturn", "actionButtonSound",
];
const ACTION_BUTTON_CASES: Array<{
    page: number; name: string; shape: PptxGenJS.SHAPE_NAME;
    x: number; y: number; w: number; h: number;
}> = ACTION_BUTTON_NAMES.map((shape, index) => ({
    page: 29 + Math.floor(index / 6), name: shape, shape,
    x: 0.5 + (index % 3) * 3, y: index % 6 < 3 ? 1 : 3.25, w: 2.25, h: 1.5,
}));
for (const [index, shape] of ([
    "actionButtonBackPrevious", "actionButtonHome", "actionButtonInformation", "actionButtonSound",
] as PptxGenJS.SHAPE_NAME[]).entries()) {
    ACTION_BUTTON_CASES.push(
        { page: 31, name: `${shape}-wide`, shape, x: 0.25 + index * 2.375, y: 1, w: 2, h: 0.75 },
        { page: 31, name: `${shape}-tall`, shape, x: 0.8125 + index * 2.375, y: 2.75, w: 0.875, h: 1.5 },
    );
}
const SYMBOL_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "plus", "mathPlus", "mathMinus", "mathEqual", "mathNotEqual", "mathMultiply", "mathDivide",
    "heart", "lightningBolt", "moon", "sun", "smileyFace", "noSmoking",
];
const SYMBOL_CASES: Array<{
    page: number; name: string; shape: PptxGenJS.SHAPE_NAME;
    x: number; y: number; w: number; h: number;
}> = SYMBOL_NAMES.map((shape, index) => ({
    page: 32 + Math.floor(index / 8), name: shape, shape,
    x: 0.5 + (index % 4) * 2.375, y: index % 8 < 4 ? 1 : 3, w: 1.5, h: 1.5,
}));
for (const [index, shape] of (["mathPlus", "heart", "moon", "sun", "smileyFace", "noSmoking"] as PptxGenJS.SHAPE_NAME[]).entries()) {
    const page = 34 + Math.floor(index / 3);
    const column = index % 3;
    SYMBOL_CASES.push(
        { page, name: `${shape}-wide`, shape, x: 0.5 + column * 3.125, y: 1, w: 2.5, h: 0.75 },
        { page, name: `${shape}-tall`, shape, x: 1.3125 + column * 3.125, y: 2.75, w: 0.875, h: 1.75 },
    );
}
const GENERATED_PRESET_CASES = GENERATED_PRESET_NAMES.map((shape, index) => ({
    page: 36 + Math.floor(index / 8), name: shape, shape,
    x: 0.5 + (index % 4) * 2.375, y: index % 8 < 4 ? 1 : 3, w: 1.5, h: 1.5,
}));
const GENERATED_ASPECT_NAMES = [
    "bevel", "can", "circularArrow", "cloud", "doubleWave", "gear6", "gear9", "leftRightCircularArrow", "wedgeEllipseCallout",
] as const;
const GENERATED_ASPECT_CASES = GENERATED_ASPECT_NAMES.flatMap((shape, index) => {
    const page = 43 + Math.floor(index / 3); const column = index % 3; const baseX = 0.4 + column * 3.2;
    return [
        { page, name: `${shape}-wide`, shape, x: baseX, y: 1, w: 2.5, h: 0.75 },
        { page, name: `${shape}-tall`, shape, x: baseX + 0.8, y: 2.75, w: 0.9, h: 1.65 },
    ];
});
const TABLE_CASES = [
    { page: 46, name: "table-sizing-spans", x: 0.5, y: 1, w: 9, h: 2.65 },
    { page: 47, name: "table-inheritance", x: 0.5, y: 1, w: 4.25, h: 3.15 },
    { page: 47, name: "table-cell-options", x: 5.25, y: 1, w: 4.25, h: 3.15 },
] as const;
const PAGINATION_CASES = [
    { page: 48, name: "table-pagination-first", x: 0.5, y: 1, w: 9, h: 4 },
    { page: 49, name: "table-pagination-second", x: 0.5, y: 0.75, w: 9, h: 4.5 },
    { page: 50, name: "table-pagination-third", x: 0.5, y: 0.75, w: 9, h: 1.5 },
] as const;
const HTML_TABLE_CASES = [
    { page: 51, name: "table-html-first", x: 0.5, y: 0.75, w: 9, h: 4.375 },
    { page: 52, name: "table-html-second", x: 0.5, y: 0.5, w: 9, h: 4.625 },
] as const;
const SHAPED_TEXT_CASES = [
    { page: 53, name: "text-diamond", shape: "diamond", text: "Decision", x: 0.65, y: 1.2, w: 1.8, h: 1.4 },
    { page: 53, name: "text-hexagon", shape: "hexagon", text: "Process", x: 3.0, y: 1.2, w: 1.8, h: 1.4 },
    { page: 53, name: "text-right-arrow", shape: "rightArrow", text: "Next", x: 5.35, y: 1.2, w: 1.8, h: 1.4 },
    { page: 53, name: "text-cloud", shape: "cloud", text: "Idea", x: 7.7, y: 1.2, w: 1.8, h: 1.4 },
] as const;

// These tight crops include the stroke but exclude labels and unused slide area.
export const PARITY_REGIONS = [
    ...CURVED_CASES, ...CIRCULAR_CASES, ...FLOWCHART_CASES, ...BRACE_BRACKET_CASES,
    ...RIBBON_SCROLL_CASES, ...ACTION_BUTTON_CASES, ...SYMBOL_CASES,
    ...GENERATED_PRESET_CASES, ...GENERATED_ASPECT_CASES, ...TABLE_CASES, ...PAGINATION_CASES, ...HTML_TABLE_CASES,
    ...SHAPED_TEXT_CASES,
].map(({ page, name, x, y, w, h }) => ({
    page, name,
    // LibreOffice rasterizes multiple coincident 1.15pt divider strokes with
    // fewer fully opaque pixels than Chromium. Geometry and divider positions
    // match; compound shapes and dense table grids need narrow rasterization
    // allowances. The table pages remain below 0.09 whole-slide RMSE.
    threshold: name === "table-inheritance" || name.startsWith("table-pagination-") || name.startsWith("table-html-") ? 0.12
        : name.startsWith("table-") ? 0.09
            : ["flowChartInternalStorage", "flowChartPredefinedProcess"].includes(name) ? 0.11 : 0.08,
    x: Math.floor(x * 96) - 3, y: Math.floor(y * 96) - 3,
    w: Math.ceil(w * 96) + 7, h: Math.ceil(h * 96) + 7,
}));

const SAMPLE_IMAGE_DATA = `data:image/svg+xml;base64,${Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" preserveAspectRatio="none">
  <rect width="200" height="100" fill="#4472C4"/><rect x="200" width="200" height="100" fill="#ED7D31"/>
  <rect y="100" width="200" height="100" fill="#70AD47"/><rect x="200" y="100" width="200" height="100" fill="#FFC000"/>
  <circle cx="200" cy="100" r="42" fill="#FFFFFF" stroke="#17365D" stroke-width="10"/>
  <path d="M0 0L400 200M400 0L0 200" stroke="#17365D" stroke-width="6" opacity=".65"/>
</svg>`).toString("base64")}`;

const TALL_IMAGE_DATA = `data:image/svg+xml;base64,${Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400" viewBox="0 0 200 400" preserveAspectRatio="none">
  <rect width="100" height="200" fill="#5B9BD5"/><rect x="100" width="100" height="200" fill="#ED7D31"/>
  <rect y="200" width="100" height="200" fill="#70AD47"/><rect x="100" y="200" width="100" height="200" fill="#FFC000"/>
  <circle cx="100" cy="200" r="38" fill="#FFFFFF" stroke="#17365D" stroke-width="9"/>
</svg>`).toString("base64")}`;

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

    const imageSizingSlide = presentation.addSlide();
    imageSizingSlide.addText("Image sizing and cropping", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    [[0.5, "Stretch"], [2.9, "Contain"], [5.3, "Cover"], [7.7, "Crop"]].forEach(([x, label]) => {
        imageSizingSlide.addShape("rect", {
            x: x as number, y: 1.05, w: 1.9, h: 2.2,
            fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 1 },
        });
        imageSizingSlide.addText(label as string, {
            x: x as number, y: 3.4, w: 1.9, h: 0.4,
            fontFace: "Arial", fontSize: 14, color: "363636", align: "center", margin: 0,
        });
    });
    imageSizingSlide.addImage({ data: SAMPLE_IMAGE_DATA, x: 0.5, y: 1.05, w: 1.9, h: 2.2, altText: "Stretched sample" });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 2.9, y: 1.05, w: 4, h: 2,
        sizing: { type: "contain", w: 1.9, h: 2.2 }, altText: "Contained sample",
    });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 5.3, y: 1.05, w: 4, h: 2,
        sizing: { type: "cover", w: 1.9, h: 2.2 }, altText: "Covered sample",
    });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 7.7, y: 1.05, w: 4, h: 2,
        sizing: { type: "crop", x: 1, y: 0.25, w: 1.9, h: 2.2 }, altText: "Cropped sample",
    });
    imageSizingSlide.addImage({
        data: TALL_IMAGE_DATA, x: 2.3, y: 4.05, w: 2, h: 4,
        sizing: { type: "contain", w: 2.2, h: 1.2 }, altText: "Contained tall sample",
    });
    imageSizingSlide.addImage({
        data: TALL_IMAGE_DATA, x: 5.5, y: 4.05, w: 2, h: 4,
        sizing: { type: "cover", w: 2.2, h: 1.2 }, altText: "Covered tall sample",
    });

    const imageEffectsSlide = presentation.addSlide();
    imageEffectsSlide.addText("Image transforms and effects", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 0.75, y: 1.25, w: 1.7, h: 1.7,
        rounding: true, altText: "Rounded image", objectName: "Rounded sample",
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 3.1, y: 1.35, w: 2.5, h: 1.25,
        rotate: -12, flipH: true, altText: "Rotated and flipped image",
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 6.25, y: 1.35, w: 2.5, h: 1.25,
        transparency: 45, shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 4, offset: 4, angle: 45 },
        hyperlink: { url: "https://example.com", tooltip: "Open image link" }, altText: "Transparent linked image",
    });
    imageEffectsSlide.addText("Rounded", { x: 0.75, y: 3.35, w: 1.7, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addText("Rotate + flip", { x: 3.1, y: 3.35, w: 2.5, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addText("Transparency + shadow + link", { x: 6.1, y: 3.35, w: 2.8, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA, x: 4, y: 4.05, w: 4, h: 2, rotate: 8, rounding: true,
        sizing: { type: "crop", x: 0.75, y: 0.25, w: 2, h: 1.1 }, altText: "Cropped rounded rotated image",
    });

    const coreShapesSlide = presentation.addSlide();
    coreShapesSlide.addText("Core SVG shape geometry", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    coreShapesSlide.addShape("rect", {
        x: 0.6, y: 1.05, w: 1.6, h: 1.15,
        fill: { color: "4472C4", transparency: 12 }, line: { color: "17365D", width: 1.5 },
    });
    coreShapesSlide.addShape("roundRect", {
        x: 2.55, y: 1.05, w: 1.6, h: 1.15, rectRadius: 0.18,
        fill: { color: "ED7D31" }, line: { color: "C65911", width: 1.5 },
    });
    coreShapesSlide.addShape("ellipse", {
        x: 4.5, y: 1.05, w: 1.6, h: 1.15,
        fill: { color: "70AD47" }, line: { color: "375623", width: 1.5 },
    });
    coreShapesSlide.addShape("line", {
        x: 6.55, y: 1.6, w: 2.6, h: 0,
        line: { color: "4472C4", width: 2.25, dashType: "dash", beginArrowType: "oval", endArrowType: "triangle" },
        hyperlink: { url: "https://example.com", tooltip: "Shape link" },
    });
    coreShapesSlide.addText("Rectangle", { x: 0.6, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Rounded", { x: 2.55, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Ellipse", { x: 4.5, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Dashed arrow line", { x: 6.55, y: 2.4, w: 2.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addShape("custGeom" as never, {
        x: 0.8, y: 3.25, w: 2.4, h: 1.55,
        points: [{ x: 0, y: 0.75 }, { x: 1.2, y: 0 }, { x: 2.4, y: 0.75 }, { x: 1.2, y: 1.5 }, { close: true }],
        fill: { color: "FFC000", transparency: 10 }, line: { color: "BF9000", width: 1.5 },
    });
    coreShapesSlide.addShape("custGeom" as never, {
        x: 4, y: 3.25, w: 4.8, h: 1.55,
        points: [
            { x: 0, y: 1.2 },
            { x: 2.4, y: 0.2, curve: { type: "cubic", x1: 0.8, y1: -0.15, x2: 1.6, y2: 1.55 } },
            { x: 4.8, y: 1.2, curve: { type: "quadratic", x1: 3.6, y1: 0.1 } },
        ],
        fill: { type: "none" }, line: { color: "7030A0", width: 2.25, dashType: "dashDot" },
    });

    const polygonShapesSlide = presentation.addSlide();
    polygonShapesSlide.addText("Polygon and star presets", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const polygonShapes: Array<[PptxGenJS.SHAPE_NAME, number, number, string]> = [
        ["triangle", 0.55, 1, "4472C4"], ["rtTriangle", 2.35, 1, "5B9BD5"],
        ["diamond", 4.15, 1, "ED7D31"], ["parallelogram", 5.95, 1, "FFC000"],
        ["trapezoid", 7.75, 1, "70AD47"], ["pentagon", 0.55, 3.25, "4472C4"],
        ["hexagon", 2.35, 3.25, "5B9BD5"], ["octagon", 4.15, 3.25, "ED7D31"],
        ["star4", 5.95, 3.25, "FFC000"], ["star5", 7.75, 3.25, "70AD47"],
    ];
    polygonShapes.forEach(([shape, x, y, color]) => {
        polygonShapesSlide.addShape(shape, {
            x, y, w: 1.35, h: 1.35,
            fill: { color, transparency: 8 }, line: { color: "44546A", width: 1.25 },
        });
        polygonShapesSlide.addText(shape, {
            x: x - 0.15, y: y + 1.5, w: 1.65, h: 0.3,
            fontFace: "Arial", fontSize: 11, color: "363636", align: "center", margin: 0,
        });
    });

    const arrowShapesSlide = presentation.addSlide();
    arrowShapesSlide.addText("Directional and compound arrows", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const arrowShapes: Array<[PptxGenJS.SHAPE_NAME, number, number]> = [
        ["rightArrow", 0.55, 1], ["leftArrow", 2.35, 1], ["upArrow", 4.15, 1], ["downArrow", 5.95, 1], ["leftRightArrow", 7.75, 1],
        ["upDownArrow", 0.55, 3.25], ["quadArrow", 2.35, 3.25], ["leftRightUpArrow", 4.15, 3.25], ["notchedRightArrow", 5.95, 3.25], ["stripedRightArrow", 7.75, 3.25],
    ];
    arrowShapes.forEach(([shape, x, y], index) => {
        arrowShapesSlide.addShape(shape, {
            x, y, w: 1.35, h: 1.2,
            fill: { color: index % 2 ? "5B9BD5" : "4472C4", transparency: 5 },
            line: { color: "17365D", width: 1.15 },
        });
        arrowShapesSlide.addText(shape, {
            x: x - 0.18, y: y + 1.42, w: 1.71, h: 0.3,
            fontFace: "Arial", fontSize: 9, color: "363636", align: "center", margin: 0,
        });
    });

    const arrowCalloutsSlide = presentation.addSlide();
    arrowCalloutsSlide.addText("Arrow callout presets", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const arrowCallouts: Array<[PptxGenJS.SHAPE_NAME, number, number]> = [
        ["rightArrowCallout", 0.7, 1.05], ["leftArrowCallout", 3.05, 1.05], ["upArrowCallout", 5.4, 1.05], ["downArrowCallout", 7.75, 1.05],
        ["leftRightArrowCallout", 1.9, 3.35], ["upDownArrowCallout", 4.25, 3.35], ["quadArrowCallout", 6.6, 3.35],
    ];
    arrowCallouts.forEach(([shape, x, y], index) => {
        arrowCalloutsSlide.addShape(shape, {
            x, y, w: 1.55, h: 1.35,
            fill: { color: index % 2 ? "ED7D31" : "FFC000", transparency: 7 },
            line: { color: "843C0C", width: 1.15 },
        });
        arrowCalloutsSlide.addText(shape, {
            x: x - 0.25, y: y + 1.55, w: 2.05, h: 0.3,
            fontFace: "Arial", fontSize: 9, color: "363636", align: "center", margin: 0,
        });
    });

    const bentArrowsSlide = presentation.addSlide();
    bentArrowsSlide.addText("Bent and routing arrows", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const bentArrows: Array<[PptxGenJS.SHAPE_NAME, number]> = [
        ["leftUpArrow", 0.7], ["bentUpArrow", 2.95], ["bentArrow", 5.2], ["uturnArrow", 7.45],
    ];
    bentArrows.forEach(([shape, x], index) => {
        bentArrowsSlide.addShape(shape, {
            x, y: 1.25, w: 1.8, h: 2.4,
            fill: { color: index % 2 ? "70AD47" : "4472C4", transparency: 5 },
            line: { color: "17365D", width: 1.15 },
        });
        bentArrowsSlide.addText(shape, {
            x: x - 0.15, y: 3.95, w: 2.1, h: 0.3,
            fontFace: "Arial", fontSize: 11, color: "363636", align: "center", margin: 0,
        });
    });

    const curvedArrowsSlide = presentation.addSlide();
    curvedArrowsSlide.addText("Curved and swoosh arrows", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const curvedArrows = [
        ...CURVED_CASES.filter(sample => sample.page === 17),
        { shape: "swooshArrow" as const, x: 8, y: 1, w: 1.4, h: 2.1 },
    ];
    curvedArrows.forEach(({ shape, x, y, w, h }, index) => {
        curvedArrowsSlide.addShape(shape, {
            x, y, w, h,
            fill: { color: index % 2 ? "ED7D31" : "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
        curvedArrowsSlide.addText(shape, {
            x: x - 0.2, y: 3.35, w: 1.8, h: 0.3,
            fontFace: "Arial", fontSize: 9, color: "363636", align: "center", margin: 0,
        });
    });

    const curvedRatiosSlide = presentation.addSlide();
    curvedRatiosSlide.addText("Curved arrows: aspect ratios", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    CURVED_CASES.filter(sample => sample.page === 18).forEach(({ shape, x, y, w, h }) => {
        curvedRatiosSlide.addShape(shape, {
            x, y, w, h,
            fill: { color: "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
    });

    for (const pageNumber of [19, 20]) {
        const circularSlide = presentation.addSlide();
        circularSlide.addText(pageNumber === 19 ? "Circular shape presets" : "Adjusted arcs and thickness", {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        CIRCULAR_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h, options }) => {
            circularSlide.addShape(shape, {
                x, y, w, h, ...options,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [21, 22, 23]) {
        const flowchartSlide = presentation.addSlide();
        flowchartSlide.addText(`Flowchart presets ${pageNumber - 20}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        FLOWCHART_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            flowchartSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [24, 25]) {
        const braceSlide = presentation.addSlide();
        braceSlide.addText(pageNumber === 24 ? "Brace and bracket presets" : "Braces and brackets: aspect ratios", {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        BRACE_BRACKET_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            braceSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [26, 27, 28]) {
        const ribbonSlide = presentation.addSlide();
        ribbonSlide.addText(pageNumber === 26 ? "Ribbon and scroll presets" : `Ribbons and scrolls: aspect ratios ${pageNumber - 26}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        RIBBON_SCROLL_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            ribbonSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [29, 30, 31]) {
        const actionSlide = presentation.addSlide();
        actionSlide.addText(pageNumber === 31 ? "Action buttons: aspect ratios" : `Action button presets ${pageNumber - 28}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        ACTION_BUTTON_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            actionSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [32, 33, 34, 35]) {
        const symbolSlide = presentation.addSlide();
        symbolSlide.addText(pageNumber < 34 ? `Common symbol presets ${pageNumber - 31}` : `Common symbols: aspect ratios ${pageNumber - 33}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        SYMBOL_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            symbolSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (let pageNumber = 36; pageNumber <= 42; pageNumber++) {
        const presetSlide = presentation.addSlide();
        presetSlide.addText(`Remaining shape presets ${pageNumber - 35}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        GENERATED_PRESET_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            presetSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (let pageNumber = 43; pageNumber <= 45; pageNumber++) {
        const aspectSlide = presentation.addSlide();
        aspectSlide.addText(`Remaining presets: aspect ratios ${pageNumber - 42}`, {
            x: 0.5, y: 0.2, w: 9, h: 0.5,
            fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
        });
        GENERATED_ASPECT_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            aspectSlide.addShape(shape, {
                x, y, w, h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    const sizingTableSlide = presentation.addSlide();
    sizingTableSlide.addText("Static table sizing, spans, and borders", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    sizingTableSlide.addTable([
        [
            { text: "Region", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
            { text: "Product", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
            { text: "Status", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
            { text: "Notes", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
        ],
        [
            { text: "North", options: { rowspan: 2, fill: { color: "D9EAF7" }, bold: true, valign: "middle", align: "center" } },
            { text: [
                { text: "Merged ", options: { bold: true, color: "C00000" } },
                { text: "rich text", options: { italic: true, underline: { style: "sng" } } },
            ], options: { colspan: 2, fill: { color: "FFF2CC" }, valign: "middle" } },
            { text: "First row", options: { align: "right" } },
        ],
        [
            { text: "Two columns", options: { colspan: 2, fill: { color: "E2F0D9" }, align: "center" } },
            { text: "Second row", options: { align: "right" } },
        ],
        [
            { text: "South" },
            { text: "Widget" },
            { text: "Ready", options: { bold: true, color: "548235" } },
            { text: "Explicit widths and heights" },
        ],
    ], {
        x: 0.5, y: 1,
        colW: [1.5, 2.5, 2, 3], rowH: [0.55, 0.75, 0.65, 0.7],
        fontFace: "Arial", fontSize: 13, color: "363636", margin: 0.08,
        border: { type: "solid", color: "7F8C8D", pt: 1 },
    });

    const cellOptionsSlide = presentation.addSlide();
    cellOptionsSlide.addText("Table inheritance and cell text options", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    cellOptionsSlide.addTable([
        [{ text: "Inherited header", options: { colspan: 2, bold: true, align: "center", fill: { color: "BDD7EE" } } }],
        [{ text: "Bottom left", options: { valign: "bottom" } }, { text: "Centered", options: { align: "center", valign: "middle" } }],
        [{ text: "Small inset", options: { margin: 0.03 } }, { text: "Large inset", options: { margin: 0.16 } }],
        [{ text: "Dashed sides", options: { border: [{ type: "dash", color: "C00000", pt: 2 }, { type: "solid", color: "548235", pt: 2 }, { type: "dash", color: "C00000", pt: 2 }, { type: "solid", color: "548235", pt: 2 }] } }, { text: "Inherited fill" }],
    ], {
        x: 0.5, y: 1, w: 4.25, h: 3.15,
        fontFace: "Arial", fontSize: 13, color: "1F4E78", fill: { color: "F2F2F2" }, margin: 0.08,
        border: { type: "solid", color: "5B9BD5", pt: 1 },
    });
    cellOptionsSlide.addTable([
        [{ text: "Rich text", options: { colspan: 2, fill: { color: "F4B183" }, bold: true, align: "center" } }],
        [{ text: [
            { text: "Bold", options: { bold: true, color: "C00000" } },
            { text: " + italic", options: { italic: true, color: "548235", breakLine: true } },
            { text: "underlined", options: { underline: { style: "dbl", color: "4472C4" } } },
        ], options: { colspan: 2, valign: "middle" } }],
        [{ text: "Bullet", options: { bullet: true } }, { text: "Transparent", options: { color: "C00000", transparency: 55 } }],
        [{ text: "Vertical", options: { textDirection: "vert", align: "center" } }, { text: "Bottom", options: { valign: "bottom", align: "right" } }],
    ], {
        x: 5.25, y: 1, w: 4.25, h: 3.15,
        fontFace: "Arial", fontSize: 13, color: "363636", margin: 0.08,
        border: { type: "solid", color: "A6A6A6", pt: 1 },
    });

    const paginationSlide = presentation.addSlide();
    paginationSlide.addText("Automatic table pagination", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const paginatedRows: PptxGenJS.TableRow[] = [[
        { text: "ID", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
        { text: "Description", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
        { text: "State", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
    ]];
    for (let index = 1; index <= 29; index++) {
        const fill = index % 2 === 0 ? { color: "EAF2F8" } : undefined;
        paginatedRows.push([
            { text: String(index).padStart(2, "0"), options: { fill, align: "center" } },
            { text: `Paginated record ${index}`, options: { fill } },
            { text: index % 3 === 0 ? "Review" : "Ready", options: { fill, color: index % 3 === 0 ? "C65911" : "548235", bold: true, align: "center" } },
        ]);
    }
    paginationSlide.addTable(paginatedRows, {
        x: 0.5, y: 1, colW: [1.4, 4.8, 2.8],
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: 0.75,
        fontFace: "Arial", fontSize: 12, color: "363636", margin: 0.05,
        border: { type: "solid", color: "9EADBA", pt: 0.75 },
    });

    installTableToSlidesFixture(presentation);
    presentation.tableToSlides("visual-html-table", {
        w: 10,
        y: 0.75,
        slideMargin: 0.5,
        autoPageRepeatHeader: true,
        autoPageSlideStartY: 0.5,
        addText: {
            text: [{ text: "HTML table import", options: { bold: true, color: "17365D" } }],
            options: { x: 0.5, y: 0.12, w: 4, h: 0.35, fontFace: "Arial", fontSize: 16, margin: 0 },
        },
        addShape: {
            shapeName: "rect",
            options: { x: 9.1, y: 0.14, w: 0.35, h: 0.2, fill: { color: "4472C4" }, line: { type: "none" } },
        },
    });

    const shapedTextSlide = presentation.addSlide();
    shapedTextSlide.addText("Text in arbitrary preset shapes", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    SHAPED_TEXT_CASES.forEach(({ shape, text, x, y, w, h }) => {
        shapedTextSlide.addText(text, {
            shape,
            x, y, w, h,
            fontFace: "Arial", fontSize: 16, bold: true, color: "FFFFFF",
            align: "center", valign: "middle", margin: 0.08,
            fill: { color: "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
    });

    const chartsSlide = presentation.addSlide();
    chartsSlide.addText("Core chart rendering", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const chartData: PptxGenJS.OptsChartData[] = [
        { name: "North", labels: ["Q1", "Q2", "Q3", "Q4"], values: [3, 5, 4, 7] },
        { name: "South", labels: ["Q1", "Q2", "Q3", "Q4"], values: [5, 2, 6, 4] },
    ];
    chartsSlide.addChart("bar", chartData, {
        x: 0.4, y: 0.9, w: 4.4, h: 4.1,
        fontFace: "Arial", fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true, legendPos: "b",
    });
    chartsSlide.addChart("line", chartData, {
        x: 5.2, y: 0.9, w: 4.4, h: 4.1,
        fontFace: "Arial", fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true, legendPos: "b",
        lineDataSymbol: "circle", lineDataSymbolSize: 6, lineSize: 2,
    });

    const bar3DSlide = presentation.addSlide();
    bar3DSlide.addText("Three-dimensional bar charts", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    bar3DSlide.addChart("bar3D", chartData, {
        x: 2, y: 1.1, w: 6, h: 3.3,
        fontFace: "Arial", fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        bar3DShape: "box", showLegend: true, legendPos: "b",
    });

    const mixedChartSlide = presentation.addSlide();
    mixedChartSlide.addText("Mixed bar and line chart", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const mixedChart: PptxGenJS.IChartMulti[] = [
        { type: "bar", data: [chartData[0]!], options: {} },
        { type: "line", data: [chartData[1]!], options: {} },
    ];
    (mixedChartSlide.addChart as Function)(mixedChart, {
        x: 2, y: 1.1, w: 6, h: 3.3,
        fontFace: "Arial", fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true, legendPos: "b",
        lineDataSymbol: "circle", lineDataSymbolSize: 6, lineSize: 2,
    });

    const secondaryAxisSlide = presentation.addSlide();
    secondaryAxisSlide.addText("Mixed chart with secondary value axis", {
        x: 0.5, y: 0.2, w: 9, h: 0.5,
        fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0,
    });
    const secondaryChart: PptxGenJS.IChartMulti[] = [
        { type: "bar", data: [chartData[0]!], options: {} },
        {
            type: "line",
            data: [{ name: "Revenue", labels: ["Q1", "Q2", "Q3", "Q4"], values: [100, 250, 400, 300] }],
            options: { secondaryValAxis: true },
        },
    ];
    (secondaryAxisSlide.addChart as Function)(secondaryChart, {
        x: 2, y: 1.1, w: 6, h: 3.3,
        fontFace: "Arial", fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true, legendPos: "b",
        lineDataSymbol: "circle", lineDataSymbolSize: 6, lineSize: 2,
        valAxes: [
            { valAxisMinVal: 0, valAxisMaxVal: 8, showValAxisTitle: true, valAxisTitle: "Units" },
            { valAxisMinVal: 0, valAxisMaxVal: 500, showValAxisTitle: true, valAxisTitle: "Revenue" },
        ],
    });
}
