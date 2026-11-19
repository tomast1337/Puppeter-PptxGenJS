import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type PptxGenJS from "pptxgenjs";
import { createElement } from "react";
import { z } from "zod";
import { PuppeteerGen } from "../../packages/pptxgenjs/src/node";
import { inchesToPixels } from "../../packages/pptxgenjs/src/units";
import { registerReactComponent } from "../../packages/react/src/index";
import { CROP_TARGET, TEXT_LINE_SNAP_CROP_THRESHOLDS, UNDERLINE_DOUBLE_CROP_THRESHOLDS } from "./thresholds";

type Presentation = PptxGenJS | PuppeteerGen;

/**
 * The tableToSlides() source: PptxGenJS takes the id of a table in the global document, so the table goes there;
 * PuppeteerGen takes the markup, which it parses into a createDocument() document (jsdom in Node).
 */
function installTableToSlidesFixture(presentation: Presentation): string {
    const cellStyle = "font-family:Arial;font-size:12px;color:#363636;padding:4px;border:1px solid #9EADBA";
    const html = `
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
    if (presentation instanceof PuppeteerGen) return html;
    const host = globalThis.document.createElement("div");
    host.innerHTML = html;
    globalThis.document.body.appendChild(host);
    return "visual-html-table";
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
    x: number;
    y: number;
    w: number;
    h: number;
    options?: Pick<PptxGenJS.ShapeProps, "angleRange" | "arcThicknessRatio">;
}> = [
    ["arc", 0.55, 1],
    ["pie", 3.55, 1],
    ["chord", 6.55, 1],
    ["blockArc", 0.55, 3.15],
    ["donut", 3.55, 3.15],
    ["pieWedge", 6.55, 3.15],
].map(([shape, x, y]) => ({ page: 19, name: String(shape), shape: shape as PptxGenJS.SHAPE_NAME, x: Number(x), y: Number(y), w: 2.2, h: 1.45 }));
CIRCULAR_CASES.push(
    { page: 20, name: "arc-custom", shape: "arc", x: 0.6, y: 1.1, w: 2.2, h: 1.5, options: { angleRange: [30, 250] } },
    { page: 20, name: "pie-custom", shape: "pie", x: 3.9, y: 1.1, w: 2.2, h: 1.5, options: { angleRange: [210, 80] } },
    { page: 20, name: "blockArc-thin", shape: "blockArc", x: 0.6, y: 3.3, w: 2.2, h: 1.5, options: { angleRange: [25, 300], arcThicknessRatio: 0.2 } },
    { page: 20, name: "blockArc-thick", shape: "blockArc", x: 3.9, y: 3.3, w: 2.2, h: 1.5, options: { angleRange: [25, 300], arcThicknessRatio: 0.8 } },
);
const FLOWCHART_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "flowChartAlternateProcess",
    "flowChartCollate",
    "flowChartConnector",
    "flowChartDecision",
    "flowChartDelay",
    "flowChartDisplay",
    "flowChartExtract",
    "flowChartInputOutput",
    "flowChartInternalStorage",
    "flowChartManualInput",
    "flowChartManualOperation",
    "flowChartMerge",
    "flowChartOffpageConnector",
    "flowChartOr",
    "flowChartPredefinedProcess",
    "flowChartPreparation",
    "flowChartProcess",
    "flowChartSort",
    "flowChartSummingJunction",
    "flowChartTerminator",
    "flowChartDocument",
    "flowChartMagneticDisk",
    "flowChartMagneticDrum",
    "flowChartMagneticTape",
    "flowChartMultidocument",
    "flowChartOfflineStorage",
    "flowChartOnlineStorage",
    "flowChartPunchedCard",
    "flowChartPunchedTape",
];
const FLOWCHART_CASES = FLOWCHART_NAMES.map((shape, index) => ({
    page: 21 + Math.floor(index / 10),
    name: shape,
    shape,
    x: 0.35 + (index % 5) * 1.95,
    y: index % 10 < 5 ? 1.05 : 3.15,
    w: 1.45,
    h: 1.25,
}));
const BRACE_BRACKET_NAMES: PptxGenJS.SHAPE_NAME[] = ["leftBrace", "rightBrace", "bracePair", "leftBracket", "rightBracket", "bracketPair"];
const BRACE_BRACKET_CASES = BRACE_BRACKET_NAMES.flatMap((shape, index) => [
    { page: 24, name: shape, shape, x: 0.45 + index * 1.55, y: 1.25, w: 1.05, h: 2.6 },
    { page: 25, name: `${shape}-wide`, shape, x: 0.4 + index * 1.6, y: 1, w: 1.25, h: 0.5 },
    { page: 25, name: `${shape}-square`, shape, x: 0.65 + index * 1.6, y: 2.15, w: 0.75, h: 0.75 },
    { page: 25, name: `${shape}-tall`, shape, x: 0.75 + index * 1.6, y: 3.55, w: 0.55, h: 1.35 },
]);
const RIBBON_SCROLL_NAMES: PptxGenJS.SHAPE_NAME[] = ["ribbon", "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon", "horizontalScroll", "verticalScroll"];
const RIBBON_SCROLL_CASES = RIBBON_SCROLL_NAMES.flatMap((shape, index) => [
    {
        page: 26,
        name: shape,
        shape,
        x: 0.4 + (index % 4) * 2.4,
        y: 0.95 + Math.floor(index / 4) * 2.1,
        w: 1.9,
        h: 1.25,
    },
    { page: 27 + Math.floor(index / 4), name: `${shape}-wide`, shape, x: 0.25 + (index % 4) * 2.375, y: 0.875, w: 2, h: 0.75 },
    { page: 27 + Math.floor(index / 4), name: `${shape}-square`, shape, x: 0.625 + (index % 4) * 2.375, y: 2, w: 1.125, h: 1.125 },
    { page: 27 + Math.floor(index / 4), name: `${shape}-tall`, shape, x: 0.75 + (index % 4) * 2.375, y: 3.375, w: 0.875, h: 1.5 },
]);
const ACTION_BUTTON_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "actionButtonBackPrevious",
    "actionButtonBeginning",
    "actionButtonBlank",
    "actionButtonDocument",
    "actionButtonEnd",
    "actionButtonForwardNext",
    "actionButtonHelp",
    "actionButtonHome",
    "actionButtonInformation",
    "actionButtonMovie",
    "actionButtonReturn",
    "actionButtonSound",
];
const ACTION_BUTTON_CASES: Array<{
    page: number;
    name: string;
    shape: PptxGenJS.SHAPE_NAME;
    x: number;
    y: number;
    w: number;
    h: number;
}> = ACTION_BUTTON_NAMES.map((shape, index) => ({
    page: 29 + Math.floor(index / 6),
    name: shape,
    shape,
    x: 0.5 + (index % 3) * 3,
    y: index % 6 < 3 ? 1 : 3.25,
    w: 2.25,
    h: 1.5,
}));
for (const [index, shape] of (["actionButtonBackPrevious", "actionButtonHome", "actionButtonInformation", "actionButtonSound"] as PptxGenJS.SHAPE_NAME[]).entries()) {
    ACTION_BUTTON_CASES.push({ page: 31, name: `${shape}-wide`, shape, x: 0.25 + index * 2.375, y: 1, w: 2, h: 0.75 }, { page: 31, name: `${shape}-tall`, shape, x: 0.8125 + index * 2.375, y: 2.75, w: 0.875, h: 1.5 });
}
const SYMBOL_NAMES: PptxGenJS.SHAPE_NAME[] = ["plus", "mathPlus", "mathMinus", "mathEqual", "mathNotEqual", "mathMultiply", "mathDivide", "heart", "lightningBolt", "moon", "sun", "smileyFace", "noSmoking"];
const SYMBOL_CASES: Array<{
    page: number;
    name: string;
    shape: PptxGenJS.SHAPE_NAME;
    x: number;
    y: number;
    w: number;
    h: number;
}> = SYMBOL_NAMES.map((shape, index) => ({
    page: 32 + Math.floor(index / 8),
    name: shape,
    shape,
    x: 0.5 + (index % 4) * 2.375,
    y: index % 8 < 4 ? 1 : 3,
    w: 1.5,
    h: 1.5,
}));
for (const [index, shape] of (["mathPlus", "heart", "moon", "sun", "smileyFace", "noSmoking"] as PptxGenJS.SHAPE_NAME[]).entries()) {
    const page = 34 + Math.floor(index / 3);
    const column = index % 3;
    SYMBOL_CASES.push({ page, name: `${shape}-wide`, shape, x: 0.5 + column * 3.125, y: 1, w: 2.5, h: 0.75 }, { page, name: `${shape}-tall`, shape, x: 1.3125 + column * 3.125, y: 2.75, w: 0.875, h: 1.75 });
}
// The presets that were generated first (#42). Shapes generated later keep their crops on their family slides, so
// this grid, its crop names and the WASM baseline keys stay where they were; leftRightUpArrow and star4 already
// have crops on the arrow and star slides.
const GENERATED_PRESET_GRID_NAMES: PptxGenJS.SHAPE_NAME[] = [
    "accentBorderCallout1",
    "accentBorderCallout2",
    "accentBorderCallout3",
    "accentCallout1",
    "accentCallout2",
    "accentCallout3",
    "bevel",
    "borderCallout1",
    "borderCallout2",
    "borderCallout3",
    "callout1",
    "callout2",
    "callout3",
    "can",
    "chartPlus",
    "chartStar",
    "chartX",
    "chevron",
    "circularArrow",
    "cloud",
    "cloudCallout",
    "corner",
    "cornerTabs",
    "cube",
    "diagStripe",
    "doubleWave",
    "folderCorner",
    "frame",
    "funnel",
    "gear6",
    "gear9",
    "halfFrame",
    "homePlate",
    "irregularSeal1",
    "irregularSeal2",
    "leftCircularArrow",
    "leftRightCircularArrow",
    "plaque",
    "plaqueTabs",
    "round1Rect",
    "round2DiagRect",
    "round2SameRect",
    "snip1Rect",
    "snip2DiagRect",
    "snip2SameRect",
    "snipRoundRect",
    "squareTabs",
    "teardrop",
    "wave",
    "wedgeEllipseCallout",
    "wedgeRectCallout",
    "wedgeRoundRectCallout",
];
const GENERATED_PRESET_CASES = GENERATED_PRESET_GRID_NAMES.map((shape, index) => ({
    page: 36 + Math.floor(index / 8),
    name: shape,
    shape,
    x: 0.5 + (index % 4) * 2.375,
    y: index % 8 < 4 ? 1 : 3,
    w: 1.5,
    h: 1.5,
}));
const GENERATED_ASPECT_NAMES = ["bevel", "can", "circularArrow", "cloud", "doubleWave", "gear6", "gear9", "leftRightCircularArrow", "wedgeEllipseCallout"] as const;
const GENERATED_ASPECT_CASES = GENERATED_ASPECT_NAMES.flatMap((shape, index) => {
    const page = 43 + Math.floor(index / 3);
    const column = index % 3;
    const baseX = 0.4 + column * 3.2;
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
// Baseline placement and line pitch of plain text boxes (#49): the paragraph slide's title and its
// single and exact line spacing paragraphs with paragraph spacing, and two lines at 1.5x spacing
// (LibreOffice puts the extra leading above each baseline).
const TEXT_CASES = [
    { page: 4, name: "text-title", x: 0.5, y: 0.2, w: 9, h: 0.5 },
    { page: 4, name: "text-paragraph-spacing", x: 0.75, y: 1, w: 8.5, h: 2.1 },
    { page: 4, name: "text-line-spacing-multiple", x: 0.75, y: 4.95, w: 8.5, h: 0.6 },
] as const;
// Every line head type at both ends of a 45 degree line, from a 1pt line (below LibreOffice's 0.7 mm sizing
// floor) and a 4.5pt one. The diagonal keeps triangle-like heads inside the box, so the WASM deck's
// per-object crops see them whole; these regions pad the box for the centred oval and diamond.
const ARROW_HEAD_TYPES = ["none", "triangle", "stealth", "diamond", "oval", "arrow"] as const;
const ARROW_HEAD_CASES = [1, 4.5].flatMap((widthPt, row) => ARROW_HEAD_TYPES.map((type, index) => ({ page: 60, name: `arrowhead-${type}-${widthPt}pt`, type, widthPt, x: 1 + index * 1.5, y: 1.5 + row * 2, w: 0.5, h: 0.5 })));
// A vertical line is a zero-width shape: PptxGenJS writes <a:ext cx="0">, PowerPoint and LibreOffice draw the stroke.
const VERTICAL_LINE_CASE = { page: 60, name: "line-zero-width", x: 9.5, y: 1.5, w: 0, h: 2.5 } as const;

// populateTextOptionsFixture(): text options PptxGenJS reads only in some combinations, one slide per
// group. Each case is a text box with a short text and a crop (padded for strokes and arrowheads), on whole
// pixels at 96 dpi so the crop scores the option rather than where each rasterizer snaps a fractional edge; its
// label sits above the crop.
interface TextOptionCase {
    name: string;
    label: string;
    text: string | PptxGenJS.TextProps[];
    options: PptxGenJS.TextPropsOptions & { x: number; y: number; w: number; h?: number };
    /** Crop padding around the box in inches (default 0.15); the label sits 0.3in above the crop. */
    pad?: number;
}
const BULLET_RUNS: PptxGenJS.TextProps[] = [
    { text: " ", options: { bullet: { code: "2022" } } },
    { text: "Item", options: { bullet: true, breakLine: true } },
    { text: "Next", options: {} },
];
/**
 * Kerning-sensitive wrapping: each box is between the kerned and the unkerned width of KERNING_TEXT in Arial
 * (Liberation Sans), margin 0. LibreOffice and Chromium kern every run, so the line fits. PowerPoint kerns only from
 * the inherited `kern="1200"` (12pt), so at 8 and 10pt "Yay" wraps: tests/renderingTarget.test.ts checks the
 * PowerPoint target, which LibreOffice references cannot score.
 */
const KERNING_TEXT = "AVATAR WAVY Tower Toy Yay";
export const KERNING_CASES = [
    { fontSize: 8, w: 1.54 },
    { fontSize: 10, w: 1.92 },
    { fontSize: 14, w: 2.69 },
].map(({ fontSize, w }, index) => ({
    name: `text-kerning-${fontSize}pt`,
    label: `${fontSize}pt: fits kerned, wraps unkerned`,
    text: KERNING_TEXT,
    options: { x: 0.75 + index * 3.125, y: 1.25, w, h: 0.75, fontSize, margin: 0, valign: "top" as const, fill: { color: "F2F2F2" } },
}));
const TEXT_OPTION_SLIDES: readonly { title: string; cases: readonly TextOptionCase[] }[] = [
    {
        // PptxGenJS 4.0.1 reads a string `line` and lineSize/lineDash/lineHead/lineTail only for shape "line".
        title: "Text outlines: deprecated line options",
        cases: [
            { name: "text-line-deprecated-ignored", label: "line object; lineSize 6 and lineDash ignored", text: "Outline", options: { x: 0.5, y: 1.25, w: 4, h: 0.75, line: { color: "C00000", width: 2 }, lineSize: 6, lineDash: "dash" } },
            { name: "text-line-hairline", label: "line object without width: hairline", text: "Hairline", options: { x: 5.5, y: 1.25, w: 4, h: 0.75, line: { color: "2F5597" } } },
            { name: "text-line-string-ignored", label: "string line on a text box: no outline", text: "None", options: { x: 0.5, y: 2.75, w: 4, h: 0.75, fill: { color: "F2F2F2" }, line: "C00000" as unknown as PptxGenJS.ShapeLineProps, lineSize: 3 } },
            { name: "text-line-shape-line-deprecated", label: "shape line: lineSize, lineDash, lineHead, lineTail", text: "", options: { x: 0.5, y: 4.25, w: 4, h: 0.75, shape: "line", line: { color: "2F5597" }, lineSize: 4, lineDash: "dash", lineHead: "triangle", lineTail: "oval" } },
            { name: "text-line-shape-line-string", label: "shape line: string line and lineSize", text: "", options: { x: 5.5, y: 4.25, w: 4, h: 0.75, shape: "line", line: "C00000" as unknown as PptxGenJS.ShapeLineProps, lineSize: 3 } },
        ],
    },
    {
        // `inset` is inches on all four sides unless `margin` is given; rectRadius is the roundRect corner in inches, 0 the preset's 1/6.
        title: "Text insets and rounded corners",
        cases: [
            { name: "text-inset", label: "inset 0.5 (inches)", text: "Inset", options: { x: 0.5, y: 1.25, w: 4, h: 1.25, inset: 0.5, valign: "top", fill: { color: "F2F2F2" } } },
            { name: "text-inset-margin", label: "inset 0.5 and margin 0: margin wins", text: "Margin", options: { x: 5.5, y: 1.25, w: 4, h: 1.25, inset: 0.5, margin: 0, valign: "top", fill: { color: "F2F2F2" } } },
            { name: "text-roundrect-corner", label: "roundRect, rectRadius 0.4, margin 0", text: "Corner", options: { x: 0.5, y: 3.5, w: 4, h: 1.25, shape: "roundRect", rectRadius: 0.4, margin: 0, valign: "top", fill: { color: "D9E2F3" } } },
            { name: "text-roundrect-zero", label: "roundRect, rectRadius 0: preset corner", text: "", options: { x: 5.5, y: 3.5, w: 4, h: 1.25, shape: "roundRect", rectRadius: 0, fill: { color: "D9E2F3" } } },
        ],
    },
    {
        // Text in a shape is laid out in the preset's ECMA-376 text rectangle; the outline is centred on the geometry.
        title: "Text in preset shapes",
        cases: [
            { name: "text-shape-ellipse", label: "ellipse, margin 0, top left", text: "Ellipse", options: { x: 0.5, y: 1.25, w: 4, h: 1.25, shape: "ellipse", margin: 0, valign: "top", fill: { color: "D9E2F3" } } },
            { name: "text-shape-can", label: "can, margin 0, top left", text: "Can", options: { x: 5.5, y: 1.25, w: 4, h: 1.25, shape: "can", margin: 0, valign: "top", fill: { color: "D9E2F3" } } },
            { name: "text-shape-stroke", label: "roundRect with a 6pt line", text: "Stroke", options: { x: 0.5, y: 3.5, w: 4, h: 1.25, shape: "roundRect", line: { color: "2F5597", width: 6 }, fill: { color: "D9E2F3" } } },
            { name: "text-shape-line-heads", label: "shape line with oval and triangle heads", text: "", options: { x: 5.5, y: 3.5, w: 4, h: 1.25, shape: "line", line: { color: "C00000", width: 3, beginArrowType: "oval", endArrowType: "triangle" } } },
        ],
    },
    {
        // PptxGenJS 4.0.1 genXmlTextBody: with `align` set only an align change starts a paragraph, so bullet runs join
        // the open one; without it each bullet run starts a paragraph. (A run joining a bullet paragraph without align
        // would make PptxGenJS write a second <a:pPr> in it, which LibreOffice and PowerPoint read differently.)
        title: "Paragraphs from bullet runs",
        cases: [
            { name: "text-bullet-runs-align", label: "bullet runs, align left: two paragraphs", text: BULLET_RUNS, options: { x: 0.5, y: 1.25, w: 4, h: 1.25, align: "left", valign: "top", fill: { color: "F2F2F2" } } },
            { name: "text-bullet-runs", label: "bullet runs, no align: two paragraphs", text: BULLET_RUNS.slice(0, 2), options: { x: 5.5, y: 1.25, w: 4, h: 1.25, valign: "top", fill: { color: "F2F2F2" } } },
        ],
    },
    {
        // PptxGenJS writes no clip: PowerPoint and LibreOffice draw text past a box too small for it, from the anchor.
        title: "Text past its box",
        cases: (["top", "middle", "bottom"] as const).map((valign, index) => ({
            name: `text-overflow-${valign}`,
            label: `three lines in a 0.3in box, valign ${valign}`,
            text: "First line\nSecond line\nThird line",
            options: { x: 0.75 + index * 3.125, y: 2.5, w: 2.25, h: 0.3, valign, fill: { color: "F2F2F2" } },
            pad: 0.6,
        })),
    },
    {
        // PptxGenJS writes cy="0" without `h`. Shorter than its insets, the text area collapses onto the box's
        // midline (PowerPoint; LibreOffice with equal insets) and the text is drawn from there by its anchor.
        title: "Text boxes without a height",
        cases: [
            { name: "text-no-height", label: "no h: middle on y", text: "No height", options: { x: 0.75, y: 2.5, w: 2.25 }, pad: 0.5 },
            { name: "text-zero-height-top", label: "h 0, valign top: below y", text: "Zero, top", options: { x: 3.875, y: 2.5, w: 2.25, h: 0, valign: "top" }, pad: 0.5 },
            { name: "text-thin-bottom", label: "h 0.05, valign bottom: above the midline", text: "Thin, bottom", options: { x: 7, y: 2.5, w: 2.25, h: 0.05, valign: "bottom" }, pad: 0.5 },
        ],
    },
    {
        // PowerPoint and LibreOffice leave the last paragraph's space after out of the text height, so it does not
        // lift bottom- or middle-anchored text; the space after the first of two paragraphs still separates them.
        title: "Space after the last paragraph",
        cases: [
            ...(["top", "middle", "bottom"] as const).map((valign, index) => ({
                name: `text-last-space-after-${valign}`,
                label: `paraSpaceAfter 24, valign ${valign}`,
                text: [{ text: "Last paragraph", options: { paraSpaceAfter: 24 } }],
                options: { x: 0.75 + index * 3.125, y: 1.25, w: 2.25, h: 1.25, valign, fill: { color: "F2F2F2" } },
            })),
            {
                name: "text-last-space-after-two",
                label: "two paragraphs, paraSpaceAfter 12 each, valign bottom",
                text: [
                    { text: "First", options: { paraSpaceAfter: 12, breakLine: true } },
                    { text: "Second", options: { paraSpaceAfter: 12 } },
                ],
                options: { x: 0.75, y: 3.5, w: 2.25, h: 1.25, valign: "bottom", fill: { color: "F2F2F2" } },
            },
        ],
    },
    { title: "Kerning-sensitive wrapping", cases: KERNING_CASES },
    {
        // PptxGenJS 4.0.1 writes `underline.style` as <a:rPr u="...">; the HTML carries it as text-decoration-style.
        title: "Underline styles",
        cases: (["sng", "dbl", "heavy", "dotted", "dottedHeavy", "dash", "dashLong", "dotDash", "dotDotDash", "wavy", "wavyDbl", "wavyHeavy"] as const).map((style, index) => ({
            name: `text-underline-${style}`,
            label: `underline style ${style}`,
            text: "Underline gjy",
            options: { x: 0.5 + (index % 3) * 3.125, y: 1.25 + Math.floor(index / 3) * 1.05, w: 2.75, h: 0.5, fontSize: 20, margin: 0, valign: "top", underline: { style, color: "2F5597" } },
        })),
    },
];
const TEXT_OPTION_CASES = TEXT_OPTION_SLIDES.flatMap(({ cases }, index) => cases.map(({ name, options: { x, y, w, h = 0 }, pad = 0.15 }) => ({ page: 63 + index, name, x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad })));
export const TEXT_OPTION_PAGES = TEXT_OPTION_SLIDES.length;

// populateTableOptionsFixture(): one slide of table options, after the text-option slides. Each region is the
// table's area (in inches), tall enough for the rows it grows.
const TABLE_OPTION_CASES = [
    { name: "table-row-grow", x: 0.5, y: 1.25, w: 4, h: 2 },
    { name: "table-height-grow", x: 5.5, y: 1.25, w: 4, h: 2 },
    { name: "table-border-no-type", x: 0.5, y: 3.75, w: 4, h: 0.75 },
    { name: "table-border-sides-no-type", x: 5.5, y: 3.75, w: 4, h: 0.75 },
    { name: "table-thin-border-rows", x: 0.5, y: 4.75, w: 4, h: 0.6 },
    { name: "table-thin-border-grid", x: 5.5, y: 4.75, w: 4, h: 0.6 },
] as const;

// populatePresetAspectFixture(): presets whose OOXML geometry depends on the aspect ratio, drawn wide and tall
// where no other slide does, one slide per entry, after the table-option slide (#153).
// Up to four shapes per slide, each drawn wide and tall: the generated presets derive their guides from the short
// side (ss), so a square crop cannot show a guide taken from the wrong side.
const PRESET_ASPECT_SLIDES: ReadonlyArray<{ readonly title: string; readonly shapes: readonly PptxGenJS.SHAPE_NAME[] }> = [
    { title: "Arrows: aspect ratios", shapes: ["notchedRightArrow"] },
    { title: "Polygons: aspect ratios", shapes: ["parallelogram", "trapezoid", "nonIsoscelesTrapezoid", "octagon"] },
    { title: "Polygons: aspect ratios", shapes: ["heptagon", "decagon", "dodecagon"] },
    { title: "Stars: aspect ratios", shapes: ["star5", "star6", "star7", "star8"] },
    { title: "Stars: aspect ratios", shapes: ["star10", "star12", "star16", "star24"] },
    { title: "Stars: aspect ratios", shapes: ["star32"] },
];
const PRESET_ASPECT_CASES = PRESET_ASPECT_SLIDES.flatMap(({ shapes }, slideIndex) =>
    shapes.flatMap((shape, index) => {
        const page = 64 + TEXT_OPTION_PAGES + slideIndex;
        const x = 0.4 + (index % 2) * 4.7;
        const y = 0.9 + Math.floor(index / 2) * 2;
        return [
            { page, name: `${shape}-wide`, shape, x, y: y + 0.45, w: 2.5, h: 0.75 },
            { page, name: `${shape}-tall`, shape, x: x + 2.7, y, w: 0.9, h: 1.65 },
        ];
    }),
);

// populateParagraphFixture(): paragraphs PptxGenJS groups from runs, the last parity slide. No WASM deck takes it,
// so its cases need no WASM baseline; the WASM renderer reads the same paragraphs from the HTML.
const PARAGRAPH_PAGE = 64 + TEXT_OPTION_PAGES + PRESET_ASPECT_SLIDES.length;
const PARAGRAPH_CASES = [
    { name: "text-cell-paragraph-grouping", x: 0.5, y: 1.25, w: 4, h: 0.5 },
    { name: "text-inner-line-feed", x: 5.5, y: 1.25, w: 4, h: 0.9 },
    { name: "text-bullet-wrap-level-0", x: 0.5, y: 2.75, w: 4, h: 1 },
    { name: "text-bullet-wrap-level-1", x: 5.5, y: 2.75, w: 4, h: 1 },
    { name: "text-number-leading-line-feed", x: 0.5, y: 4.25, w: 4, h: 1 },
    // Not paragraph cases: free spots on the last parity slide, which no WASM deck takes.
    { name: "table-rows-under-frame-height", x: 5.5, y: 4.25, w: 4, h: 1.2 },
    { name: "table-falsy-bold", x: 0.5, y: 2.1, w: 4, h: 0.35 },
    { name: "text-underline-string-forms", x: 5.5, y: 2.3, w: 4, h: 0.3 },
] as const;
const WRAPPING_TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore";
// populateLineFeedTailFixture(): runs ending with line feeds, on the slide after the paragraph slide; no WASM deck takes it.
const LINE_FEED_TAIL_CASE = { page: PARAGRAPH_PAGE + 1, name: "text-line-feed-tail-run", x: 0.5, y: 1, w: 4, h: 2.5 } as const;
// populateLineFeedTailFixture() too: paragraphs written without a run, at the size on their <a:endParaRPr>.
const EMPTY_PARAGRAPH_CASE = { page: PARAGRAPH_PAGE + 1, name: "text-empty-paragraph-mark", x: 5.5, y: 1, w: 4, h: 2.5 } as const;
// populateLineFeedTailFixture() too: run options two text boxes, and two tables, share.
const SHARED_RUN_OPTIONS_CASE = { page: PARAGRAPH_PAGE + 1, name: "text-shared-run-options", x: 0.5, y: 3.9, w: 9, h: 1.2 } as const;

// These tight crops include the stroke but exclude labels and unused slide area.
// Each exception above CROP_TARGET and its evidence is documented in thresholds.ts.
function cropThreshold(name: string): number {
    const lineSnap = TEXT_LINE_SNAP_CROP_THRESHOLDS[name];
    if (lineSnap !== undefined) return lineSnap;
    return UNDERLINE_DOUBLE_CROP_THRESHOLDS[name] ?? CROP_TARGET;
}

export const PARITY_REGIONS = [
    ...CURVED_CASES,
    ...CIRCULAR_CASES,
    ...FLOWCHART_CASES,
    ...BRACE_BRACKET_CASES,
    ...RIBBON_SCROLL_CASES,
    ...ACTION_BUTTON_CASES,
    ...SYMBOL_CASES,
    ...GENERATED_PRESET_CASES,
    ...GENERATED_ASPECT_CASES,
    ...TABLE_CASES,
    ...PAGINATION_CASES,
    ...HTML_TABLE_CASES,
    ...SHAPED_TEXT_CASES,
    ...TEXT_CASES,
    { page: 59, name: "html-react-component-bars", x: 1, y: 1, w: 6, h: 2 },
    { page: 12, name: "dashed-arrow-line", x: 6.55, y: 1.6, w: 2.6, h: 0 },
    ...[...ARROW_HEAD_CASES, VERTICAL_LINE_CASE].map(({ page, name, x, y, w, h }) => ({ page, name, x: x - 0.1, y: y - 0.1, w: w + 0.2, h: h + 0.2 })),
    // populateSlidePropertiesFixture(): the slide numbers, own style and inherited one; its hidden slide prints no page.
    { page: 61, name: "slide-number-own-style", x: 7.5, y: 4.6, w: 2, h: 0.8 },
    { page: 62, name: "slide-number-inherited-style", x: 0.5, y: 1.2, w: 2.5, h: 1 },
    ...TEXT_OPTION_CASES,
    ...TABLE_OPTION_CASES.map(({ name, x, y, w, h }) => ({ page: 63 + TEXT_OPTION_PAGES, name, x: x - 0.15, y: y - 0.15, w: w + 0.3, h: h + 0.3 })),
    ...PRESET_ASPECT_CASES,
    ...PARAGRAPH_CASES.map(({ name, x, y, w, h }) => ({ page: PARAGRAPH_PAGE, name, x: x - 0.15, y: y - 0.15, w: w + 0.3, h: h + 0.3 })),
    { ...LINE_FEED_TAIL_CASE, x: LINE_FEED_TAIL_CASE.x - 0.15, y: LINE_FEED_TAIL_CASE.y - 0.15, w: LINE_FEED_TAIL_CASE.w + 0.3, h: LINE_FEED_TAIL_CASE.h + 0.3 },
    { ...EMPTY_PARAGRAPH_CASE, x: EMPTY_PARAGRAPH_CASE.x - 0.15, y: EMPTY_PARAGRAPH_CASE.y - 0.15, w: EMPTY_PARAGRAPH_CASE.w + 0.3, h: EMPTY_PARAGRAPH_CASE.h + 0.3 },
    { ...SHARED_RUN_OPTIONS_CASE, x: SHARED_RUN_OPTIONS_CASE.x - 0.15, y: SHARED_RUN_OPTIONS_CASE.y - 0.15, w: SHARED_RUN_OPTIONS_CASE.w + 0.3, h: SHARED_RUN_OPTIONS_CASE.h + 0.3 },
].map(({ page, name, x, y, w, h }) => ({
    page,
    name,
    threshold: cropThreshold(name),
    x: Math.floor(inchesToPixels(x)) - 3,
    y: Math.floor(inchesToPixels(y)) - 3,
    w: Math.ceil(inchesToPixels(w)) + 7,
    h: Math.ceil(inchesToPixels(h)) + 7,
}));

// A PNG as data, so toHtml() needs no file access: PptxGenJS writes a background picture without the
// SVG-to-PNG fallback it gives addImage(). tests/slide.test.ts covers the path form.
const SLIDE_BACKGROUND_DATA = `data:image/png;base64,${readFileSync(join(import.meta.dir, "wasm", "images", "sample.png")).toString("base64")}`;

const SAMPLE_IMAGE_DATA = `data:image/svg+xml;base64,${Buffer.from(
    `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" preserveAspectRatio="none">
  <rect width="200" height="100" fill="#4472C4"/><rect x="200" width="200" height="100" fill="#ED7D31"/>
  <rect y="100" width="200" height="100" fill="#70AD47"/><rect x="200" y="100" width="200" height="100" fill="#FFC000"/>
  <circle cx="200" cy="100" r="42" fill="#FFFFFF" stroke="#17365D" stroke-width="10"/>
  <path d="M0 0L400 200M400 0L0 200" stroke="#17365D" stroke-width="6" opacity=".65"/>
</svg>`,
).toString("base64")}`;

const TALL_IMAGE_DATA = `data:image/svg+xml;base64,${Buffer.from(
    `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400" viewBox="0 0 200 400" preserveAspectRatio="none">
  <rect width="100" height="200" fill="#5B9BD5"/><rect x="100" width="100" height="200" fill="#ED7D31"/>
  <rect y="200" width="100" height="200" fill="#70AD47"/><rect x="100" y="200" width="100" height="200" fill="#FFC000"/>
  <circle cx="100" cy="200" r="38" fill="#FFFFFF" stroke="#17365D" stroke-width="9"/>
</svg>`,
).toString("base64")}`;

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
        x: 0.75,
        y: 1.15,
        w: 4,
        h: 1.25,
        fill: { color: "F2F2F2" },
        line: { color: "A6A6A6", width: 1 },
    });
    defaultsSlide.addText("Default inset and vertical alignment", {
        x: 0.75,
        y: 1.15,
        w: 4,
        h: 1.25,
    });

    defaultsSlide.addShape("rect", {
        x: 5.25,
        y: 1.15,
        w: 4,
        h: 1.25,
        fill: { color: "F2F2F2" },
        line: { color: "A6A6A6", width: 1 },
    });
    defaultsSlide.addText("Explicit zero margin", {
        x: 5.25,
        y: 1.15,
        w: 4,
        h: 1.25,
        margin: 0,
    });

    defaultsSlide.addTable(
        [
            [
                { text: "Default table inset", options: { fill: { color: "D9EAF7" } } },
                { text: "Default 12pt text", options: { fill: { color: "E2F0D9" } } },
            ],
        ],
        {
            x: 0.75,
            y: 3,
            w: 8.5,
            h: 1.1,
        },
    );

    const primitivesSlide = presentation.addSlide();
    primitivesSlide.background = { color: "F2F2F2" };
    primitivesSlide.color = "17365D";
    primitivesSlide.addText("Shared Phase 1 primitives", {
        x: 0.5,
        y: 0.25,
        w: 9,
        h: 0.6,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        margin: 0,
    });
    primitivesSlide.addText("Inherited slide color", {
        x: 0.75,
        y: 1.1,
        w: 3.5,
        h: 0.6,
        fontFace: "Arial",
        fontSize: 18,
        margin: 0,
    });
    primitivesSlide.addShape("rect", {
        x: 0.75,
        y: 2,
        w: 3.5,
        h: 1.5,
        fill: { color: "accent1", transparency: 15 },
        line: { color: "accent2", width: 2, dashType: "dash" },
        rotate: 5,
    });
    primitivesSlide.addShape("rect", {
        x: 5.5,
        y: 2,
        w: 3.5,
        h: 1.5,
        fill: { color: "E2F0D9" },
        line: { color: "70AD47", width: 1 },
        shadow: { type: "outer", color: "000000", opacity: 0.3, blur: 3, offset: 3, angle: 45 },
    });

    const paragraphsSlide = presentation.addSlide();
    paragraphsSlide.addText("Paragraph structure", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    paragraphsSlide.addText(
        [
            { text: "Left paragraph", options: { breakLine: true, align: "left", paraSpaceAfter: 8 } },
            { text: "Centered with exact spacing", options: { breakLine: true, align: "center", lineSpacing: 24 } },
            { text: "Right paragraph", options: { align: "right", paraSpaceBefore: 8 } },
        ],
        {
            x: 0.75,
            y: 1,
            w: 8.5,
            h: 2.1,
            fontFace: "Arial",
            fontSize: 18,
            color: "363636",
            fill: { color: "F2F2F2" },
            line: { color: "A6A6A6", width: 1 },
            margin: 8,
        },
    );
    paragraphsSlide.addText("Top\n\nEmpty paragraph preserved", {
        x: 1.5,
        y: 3.5,
        w: 7,
        h: 1.4,
        fontFace: "Arial",
        fontSize: 15,
        color: "44546A",
        align: "center",
        valign: "middle",
        margin: 0,
    });
    paragraphsSlide.addText([{ text: "Two lines at 1.5x line spacing:" }, { text: "the extra leading sits above each baseline", options: { softBreakBefore: true } }], {
        x: 0.75,
        y: 4.95,
        w: 8.5,
        h: 0.6,
        fontFace: "Arial",
        fontSize: 12,
        color: "363636",
        lineSpacingMultiple: 1.5,
        margin: 0,
    });

    const runsSlide = presentation.addSlide();
    runsSlide.addText("Mixed run typography", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    runsSlide.addText(
        [
            { text: "Bold ", options: { bold: true, color: "4472C4" } },
            { text: "italic ", options: { italic: true, color: "ED7D31" } },
            { text: "underlined ", options: { underline: { style: "sng", color: "70AD47" } } },
            { text: "highlighted", options: { highlight: "FFF2CC", breakLine: true } },
            { text: "strike ", options: { strike: true } },
            { text: "super", options: { superscript: true, fontSize: 13 } },
            { text: " and ", options: {} },
            { text: "sub", options: { subscript: true, fontSize: 13 } },
        ],
        {
            x: 0.75,
            y: 1.2,
            w: 8.5,
            h: 2.2,
            fontFace: "Arial",
            fontSize: 20,
            color: "363636",
            margin: 6,
            valign: "middle",
        },
    );
    runsSlide.addText([{ text: "PuppeteerGen link", options: { hyperlink: { url: "https://example.com" } } }], {
        x: 3,
        y: 4.1,
        w: 4,
        h: 0.6,
        fontFace: "Arial",
        fontSize: 17,
        align: "center",
        margin: 0,
    });

    const listsSlide = presentation.addSlide();
    listsSlide.addText("Bullets and numbering", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    listsSlide.addText(
        [
            { text: "Default bullet", options: { bullet: true, breakLine: true } },
            { text: "Custom pointer", options: { bullet: { characterCode: "25BA", indent: 24 }, breakLine: true } },
            { text: "Nested bullet", options: { bullet: true, indentLevel: 1 } },
        ],
        {
            x: 0.75,
            y: 1,
            w: 4,
            h: 3.5,
            fontFace: "Arial",
            fontSize: 18,
            color: "363636",
            margin: 6,
        },
    );
    listsSlide.addText(
        [
            { text: "Third", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 }, breakLine: true } },
            { text: "Fourth", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 }, breakLine: true } },
            { text: "Fifth", options: { bullet: { type: "number", numberType: "romanLcParenR", numberStartAt: 3 } } },
        ],
        {
            x: 5.25,
            y: 1,
            w: 4,
            h: 3.5,
            fontFace: "Arial",
            fontSize: 18,
            color: "363636",
            margin: 6,
        },
    );

    const effectsSlide = presentation.addSlide();
    effectsSlide.addText("Text and text-box effects", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    effectsSlide.addText("Rounded, filled, bordered, and shadowed", {
        x: 0.75,
        y: 1.15,
        w: 4,
        h: 1.5,
        fontFace: "Arial",
        fontSize: 17,
        color: "FFFFFF",
        bold: true,
        align: "center",
        valign: "middle",
        fill: { color: "4472C4" },
        line: { color: "17365D", width: 2 },
        shape: "roundRect",
        rectRadius: 0.2,
        shadow: { type: "outer", color: "000000", opacity: 0.25, blur: 3, offset: 3, angle: 45 },
        margin: 6,
    });
    effectsSlide.addText(
        [
            { text: "Transparent", options: { transparency: 35 } },
            // PptxGenJS writes no run shadow (#223): neither side draws this one.
            { text: " and outlined", options: { outline: { color: "ED7D31", size: 0.75 }, shadow: { type: "outer", color: "FF0000", blur: 3, offset: 3, angle: 45, opacity: 0.8 } } },
        ],
        {
            x: 5.25,
            y: 1.15,
            w: 4,
            h: 1.5,
            fontFace: "Arial",
            fontSize: 20,
            color: "17365D",
            align: "center",
            valign: "middle",
            margin: 4,
        },
    );

    const directionSlide = presentation.addSlide();
    directionSlide.addText("Rotation, direction, and RTL", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    directionSlide.addText("Rotated text", {
        x: 0.7,
        y: 1.5,
        w: 2.6,
        h: 1,
        rotate: -15,
        fontFace: "Arial",
        fontSize: 18,
        color: "4472C4",
        align: "center",
        margin: 0,
    });
    directionSlide.addText("VERTICAL", {
        x: 4.1,
        y: 1,
        w: 1.2,
        h: 3.5,
        vert: "vert",
        fontFace: "Arial",
        fontSize: 17,
        color: "ED7D31",
        align: "center",
        margin: 0,
    });
    directionSlide.addText("مرحبا بالعالم", {
        x: 6,
        y: 1.5,
        w: 3.2,
        h: 1.2,
        rtlMode: true,
        fontFace: "Arial",
        fontSize: 20,
        color: "375623",
        align: "right",
        margin: 4,
    });

    const overflowSlide = presentation.addSlide();
    overflowSlide.addText("Wrapping and overflow", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    overflowSlide.addText("This sentence wraps naturally inside a constrained text box.", {
        x: 0.75,
        y: 1.1,
        w: 2.5,
        h: 1.5,
        fontFace: "Arial",
        fontSize: 18,
        color: "363636",
        fill: { color: "D9EAF7" },
        margin: 6,
    });
    overflowSlide.addText("This sentence stays on one line and is clipped at the edge.", {
        x: 3.75,
        y: 1.1,
        w: 2.5,
        h: 1.5,
        wrap: false,
        fontFace: "Arial",
        fontSize: 18,
        color: "363636",
        fill: { color: "FCE4D6" },
        margin: 6,
    });
    overflowSlide.addText("Shrink this oversized text until it fits within the fixed box", {
        x: 6.75,
        y: 1.1,
        w: 2.5,
        h: 1.5,
        fit: "shrink",
        fontFace: "Arial",
        fontSize: 24,
        color: "363636",
        fill: { color: "E2F0D9" },
        margin: 6,
    });

    populateImageFixture(presentation);

    const coreShapesSlide = presentation.addSlide();
    coreShapesSlide.addText("Core SVG shape geometry", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    coreShapesSlide.addShape("rect", {
        x: 0.6,
        y: 1.05,
        w: 1.6,
        h: 1.15,
        fill: { color: "4472C4", transparency: 12 },
        line: { color: "17365D", width: 1.5 },
    });
    coreShapesSlide.addShape("roundRect", {
        x: 2.55,
        y: 1.05,
        w: 1.6,
        h: 1.15,
        rectRadius: 0.18,
        fill: { color: "ED7D31" },
        line: { color: "C65911", width: 1.5 },
    });
    coreShapesSlide.addShape("ellipse", {
        x: 4.5,
        y: 1.05,
        w: 1.6,
        h: 1.15,
        fill: { color: "70AD47" },
        line: { color: "375623", width: 1.5 },
    });
    coreShapesSlide.addShape("line", {
        x: 6.55,
        y: 1.6,
        w: 2.6,
        h: 0,
        // Crop "dashed-arrow-line" (issue #42), measured in the pinned image: Puppeteer 0.0571, WASM 0.0916.
        // - Both: LibreOffice stores the width in whole 1/100 mm (2.25pt -> 0.79 mm, 2.986px), so its 7-width
        //   dash period is 20.9px, not 21px: a 1px drift by the line end. Not copied, the OOXML says 28575 EMU.
        //   Emulating the rounding in a scratch build scored Puppeteer 0.0038, WASM 0.0343.
        // - WASM only: poppler's stroke adjustment snaps the dashes of an exactly horizontal stroke to whole
        //   pixels (every dash edge on .0). LibreOffice writes this line from y 289.814pt to 289.786pt, slightly
        //   sloped, which escapes the snap. Sloping the WASM PDF's line by the same 0.037px gives 0.0571, the
        //   Puppeteer score. Gated by tests/visual/wasm/baseline.json.
        line: { color: "4472C4", width: 2.25, dashType: "dash", beginArrowType: "oval", endArrowType: "triangle" },
        hyperlink: { url: "https://example.com", tooltip: "Shape link" },
    });
    coreShapesSlide.addText("Rectangle", { x: 0.6, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Rounded", { x: 2.55, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Ellipse", { x: 4.5, y: 2.4, w: 1.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addText("Dashed arrow line", { x: 6.55, y: 2.4, w: 2.6, h: 0.35, fontFace: "Arial", fontSize: 13, align: "center", margin: 0 });
    coreShapesSlide.addShape("custGeom" as never, {
        x: 0.8,
        y: 3.25,
        w: 2.4,
        h: 1.55,
        points: [{ x: 0, y: 0.75 }, { x: 1.2, y: 0 }, { x: 2.4, y: 0.75 }, { x: 1.2, y: 1.5 }, { close: true }],
        fill: { color: "FFC000", transparency: 10 },
        line: { color: "BF9000", width: 1.5 },
    });
    coreShapesSlide.addShape("custGeom" as never, {
        x: 4,
        y: 3.25,
        w: 4.8,
        h: 1.55,
        points: [
            { x: 0, y: 1.2 },
            { x: 2.4, y: 0.2, curve: { type: "cubic", x1: 0.8, y1: -0.15, x2: 1.6, y2: 1.55 } },
            { x: 4.8, y: 1.2, curve: { type: "quadratic", x1: 3.6, y1: 0.1 } },
        ],
        fill: { type: "none" },
        line: { color: "7030A0", width: 2.25, dashType: "dashDot" },
    });

    const polygonShapesSlide = presentation.addSlide();
    polygonShapesSlide.addText("Polygon and star presets", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const polygonShapes: Array<[PptxGenJS.SHAPE_NAME, number, number, string]> = [
        ["triangle", 0.55, 1, "4472C4"],
        ["rtTriangle", 2.35, 1, "5B9BD5"],
        ["diamond", 4.15, 1, "ED7D31"],
        ["parallelogram", 5.95, 1, "FFC000"],
        ["trapezoid", 7.75, 1, "70AD47"],
        ["pentagon", 0.55, 3.25, "4472C4"],
        ["hexagon", 2.35, 3.25, "5B9BD5"],
        ["octagon", 4.15, 3.25, "ED7D31"],
        ["star4", 5.95, 3.25, "FFC000"],
        ["star5", 7.75, 3.25, "70AD47"],
    ];
    polygonShapes.forEach(([shape, x, y, color]) => {
        polygonShapesSlide.addShape(shape, {
            x,
            y,
            w: 1.35,
            h: 1.35,
            fill: { color, transparency: 8 },
            line: { color: "44546A", width: 1.25 },
        });
        polygonShapesSlide.addText(shape, {
            x: x - 0.15,
            y: y + 1.5,
            w: 1.65,
            h: 0.3,
            fontFace: "Arial",
            fontSize: 11,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });

    const arrowShapesSlide = presentation.addSlide();
    arrowShapesSlide.addText("Directional and compound arrows", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const arrowShapes: Array<[PptxGenJS.SHAPE_NAME, number, number]> = [
        ["rightArrow", 0.55, 1],
        ["leftArrow", 2.35, 1],
        ["upArrow", 4.15, 1],
        ["downArrow", 5.95, 1],
        ["leftRightArrow", 7.75, 1],
        ["upDownArrow", 0.55, 3.25],
        ["quadArrow", 2.35, 3.25],
        ["leftRightUpArrow", 4.15, 3.25],
        ["notchedRightArrow", 5.95, 3.25],
        ["stripedRightArrow", 7.75, 3.25],
    ];
    arrowShapes.forEach(([shape, x, y], index) => {
        arrowShapesSlide.addShape(shape, {
            x,
            y,
            w: 1.35,
            h: 1.2,
            fill: { color: index % 2 ? "5B9BD5" : "4472C4", transparency: 5 },
            line: { color: "17365D", width: 1.15 },
        });
        arrowShapesSlide.addText(shape, {
            x: x - 0.18,
            y: y + 1.42,
            w: 1.71,
            h: 0.3,
            fontFace: "Arial",
            fontSize: 9,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });

    const arrowCalloutsSlide = presentation.addSlide();
    arrowCalloutsSlide.addText("Arrow callout presets", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const arrowCallouts: Array<[PptxGenJS.SHAPE_NAME, number, number]> = [
        ["rightArrowCallout", 0.7, 1.05],
        ["leftArrowCallout", 3.05, 1.05],
        ["upArrowCallout", 5.4, 1.05],
        ["downArrowCallout", 7.75, 1.05],
        ["leftRightArrowCallout", 1.9, 3.35],
        ["upDownArrowCallout", 4.25, 3.35],
        ["quadArrowCallout", 6.6, 3.35],
    ];
    arrowCallouts.forEach(([shape, x, y], index) => {
        arrowCalloutsSlide.addShape(shape, {
            x,
            y,
            w: 1.55,
            h: 1.35,
            fill: { color: index % 2 ? "ED7D31" : "FFC000", transparency: 7 },
            line: { color: "843C0C", width: 1.15 },
        });
        arrowCalloutsSlide.addText(shape, {
            x: x - 0.25,
            y: y + 1.55,
            w: 2.05,
            h: 0.3,
            fontFace: "Arial",
            fontSize: 9,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });

    const bentArrowsSlide = presentation.addSlide();
    bentArrowsSlide.addText("Bent and routing arrows", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const bentArrows: Array<[PptxGenJS.SHAPE_NAME, number]> = [
        ["leftUpArrow", 0.7],
        ["bentUpArrow", 2.95],
        ["bentArrow", 5.2],
        ["uturnArrow", 7.45],
    ];
    bentArrows.forEach(([shape, x], index) => {
        bentArrowsSlide.addShape(shape, {
            x,
            y: 1.25,
            w: 1.8,
            h: 2.4,
            fill: { color: index % 2 ? "70AD47" : "4472C4", transparency: 5 },
            line: { color: "17365D", width: 1.15 },
        });
        bentArrowsSlide.addText(shape, {
            x: x - 0.15,
            y: 3.95,
            w: 2.1,
            h: 0.3,
            fontFace: "Arial",
            fontSize: 11,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });

    const curvedArrowsSlide = presentation.addSlide();
    curvedArrowsSlide.addText("Curved and swoosh arrows", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const curvedArrows = [...CURVED_CASES.filter(sample => sample.page === 17), { shape: "swooshArrow" as const, x: 8, y: 1, w: 1.4, h: 2.1 }];
    curvedArrows.forEach(({ shape, x, y, w, h }, index) => {
        curvedArrowsSlide.addShape(shape, {
            x,
            y,
            w,
            h,
            fill: { color: index % 2 ? "ED7D31" : "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
        curvedArrowsSlide.addText(shape, {
            x: x - 0.2,
            y: 3.35,
            w: 1.8,
            h: 0.3,
            fontFace: "Arial",
            fontSize: 9,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });

    const curvedRatiosSlide = presentation.addSlide();
    curvedRatiosSlide.addText("Curved arrows: aspect ratios", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    CURVED_CASES.filter(sample => sample.page === 18).forEach(({ shape, x, y, w, h }) => {
        curvedRatiosSlide.addShape(shape, {
            x,
            y,
            w,
            h,
            fill: { color: "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
    });

    for (const pageNumber of [19, 20]) {
        const circularSlide = presentation.addSlide();
        circularSlide.addText(pageNumber === 19 ? "Circular shape presets" : "Adjusted arcs and thickness", {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        CIRCULAR_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h, options }) => {
            circularSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                ...options,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [21, 22, 23]) {
        const flowchartSlide = presentation.addSlide();
        flowchartSlide.addText(`Flowchart presets ${pageNumber - 20}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        FLOWCHART_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            flowchartSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [24, 25]) {
        const braceSlide = presentation.addSlide();
        braceSlide.addText(pageNumber === 24 ? "Brace and bracket presets" : "Braces and brackets: aspect ratios", {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        BRACE_BRACKET_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            braceSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [26, 27, 28]) {
        const ribbonSlide = presentation.addSlide();
        ribbonSlide.addText(pageNumber === 26 ? "Ribbon and scroll presets" : `Ribbons and scrolls: aspect ratios ${pageNumber - 26}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        RIBBON_SCROLL_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            ribbonSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [29, 30, 31]) {
        const actionSlide = presentation.addSlide();
        actionSlide.addText(pageNumber === 31 ? "Action buttons: aspect ratios" : `Action button presets ${pageNumber - 28}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        ACTION_BUTTON_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            actionSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (const pageNumber of [32, 33, 34, 35]) {
        const symbolSlide = presentation.addSlide();
        symbolSlide.addText(pageNumber < 34 ? `Common symbol presets ${pageNumber - 31}` : `Common symbols: aspect ratios ${pageNumber - 33}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        SYMBOL_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            symbolSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (let pageNumber = 36; pageNumber <= 42; pageNumber++) {
        const presetSlide = presentation.addSlide();
        presetSlide.addText(`Remaining shape presets ${pageNumber - 35}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        GENERATED_PRESET_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            presetSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    for (let pageNumber = 43; pageNumber <= 45; pageNumber++) {
        const aspectSlide = presentation.addSlide();
        aspectSlide.addText(`Remaining presets: aspect ratios ${pageNumber - 42}`, {
            x: 0.5,
            y: 0.2,
            w: 9,
            h: 0.5,
            fontFace: "Arial",
            fontSize: 24,
            bold: true,
            color: "17365D",
            margin: 0,
        });
        GENERATED_ASPECT_CASES.filter(sample => sample.page === pageNumber).forEach(({ shape, x, y, w, h }) => {
            aspectSlide.addShape(shape, {
                x,
                y,
                w,
                h,
                fill: { color: "5B9BD5", transparency: 5 },
                line: { color: "843C0C", width: 1.15 },
            });
        });
    }

    const sizingTableSlide = presentation.addSlide();
    sizingTableSlide.addText("Static table sizing, spans, and borders", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    sizingTableSlide.addTable(
        [
            [
                { text: "Region", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
                { text: "Product", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
                { text: "Status", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
                { text: "Notes", options: { fill: { color: "4472C4" }, color: "FFFFFF", bold: true, align: "center" } },
            ],
            [
                { text: "North", options: { rowspan: 2, fill: { color: "D9EAF7" }, bold: true, valign: "middle", align: "center" } },
                {
                    text: [
                        { text: "Merged ", options: { bold: true, color: "C00000" } },
                        { text: "rich text", options: { italic: true, underline: { style: "sng" } } },
                    ],
                    options: { colspan: 2, fill: { color: "FFF2CC" }, valign: "middle" },
                },
                { text: "First row", options: { align: "right" } },
            ],
            [
                { text: "Two columns", options: { colspan: 2, fill: { color: "E2F0D9" }, align: "center" } },
                { text: "Second row", options: { align: "right" } },
            ],
            [{ text: "South" }, { text: "Widget" }, { text: "Ready", options: { bold: true, color: "548235" } }, { text: "Explicit widths and heights" }],
        ],
        {
            x: 0.5,
            y: 1,
            colW: [1.5, 2.5, 2, 3],
            rowH: [0.55, 0.75, 0.65, 0.7],
            fontFace: "Arial",
            fontSize: 13,
            color: "363636",
            margin: 0.08,
            border: { type: "solid", color: "7F8C8D", pt: 1 },
        },
    );

    const cellOptionsSlide = presentation.addSlide();
    cellOptionsSlide.addText("Table inheritance and cell text options", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    cellOptionsSlide.addTable(
        [
            [{ text: "Inherited header", options: { colspan: 2, bold: true, align: "center", fill: { color: "BDD7EE" } } }],
            [
                { text: "Bottom left", options: { valign: "bottom" } },
                { text: "Centered", options: { align: "center", valign: "middle" } },
            ],
            [
                { text: "Small inset", options: { margin: 0.03 } },
                { text: "Large inset", options: { margin: 0.16 } },
            ],
            [
                {
                    text: "Dashed sides",
                    options: {
                        border: [
                            { type: "dash", color: "C00000", pt: 2 },
                            { type: "solid", color: "548235", pt: 2 },
                            { type: "dash", color: "C00000", pt: 2 },
                            { type: "solid", color: "548235", pt: 2 },
                        ],
                    },
                },
                { text: "Inherited fill" },
            ],
        ],
        {
            x: 0.5,
            y: 1,
            w: 4.25,
            h: 3.15,
            fontFace: "Arial",
            fontSize: 13,
            color: "1F4E78",
            fill: { color: "F2F2F2" },
            margin: 0.08,
            border: { type: "solid", color: "5B9BD5", pt: 1 },
        },
    );
    cellOptionsSlide.addTable(
        [
            [{ text: "Rich text", options: { colspan: 2, fill: { color: "F4B183" }, bold: true, align: "center" } }],
            [
                {
                    text: [
                        { text: "Bold", options: { bold: true, color: "C00000" } },
                        { text: " + italic", options: { italic: true, color: "548235", breakLine: true } },
                        { text: "underlined", options: { underline: { style: "dbl", color: "4472C4" } } },
                    ],
                    options: { colspan: 2, valign: "middle" },
                },
            ],
            [
                { text: "Bullet", options: { bullet: true } },
                { text: "Transparent", options: { color: "C00000", transparency: 55 } },
            ],
            [
                { text: "Vertical", options: { textDirection: "vert", align: "center" } },
                { text: "Bottom", options: { valign: "bottom", align: "right" } },
            ],
        ],
        {
            x: 5.25,
            y: 1,
            w: 4.25,
            h: 3.15,
            fontFace: "Arial",
            fontSize: 13,
            color: "363636",
            margin: 0.08,
            border: { type: "solid", color: "A6A6A6", pt: 1 },
        },
    );

    const paginationSlide = presentation.addSlide();
    paginationSlide.addText("Automatic table pagination", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const paginatedRows: PptxGenJS.TableRow[] = [
        [
            { text: "ID", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
            { text: "Description", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
            { text: "State", options: { bold: true, color: "FFFFFF", fill: { color: "4472C4" }, align: "center" } },
        ],
    ];
    for (let index = 1; index <= 29; index++) {
        const fill = index % 2 === 0 ? { color: "EAF2F8" } : undefined;
        paginatedRows.push([
            { text: String(index).padStart(2, "0"), options: { fill, align: "center" } },
            { text: `Paginated record ${index}`, options: { fill } },
            { text: index % 3 === 0 ? "Review" : "Ready", options: { fill, color: index % 3 === 0 ? "C65911" : "548235", bold: true, align: "center" } },
        ]);
    }
    paginationSlide.addTable(paginatedRows, {
        x: 0.5,
        y: 1,
        colW: [1.4, 4.8, 2.8],
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageHeaderRows: 1,
        autoPageSlideStartY: 0.75,
        fontFace: "Arial",
        fontSize: 12,
        color: "363636",
        margin: 0.05,
        border: { type: "solid", color: "9EADBA", pt: 0.75 },
    });

    presentation.tableToSlides(installTableToSlidesFixture(presentation), {
        w: 10,
        // The slide height: the same pages as without `h`, which PptxGenJS uses only to paginate (#224), so the
        // drawn rows still size to their content instead of sharing the 5.625in.
        h: 5.625,
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
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    SHAPED_TEXT_CASES.forEach(({ shape, text, x, y, w, h }) => {
        shapedTextSlide.addText(text, {
            shape,
            x,
            y,
            w,
            h,
            fontFace: "Arial",
            fontSize: 16,
            bold: true,
            color: "FFFFFF",
            align: "center",
            valign: "middle",
            margin: 0.08,
            fill: { color: "5B9BD5", transparency: 5 },
            line: { color: "843C0C", width: 1.15 },
        });
    });

    populateChartFixture(presentation);
    populateComponentFixture(presentation);
    populateArrowHeadFixture(presentation);
    populateSlidePropertiesFixture(presentation);
    populateTextOptionsFixture(presentation);
    populateTableOptionsFixture(presentation);
    populatePresetAspectFixture(presentation);
    populateParagraphFixture(presentation);
    populateLineFeedTailFixture(presentation);
}

// A run ending with "\n" keeps its line feeds inside its <a:t>. The empty text after the last one takes no room in the
// next run's paragraph, so each 8pt paragraph keeps an 8pt line pitch under the 16pt head.
function populateLineFeedTailFixture(presentation: Presentation): void {
    const slide = presentation.addSlide();
    slide.addText("Runs ending with line feeds", { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
    const { x, y, w, h } = LINE_FEED_TAIL_CASE;
    slide.addText(
        [
            { text: "Lorem ipsum heading.\n\n", options: { bold: true, fontSize: 16 } },
            { text: `${WRAPPING_TEXT} magna aliqua. ${WRAPPING_TEXT} magna aliqua.\n\n`, options: { fontSize: 8 } },
            { text: `${WRAPPING_TEXT} magna aliqua.\n`, options: { fontSize: 8 } },
        ],
        // shortcut: left, not justify: LibreOffice draws the paragraphs a line feed inside <a:t> starts unjustified, which is
        // the paragraph-properties follow-up (the <a:p>'s first <a:pPr>), not this line pitch; justify them once that lands.
        { x, y, w, h, fontFace: "Arial", color: "363636", align: "left", valign: "bottom", margin: 0 },
    );
    // PptxGenJS writes the empty line between two line feeds, and an empty run, as an <a:p> with only <a:endParaRPr
    // sz="800">, the box's or table's 8pt: each is one 9.6pt line between the 12pt ones (PowerPoint and LibreOffice).
    const empty = EMPTY_PARAGRAPH_CASE;
    const style = { fontFace: "Arial", fontSize: 8, color: "363636" } as const;
    slide.addText([{ text: "Heading in a box\n\nBody after an 8pt empty line", options: { fontSize: 12 } }], { x: empty.x, y: empty.y, w: empty.w, h: 1, valign: "top", margin: 0, ...style });
    slide.addTable(
        [
            [
                {
                    text: [
                        { text: "Heading in a cell", options: { fontSize: 12, bold: true, breakLine: true } },
                        { text: "", options: { breakLine: true } },
                        { text: "Body after an empty run", options: { fontSize: 12, breakLine: true } },
                        { text: "", options: { breakLine: true, fontSize: 20 } },
                        { text: "Its own 20pt is not written", options: { fontSize: 12 } },
                    ],
                },
            ],
        ],
        { x: empty.x, y: empty.y + 1.1, w: empty.w, border: { type: "solid", pt: 1, color: "404040" }, ...style },
    );
    // PptxGenJS writes the first box's options onto the run options both boxes share (sharedRunOptions.ts): the
    // second box's runs keep the first one's 12pt and spacing, and the second table's run its 14pt, red and right.
    const shared = SHARED_RUN_OPTIONS_CASE;
    const title = { color: "0077AA", italic: true, breakLine: true, paraSpaceAfter: 5 };
    const item = { breakLine: true, paraSpaceAfter: 3 };
    const column = { y: shared.y, w: 2.1, h: shared.h, fontFace: "Arial", color: "000000", align: "left", valign: "top", margin: 0 } as const;
    slide.addText(
        [
            { text: "Column A", options: title },
            { text: "Alpha", options: item },
            { text: "Beta", options: item },
        ],
        { ...column, x: shared.x, fontSize: 12 },
    );
    slide.addText(
        [
            { text: "Column B", options: title },
            { text: "Gamma", options: item },
            { text: "Delta", options: item },
        ],
        { ...column, x: shared.x + 2.3, fontSize: 10 },
    );
    const cellRun = { breakLine: true };
    const table = { y: shared.y, w: 2.1, fontFace: "Arial", border: { type: "solid", pt: 1, color: "404040" } } as const;
    slide.addTable([[{ text: [{ text: "Cell A", options: cellRun }, { text: "Own tail" }] }]], { ...table, x: shared.x + 4.6, fontSize: 14, color: "AA0000", align: "right" });
    slide.addTable([[{ text: [{ text: "Cell B", options: cellRun }, { text: "Own tail" }] }]], { ...table, x: shared.x + 6.9, fontSize: 8, color: "0000AA", align: "left" });
}

function populateParagraphFixture(presentation: Presentation): void {
    const slide = presentation.addSlide();
    slide.addText("Paragraphs from runs", { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
    const [cell, lineFeed, levelZero, levelOne, leadingLineFeed, frameHeight, falsyBold, underlineForms] = PARAGRAPH_CASES;
    // PptxGenJS 4.0.1 genXmlTextBody STEP 4/5: a cell's runs without options share the cell's options (align
    // included), so one next to a run with its own options starts a paragraph; a run split on an inner "\n" ends a
    // paragraph after every piece, the last one too, whatever its own breakLine.
    slide.addTable([[{ text: [{ text: "Heading:", options: { bold: true } }, { text: " body without options" }] }]], { x: cell.x, y: cell.y, w: cell.w, align: "left", fontFace: "Arial", fontSize: 12, color: "363636" });
    slide.addText([{ text: "Intro", options: { breakLine: true } }, { text: "\nTitle after a blank line", options: { bold: true, breakLine: false } }, { text: "Description on its own line" }], {
        x: lineFeed.x,
        y: lineFeed.y,
        w: lineFeed.w,
        h: lineFeed.h,
        fontFace: "Arial",
        fontSize: 12,
        color: "363636",
        valign: "top",
        margin: 0,
    });
    // PptxGenJS writes a bullet paragraph with marL = 27pt per level and indent = -27pt: wrapped lines hang under the
    // first line's text, not under the marker.
    const wrapBox = { fontFace: "Arial", fontSize: 12, color: "363636", valign: "top", margin: 0 } as const;
    slide.addText([{ text: WRAPPING_TEXT, options: { bullet: true } }], { ...wrapBox, x: levelZero.x, y: levelZero.y, w: levelZero.w, h: levelZero.h });
    slide.addText([{ text: WRAPPING_TEXT, options: { bullet: { type: "number" }, indentLevel: 1 } }], { ...wrapBox, x: levelOne.x, y: levelOne.y, w: levelOne.w, h: levelOne.h });
    // A numbered run starting with "\n" makes PptxGenJS write an empty paragraph without a run before it: no marker in
    // LibreOffice or PowerPoint; LibreOffice restarts the numbering after it (RENDERING_TARGETS).
    const numbered = { bullet: { type: "number", style: "romanUcPeriod" } } as const;
    slide.addText(
        [
            { text: "Intro", options: { breakLine: true } },
            { text: "\nItem one", options: numbered },
            { text: "\nItem two", options: numbered },
        ],
        {
            ...wrapBox,
            x: leadingLineFeed.x,
            y: leadingLineFeed.y,
            w: leadingLineFeed.w,
            h: leadingLineFeed.h,
        },
    );
    // PptxGenJS 4.0.1 writes rowH into `<a:tr h>` and `h` only into the frame's cy, which PowerPoint and LibreOffice
    // ignore: three 0.3 in rows, not 1.2 in shared out (#246).
    const fills = ["D9EAF7", "FFF2CC", "E2F0D9"];
    slide.addTable(
        fills.map((color, index) => [
            { text: `Label ${index + 1}`, options: { fill: { color } } },
            { text: `Value ${index + 1}`, options: { fill: { color } } },
        ]),
        { x: frameHeight.x, y: frameHeight.y, w: frameHeight.w, h: frameHeight.h, rowH: 0.3, fontFace: "Arial", fontSize: 8, color: "363636", border: { type: "solid", color: "7F8C8D", pt: 1 } },
    );
    // PptxGenJS 4.0.1 fills a falsy cell option from the table (genXmlTable step 2) and a falsy run option from the
    // cell (genXmlTextBody step 6 C), so `bold: false` in a bold table is bold in both cells (#222).
    slide.addTable(
        [
            [
                { text: [{ text: "Run bold: false", options: { bold: false } }], options: { fill: { color: "D9EAF7" } } },
                { text: "Cell bold: false", options: { bold: false, fill: { color: "FFF2CC" } } },
            ],
        ],
        { x: falsyBold.x, y: falsyBold.y, w: falsyBold.w, bold: true, fontFace: "Arial", fontSize: 12, color: "363636" },
    );
    // PptxGenJS 4.0.1 writes a string `underline` (deprecated since 3.5.0) as u="heavy" / u="dash", and a text box's
    // `underline: true` as u="sng" (addTextDefinition). `as`: its types declare only the object form.
    const underline = (value: string | boolean) => ({ underline: value }) as unknown as PptxGenJS.TextPropsOptions;
    slide.addText(
        [
            { text: "String heavy, ", options: underline("heavy") },
            { text: "string dash, ", options: underline("dash") },
            { text: "boolean true", options: underline(true) },
        ],
        { x: underlineForms.x, y: underlineForms.y, w: underlineForms.w, h: underlineForms.h, fontFace: "Arial", fontSize: 12, color: "363636", valign: "top", margin: 0 },
    );
}

function populatePresetAspectFixture(presentation: Presentation): void {
    PRESET_ASPECT_SLIDES.forEach(({ title }, slideIndex) => {
        const slide = presentation.addSlide();
        slide.addText(title, { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
        for (const { shape, x, y, w, h } of PRESET_ASPECT_CASES.filter(sample => sample.page === 64 + TEXT_OPTION_PAGES + slideIndex)) {
            slide.addShape(shape, { x, y, w, h, fill: { color: "5B9BD5", transparency: 5 }, line: { color: "843C0C", width: 1.15 } });
        }
    });
}

/** The parity fixture's image slides (SVG pictures), also the WASM backend's SVG image deck (tests/visual/wasm/decks.ts). */
export function populateImageFixture(presentation: Presentation): void {
    const imageSizingSlide = presentation.addSlide();
    imageSizingSlide.addText("Image sizing and cropping", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    [
        [0.5, "Stretch"],
        [2.9, "Contain"],
        [5.3, "Cover"],
        [7.7, "Crop"],
    ].forEach(([x, label]) => {
        imageSizingSlide.addShape("rect", {
            x: x as number,
            y: 1.05,
            w: 1.9,
            h: 2.2,
            fill: { color: "F2F2F2" },
            line: { color: "A6A6A6", width: 1 },
        });
        imageSizingSlide.addText(label as string, {
            x: x as number,
            y: 3.4,
            w: 1.9,
            h: 0.4,
            fontFace: "Arial",
            fontSize: 14,
            color: "363636",
            align: "center",
            margin: 0,
        });
    });
    imageSizingSlide.addImage({ data: SAMPLE_IMAGE_DATA, x: 0.5, y: 1.05, w: 1.9, h: 2.2, altText: "Stretched sample" });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 2.9,
        y: 1.05,
        w: 4,
        h: 2,
        sizing: { type: "contain", w: 1.9, h: 2.2 },
        altText: "Contained sample",
    });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 5.3,
        y: 1.05,
        w: 4,
        h: 2,
        sizing: { type: "cover", w: 1.9, h: 2.2 },
        altText: "Covered sample",
    });
    imageSizingSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 7.7,
        y: 1.05,
        w: 4,
        h: 2,
        sizing: { type: "crop", x: 1, y: 0.25, w: 1.9, h: 2.2 },
        altText: "Cropped sample",
    });
    imageSizingSlide.addImage({
        data: TALL_IMAGE_DATA,
        x: 2.3,
        y: 4.05,
        w: 2,
        h: 4,
        sizing: { type: "contain", w: 2.2, h: 1.2 },
        altText: "Contained tall sample",
    });
    imageSizingSlide.addImage({
        data: TALL_IMAGE_DATA,
        x: 5.5,
        y: 4.05,
        w: 2,
        h: 4,
        sizing: { type: "cover", w: 2.2, h: 1.2 },
        altText: "Covered tall sample",
    });

    const imageEffectsSlide = presentation.addSlide();
    imageEffectsSlide.addText("Image transforms and effects", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 0.75,
        y: 1.25,
        w: 1.7,
        h: 1.7,
        rounding: true,
        altText: "Rounded image",
        objectName: "Rounded sample",
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 3.1,
        y: 1.35,
        w: 2.5,
        h: 1.25,
        rotate: -12,
        flipH: true,
        altText: "Rotated and flipped image",
    });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 6.25,
        y: 1.35,
        w: 2.5,
        h: 1.25,
        transparency: 45,
        shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 4, offset: 4, angle: 45 },
        hyperlink: { url: "https://example.com", tooltip: "Open image link" },
        altText: "Transparent linked image",
    });
    imageEffectsSlide.addText("Rounded", { x: 0.75, y: 3.35, w: 1.7, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addText("Rotate + flip", { x: 3.1, y: 3.35, w: 2.5, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addText("Transparency + shadow + link", { x: 6.1, y: 3.35, w: 2.8, h: 0.4, fontFace: "Arial", fontSize: 14, align: "center", margin: 0 });
    imageEffectsSlide.addImage({
        data: SAMPLE_IMAGE_DATA,
        x: 4,
        y: 4.05,
        w: 4,
        h: 2,
        rotate: 8,
        rounding: true,
        sizing: { type: "crop", x: 0.75, y: 0.25, w: 2, h: 1.1 },
        altText: "Cropped rounded rotated image",
    });
}

/** The parity fixture's chart slides, also the WASM backend's chart deck (tests/visual/wasm/decks.ts). */
export function populateChartFixture(presentation: Presentation): void {
    const chartsSlide = presentation.addSlide();
    chartsSlide.addText("Core chart rendering", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const chartData: PptxGenJS.OptsChartData[] = [
        { name: "North", labels: ["Q1", "Q2", "Q3", "Q4"], values: [3, 5, 4, 7] },
        { name: "South", labels: ["Q1", "Q2", "Q3", "Q4"], values: [5, 2, 6, 4] },
    ];
    chartsSlide.addChart("bar", chartData, {
        x: 0.4,
        y: 0.9,
        w: 4.4,
        h: 4.1,
        fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true,
        legendPos: "b",
    });
    chartsSlide.addChart("line", chartData, {
        x: 5.2,
        y: 0.9,
        w: 4.4,
        h: 4.1,
        fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true,
        legendPos: "b",
        lineDataSymbol: "circle",
        lineDataSymbolSize: 6,
        lineSize: 2,
    });

    const bar3DSlide = presentation.addSlide();
    bar3DSlide.addText("Three-dimensional bar charts", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    bar3DSlide.addChart("bar3D", chartData, {
        x: 2,
        y: 1.1,
        w: 6,
        h: 3.3,
        fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        bar3DShape: "box",
        showLegend: true,
        legendPos: "b",
    });

    const mixedChartSlide = presentation.addSlide();
    mixedChartSlide.addText("Mixed bar and line chart", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    const mixedChart: PptxGenJS.IChartMulti[] = [
        { type: "bar", data: [chartData[0]!], options: {} },
        { type: "line", data: [chartData[1]!], options: {} },
    ];
    (mixedChartSlide.addChart as Function)(mixedChart, {
        x: 2,
        y: 1.1,
        w: 6,
        h: 3.3,
        fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true,
        legendPos: "b",
        lineDataSymbol: "circle",
        lineDataSymbolSize: 6,
        lineSize: 2,
    });

    const secondaryAxisSlide = presentation.addSlide();
    secondaryAxisSlide.addText("Mixed chart with secondary value axis", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
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
        x: 2,
        y: 1.1,
        w: 6,
        h: 3.3,
        fontSize: 11,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true,
        legendPos: "b",
        lineDataSymbol: "circle",
        lineDataSymbolSize: 6,
        lineSize: 2,
        valAxes: [
            { valAxisMinVal: 0, valAxisMaxVal: 8, showValAxisTitle: true, valAxisTitle: "Units" },
            { valAxisMinVal: 0, valAxisMaxVal: 500, showValAxisTitle: true, valAxisTitle: "Revenue" },
        ],
    });

    const formattedAxisSlide = presentation.addSlide();
    formattedAxisSlide.addText("Advanced value-axis formatting", {
        x: 0.5,
        y: 0.2,
        w: 9,
        h: 0.5,
        fontFace: "Arial",
        fontSize: 24,
        bold: true,
        color: "17365D",
        margin: 0,
    });
    formattedAxisSlide.addChart("bar", chartData, {
        x: 0.7,
        y: 1.1,
        w: 4.2,
        h: 3.3,
        fontSize: 10,
        chartColors: ["4472C4", "ED7D31"],
        showLegend: true,
        legendPos: "b",
        valAxisMinVal: 0,
        valAxisMaxVal: 8,
        valAxisMajorUnit: 2,
        valAxisLabelFormatCode: "0.0",
        valAxisLabelColor: "C00000",
        valAxisLabelFontBold: true,
        valAxisLabelRotate: 15,
        valAxisLineColor: "548235",
        valAxisLineSize: 1.5,
        valAxisLineStyle: "dash",
        valAxisMajorTickMark: "inside",
        valAxisMinorTickMark: "outside",
        showValAxisTitle: true,
        valAxisTitle: "Units",
        valAxisTitleColor: "17365D",
        valAxisTitleFontFace: "Arial",
        valAxisTitleFontSize: 12,
        valGridLine: { color: "A5A5A5", size: 1, style: "dot" },
    });
    formattedAxisSlide.addChart(
        "line",
        [
            {
                name: "Growth",
                labels: ["Q1", "Q2", "Q3", "Q4"],
                values: [1, 10, 100, 1000],
            },
        ],
        {
            x: 5.1,
            y: 1.1,
            w: 4.2,
            h: 3.3,
            fontSize: 10,
            chartColors: ["70AD47"],
            showLegend: true,
            legendPos: "b",
            lineDataSymbol: "circle",
            lineDataSymbolSize: 6,
            valAxisMinVal: 1,
            valAxisMaxVal: 1000,
            valAxisLogScaleBase: 10,
            valAxisLabelFormatCode: "#,##0",
            valAxisMajorTickMark: "outside",
            showValAxisTitle: true,
            valAxisTitle: "Log scale",
        },
    );
}

function populateArrowHeadFixture(presentation: Presentation): void {
    const slide = presentation.addSlide();
    slide.addText("Line heads (begin and end)", { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
    for (const { type, widthPt, x, y, w, h } of ARROW_HEAD_CASES) {
        slide.addShape("line", { x, y, w, h, line: { color: "4472C4", width: widthPt, beginArrowType: type, endArrowType: type } });
        slide.addText(`${type} ${widthPt}pt`, { x: x - 0.25, y: y + h + 0.3, w: w + 0.5, h: 0.3, fontFace: "Arial", fontSize: 12, align: "center", margin: 0 });
    }
    const { x, y, w, h } = VERTICAL_LINE_CASE;
    slide.addShape("line", { x, y, w, h, line: { color: "2CA8E2", width: 1 } });
}

export function populateComponentFixture(presentation: Presentation): void {
    // HTML extension reference: equivalent PptxGenJS rectangles verify geometry and clipping.
    const componentBoxes = [
        { x: 1, y: 1, w: 4, h: 0.5 },
        { x: 1, y: 2, w: 6, h: 1 },
    ];
    if (presentation instanceof PuppeteerGen) {
        const schema = z.object({ percent: z.number().min(0).max(100).default(75) });
        presentation.registerComponent("fixture/progress", 1, {
            schema,
            render: props => `<div style="width:100%;height:100%;background:#E0E0E0"><div style="width:${Number(props.percent)}%;height:200%;background:#4472C4"></div></div>`,
        });
        registerReactComponent(presentation, "fixture/react-progress", 1, ({ percent }: z.output<typeof schema>) => createElement("div", { style: { width: "100%", height: "100%", background: "#E0E0E0" } }, createElement("div", { style: { width: `${percent}%`, height: "200%", background: "#4472C4" } })), { schema });
        const componentSlide = presentation.addSlide();
        componentBoxes.forEach((box, index) => {
            // Both renderers use the same schema default; the reference stays at 75%.
            componentSlide.addComponent({ type: index === 0 ? "fixture/progress" : "fixture/react-progress", version: 1, props: {} }, box);
        });
    } else {
        const componentSlide = presentation.addSlide();
        for (const box of componentBoxes) {
            componentSlide.addShape("rect", { ...box, fill: { color: "E0E0E0" }, line: { transparency: 100 } });
            componentSlide.addShape("rect", { ...box, w: box.w * 0.75, fill: { color: "4472C4" }, line: { transparency: 100 } });
        }
    }
}

/**
 * Slide properties (#102): a background picture, a hidden slide and slide numbers, also the WASM backend's slides deck
 * (tests/visual/wasm/decks.ts). Two printed pages: the hidden slide is in neither PDF, and the slide after it prints
 * its position, which counts the hidden slide (LibreOffice numbers by position too).
 */
export function populateSlidePropertiesFixture(presentation: Presentation): void {
    const title = { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 } as const;
    const pictured = presentation.addSlide();
    // A path picture, stretched from 2:1 over the 16:9 slide; the color under it is not drawn.
    pictured.background = { data: SLIDE_BACKGROUND_DATA, color: "FF0000" };
    pictured.addText("Background picture, numbered slides", { ...title, fill: { color: "FFFFFF" } });

    const hidden = presentation.addSlide();
    hidden.addText("A hidden slide prints no page", title);
    hidden.hidden = true;

    const numbered = presentation.addSlide();
    numbered.addText("The slide number below counts the hidden slide", title);
    // No font, size or color of its own: they, its insets and its anchor come from the slideNumber set last.
    numbered.slideNumber = { x: 0.5, y: 1.2, w: 2.5, h: 1, align: "left" };
    pictured.slideNumber = { x: 7.5, y: 4.6, w: 2, h: 0.8, fontFace: "Arial", fontSize: 28, color: "C00000", bold: true, align: "right", valign: "bottom", margin: [0, 12, 6, 0] };
}

/** The parity fixture's text-option slides (TEXT_OPTION_SLIDES), also the WASM backend's options deck. */
export function populateTextOptionsFixture(presentation: Presentation): void {
    for (const { title, cases } of TEXT_OPTION_SLIDES) {
        const slide = presentation.addSlide();
        slide.addText(title, { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
        for (const { name, label, text, options, pad = 0.15 } of cases) {
            slide.addText(label, { x: options.x, y: options.y - pad - 0.3, w: options.w, h: 0.25, fontFace: "Arial", fontSize: 11, color: "595959", margin: 0 });
            // Fresh objects per call: PptxGenJS mutates the options and runs it is given.
            slide.addText(structuredClone(text), { fontFace: "Arial", fontSize: 14, color: "363636", objectName: name, ...options });
        }
    }
}

/** The parity fixture's table-option slide (TABLE_OPTION_CASES), also the WASM backend's tableOptions deck. */
export function populateTableOptionsFixture(presentation: Presentation): void {
    const slide = presentation.addSlide();
    slide.addText("Table rows and borders", { x: 0.5, y: 0.2, w: 9, h: 0.5, fontFace: "Arial", fontSize: 24, bold: true, color: "17365D", margin: 0 });
    const [rowGrow, heightGrow, noType, sidesNoType, thinRows, thinGrid] = TABLE_OPTION_CASES;
    const border = { type: "solid", pt: 1, color: "404040" } as const;
    const cell = (text: string) => ({ text, options: { border } });
    // rowH is a minimum: the middle row grows to its three lines and the last row moves down (PowerPoint, LibreOffice).
    slide.addTable([[cell("Row one")], [cell("Row two\nsecond line\nthird line")], [cell("Row three")]], { x: rowGrow.x, y: rowGrow.y, w: rowGrow.w, rowH: 0.25, fontFace: "Arial", fontSize: 12, color: "363636" });
    // A table `h` shared by its rows is a minimum too.
    slide.addTable(
        [
            [cell("A"), cell("B")],
            [cell("Two\nlines"), cell("C")],
        ],
        { x: heightGrow.x, y: heightGrow.y, w: heightGrow.w, h: 0.4, fontFace: "Arial", fontSize: 12, color: "363636", valign: "middle" },
    );
    // A border without `type` is solid (PptxGenJS DEF_CELL_BORDER); a missing side of an array has none.
    const typeless = { color: "C00000", pt: 2 };
    slide.addTable([[{ text: "Border without type" }, { text: "Solid" }]], { x: noType.x, y: noType.y, w: noType.w, rowH: 0.75, border: typeless, fontFace: "Arial", fontSize: 12, color: "363636" });
    const sides = [typeless, null, typeless, null] as unknown as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps];
    slide.addTable([[{ text: "Top and bottom only", options: { border: sides } }]], { x: sidesNoType.x, y: sidesNoType.y, w: sidesNoType.w, rowH: 0.75, fontFace: "Arial", fontSize: 12, color: "363636" });
    // 0.5pt borders (<a:lnT w="6350">) are stroked once per grid line at their width, centred on it, as PowerPoint and
    // LibreOffice draw them; a filled CSS border box prints 0.47pt high and anti-aliases to a pale line.
    const thin = { type: "solid", pt: 0.5, color: "000000" } as const;
    const thinGray = { type: "solid", pt: 0.5, color: "808080" } as const;
    const thinCells = (border: PptxGenJS.BorderProps | [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps]) =>
        [
            ["Lorem", "Ipsum", "Dolor"],
            ["Sit", "Amet", "Elit"],
        ].map(row => row.map(text => ({ text, options: { border } })));
    slide.addTable(thinCells([thin, { type: "none" }, thin, { type: "none" }]), { x: thinRows.x, y: thinRows.y, w: thinRows.w, rowH: 0.25, fontFace: "Arial", fontSize: 10, color: "363636" });
    slide.addTable(thinCells(thinGray), { x: thinGrid.x, y: thinGrid.y, w: thinGrid.w, rowH: 0.25, fontFace: "Arial", fontSize: 10, color: "363636" });
}
