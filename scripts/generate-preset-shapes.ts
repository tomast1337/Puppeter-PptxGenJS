import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import pptxgen from "pptxgenjs";

const source = process.argv[2];
if (!source) throw new Error("Usage: bun scripts/generate-preset-shapes.ts <presetShapeDefinitions.xml>");

// Presets PdfLapas draws by hand on purpose, each group with its reason. Every other preset PptxGenJS 4.0.1 can
// write (its ShapeType values) is generated from presetShapeDefinitions.xml.
const HAND_DRAWN: readonly { readonly why: string; readonly names: readonly string[] }[] = [
    { why: "drawn as an HTML box, ellipse or line, not a path; roundRect reads rectRadius", names: ["rect", "roundRect", "ellipse", "line", "lineInv"] },
    { why: "not a preset: the path is the caller's points", names: ["custGeom"] },
    { why: "PptxGenJS writes their adjustments from angleRange and arcThicknessRatio", names: ["arc", "pie", "chord", "blockArc"] },
    // shortcut: the groups below are hand-transcribed and not yet compared with the generated geometry; each group
    // leaves this list once its visual crops do not get worse (#153).
    { why: "polygons and stars, not yet compared (#153)", names: ["triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "nonIsoscelesTrapezoid", "pentagon", "hexagon", "heptagon", "octagon", "decagon", "dodecagon", "star5", "star6", "star7", "star8", "star10", "star12", "star16", "star24", "star32"] },
    { why: "circular presets without options, not yet compared (#153)", names: ["pieWedge", "donut"] },
    { why: "braces and brackets, not yet compared (#153)", names: ["leftBrace", "rightBrace", "bracePair", "leftBracket", "rightBracket", "bracketPair"] },
    { why: "ribbons and scrolls, not yet compared (#153)", names: ["ribbon", "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon", "horizontalScroll", "verticalScroll"] },
    {
        why: "action buttons, not yet compared (#153)",
        names: ["actionButtonBackPrevious", "actionButtonBeginning", "actionButtonBlank", "actionButtonDocument", "actionButtonEnd", "actionButtonForwardNext", "actionButtonHelp", "actionButtonHome", "actionButtonInformation", "actionButtonMovie", "actionButtonReturn", "actionButtonSound"],
    },
    { why: "symbols and math, not yet compared (#153)", names: ["plus", "mathPlus", "mathMinus", "mathEqual", "mathNotEqual", "mathMultiply", "mathDivide", "heart", "lightningBolt", "moon", "sun", "smileyFace", "noSmoking"] },
    {
        why: "flowchart symbols, not yet compared (#153)",
        names: [
            "flowChartAlternateProcess",
            "flowChartCollate",
            "flowChartConnector",
            "flowChartDecision",
            "flowChartDelay",
            "flowChartDisplay",
            "flowChartExtract",
            "flowChartInputOutput",
            "flowChartInternalStorage",
            "flowChartDocument",
            "flowChartMagneticDisk",
            "flowChartMagneticDrum",
            "flowChartMagneticTape",
            "flowChartManualInput",
            "flowChartManualOperation",
            "flowChartMerge",
            "flowChartMultidocument",
            "flowChartOfflineStorage",
            "flowChartOffpageConnector",
            "flowChartOnlineStorage",
            "flowChartOr",
            "flowChartPredefinedProcess",
            "flowChartPreparation",
            "flowChartProcess",
            "flowChartPunchedCard",
            "flowChartPunchedTape",
            "flowChartSort",
            "flowChartSummingJunction",
            "flowChartTerminator",
        ],
    },
];
const WRITABLE: readonly string[] = Object.values(new pptxgen().ShapeType);
const handDrawn = new Set(HAND_DRAWN.flatMap(group => group.names));
const unknown = [...handDrawn].filter(name => !WRITABLE.includes(name));
if (unknown.length) throw new Error(`HAND_DRAWN names that PptxGenJS 4.0.1 cannot write: ${unknown.join(", ")}`);
const PRESETS = WRITABLE.filter(name => !handDrawn.has(name)).sort();
const document = new JSDOM(readFileSync(source, "utf8"), { contentType: "text/xml" }).window.document;

const attr = (element: Element, name: string) => element.getAttribute(name) ?? undefined;
const point = (element: Element) => {
    const value = element.querySelector(":scope > pt");
    if (!value) throw new Error(`Missing point in ${element.tagName}`);
    return [attr(value, "x")!, attr(value, "y")!];
};
const command = (element: Element): string[] => {
    const name = element.localName;
    if (name === "close") return ["Z"];
    if (name === "moveTo") return ["M", ...point(element)];
    if (name === "lnTo") return ["L", ...point(element)];
    if (name === "arcTo") return ["A", attr(element, "wR")!, attr(element, "hR")!, attr(element, "stAng")!, attr(element, "swAng")!];
    const points = [...element.querySelectorAll(":scope > pt")].flatMap(value => [attr(value, "x")!, attr(value, "y")!]);
    if (name === "quadBezTo") return ["Q", ...points];
    if (name === "cubicBezTo") return ["C", ...points];
    throw new Error(`Unsupported path command ${name}`);
};

const guides = (list: Element | null) => [...(list?.children ?? [])].map(element => [attr(element, "name")!, attr(element, "fmla")!] as const);

const definitions = Object.fromEntries(
    PRESETS.map(name => {
        const xmlName = name === "folderCorner" ? "foldedCorner" : name;
        const shape = [...document.documentElement.children].find(element => element.localName === xmlName);
        if (!shape) throw new Error(`Missing preset ${name}`);
        return [
            name,
            {
                adjustments: guides(shape.querySelector(":scope > avLst")),
                guides: guides(shape.querySelector(":scope > gdLst")),
                paths: [...shape.querySelectorAll(":scope > pathLst > path")].map(path => ({
                    ...(attr(path, "w") ? { w: attr(path, "w") } : {}),
                    ...(attr(path, "h") ? { h: attr(path, "h") } : {}),
                    ...(attr(path, "fill") ? { fill: attr(path, "fill") } : {}),
                    ...(attr(path, "stroke") ? { stroke: attr(path, "stroke") } : {}),
                    commands: [...path.children].map(command),
                })),
            },
        ];
    }),
);

// The text rectangle (<rect>) of every preset whose rectangle is not the whole box, keyed by DrawingML name, with
// the adjustments and only the guides the rectangle reads.
const TEXT_RECT_EDGES = ["l", "t", "r", "b"] as const;
const textRects = Object.fromEntries(
    [...document.documentElement.children].flatMap(shape => {
        const rect = shape.querySelector(":scope > rect");
        if (!rect) return [];
        const edges = TEXT_RECT_EDGES.map(edge => attr(rect, edge) ?? edge);
        if (edges.join() === TEXT_RECT_EDGES.join()) return [];
        // Walk back from the rectangle: a guide is kept when a later kept guide reads it. Some presets redefine a
        // name (gear9's a1), and a use reads the closest definition above it.
        const needed = new Set<string>(edges);
        const kept = guides(shape.querySelector(":scope > gdLst"))
            .reverse()
            .filter(([name, formula]) => {
                if (!needed.delete(name)) return false;
                for (const token of formula.split(/\s+/).slice(1)) needed.add(token);
                return true;
            })
            .reverse();
        return [[shape.localName, { adjustments: guides(shape.querySelector(":scope > avLst")), guides: kept, rect: edges }]];
    }),
);

const output =
    `// Generated from ECMA-376 presetShapeDefinitions.xml by scripts/generate-preset-shapes.ts.\n` +
    `// Keep this data declarative; rendering behavior belongs in normalize/generatedPreset.ts.\n` +
    `export type GeneratedPresetDefinition = {\n` +
    `    readonly adjustments: readonly (readonly [string, string])[];\n` +
    `    readonly guides: readonly (readonly [string, string])[];\n` +
    `    readonly paths: readonly {\n` +
    `        readonly w?: string;\n` +
    `        readonly h?: string;\n` +
    `        readonly fill?: string;\n` +
    `        readonly stroke?: string;\n` +
    `        readonly commands: readonly (readonly string[])[];\n` +
    `    }[];\n` +
    `};\n` +
    `export const GENERATED_PRESET_NAMES = ${JSON.stringify(PRESETS)} as const;\n` +
    `export type GeneratedPresetName = (typeof GENERATED_PRESET_NAMES)[number];\n` +
    `export const GENERATED_PRESET_SHAPES: Readonly<Record<GeneratedPresetName, GeneratedPresetDefinition>> = ${JSON.stringify(definitions)};\n` +
    `type GeneratedTextRect = {\n` +
    `    readonly adjustments: readonly (readonly [string, string])[];\n` +
    `    readonly guides: readonly (readonly [string, string])[];\n` +
    `    readonly rect: readonly [string, string, string, string];\n` +
    `};\n` +
    `export const GENERATED_TEXT_RECTS: Readonly<Record<string, GeneratedTextRect>> = ${JSON.stringify(textRects)};\n`;
writeFileSync(new URL("../packages/pptxgenjs/src/generatedPresetShapes.ts", import.meta.url), output);
console.log(`Generated ${Object.keys(definitions).length} preset definitions and ${Object.keys(textRects).length} text rectangles.`);
