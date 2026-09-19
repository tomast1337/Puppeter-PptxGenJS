import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = process.argv[2];
if (!source) throw new Error("Usage: bun scripts/generate-preset-shapes.ts <presetShapeDefinitions.xml>");

const PRESETS = [
    "accentBorderCallout1", "accentBorderCallout2", "accentBorderCallout3", "accentCallout1", "accentCallout2", "accentCallout3",
    "bevel", "borderCallout1", "borderCallout2", "borderCallout3", "callout1", "callout2", "callout3", "can",
    "chartPlus", "chartStar", "chartX", "chevron", "circularArrow", "cloud", "cloudCallout", "corner", "cornerTabs", "cube",
    "diagStripe", "doubleWave", "folderCorner", "frame", "funnel", "gear6", "gear9", "halfFrame", "homePlate",
    "irregularSeal1", "irregularSeal2", "leftCircularArrow", "leftRightCircularArrow", "plaque", "plaqueTabs", "round1Rect",
    "round2DiagRect", "round2SameRect", "snip1Rect", "snip2DiagRect", "snip2SameRect", "snipRoundRect", "squareTabs",
    "teardrop", "wave", "wedgeEllipseCallout", "wedgeRectCallout", "wedgeRoundRectCallout",
] as const;
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

const definitions = Object.fromEntries(PRESETS.map(name => {
    const xmlName = name === "folderCorner" ? "foldedCorner" : name;
    const shape = [...document.documentElement.children].find(element => element.localName === xmlName);
    if (!shape) throw new Error(`Missing preset ${name}`);
    const guides = (list: Element | null) => [...(list?.children ?? [])].map(element => [attr(element, "name")!, attr(element, "fmla")!]);
    return [name, {
        adjustments: guides(shape.querySelector(":scope > avLst")),
        guides: guides(shape.querySelector(":scope > gdLst")),
        paths: [...shape.querySelectorAll(":scope > pathLst > path")].map(path => ({
            ...(attr(path, "w") ? { w: attr(path, "w") } : {}),
            ...(attr(path, "h") ? { h: attr(path, "h") } : {}),
            ...(attr(path, "fill") ? { fill: attr(path, "fill") } : {}),
            ...(attr(path, "stroke") ? { stroke: attr(path, "stroke") } : {}),
            commands: [...path.children].map(command),
        })),
    }];
}));

const output = `// Generated from ECMA-376 presetShapeDefinitions.xml by scripts/generate-preset-shapes.ts.\n`
    + `// Keep this data declarative; rendering behavior belongs in normalize/shape.ts.\n`
    + `export const GENERATED_PRESET_SHAPES = ${JSON.stringify(definitions)} as const;\n`;
writeFileSync(new URL("../src/generatedPresetShapes.ts", import.meta.url), output);
console.log(`Generated ${Object.keys(definitions).length} preset definitions.`);
