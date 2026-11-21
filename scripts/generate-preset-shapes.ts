import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import pptxgen from "pptxgenjs";

const source = process.argv[2];

if (!source) {
    throw new Error("Usage: bun scripts/generate-preset-shapes.ts <presetShapeDefinitions.xml>");
}

// Presets PdfLapas draws by hand on purpose, each group with its reason. Every other preset PptxGenJS 4.0.1 can
// write (its ShapeType values) is generated from presetShapeDefinitions.xml.
const HAND_DRAWN: readonly { readonly why: string; readonly names: readonly string[] }[] = [
    { why: "drawn as an HTML box, ellipse or line, not a path; roundRect reads rectRadius", names: ["rect", "roundRect", "ellipse", "line", "lineInv"] },
    { why: "not a preset: the path is the caller's points", names: ["custGeom"] },
    { why: "PptxGenJS writes their adjustments from angleRange and arcThicknessRatio", names: ["arc", "pie", "chord", "blockArc"] },
    { why: "drawn as an ellipse, as before: the generated four-arc path scores 0.0055 against 0.0054 in its WASM crop (#153)", names: ["flowChartConnector"] },
    { why: "drawn by hand: the generated geometry scores 0.0001 worse in its wide and WASM crops (#153)", names: ["actionButtonInformation"] },
    { why: "drawn by hand: the generated geometry scores 0.0001 worse in its tall crop, both backends (#153)", names: ["leftRightRibbon"] },
];
const WRITABLE: readonly string[] = Object.values(new pptxgen().ShapeType);
const handDrawn = new Set(HAND_DRAWN.flatMap(group => group.names));
const unknown = [...handDrawn].filter(name => !WRITABLE.includes(name));

if (unknown.length) {
    throw new Error(`HAND_DRAWN names that PptxGenJS 4.0.1 cannot write: ${unknown.join(", ")}`);
}

const PRESETS = WRITABLE.filter(name => !handDrawn.has(name)).sort();
const document = new JSDOM(readFileSync(source, "utf8"), { contentType: "text/xml" }).window.document;

const point = (element: Element) => {
    const value = element.querySelector(":scope > pt");

    if (!value) {
        throw new Error(`Missing point in ${element.tagName}`);
    }

    return [value.getAttribute("x")!, value.getAttribute("y")!];
};
const command = (element: Element): string[] => {
    const name = element.localName;

    if (name === "close") {
        return ["Z"];
    }

    if (name === "moveTo") {
        return ["M", ...point(element)];
    }

    if (name === "lnTo") {
        return ["L", ...point(element)];
    }

    if (name === "arcTo") {
        return ["A", element.getAttribute("wR")!, element.getAttribute("hR")!, element.getAttribute("stAng")!, element.getAttribute("swAng")!];
    }

    const points = [...element.querySelectorAll(":scope > pt")].flatMap(value => [value.getAttribute("x")!, value.getAttribute("y")!]);

    if (name === "quadBezTo") {
        return ["Q", ...points];
    }

    if (name === "cubicBezTo") {
        return ["C", ...points];
    }

    throw new Error(`Unsupported path command ${name}`);
};

const guides = (list: Element | null) => [...(list?.children ?? [])].map(element => [element.getAttribute("name")!, element.getAttribute("fmla")!] as const);

const definitions: Record<string, unknown> = {};

for (const name of PRESETS) {
    const xmlName = name === "folderCorner" ? "foldedCorner" : name;
    const shape = [...document.documentElement.children].find(element => element.localName === xmlName);

    if (!shape) {
        throw new Error(`Missing preset ${name}`);
    }

    const paths = [];

    for (const path of shape.querySelectorAll(":scope > pathLst > path")) {
        paths.push({
            ...(path.getAttribute("w") ? { w: path.getAttribute("w") } : {}),
            ...(path.getAttribute("h") ? { h: path.getAttribute("h") } : {}),
            ...(path.getAttribute("fill") ? { fill: path.getAttribute("fill") } : {}),
            ...(path.getAttribute("stroke") ? { stroke: path.getAttribute("stroke") } : {}),
            commands: [...path.children].map(command),
        });
    }

    definitions[name] = {
        adjustments: guides(shape.querySelector(":scope > avLst")),
        guides: guides(shape.querySelector(":scope > gdLst")),
        paths,
    };
}

// The text rectangle (<rect>) of every preset whose rectangle is not the whole box, keyed by DrawingML name, with
// the adjustments and only the guides the rectangle reads.
const TEXT_RECT_EDGES = ["l", "t", "r", "b"] as const;
const textRects: Record<string, unknown> = {};

for (const shape of document.documentElement.children) {
    const rect = shape.querySelector(":scope > rect");

    if (!rect) {
        continue;
    }

    const edges = TEXT_RECT_EDGES.map(edge => rect.getAttribute(edge) ?? edge);

    if (edges.join() === TEXT_RECT_EDGES.join()) {
        continue;
    }

    // Walk back from the rectangle: a guide is kept when a later kept guide reads it. Some presets redefine a
    // name (gear9's a1), and a use reads the closest definition above it.
    const needed = new Set<string>(edges);
    const kept: (readonly [string, string])[] = [];

    for (const guide of guides(shape.querySelector(":scope > gdLst")).reverse()) {
        const [name, formula] = guide;

        if (!needed.delete(name)) {
            continue;
        }

        for (const token of formula.split(/\s+/).slice(1)) {
            needed.add(token);
        }

        kept.push(guide);
    }

    textRects[shape.localName] = { adjustments: guides(shape.querySelector(":scope > avLst")), guides: kept.reverse(), rect: edges };
}

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
