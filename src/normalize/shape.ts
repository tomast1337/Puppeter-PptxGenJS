import type PptxGenJS from "pptxgenjs";
import type { NormalizedLine, NormalizedShape, NormalizedTextBox } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels, inchesToPixels } from "../utils";
import { GENERATED_PRESET_NAMES, generatedPresetGeometry } from "./generatedPreset";

const POLYGON_SIDES = Object.freeze({ pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, decagon: 10, dodecagon: 12 } as const);
const STAR_POINTS = Object.freeze({ star4: 4, star5: 5, star6: 6, star7: 7, star8: 8, star10: 10, star12: 12, star16: 16, star24: 24, star32: 32 } as const);
const ARROW_SHAPES = Object.freeze([
    "rightArrow",
    "leftArrow",
    "upArrow",
    "downArrow",
    "leftRightArrow",
    "upDownArrow",
    "quadArrow",
    "leftRightUpArrow",
    "notchedRightArrow",
    "stripedRightArrow",
    "leftUpArrow",
    "bentUpArrow",
    "bentArrow",
    "uturnArrow",
    "curvedRightArrow",
    "curvedLeftArrow",
    "curvedUpArrow",
    "curvedDownArrow",
    "swooshArrow",
    "rightArrowCallout",
    "leftArrowCallout",
    "upArrowCallout",
    "downArrowCallout",
    "leftRightArrowCallout",
    "upDownArrowCallout",
    "quadArrowCallout",
] as const);
const CIRCULAR_SHAPES = Object.freeze(["arc", "pie", "pieWedge", "chord", "blockArc", "donut"] as const);
const BRACE_BRACKET_SHAPES = Object.freeze(["leftBrace", "rightBrace", "bracePair", "leftBracket", "rightBracket", "bracketPair"] as const);
const RIBBON_SCROLL_SHAPES = Object.freeze([
    "ribbon",
    "ribbon2",
    "ellipseRibbon",
    "ellipseRibbon2",
    "leftRightRibbon",
    "horizontalScroll",
    "verticalScroll",
] as const);
const ACTION_BUTTON_SHAPES = Object.freeze([
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
] as const);
const SYMBOL_SHAPES = Object.freeze([
    "plus",
    "mathPlus",
    "mathMinus",
    "mathEqual",
    "mathNotEqual",
    "mathMultiply",
    "mathDivide",
    "heart",
    "lightningBolt",
    "moon",
    "sun",
    "smileyFace",
    "noSmoking",
] as const);
const FLOWCHART_SHAPES = Object.freeze([
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
] as const);

export const CORE_SVG_SHAPES = Object.freeze([
    "rect",
    "roundRect",
    "ellipse",
    "line",
    "lineInv",
    "custGeom",
    "triangle",
    "rtTriangle",
    "diamond",
    "parallelogram",
    "trapezoid",
    "nonIsoscelesTrapezoid",
    ...Object.keys(POLYGON_SIDES),
    ...Object.keys(STAR_POINTS),
    ...ARROW_SHAPES,
    ...CIRCULAR_SHAPES,
    ...BRACE_BRACKET_SHAPES,
    ...RIBBON_SCROLL_SHAPES,
    ...ACTION_BUTTON_SHAPES,
    ...SYMBOL_SHAPES,
    ...FLOWCHART_SHAPES,
    ...GENERATED_PRESET_NAMES,
] as const);

type CustomShapeName = PptxGenJS.SHAPE_NAME | "custGeom";
type ShapePoint = NonNullable<PptxGenJS.ShapeProps["points"]>[number];

function coordinate(value: PptxGenJS.Coord, axis: "x" | "y", pageSize: PageSize): number {
    return convertToPixels(value, (axis === "x" ? pageSize.width : pageSize.height) * 96);
}

function cleanNumber(value: number): number {
    return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function drawingAngleParameter(degrees: number, rx: number, ry: number): number {
    const radians = (degrees * Math.PI) / 180;
    return Math.atan2(rx * Math.sin(radians), ry * Math.cos(radians));
}

function ellipseRayPoint(cx: number, cy: number, rx: number, ry: number, degrees: number): PixelPoint {
    const parameter = drawingAngleParameter(degrees, rx, ry);
    return [cx + rx * Math.cos(parameter), cy + ry * Math.sin(parameter)];
}

function arcCommand(
    current: { x: number; y: number },
    curve: Extract<ShapePoint, { curve: unknown }>["curve"] & { type: "arc" },
    pageSize: PageSize,
): { command: string; end: { x: number; y: number } } {
    const rx = coordinate(curve.wR, "x", pageSize);
    const ry = coordinate(curve.hR, "y", pageSize);
    const arc = arcPathCommand([current.x, current.y], rx, ry, curve.stAng, curve.swAng);
    return {
        command: arc.command,
        end: { x: cleanNumber(arc.end[0]), y: cleanNumber(arc.end[1]) },
    };
}

export function normalizeCustomPath(points: PptxGenJS.ShapeProps["points"], pageSize: PageSize): string {
    if (!points?.length) throw new Error("Custom geometry requires at least one point");
    const commands: string[] = [];
    let current = { x: 0, y: 0 };
    points.forEach((point, index) => {
        if ("close" in point) {
            commands.push("Z");
            return;
        }
        if ("curve" in point) {
            const x = coordinate(point.x, "x", pageSize);
            const y = coordinate(point.y, "y", pageSize);
            if (point.curve.type === "cubic") {
                commands.push(
                    `C ${coordinate(point.curve.x1, "x", pageSize)} ${coordinate(point.curve.y1, "y", pageSize)} ${coordinate(point.curve.x2, "x", pageSize)} ${coordinate(point.curve.y2, "y", pageSize)} ${x} ${y}`,
                );
                current = { x, y };
            } else if (point.curve.type === "quadratic") {
                commands.push(`Q ${coordinate(point.curve.x1, "x", pageSize)} ${coordinate(point.curve.y1, "y", pageSize)} ${x} ${y}`);
                current = { x, y };
            } else {
                const arc = arcCommand(current, point.curve, pageSize);
                commands.push(arc.command);
                current = arc.end;
            }
            return;
        }
        current = { x: coordinate(point.x, "x", pageSize), y: coordinate(point.y, "y", pageSize) };
        commands.push(`${point.moveTo || index === 0 ? "M" : "L"} ${current.x} ${current.y}`);
    });
    return commands.join(" ");
}

function polygonPath(points: ReadonlyArray<readonly [number, number]>, width: number, height: number): string {
    return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * width} ${y * height}`).join(" ")} Z`;
}

function radialPath(vertices: number, width: number, height: number, innerRatio?: number): string {
    const count = innerRatio === undefined ? vertices : vertices * 2;
    const evenRotation = innerRatio === undefined && vertices % 2 === 0 ? Math.PI / vertices : 0;
    const raw = Array.from({ length: count }, (_, index) => {
        const outer = innerRatio === undefined || index % 2 === 0;
        const radius = outer ? 1 : innerRatio;
        const angle = -Math.PI / 2 + evenRotation + (index * Math.PI * 2) / count;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
    });
    const xs = raw.map(([x]) => x);
    const ys = raw.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return polygonPath(
        raw.map(([x, y]) => [(x - minX) / (maxX - minX), (y - minY) / (maxY - minY)] as const),
        width,
        height,
    );
}

type PixelPoint = readonly [number, number];

function pixelPath(points: ReadonlyArray<PixelPoint>): string {
    return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${cleanNumber(x)} ${cleanNumber(y)}`).join(" ")} Z`;
}

function pointCommand(command: "M" | "L" | "Q", points: ReadonlyArray<PixelPoint>): string {
    return `${command} ${points.flatMap(([x, y]) => [cleanNumber(x), cleanNumber(y)]).join(" ")}`;
}

function arcEndpoint(current: PixelPoint, rx: number, ry: number, startDegrees: number, sweepDegrees: number): PixelPoint {
    // DrawingML angles describe rays from the ellipse center, not the
    // parametric angles used by (rx * cos(t), ry * sin(t)).
    const start = drawingAngleParameter(startDegrees, rx, ry);
    const end = drawingAngleParameter(startDegrees + sweepDegrees, rx, ry);
    const centerX = current[0] - rx * Math.cos(start);
    const centerY = current[1] - ry * Math.sin(start);
    return [centerX + rx * Math.cos(end), centerY + ry * Math.sin(end)];
}

function presetArcPath(rx: number, ry: number) {
    const commands: string[] = [];
    let current: PixelPoint = [0, 0];
    return {
        move(x: number, y: number) {
            current = [x, y];
            commands.push(pointCommand("M", [current]));
            return this;
        },
        line(x: number, y: number) {
            current = [x, y];
            commands.push(pointCommand("L", [current]));
            return this;
        },
        arc(start: number, sweep: number) {
            const result = arcPathCommand(current, rx, ry, start, sweep);
            current = result.end;
            commands.push(result.command);
            return this;
        },
        close() {
            commands.push("Z");
            return this;
        },
        data() {
            return commands.join(" ");
        },
    };
}

function drawingPath() {
    const commands: string[] = [];
    let current: PixelPoint = [0, 0];
    return {
        move(x: number, y: number) {
            current = [x, y];
            commands.push(pointCommand("M", [current]));
            return this;
        },
        line(x: number, y: number) {
            current = [x, y];
            commands.push(pointCommand("L", [current]));
            return this;
        },
        arc(rx: number, ry: number, start: number, sweep: number) {
            const result = arcPathCommand(current, rx, ry, start, sweep);
            current = result.end;
            commands.push(result.command);
            return this;
        },
        quadratic(controlX: number, controlY: number, x: number, y: number) {
            current = [x, y];
            commands.push(pointCommand("Q", [[controlX, controlY], current]));
            return this;
        },
        cubic(controlX1: number, controlY1: number, controlX2: number, controlY2: number, x: number, y: number) {
            current = [x, y];
            commands.push(`C ${[controlX1, controlY1, controlX2, controlY2, x, y].map(cleanNumber).join(" ")}`);
            return this;
        },
        close() {
            commands.push("Z");
            return this;
        },
        data() {
            return commands.join(" ");
        },
    };
}

function arcPathCommand(current: PixelPoint, rx: number, ry: number, startDegrees: number, sweepDegrees: number): { command: string; end: PixelPoint } {
    const end = arcEndpoint(current, rx, ry, startDegrees, sweepDegrees);
    return {
        command: `A ${cleanNumber(rx)} ${cleanNumber(ry)} 0 ${Math.abs(sweepDegrees) > 180 ? 1 : 0} ${sweepDegrees >= 0 ? 1 : 0} ${cleanNumber(end[0])} ${cleanNumber(end[1])}`,
        end,
    };
}

function rightArrowPoints(width: number, height: number): PixelPoint[] {
    const head = Math.min(width, height) / 2;
    const base = width - head;
    return [
        [0, height / 4],
        [base, height / 4],
        [base, 0],
        [width, height / 2],
        [base, height],
        [base, (height * 3) / 4],
        [0, (height * 3) / 4],
    ];
}

function rotateRightArrow(width: number, height: number, direction: "left" | "up" | "down"): PixelPoint[] {
    if (direction === "left") return rightArrowPoints(width, height).map(([x, y]) => [width - x, y]);
    const source = rightArrowPoints(height, width);
    return source.map(([x, y]) => (direction === "up" ? [y, height - x] : [width - y, x]));
}

function leftRightArrowPoints(width: number, height: number): PixelPoint[] {
    const head = Math.min(width, height) / 2;
    const y1 = height / 4;
    return [
        [0, height / 2],
        [head, 0],
        [head, y1],
        [width - head, y1],
        [width - head, 0],
        [width, height / 2],
        [width - head, height],
        [width - head, height - y1],
        [head, height - y1],
        [head, height],
    ];
}

function rightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const y1 = height / 2 - short / 4;
    const y2 = height / 2 - short / 8;
    const y3 = height / 2 + short / 8;
    const y4 = height / 2 + short / 4;
    const x2 = width * 0.64977;
    const x3 = width - short / 4;
    return [
        [0, 0],
        [x2, 0],
        [x2, y2],
        [x3, y2],
        [x3, y1],
        [width, height / 2],
        [x3, y4],
        [x3, y3],
        [x2, y3],
        [x2, height],
        [0, height],
    ];
}

function rotateRightCallout(width: number, height: number, direction: "left" | "up" | "down"): PixelPoint[] {
    if (direction === "left") return rightCalloutPoints(width, height).map(([x, y]) => [width - x, y]);
    const source = rightCalloutPoints(height, width);
    return source.map(([x, y]) => (direction === "up" ? [y, height - x] : [width - y, x]));
}

function leftRightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short / 4;
    const y1 = height / 2 - head;
    const y2 = height / 2 - head / 2;
    const y3 = height / 2 + head / 2;
    const y4 = height / 2 + head;
    const bodyHalf = (width * 0.48123) / 2;
    const x2 = width / 2 - bodyHalf;
    const x3 = width / 2 + bodyHalf;
    return [
        [0, height / 2],
        [head, y1],
        [head, y2],
        [x2, y2],
        [x2, 0],
        [x3, 0],
        [x3, y2],
        [width - head, y2],
        [width - head, y1],
        [width, height / 2],
        [width - head, y4],
        [width - head, y3],
        [x3, y3],
        [x3, height],
        [x2, height],
        [x2, y3],
        [head, y3],
        [head, y4],
    ];
}

function quadCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short * 0.18515;
    const headHalfWidth = short * 0.18515;
    const shaftHalfWidth = short * 0.092575;
    const bodyHalfWidth = (width * 0.48123) / 2;
    const bodyHalfHeight = (height * 0.48123) / 2;
    const x2 = width / 2 - bodyHalfWidth;
    const x7 = width / 2 + bodyHalfWidth;
    const x3 = width / 2 - headHalfWidth;
    const x6 = width / 2 + headHalfWidth;
    const x4 = width / 2 - shaftHalfWidth;
    const x5 = width / 2 + shaftHalfWidth;
    const y2 = height / 2 - bodyHalfHeight;
    const y7 = height / 2 + bodyHalfHeight;
    const y3 = height / 2 - headHalfWidth;
    const y6 = height / 2 + headHalfWidth;
    const y4 = height / 2 - shaftHalfWidth;
    const y5 = height / 2 + shaftHalfWidth;
    return [
        [0, height / 2],
        [head, y3],
        [head, y4],
        [x2, y4],
        [x2, y2],
        [x4, y2],
        [x4, head],
        [x3, head],
        [width / 2, 0],
        [x6, head],
        [x5, head],
        [x5, y2],
        [x7, y2],
        [x7, y4],
        [width - head, y4],
        [width - head, y3],
        [width, height / 2],
        [width - head, y6],
        [width - head, y5],
        [x7, y5],
        [x7, y7],
        [x5, y7],
        [x5, height - head],
        [x6, height - head],
        [width / 2, height],
        [x3, height - head],
        [x4, height - head],
        [x4, y7],
        [x2, y7],
        [x2, y5],
        [head, y5],
        [head, y6],
    ];
}

function quadArrowPoints(width: number, height: number, includeDown = true): PixelPoint[] {
    const short = Math.min(width, height);
    const headInset = short * 0.225;
    const headHalfWidth = short * 0.225;
    const shaftHalfWidth = short * 0.1125;
    const x2 = width / 2 - headHalfWidth;
    const x3 = width / 2 - shaftHalfWidth;
    const x4 = width / 2 + shaftHalfWidth;
    const x5 = width / 2 + headHalfWidth;
    const x6 = width - headInset;
    const y2 = height / 2 - headHalfWidth;
    const y3 = height / 2 - shaftHalfWidth;
    const y4 = height / 2 + shaftHalfWidth;
    const y5 = height / 2 + headHalfWidth;
    const y6 = height - headInset;
    const points: PixelPoint[] = [
        [0, height / 2],
        [headInset, y2],
        [headInset, y3],
        [x3, y3],
        [x3, headInset],
        [x2, headInset],
        [width / 2, 0],
        [x5, headInset],
        [x4, headInset],
        [x4, y3],
        [x6, y3],
        [x6, y2],
        [width, height / 2],
        [x6, y5],
        [x6, y4],
        [x4, y4],
    ];
    if (includeDown) points.push([x4, y6], [x5, y6], [width / 2, height], [x2, y6], [x3, y6]);
    else points.push([x4, height], [x3, height]);
    points.push([x3, y4], [headInset, y4], [headInset, y5]);
    return points;
}

function leftUpArrowPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const x1 = short / 4;
    const dx2 = short / 2;
    const x2 = width - dx2;
    const y2 = height - dx2;
    const x4 = width - short / 4;
    const y4 = height - short / 4;
    const dx3 = short / 8;
    const x3 = x4 - dx3;
    const x5 = x4 + dx3;
    const y3 = y4 - dx3;
    const y5 = y4 + dx3;
    return [
        [0, y4],
        [x1, y2],
        [x1, y3],
        [x3, y3],
        [x3, x1],
        [x2, x1],
        [x4, 0],
        [width, x1],
        [x5, x1],
        [x5, y5],
        [x1, y5],
        [x1, height],
    ];
}

function bentUpArrowPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const y1 = short / 4;
    const x1 = width - short / 2;
    const x3 = width - short / 4;
    const dx2 = short / 8;
    const x2 = x3 - dx2;
    const x4 = x3 + dx2;
    const y2 = height - short / 4;
    return [
        [0, y2],
        [x2, y2],
        [x2, y1],
        [x1, y1],
        [x3, 0],
        [width, y1],
        [x4, y1],
        [x4, height],
        [0, height],
    ];
}

function bentArrowPath(width: number, height: number): string {
    const short = Math.min(width, height);
    const thickness = short / 4;
    const arrowHalf = short / 4;
    const thicknessHalf = thickness / 2;
    const delta = arrowHalf - thicknessHalf;
    const arrowHeight = short / 4;
    const bend = Math.min(short * 0.4375, width - arrowHeight, height - delta);
    const innerBend = Math.max(bend - thickness, 0);
    const x3 = thickness + innerBend;
    const x4 = width - arrowHeight;
    const y3 = delta + thickness;
    const y4 = y3 + delta;
    const y5 = delta + bend;
    const commands = [pointCommand("M", [[0, height]]), pointCommand("L", [[0, y5]])];
    let arc = arcPathCommand([0, y5], bend, bend, 180, 90);
    commands.push(
        arc.command,
        pointCommand("L", [[x4, delta]]),
        pointCommand("L", [[x4, 0]]),
        pointCommand("L", [[width, arrowHalf]]),
        pointCommand("L", [[x4, y4]]),
        pointCommand("L", [[x4, y3]]),
        pointCommand("L", [[x3, y3]]),
    );
    arc = arcPathCommand([x3, y3], innerBend, innerBend, 270, -90);
    commands.push(arc.command, pointCommand("L", [[thickness, height]]), "Z");
    return commands.join(" ");
}

function uturnArrowPath(width: number, height: number): string {
    const short = Math.min(width, height);
    const thickness = short / 4;
    const arrowHalf = short / 4;
    const thicknessHalf = thickness / 2;
    const delta = arrowHalf - thicknessHalf;
    const y5 = height * 0.75;
    const arrowHeight = short / 4;
    const y4 = y5 - arrowHeight;
    const x9 = width - delta;
    const bend = Math.min(short * 0.4375, x9 / 2, y4);
    const innerBend = Math.max(bend - thickness, 0);
    const x3 = thickness + innerBend;
    const x8 = width - arrowHalf;
    const x6 = x8 - arrowHalf;
    const x7 = x6 + delta;
    const x4 = x9 - bend;
    const commands = [pointCommand("M", [[0, height]]), pointCommand("L", [[0, bend]])];
    let arc = arcPathCommand([0, bend], bend, bend, 180, 90);
    commands.push(arc.command, pointCommand("L", [[x4, 0]]));
    arc = arcPathCommand([x4, 0], bend, bend, 270, 90);
    commands.push(
        arc.command,
        pointCommand("L", [[x9, y4]]),
        pointCommand("L", [[width, y4]]),
        pointCommand("L", [[x8, y5]]),
        pointCommand("L", [[x6, y4]]),
        pointCommand("L", [[x7, y4]]),
        pointCommand("L", [[x7, x3]]),
    );
    arc = arcPathCommand([x7, x3], innerBend, innerBend, 0, -90);
    commands.push(arc.command, pointCommand("L", [[x3, thickness]]));
    arc = arcPathCommand([x3, thickness], innerBend, innerBend, 270, -90);
    commands.push(arc.command, pointCommand("L", [[thickness, height]]), "Z");
    return commands.join(" ");
}

function curvedArrowGeometry(
    width: number,
    height: number,
    direction: "right" | "left" | "up" | "down",
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    // Default DrawingML curved-arrow guides. Transposing the horizontal
    // definitions gives the vertical presets, including their face boundaries.
    const vertical = direction === "up" || direction === "down";
    const left = direction === "left" || direction === "up";
    const w = vertical ? height : width;
    const h = vertical ? width : height;
    const short = Math.min(w, h);
    const thickness = short / 4;
    const arrowWidth = short / 2;
    const radiusY = h / 2 - (thickness + arrowWidth) / 4;
    const diameter = radiusY * 2;
    const idx = (Math.sqrt(diameter * diameter - thickness * thickness) * w) / diameter;
    const arrowHeight = Math.min(short / 4, idx);
    const y3 = radiusY + thickness;
    const dy = (Math.sqrt(w * w - arrowHeight * arrowHeight) * radiusY) / w;
    const y5 = radiusY + dy;
    const y7 = y3 + dy;
    const halfDifference = (arrowWidth - thickness) / 2;
    const y4 = y5 - halfDifference;
    const y8 = y7 + halfDifference;
    const y6 = h - arrowWidth / 2;
    const x1 = left ? arrowHeight : w - arrowHeight;
    const sweep = (Math.atan2(dy, arrowHeight) * 180) / Math.PI;
    const diagonal = (Math.atan2(thickness / 2, idx) * 180) / Math.PI;
    const path = () => presetArcPath(w, radiusY);
    let main: string;
    let dark: string;
    let outline: string;
    if (left) {
        main = path()
            .move(0, y6)
            .line(x1, y4)
            .line(x1, y5)
            .arc(sweep, diagonal - sweep)
            .arc(-diagonal, sweep + diagonal)
            .line(x1, y8)
            .close()
            .data();
        dark = path().move(w, y3).arc(0, -90).line(0, 0).arc(270, 90).close().data();
        outline = path()
            .move(w, y3)
            .arc(0, -90)
            .line(0, 0)
            .arc(270, 90)
            .line(w, y3)
            .arc(0, sweep)
            .line(x1, y8)
            .line(0, y6)
            .line(x1, y4)
            .line(x1, y5)
            .arc(sweep, diagonal - sweep)
            .data();
    } else {
        main = path()
            .move(0, radiusY)
            .arc(180, -sweep)
            .line(x1, y4)
            .line(w, y6)
            .line(x1, y8)
            .line(x1, y7)
            .arc(180 - sweep, sweep)
            .close()
            .data();
        dark = path()
            .move(w, thickness)
            .arc(270, diagonal - 90)
            .arc(180 - diagonal, 90 + diagonal)
            .close()
            .data();
        outline = path()
            .move(0, radiusY)
            .arc(180, -sweep)
            .line(x1, y4)
            .line(w, y6)
            .line(x1, y8)
            .line(x1, y7)
            .arc(180 - sweep, sweep)
            .line(0, radiusY)
            .arc(180, 90)
            .line(w, thickness)
            .arc(270, diagonal - 90)
            .data();
    }
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: outline,
        transform: vertical ? "matrix(0 1 1 0 0 0)" : undefined,
    };
}

function normalizedSweep(start: number, end: number): number {
    const delta = (((end - start) % 360) + 360) % 360;
    return delta === 0 ? 360 : delta;
}

function ellipseArcCommands(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    start: number,
    sweep: number,
): {
    move: string;
    arcs: string;
    start: PixelPoint;
    end: PixelPoint;
} {
    const first = ellipseRayPoint(cx, cy, rx, ry, start);
    let current = first;
    const commands: string[] = [];
    const segmentCount = Math.max(1, Math.ceil(Math.abs(sweep) / 180));
    const segmentSweep = sweep / segmentCount;
    for (let index = 0; index < segmentCount; index++) {
        const arc = arcPathCommand(current, rx, ry, start + segmentSweep * index, segmentSweep);
        commands.push(arc.command);
        current = arc.end;
    }
    return { move: pointCommand("M", [first]), arcs: commands.join(" "), start: first, end: current };
}

function circularShapeGeometry(
    shapeName: (typeof CIRCULAR_SHAPES)[number],
    options: PptxGenJS.ShapeProps,
    width: number,
    height: number,
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const defaults: Record<"arc" | "pie" | "chord" | "blockArc", readonly [number, number]> = {
        arc: [270, 0],
        pie: [0, 270],
        chord: [45, 270],
        blockArc: [180, 0],
    };
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = width / 2;
    const radiusY = height / 2;
    if (shapeName === "donut") {
        const thickness = Math.min(width, height) / 4;
        const innerX = Math.max(radiusX - thickness, 0.001);
        const innerY = Math.max(radiusY - thickness, 0.001);
        const outer = ellipseArcCommands(centerX, centerY, radiusX, radiusY, 180, 360);
        const inner = ellipseArcCommands(centerX, centerY, innerX, innerY, 180, -360);
        return { kind: "path", data: `${outer.move} ${outer.arcs} Z ${inner.move} ${inner.arcs} Z` };
    }
    if (shapeName === "pieWedge") {
        const arc = ellipseArcCommands(width, height, width, height, 180, 90);
        return { kind: "path", data: `${arc.move} ${arc.arcs} L ${cleanNumber(width)} ${cleanNumber(height)} Z` };
    }
    const defaultRange = defaults[shapeName];
    const range = options.angleRange ?? defaultRange;
    const start = ((range[0] % 360) + 360) % 360;
    const end = ((range[1] % 360) + 360) % 360;
    const sweep = normalizedSweep(start, end);
    const outer = ellipseArcCommands(centerX, centerY, radiusX, radiusY, start, sweep);
    if (shapeName === "arc") {
        const face = `${outer.move} ${outer.arcs} L ${cleanNumber(centerX)} ${cleanNumber(centerY)} Z`;
        const outline = `${outer.move} ${outer.arcs}`;
        return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
    }
    if (shapeName === "pie") {
        return { kind: "path", data: `${outer.move} ${outer.arcs} L ${cleanNumber(centerX)} ${cleanNumber(centerY)} Z` };
    }
    if (shapeName === "chord") return { kind: "path", data: `${outer.move} ${outer.arcs} Z` };

    const ratio = Math.min(1, Math.max(0, options.arcThicknessRatio ?? 0.5));
    const thickness = (Math.min(width, height) * ratio) / 2;
    const innerX = Math.max(radiusX - thickness, 0.001);
    const innerY = Math.max(radiusY - thickness, 0.001);
    const inner = ellipseArcCommands(centerX, centerY, innerX, innerY, end, -sweep);
    return {
        kind: "path",
        data: `${outer.move} ${outer.arcs} L ${cleanNumber(inner.start[0])} ${cleanNumber(inner.start[1])} ${inner.arcs} Z`,
    };
}

function fullEllipsePath(width: number, height: number): string {
    const ellipse = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 180, 360);
    return `${ellipse.move} ${ellipse.arcs} Z`;
}

function compoundShape(face: string, details = ""): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    return {
        kind: "path",
        data: face,
        faces: [{ data: face }],
        outlineData: details ? `${face} ${details}` : face,
    };
}

function braceBracketGeometry(
    shapeName: (typeof BRACE_BRACKET_SHAPES)[number],
    width: number,
    height: number,
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const short = Math.min(width, height);
    if (shapeName === "leftBrace" || shapeName === "rightBrace") {
        const radiusY = Math.min((short * 8333) / 100000, height / 4);
        const path = () => presetArcPath(width / 2, radiusY);
        const outline =
            shapeName === "leftBrace"
                ? path()
                      .move(width, height)
                      .arc(90, 90)
                      .line(width / 2, height / 2 + radiusY)
                      .arc(0, -90)
                      .arc(90, -90)
                      .line(width / 2, radiusY)
                      .arc(180, 90)
                      .data()
                : path()
                      .move(0, 0)
                      .arc(270, 90)
                      .line(width / 2, height / 2 - radiusY)
                      .arc(180, -90)
                      .arc(270, -90)
                      .line(width / 2, height - radiusY)
                      .arc(0, 90)
                      .data();
        const face = `${outline} Z`;
        return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
    }
    if (shapeName === "bracePair") {
        const radius = (short * 8333) / 100000;
        const x2 = radius * 2;
        const x3 = width - x2;
        const x4 = width - radius;
        const path = () => presetArcPath(radius, radius);
        const left = path()
            .move(x2, height)
            .arc(90, 90)
            .line(radius, height / 2 + radius)
            .arc(0, -90)
            .arc(90, -90)
            .line(radius, radius)
            .arc(180, 90)
            .data();
        const right = path()
            .move(x3, 0)
            .arc(270, 90)
            .line(x4, height / 2 - radius)
            .arc(180, -90)
            .arc(270, -90)
            .line(x4, height - radius)
            .arc(0, 90)
            .data();
        const face = path()
            .move(x2, height)
            .arc(90, 90)
            .line(radius, height / 2 + radius)
            .arc(0, -90)
            .arc(90, -90)
            .line(radius, radius)
            .arc(180, 90)
            .line(x3, 0)
            .arc(270, 90)
            .line(x4, height / 2 - radius)
            .arc(180, -90)
            .arc(270, -90)
            .line(x4, height - radius)
            .arc(0, 90)
            .close()
            .data();
        return { kind: "path", data: face, faces: [{ data: face }], outlineData: `${left} ${right}` };
    }
    if (shapeName === "leftBracket" || shapeName === "rightBracket") {
        const radiusY = Math.min((short * 8333) / 100000, height / 2);
        const path = () => presetArcPath(width, radiusY);
        const outline =
            shapeName === "leftBracket"
                ? path().move(width, height).arc(90, 90).line(0, radiusY).arc(180, 90).data()
                : path()
                      .move(0, 0)
                      .arc(270, 90)
                      .line(width, height - radiusY)
                      .arc(0, 90)
                      .data();
        const face = `${outline} Z`;
        return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
    }
    const radius = (short * 16667) / 100000;
    const x2 = width - radius;
    const path = () => presetArcPath(radius, radius);
    const face = path()
        .move(0, radius)
        .arc(180, 90)
        .line(x2, 0)
        .arc(270, 90)
        .line(width, height - radius)
        .arc(0, 90)
        .line(radius, height)
        .arc(90, 90)
        .close()
        .data();
    const leftOutline = path().move(radius, height).arc(90, 90).line(0, radius).arc(180, 90).data();
    const rightOutline = path()
        .move(x2, 0)
        .arc(270, 90)
        .line(width, height - radius)
        .arc(0, 90)
        .data();
    return { kind: "path", data: face, faces: [{ data: face }], outlineData: `${leftOutline} ${rightOutline}` };
}

function ribbonGeometry(width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const rx = width / 32;
    const ry = (height * 16667) / 400000;
    const x2 = width / 4;
    const x3 = x2 + rx;
    const x5 = x2 + width / 8;
    const x4 = x5 - rx;
    const x9 = (width * 3) / 4;
    const x8 = x9 - rx;
    const x6 = x9 - width / 8;
    const x7 = x6 + rx;
    const y1 = (height * 16667) / 200000;
    const y2 = (height * 16667) / 100000;
    const y4 = height - y2;
    const y3 = y4 / 2;
    const y5 = height - ry;
    const y6 = y2 - ry;
    const main = drawingPath()
        .move(0, 0)
        .line(x4, 0)
        .arc(rx, ry, 270, 180)
        .line(x3, y1)
        .arc(rx, ry, 270, -180)
        .line(x8, y2)
        .arc(rx, ry, 90, -180)
        .line(x7, y1)
        .arc(rx, ry, 90, 180)
        .line(width, 0)
        .line((width * 7) / 8, y3)
        .line(width, y4)
        .line(x9, y4)
        .line(x9, y5)
        .arc(rx, ry, 0, 90)
        .line(x3, height)
        .arc(rx, ry, 90, 90)
        .line(x2, y4)
        .line(0, y4)
        .line(width / 8, y3)
        .close()
        .data();
    const dark = drawingPath()
        .move(x5, ry)
        .arc(rx, ry, 0, 90)
        .line(x3, y1)
        .arc(rx, ry, 270, -180)
        .line(x5, y2)
        .close()
        .move(x6, ry)
        .arc(rx, ry, 180, -90)
        .line(x8, y1)
        .arc(rx, ry, 270, 180)
        .line(x6, y2)
        .close()
        .data();
    const details = drawingPath().move(x5, ry).line(x5, y2).move(x6, y2).line(x6, ry).move(x2, y4).line(x2, y6).move(x9, y6).line(x9, y4).data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function ellipseRibbonGeometry(width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const x2 = width / 4;
    const x3 = x2 + width / 8;
    const x4 = width - x3;
    const x5 = width - x2;
    const x6 = (width * 7) / 8;
    const cx1 = x3 / 2;
    const cx2 = width - cx1;
    const cx4 = x2 / 2;
    const cx5 = width - cx4;
    const dy1 = height / 8;
    const f1 = (4 * dy1) / width;
    const bandHeight = height / 4;
    const dy3 = bandHeight - dy1;
    const y1 = f1 * (x3 - (x3 * x3) / width);
    const cy1 = f1 * cx1;
    const q5 = f1 * (x2 - (x2 * x2) / width);
    const y3 = q5 + dy3;
    const cy3 = dy1 + dy3 - y3 + dy1 + dy3;
    const rh = height - bandHeight;
    const y2 = ((dy1 * 14) / 16 + rh) / 2;
    const y5 = q5 + rh;
    const y6 = y3 + rh;
    const cy4 = f1 * cx4 + rh;
    const cy6 = cy3 + rh;
    const y7 = y1 + dy3;
    const cy7 = bandHeight * 2 - y7;
    const main = drawingPath()
        .move(0, 0)
        .quadratic(cx1, cy1, x3, y1)
        .line(x2, y3)
        .quadratic(width / 2, cy3, x5, y3)
        .line(x4, y1)
        .quadratic(cx2, cy1, width, 0)
        .line(x6, y2)
        .line(width, rh)
        .quadratic(cx5, cy4, x5, y5)
        .line(x5, y6)
        .quadratic(width / 2, cy6, x2, y6)
        .line(x2, y5)
        .quadratic(cx4, cy4, 0, rh)
        .line(width / 8, y2)
        .close()
        .data();
    const dark = drawingPath()
        .move(x3, y7)
        .line(x3, y1)
        .line(x2, y3)
        .quadratic(width / 2, cy3, x5, y3)
        .line(x4, y1)
        .line(x4, y7)
        .quadratic(width / 2, cy7, x3, y7)
        .close()
        .data();
    const details = drawingPath().move(x2, y5).line(x2, y3).move(x5, y3).line(x5, y5).move(x3, y1).line(x3, y7).move(x4, y7).line(x4, y1).data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function leftRightRibbonGeometry(width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const short = Math.min(width, height);
    const x1 = Math.min(short / 2, (width * 15) / 32);
    const x4 = width - x1;
    const x2 = (width * 15) / 32;
    const x3 = (width * 17) / 32;
    const ly1 = height / 6;
    const ly2 = (height * 5) / 12;
    const ly3 = (height * 2) / 3;
    const ly4 = (height * 5) / 6;
    const ry1 = height / 6;
    const ry2 = height / 3;
    const ry3 = (height * 7) / 12;
    const ry4 = (height * 5) / 6;
    const rx = width / 32;
    const ry = (short * 16667) / 400000;
    const main = drawingPath()
        .move(0, ly2)
        .line(x1, 0)
        .line(x1, ly1)
        .line(width / 2, ly1)
        .arc(rx, ry, 270, 180)
        .arc(rx, ry, 270, -180)
        .line(x4, ry2)
        .line(x4, ry1)
        .line(width, ry3)
        .line(x4, height)
        .line(x4, ry4)
        .line(width / 2, ry4)
        .arc(rx, ry, 90, 90)
        .line(x2, ly3)
        .line(x1, ly3)
        .line(x1, ly4)
        .close()
        .data();
    const dark = drawingPath()
        .move(x3, ly1 + ry)
        .arc(rx, ry, 0, 90)
        .arc(rx, ry, 270, -180)
        .line(x3, ry2)
        .close()
        .data();
    const details = drawingPath()
        .move(x3, ly1 + ry)
        .line(x3, ry2)
        .move(x2, ry2 - ry)
        .line(x2, ly3)
        .data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function verticalScrollGeometry(width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const curl = Math.min(width, height) / 8;
    const half = curl / 2;
    const quarter = curl / 4;
    const x3 = curl * 1.5;
    const x4 = curl * 2;
    const x6 = width - curl;
    const x7 = width - half;
    const y3 = height - curl;
    const y4 = height - half;
    const main = drawingPath()
        .move(half, height)
        .arc(half, half, 90, -90)
        .line(half, y4)
        .arc(quarter, quarter, 90, -180)
        .line(curl, y3)
        .line(curl, half)
        .arc(half, half, 180, 90)
        .line(x7, 0)
        .arc(half, half, 270, 180)
        .line(x6, curl)
        .line(x6, y4)
        .arc(half, half, 0, 90)
        .close()
        .move(x4, half)
        .arc(half, half, 0, 90)
        .arc(quarter, quarter, 90, 180)
        .close()
        .data();
    const dark = drawingPath()
        .move(x4, half)
        .arc(half, half, 0, 90)
        .arc(quarter, quarter, 90, 180)
        .close()
        .move(curl, y4)
        .arc(half, half, 0, 270)
        .arc(quarter, quarter, 270, 180)
        .close()
        .data();
    const outline = drawingPath()
        .move(curl, y3)
        .line(curl, half)
        .arc(half, half, 180, 90)
        .line(x7, 0)
        .arc(half, half, 270, 180)
        .line(x6, curl)
        .line(x6, y4)
        .arc(half, half, 0, 90)
        .line(half, height)
        .arc(half, half, 90, 180)
        .close()
        .move(x3, 0)
        .arc(half, half, 270, 180)
        .arc(quarter, quarter, 90, 180)
        .line(x4, half)
        .move(x6, curl)
        .line(x3, curl)
        .move(half, y3)
        .arc(quarter, quarter, 270, 180)
        .line(curl, y4)
        .move(half, height)
        .arc(half, half, 90, -90)
        .line(curl, y3)
        .data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: outline,
    };
}

function ribbonScrollGeometry(
    shapeName: (typeof RIBBON_SCROLL_SHAPES)[number],
    width: number,
    height: number,
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    if (shapeName === "ribbon" || shapeName === "ribbon2") {
        const geometry = ribbonGeometry(width, height);
        return shapeName === "ribbon2" ? { ...geometry, transform: `matrix(1 0 0 -1 0 ${cleanNumber(height)})` } : geometry;
    }
    if (shapeName === "ellipseRibbon" || shapeName === "ellipseRibbon2") {
        const geometry = ellipseRibbonGeometry(width, height);
        return shapeName === "ellipseRibbon2" ? { ...geometry, transform: `matrix(1 0 0 -1 0 ${cleanNumber(height)})` } : geometry;
    }
    if (shapeName === "leftRightRibbon") return leftRightRibbonGeometry(width, height);
    if (shapeName === "verticalScroll") return verticalScrollGeometry(width, height);
    return { ...verticalScrollGeometry(height, width), transform: "matrix(0 1 1 0 0 0)" };
}

function actionButtonGeometry(
    shapeName: (typeof ACTION_BUTTON_SHAPES)[number],
    width: number,
    height: number,
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const base = pixelPath([
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
    ]);
    if (shapeName === "actionButtonBlank") {
        return { kind: "path", data: base, faces: [{ data: base }], outlineData: base };
    }
    const short = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const half = (short * 3) / 8;
    const left = cx - half;
    const right = cx + half;
    const top = cy - half;
    const bottom = cy + half;
    let icon = "";
    let details = "";
    const lightFaces: string[] = [];
    const darkFaces: string[] = [];
    const darkLessFaces: string[] = [];
    let iconModifier: "darken" | "darkenLess" = "darken";
    if (shapeName === "actionButtonBackPrevious" || shapeName === "actionButtonForwardNext") {
        icon =
            shapeName === "actionButtonBackPrevious"
                ? pixelPath([
                      [left, cy],
                      [right, top],
                      [right, bottom],
                  ])
                : pixelPath([
                      [right, cy],
                      [left, bottom],
                      [left, top],
                  ]);
    } else if (shapeName === "actionButtonBeginning" || shapeName === "actionButtonEnd") {
        const bar = (short * 3) / 32;
        if (shapeName === "actionButtonBeginning") {
            icon = `${pixelPath([
                [left + (short * 3) / 16, cy],
                [right, top],
                [right, bottom],
            ])} ${pixelPath([
                [left, top],
                [left + bar, top],
                [left + bar, bottom],
                [left, bottom],
            ])}`;
        } else {
            icon = `${pixelPath([
                [right - (short * 3) / 16, cy],
                [left, bottom],
                [left, top],
            ])} ${pixelPath([
                [right - bar, top],
                [right, top],
                [right, bottom],
                [right - bar, bottom],
            ])}`;
        }
    } else if (shapeName === "actionButtonDocument") {
        const fold = (short * 3) / 16;
        const documentLeft = cx - (short * 9) / 32;
        const documentRight = cx + (short * 9) / 32;
        const document = pixelPath([
            [documentLeft, top],
            [documentRight - fold, top],
            [documentRight, top + fold],
            [documentRight, bottom],
            [documentLeft, bottom],
        ]);
        const corner = pixelPath([
            [documentRight - fold, top],
            [documentRight - fold, top + fold],
            [documentRight, top + fold],
        ]);
        icon = document;
        details = corner;
        iconModifier = "darkenLess";
        darkFaces.push(corner);
    } else if (shapeName === "actionButtonHome") {
        const unit = (short * 3) / 4;
        const g24 = top + unit / 16;
        const g25 = top + (unit * 3) / 16;
        const g26 = top + (unit * 5) / 16;
        const g27 = top + (unit * 3) / 4;
        const g28 = left + unit / 8;
        const g29 = left + (unit * 7) / 16;
        const g30 = left + (unit * 9) / 16;
        const g31 = left + (unit * 11) / 16;
        const g32 = left + (unit * 13) / 16;
        const g33 = left + (unit * 7) / 8;
        const homeOutline = pixelPath([
            [cx, top],
            [left, cy],
            [g28, cy],
            [g28, bottom],
            [g33, bottom],
            [g33, cy],
            [right, cy],
            [g32, g26],
            [g32, g24],
            [g31, g24],
            [g31, g25],
        ]);
        const chimney = pixelPath([
            [g32, g26],
            [g32, g24],
            [g31, g24],
            [g31, g25],
        ]);
        const body = pixelPath([
            [g28, cy],
            [g28, bottom],
            [g29, bottom],
            [g29, g27],
            [g30, g27],
            [g30, bottom],
            [g33, bottom],
            [g33, cy],
        ]);
        const roof = pixelPath([
            [cx, top],
            [left, cy],
            [right, cy],
        ]);
        const door = pixelPath([
            [g29, g27],
            [g30, g27],
            [g30, bottom],
            [g29, bottom],
        ]);
        icon = "";
        details = `${homeOutline} ${drawingPath().move(g31, g25).line(g32, g26).move(g33, cy).line(g28, cy).move(g29, bottom).line(g29, g27).line(g30, g27).line(g30, bottom).data()}`;
        darkLessFaces.push(chimney, body);
        darkFaces.push(roof, door);
    } else if (shapeName === "actionButtonInformation") {
        const circle = ellipseArcCommands(cx, cy, half, half, 270, 360);
        icon = `${circle.move} ${circle.arcs} Z`;
        const dotRadius = (short * 9) / 128;
        const dot = ellipseArcCommands(cx, top + (short * 3) / 128 + dotRadius, dotRadius, dotRadius, 270, 360);
        const stemLeft = left + (short * 15) / 64;
        const stemInnerLeft = left + (short * 39) / 128;
        const stemInnerRight = left + (short * 57) / 128;
        const stemRight = left + (short * 33) / 64;
        const y28 = top + (short * 15) / 64;
        const y29 = top + (short * 9) / 32;
        const y30 = top + (short * 39) / 64;
        const y31 = top + (short * 21) / 32;
        const stem = pixelPath([
            [stemLeft, y28],
            [stemInnerRight, y28],
            [stemInnerRight, y30],
            [stemRight, y30],
            [stemRight, y31],
            [stemLeft, y31],
            [stemLeft, y30],
            [stemInnerLeft, y30],
            [stemInnerLeft, y29],
            [stemLeft, y29],
        ]);
        lightFaces.push(`${dot.move} ${dot.arcs} Z ${stem}`);
        details = lightFaces[0]!;
    } else if (shapeName === "actionButtonHelp") {
        const g13 = (short * 3) / 4;
        const g14 = g13 / 7;
        const g15 = (g13 * 3) / 14;
        const g16 = (g13 * 2) / 7;
        const g19 = (g13 * 3) / 7;
        const g20 = (g13 * 4) / 7;
        const g21 = (g13 * 17) / 28;
        const g23 = (g13 * 21) / 28;
        const g24 = (g13 * 11) / 14;
        const g27 = top + g16;
        const g29 = top + g21;
        const g30 = top + g23;
        const g31 = top + g24;
        const g33 = left + g15;
        const g36 = left + g19;
        const g37 = left + g20;
        const g41 = g13 / 14;
        const g42 = (g13 * 3) / 28;
        const question = drawingPath()
            .move(g33, g27)
            .arc(g16, g16, 180, 180)
            .arc(g14, g15, 0, 90)
            .arc(g41, g42, 270, -90)
            .line(g37, g30)
            .line(g36, g30)
            .line(g36, g29)
            .arc(g14, g15, 180, 90)
            .arc(g41, g42, 90, -90)
            .arc(g14, g14, 0, -180)
            .close()
            .data();
        const dot = ellipseArcCommands(cx, g31 + g42, g42, g42, 270, 360);
        icon = `${question} ${dot.move} ${dot.arcs} Z`;
    } else if (shapeName === "actionButtonMovie") {
        const g13 = (short * 3) / 4;
        const gx = (value: number) => left + (g13 * value) / 21600;
        const gy = (value: number) => top + (g13 * value) / 21600;
        icon = pixelPath([
            [left, gy(5280)],
            [left, gy(9555)],
            [gx(1455), gy(9555)],
            [gx(1905), gy(9067)],
            [gx(2325), gy(9067)],
            [gx(2325), gy(15592)],
            [gx(17010), gy(15592)],
            [gx(17010), gy(13342)],
            [gx(19335), gy(13342)],
            [gx(20595), gy(14580)],
            [right, gy(14580)],
            [right, gy(6630)],
            [gx(20595), gy(6630)],
            [gx(19725), gy(7492)],
            [gx(17010), gy(7492)],
            [gx(17010), gy(6630)],
            [gx(16155), gy(5730)],
            [gx(1905), gy(5730)],
            [gx(1455), gy(5280)],
        ]);
    } else if (shapeName === "actionButtonReturn") {
        const g13 = (short * 3) / 4;
        const g14 = (g13 * 7) / 8;
        const g15 = (g13 * 3) / 4;
        const g16 = (g13 * 5) / 8;
        const g17 = (g13 * 3) / 8;
        const g18 = g13 / 4;
        const radius = g13 / 8;
        const g19 = top + g15;
        const g20 = top + g16;
        const g21 = top + g18;
        const g22 = left + g14;
        const g23 = left + g15;
        const g24 = left + g16;
        const g25 = left + g17;
        const g26 = left + g18;
        icon = drawingPath()
            .move(right, g21)
            .line(g23, top)
            .line(cx, g21)
            .line(g24, g21)
            .line(g24, g20)
            .arc(radius, radius, 0, 90)
            .line(g25, g19)
            .arc(radius, radius, 90, 90)
            .line(g26, g21)
            .line(left, g21)
            .line(left, g20)
            .arc(g17, g17, 180, -90)
            .line(cx, bottom)
            .arc(g17, g17, 90, -90)
            .line(g22, g21)
            .close()
            .data();
    } else {
        const g13 = (short * 3) / 4;
        const g20 = top + g13 / 8;
        const g21 = top + (g13 * 5) / 16;
        const g22 = top + (g13 * 11) / 16;
        const g23 = top + (g13 * 7) / 8;
        const g24 = left + (g13 * 5) / 16;
        const g25 = left + (g13 * 5) / 8;
        const g26 = left + (g13 * 3) / 4;
        icon = pixelPath([
            [left, g21],
            [left, g22],
            [g24, g22],
            [g25, bottom],
            [g25, top],
            [g24, g21],
        ]);
        details = drawingPath().move(g26, g21).line(right, g20).move(g26, cy).line(right, cy).move(g26, g22).line(right, g23).data();
    }
    const faces: Array<{ data: string; fillModifier?: "darken" | "darkenLess" | "lighten" }> = [{ data: base }];
    if (icon) faces.push({ data: icon, fillModifier: iconModifier });
    for (const darkLess of darkLessFaces) faces.push({ data: darkLess, fillModifier: "darkenLess" });
    for (const dark of darkFaces) faces.push({ data: dark, fillModifier: "darken" });
    for (const light of lightFaces) faces.push({ data: light, fillModifier: "lighten" });
    return { kind: "path", data: `${base} ${icon}`, faces, outlineData: `${base} ${icon} ${details}` };
}

function ellipsePath(centerX: number, centerY: number, radiusX: number, radiusY: number, sweep = 360): string {
    const ellipse = ellipseArcCommands(centerX, centerY, radiusX, radiusY, 180, sweep);
    return `${ellipse.move} ${ellipse.arcs} Z`;
}

function symbolGeometry(shapeName: (typeof SYMBOL_SHAPES)[number], width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const short = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    if (shapeName === "plus") {
        const arm = short / 4;
        return {
            kind: "path",
            data: pixelPath([
                [0, arm],
                [arm, arm],
                [arm, 0],
                [width - arm, 0],
                [width - arm, arm],
                [width, arm],
                [width, height - arm],
                [width - arm, height - arm],
                [width - arm, height],
                [arm, height],
                [arm, height - arm],
                [0, height - arm],
            ]),
        };
    }
    if (shapeName === "mathPlus") {
        const extentX = (width * 73490) / 200000;
        const extentY = (height * 73490) / 200000;
        const halfThickness = (short * 23520) / 200000;
        return {
            kind: "path",
            data: pixelPath([
                [cx - extentX, cy - halfThickness],
                [cx - halfThickness, cy - halfThickness],
                [cx - halfThickness, cy - extentY],
                [cx + halfThickness, cy - extentY],
                [cx + halfThickness, cy - halfThickness],
                [cx + extentX, cy - halfThickness],
                [cx + extentX, cy + halfThickness],
                [cx + halfThickness, cy + halfThickness],
                [cx + halfThickness, cy + extentY],
                [cx - halfThickness, cy + extentY],
                [cx - halfThickness, cy + halfThickness],
                [cx - extentX, cy + halfThickness],
            ]),
        };
    }
    const extentX = (width * 73490) / 200000;
    const x1 = cx - extentX;
    const x8 = cx + extentX;
    if (shapeName === "mathMinus") {
        const halfThickness = (height * 23520) / 200000;
        return {
            kind: "path",
            data: pixelPath([
                [x1, cy - halfThickness],
                [x8, cy - halfThickness],
                [x8, cy + halfThickness],
                [x1, cy + halfThickness],
            ]),
        };
    }
    if (shapeName === "mathEqual") {
        const thickness = (height * 23520) / 100000;
        const halfGap = (height * 11760) / 200000;
        return {
            kind: "path",
            data: `${pixelPath([
                [x1, cy - halfGap - thickness],
                [x8, cy - halfGap - thickness],
                [x8, cy - halfGap],
                [x1, cy - halfGap],
            ])} ${pixelPath([
                [x1, cy + halfGap],
                [x8, cy + halfGap],
                [x8, cy + halfGap + thickness],
                [x1, cy + halfGap + thickness],
            ])}`,
        };
    }
    if (shapeName === "mathDivide") {
        const halfThickness = (height * 23520) / 200000;
        // LibreOffice renders the pinned PptxGenJS preset's dot gap at half
        // the ECMA guide value (4.23px rather than 8.47px at 144px high).
        const gap = (height * 5880) / 200000;
        const radius = (height * 11760) / 100000;
        const bar = pixelPath([
            [x1, cy - halfThickness],
            [x8, cy - halfThickness],
            [x8, cy + halfThickness],
            [x1, cy + halfThickness],
        ]);
        return {
            kind: "path",
            data: `${ellipsePath(cx, cy - halfThickness - gap - radius, radius, radius)} ${ellipsePath(cx, cy + halfThickness + gap + radius, radius, radius)} ${bar}`,
        };
    }
    if (shapeName === "mathMultiply") {
        const diagonal = Math.hypot(width, height);
        const sin = height / diagonal;
        const cos = width / diagonal;
        const thickness = (short * 23520) / 100000;
        const middleLength = diagonal * (1 - 51965 / 100000);
        const xM = (cos * middleLength) / 2;
        const yM = (sin * middleLength) / 2;
        const dx = (sin * thickness) / 2;
        const dy = (cos * thickness) / 2;
        const xA = xM - dx;
        const yA = yM + dy;
        const xB = xM + dx;
        const yB = yM - dy;
        const yC = ((cx - xB) * height) / width + yB;
        const xD = width - xB;
        const xE = width - xA;
        const xOffset = ((cy - yA) * width) / height;
        const xF = xE - xOffset;
        const xL = xA + xOffset;
        return {
            kind: "path",
            data: pixelPath([
                [xA, yA],
                [xB, yB],
                [cx, yC],
                [xD, yB],
                [xE, yA],
                [xF, cy],
                [xE, height - yA],
                [xD, height - yB],
                [cx, height - yC],
                [xB, height - yB],
                [xA, height - yA],
                [xL, cy],
            ]),
        };
    }
    if (shapeName === "mathNotEqual") {
        const thickness = (height * 23520) / 100000;
        const halfGap = (height * 11760) / 200000;
        const y2 = cy - halfGap;
        const y3 = cy + halfGap;
        const yTop = y2 - thickness;
        const yBottom = y3 + thickness;
        const xAdj = (height / 2) * Math.tan((20 * Math.PI) / 180);
        const length = Math.hypot(xAdj, height / 2);
        const slashWidth = (length * thickness) / (height / 2);
        const x7 = cx + xAdj - slashWidth / 2;
        const atY = (y: number) => x7 - (xAdj * y) / (height / 2);
        const x6 = atY(yTop);
        const x5 = atY(y2);
        const x4 = atY(y3);
        const x3 = atY(yBottom);
        const rx = (x: number) => x + slashWidth;
        const dx7 = (thickness * (height / 2)) / length;
        const topRight = x7 + dx7;
        const bottomLeft = width - x7;
        const bottomRight = width - topRight;
        return {
            kind: "path",
            data: pixelPath([
                [x1, yTop],
                [x6, yTop],
                [x7, 0],
                [topRight, (thickness * xAdj) / length],
                [rx(x6), yTop],
                [x8, yTop],
                [x8, y2],
                [rx(x5), y2],
                [rx(x4), y3],
                [x8, y3],
                [x8, yBottom],
                [rx(x3), yBottom],
                [bottomLeft, height],
                [bottomRight, height - (thickness * xAdj) / length],
                [x3, yBottom],
                [x1, yBottom],
                [x1, y3],
                [x4, y3],
                [x5, y2],
                [x1, y2],
            ]),
        };
    }
    if (shapeName === "heart") {
        const xLeftOuter = cx - (width * 49) / 48;
        const xLeftInner = cx - (width * 10) / 48;
        const xRightInner = cx + (width * 10) / 48;
        const xRightOuter = cx + (width * 49) / 48;
        return {
            kind: "path",
            data: drawingPath()
                .move(cx, height / 4)
                .cubic(xRightInner, -height / 3, xRightOuter, height / 4, cx, height)
                .cubic(xLeftOuter, height / 4, xLeftInner, -height / 3, cx, height / 4)
                .close()
                .data(),
        };
    }
    if (shapeName === "lightningBolt") {
        const points = [
            [8472, 0],
            [12860, 6080],
            [11050, 6797],
            [16577, 12007],
            [14767, 12877],
            [21600, 21600],
            [10012, 14915],
            [12222, 13987],
            [5022, 9705],
            [7602, 8382],
            [0, 3890],
        ] as const;
        return { kind: "path", data: pixelPath(points.map(([x, y]) => [(x * width) / 21600, (y * height) / 21600])) };
    }
    if (shapeName === "sun") {
        const a = 25000;
        const g0 = 50000 - a;
        const g1 = (g0 * 30274) / 32768;
        const g2 = (g0 * 12540) / 32768;
        const g5 = 50000 - g1;
        const g6 = 50000 - g2;
        const g7 = (g0 * 23170) / 32768;
        const values = {
            g8: 50000 + g7,
            g9: 50000 - g7,
            g10: (g5 * 3) / 4,
            g12: (g5 * 3) / 4 + 3662,
            g13: (g6 * 3) / 4 + 3662,
            g14: (g6 * 3) / 4 + 12500,
        };
        const g15 = 100000 - values.g10;
        const g16 = 100000 - values.g12;
        const g17 = 100000 - values.g13;
        const g18 = 100000 - values.g14;
        const px = (n: number) => (width * n) / 100000;
        const py = (n: number) => (height * n) / 100000;
        const ray = (points: PixelPoint[]) => pixelPath(points);
        const rays = [
            ray([
                [width, cy],
                [px(g15), py(g18)],
                [px(g15), py(values.g14)],
            ]),
            ray([
                [(width * 18436) / 21600, (height * 3163) / 21600],
                [px(g16), py(values.g13)],
                [px(g17), py(values.g12)],
            ]),
            ray([
                [cx, 0],
                [px(g18), py(values.g10)],
                [px(values.g14), py(values.g10)],
            ]),
            ray([
                [(width * 3163) / 21600, (height * 3163) / 21600],
                [px(values.g13), py(values.g12)],
                [px(values.g12), py(values.g13)],
            ]),
            ray([
                [0, cy],
                [px(values.g10), py(values.g14)],
                [px(values.g10), py(g18)],
            ]),
            ray([
                [(width * 3163) / 21600, (height * 18436) / 21600],
                [px(values.g12), py(g17)],
                [px(values.g13), py(g16)],
            ]),
            ray([
                [cx, height],
                [px(values.g14), py(g15)],
                [px(g18), py(g15)],
            ]),
            ray([
                [(width * 18436) / 21600, (height * 18436) / 21600],
                [px(g17), py(g16)],
                [px(g16), py(g17)],
            ]),
        ].join(" ");
        const center = ellipsePath(cx, cy, (width * g0) / 100000, (height * g0) / 100000);
        return { kind: "path", data: `${rays} ${center}` };
    }
    if (shapeName === "smileyFace") {
        const face = ellipsePath(cx, cy, width / 2, height / 2);
        const eyeY = (height * 7570) / 21600;
        const eyeRX = (width * 1125) / 21600;
        const eyeRY = (height * 1125) / 21600;
        // DrawingML's eye X coordinates are the left edges of the ellipses,
        // not their centers. Including the radius centers the pair at 10800.
        const eyeX1 = (width * (6215 + 1125)) / 21600;
        const eyeX2 = (width * (13135 + 1125)) / 21600;
        const eyes = `${ellipsePath(eyeX1, eyeY, eyeRX, eyeRY)} ${ellipsePath(eyeX2, eyeY, eyeRX, eyeRY)}`;
        const y3 = (height * 16515) / 21600;
        const dy2 = (height * 4653) / 100000;
        const y2 = y3 - dy2;
        const y5 = y3 + dy2 + (height * 4653) / 50000;
        const smile = drawingPath()
            .move((width * 4969) / 21699, y2)
            .quadratic(cx, y5, (width * 16640) / 21600, y2)
            .data();
        return {
            kind: "path",
            data: `${face} ${eyes}`,
            faces: [{ data: face }, { data: eyes, fillModifier: "darkenLess" }],
            outlineData: `${face} ${eyes} ${smile}`,
        };
    }
    if (shapeName === "noSmoking") {
        const inset = (short * 18750) / 100000;
        const outer = ellipsePath(cx, cy, width / 2, height / 2);
        const innerX = Math.max(width / 2 - inset, 0.001);
        const innerY = Math.max(height / 2 - inset, 0.001);
        const diagonalAngle = Math.atan2(height, width);
        // These are the DrawingML preset's polar intersection calculations.
        // Its two reverse inner arcs leave their closing chords as the slash,
        // producing a single compound contour without overlapping outlines.
        const ellipseRadius = (innerX * innerY) / Math.hypot(innerY * Math.cos(diagonalAngle), innerX * Math.sin(diagonalAngle));
        const angleInset = Math.atan2(inset / 2, ellipseRadius);
        const startAngle = diagonalAngle - angleInset;
        const sweep = -Math.PI + 2 * angleInset;
        const startRadius = (innerX * innerY) / Math.hypot(innerY * Math.cos(startAngle), innerX * Math.sin(startAngle));
        const dx = startRadius * Math.cos(startAngle);
        const dy = startRadius * Math.sin(startAngle);
        const first: PixelPoint = [cx + dx, cy + dy];
        const second: PixelPoint = [cx - dx, cy - dy];
        const degrees = 180 / Math.PI;
        const firstArc = arcPathCommand(first, innerX, innerY, startAngle * degrees, sweep * degrees);
        const secondArc = arcPathCommand(second, innerX, innerY, startAngle * degrees - 180, sweep * degrees);
        return { kind: "path", data: `${outer} ${pointCommand("M", [first])} ${firstArc.command} Z ${pointCommand("M", [second])} ${secondArc.command} Z` };
    }
    const innerRadiusX = width * 1.25;
    const innerRadiusY = height * 0.625;
    const innerStart = (Math.atan2(-height / 2, -width * 0.75) * 180) / Math.PI;
    const innerEnd = (Math.atan2(height / 2, -width * 0.75) * 180) / Math.PI - 360;
    return {
        kind: "path",
        data: drawingPath()
            .move(width, height)
            .arc(width, height / 2, 90, 180)
            .arc(innerRadiusX, innerRadiusY, innerStart, innerEnd - innerStart)
            .close()
            .data(),
    };
}

function basicFlowchartGeometry(shapeName: (typeof FLOWCHART_SHAPES)[number], width: number, height: number): NormalizedShape["geometry"] | undefined {
    if (shapeName === "flowChartProcess") return { kind: "rect", radius: 0 };
    if (shapeName === "flowChartAlternateProcess") return { kind: "rect", radius: Math.min(width, height) / 6 };
    if (shapeName === "flowChartConnector") return { kind: "ellipse" };
    if (shapeName === "flowChartDecision")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0.5],
                    [0.5, 0],
                    [1, 0.5],
                    [0.5, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartCollate")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0],
                    [1, 0],
                    [0.5, 0.5],
                    [1, 1],
                    [0, 1],
                    [0.5, 0.5],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartExtract")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 1],
                    [0.5, 0],
                    [1, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartMerge")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0],
                    [1, 0],
                    [0.5, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartInputOutput")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 1],
                    [0.2, 0],
                    [1, 0],
                    [0.8, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartManualInput")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0.2],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartManualOperation")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0],
                    [1, 0],
                    [0.8, 1],
                    [0.2, 1],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartOffpageConnector")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0],
                    [1, 0],
                    [1, 0.8],
                    [0.5, 1],
                    [0, 0.8],
                ],
                width,
                height,
            ),
        };
    if (shapeName === "flowChartPreparation")
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0.5],
                    [0.2, 0],
                    [0.8, 0],
                    [1, 0.5],
                    [0.8, 1],
                    [0.2, 1],
                ],
                width,
                height,
            ),
        };
    return undefined;
}

function flowchartGeometry(shapeName: (typeof FLOWCHART_SHAPES)[number], width: number, height: number): NormalizedShape["geometry"] {
    const basic = basicFlowchartGeometry(shapeName, width, height);
    if (basic) return basic;
    if (shapeName === "flowChartDelay") {
        const arc = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 270, 180);
        return { kind: "path", data: `M 0 0 L ${cleanNumber(width / 2)} 0 ${arc.arcs} L 0 ${cleanNumber(height)} Z` };
    }
    if (shapeName === "flowChartDisplay") {
        const arc = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 270, 180);
        return {
            kind: "path",
            data: `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width / 6)} 0 L ${cleanNumber((width * 5) / 6)} 0 ${arc.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} Z`,
        };
    }
    if (shapeName === "flowChartTerminator") {
        const radiusX = (width * 3475) / 21600;
        const rightArc = ellipseArcCommands(width - radiusX, height / 2, radiusX, height / 2, 270, 180);
        const leftArc = ellipseArcCommands(radiusX, height / 2, radiusX, height / 2, 90, 180);
        return {
            kind: "path",
            data: `M ${cleanNumber(radiusX)} 0 L ${cleanNumber(width - radiusX)} 0 ${rightArc.arcs} L ${cleanNumber(radiusX)} ${cleanNumber(height)} ${leftArc.arcs} Z`,
        };
    }
    if (shapeName === "flowChartDocument") {
        const y1 = (height * 17322) / 21600;
        return {
            kind: "path",
            data: `M 0 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${cleanNumber(y1)} C ${cleanNumber(width / 2)} ${cleanNumber(y1)} ${cleanNumber(width / 2)} ${cleanNumber((height * 23922) / 21600)} 0 ${cleanNumber((height * 20172) / 21600)} Z`,
        };
    }
    if (shapeName === "flowChartMagneticDisk") {
        const top = ellipseArcCommands(width / 2, height / 6, width / 2, height / 6, 180, 180);
        const bottom = ellipseArcCommands(width / 2, (height * 5) / 6, width / 2, height / 6, 0, 180);
        const face = `${top.move} ${top.arcs} L ${cleanNumber(width)} ${cleanNumber((height * 5) / 6)} ${bottom.arcs} Z`;
        const inner = ellipseArcCommands(width / 2, height / 6, width / 2, height / 6, 0, 180);
        return compoundShape(face, `${inner.move} ${inner.arcs}`);
    }
    if (shapeName === "flowChartMagneticDrum") {
        const right = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 270, 180);
        const left = ellipseArcCommands(width / 6, height / 2, width / 6, height / 2, 90, 180);
        const face = `M ${cleanNumber(width / 6)} 0 L ${cleanNumber((width * 5) / 6)} 0 ${right.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} ${left.arcs} Z`;
        const inner = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 90, 180);
        return compoundShape(face, `${inner.move} ${inner.arcs}`);
    }
    if (shapeName === "flowChartOnlineStorage") {
        const concave = ellipseArcCommands(width, height / 2, width / 6, height / 2, 270, -180);
        const left = ellipseArcCommands(width / 6, height / 2, width / 6, height / 2, 90, 180);
        return {
            kind: "path",
            data: `M ${cleanNumber(width / 6)} 0 L ${cleanNumber(width)} 0 ${concave.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} ${left.arcs} Z`,
        };
    }
    if (shapeName === "flowChartOfflineStorage") {
        const face = polygonPath(
            [
                [0, 0],
                [1, 0],
                [0.5, 1],
            ],
            width,
            height,
        );
        return compoundShape(
            face,
            `M ${cleanNumber((width * 2) / 5)} ${cleanNumber((height * 4) / 5)} L ${cleanNumber((width * 3) / 5)} ${cleanNumber((height * 4) / 5)}`,
        );
    }
    if (shapeName === "flowChartPunchedCard") {
        return {
            kind: "path",
            data: polygonPath(
                [
                    [0, 0.2],
                    [0.2, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                ],
                width,
                height,
            ),
        };
    }
    if (shapeName === "flowChartPunchedTape") {
        const topLeft = ellipseArcCommands(width / 4, height / 10, width / 4, height / 10, 180, -180);
        const topRight = ellipseArcCommands((width * 3) / 4, height / 10, width / 4, height / 10, 180, 180);
        const bottomRight = ellipseArcCommands((width * 3) / 4, (height * 9) / 10, width / 4, height / 10, 0, -180);
        const bottomLeft = ellipseArcCommands(width / 4, (height * 9) / 10, width / 4, height / 10, 0, 180);
        return {
            kind: "path",
            data: `${topLeft.move} ${topLeft.arcs} ${topRight.arcs} L ${cleanNumber(width)} ${cleanNumber((height * 9) / 10)} ${bottomRight.arcs} ${bottomLeft.arcs} Z`,
        };
    }
    if (shapeName === "flowChartMagneticTape") {
        const quarter1 = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 90, 90);
        const quarter2 = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 180, 90);
        const quarter3 = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 270, 90);
        const tailAngle = (Math.atan2(height, width) * 180) / Math.PI;
        const tailArc = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 0, tailAngle);
        const innerBottom = height / 2 + (height / 2) * Math.SQRT1_2;
        return {
            kind: "path",
            data: `${quarter1.move} ${quarter1.arcs} ${quarter2.arcs} ${quarter3.arcs} ${tailArc.arcs} L ${cleanNumber(width)} ${cleanNumber(innerBottom)} L ${cleanNumber(width)} ${cleanNumber(height)} Z`,
        };
    }
    if (shapeName === "flowChartMultidocument") {
        const x = (value: number) => cleanNumber((width * value) / 21600);
        const y = (value: number) => cleanNumber((height * value) / 21600);
        const face = [
            `M 0 ${y(20782)} C ${x(9298)} ${y(23542)} ${x(9298)} ${y(18022)} ${x(18595)} ${y(18022)} L ${x(18595)} ${y(3675)} L 0 ${y(3675)} Z`,
            `M ${x(1532)} ${y(3675)} L ${x(1532)} ${y(1815)} L ${x(20000)} ${y(1815)} L ${x(20000)} ${y(16252)} C ${x(19298)} ${y(16252)} ${x(18595)} ${y(16352)} ${x(18595)} ${y(16352)} L ${x(18595)} ${y(3675)} Z`,
            `M ${x(2972)} ${y(1815)} L ${x(2972)} 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${y(14392)} C ${x(20800)} ${y(14392)} ${x(20000)} ${y(14467)} ${x(20000)} ${y(14467)} L ${x(20000)} ${y(1815)} Z`,
        ].join(" ");
        const outline = [
            `M 0 ${y(3675)} L ${x(18595)} ${y(3675)} L ${x(18595)} ${y(18022)} C ${x(9298)} ${y(18022)} ${x(9298)} ${y(23542)} 0 ${y(20782)} Z`,
            `M ${x(1532)} ${y(3675)} L ${x(1532)} ${y(1815)} L ${x(20000)} ${y(1815)} L ${x(20000)} ${y(16252)} C ${x(19298)} ${y(16252)} ${x(18595)} ${y(16352)} ${x(18595)} ${y(16352)}`,
            `M ${x(2972)} ${y(1815)} L ${x(2972)} 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${y(14392)} C ${x(20800)} ${y(14392)} ${x(20000)} ${y(14467)} ${x(20000)} ${y(14467)}`,
        ].join(" ");
        return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
    }

    const rectangle = `M 0 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${cleanNumber(height)} L 0 ${cleanNumber(height)} Z`;
    if (shapeName === "flowChartInternalStorage") {
        return compoundShape(
            rectangle,
            `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 8)} L ${cleanNumber(width)} ${cleanNumber(height / 8)}`,
        );
    }
    if (shapeName === "flowChartPredefinedProcess") {
        return compoundShape(
            rectangle,
            `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M ${cleanNumber((width * 7) / 8)} 0 L ${cleanNumber((width * 7) / 8)} ${cleanNumber(height)}`,
        );
    }
    if (shapeName === "flowChartSort") {
        const diamond = polygonPath(
            [
                [0, 0.5],
                [0.5, 0],
                [1, 0.5],
                [0.5, 1],
            ],
            width,
            height,
        );
        return compoundShape(diamond, `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`);
    }
    const ellipse = fullEllipsePath(width, height);
    if (shapeName === "flowChartOr") {
        return compoundShape(
            ellipse,
            `M ${cleanNumber(width / 2)} 0 L ${cleanNumber(width / 2)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`,
        );
    }
    const insetX = (width / 2) * Math.SQRT1_2;
    const insetY = (height / 2) * Math.SQRT1_2;
    return compoundShape(
        ellipse,
        `M ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 + insetY)} M ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 + insetY)}`,
    );
}

function swooshArrowPath(width: number, height: number): string {
    const short = Math.min(width, height);
    const ad1 = height / 4;
    const ad2 = short * 0.16667;
    const xB = width - ad2;
    const yB = short / 8;
    const tangent = Math.tan(Math.PI / 28);
    const xC = xB - yB * tangent;
    const yF = yB + ad1;
    const xF = xB + ad1 * tangent;
    const xE = xF + yB * tangent;
    const yE = yF + yB;
    const yD = yE / 2 - height / 20;
    return [
        pointCommand("M", [[0, height]]),
        pointCommand("Q", [
            [width / 6, height / 3],
            [xB, yB],
        ]),
        pointCommand("L", [[xC, 0]]),
        pointCommand("L", [[width, yD]]),
        pointCommand("L", [[xE, yE]]),
        pointCommand("L", [[xF, yF]]),
        pointCommand("Q", [
            [width / 4, yF + height / 12],
            [0, height],
        ]),
        "Z",
    ].join(" ");
}

function arrowPath(shapeName: string, width: number, height: number): string | undefined {
    if (shapeName === "rightArrow") return pixelPath(rightArrowPoints(width, height));
    if (shapeName === "leftArrow") return pixelPath(rotateRightArrow(width, height, "left"));
    if (shapeName === "upArrow") return pixelPath(rotateRightArrow(width, height, "up"));
    if (shapeName === "downArrow") return pixelPath(rotateRightArrow(width, height, "down"));
    if (shapeName === "leftRightArrow") return pixelPath(leftRightArrowPoints(width, height));
    if (shapeName === "upDownArrow") {
        const source = leftRightArrowPoints(height, width);
        return pixelPath(source.map(([x, y]) => [y, height - x]));
    }
    if (shapeName === "quadArrow") return pixelPath(quadArrowPoints(width, height));
    if (shapeName === "leftRightUpArrow") return pixelPath(quadArrowPoints(width, height, false));
    if (shapeName === "leftUpArrow") return pixelPath(leftUpArrowPoints(width, height));
    if (shapeName === "bentUpArrow") return pixelPath(bentUpArrowPoints(width, height));
    if (shapeName === "bentArrow") return bentArrowPath(width, height);
    if (shapeName === "uturnArrow") return uturnArrowPath(width, height);
    if (shapeName === "swooshArrow") return swooshArrowPath(width, height);
    if (shapeName === "notchedRightArrow") {
        const head = Math.min(width, height) / 2;
        const base = width - head;
        return pixelPath([
            [0, height / 4],
            [base, height / 4],
            [base, 0],
            [width, height / 2],
            [base, height],
            [base, (height * 3) / 4],
            [0, (height * 3) / 4],
            [height / 4, height / 2],
        ]);
    }
    if (shapeName === "stripedRightArrow") {
        const short = Math.min(width, height);
        const y1 = height / 4;
        const y2 = (height * 3) / 4;
        const stripe1 = pixelPath([
            [0, y1],
            [short / 32, y1],
            [short / 32, y2],
            [0, y2],
        ]);
        const stripe2 = pixelPath([
            [short / 16, y1],
            [short / 8, y1],
            [short / 8, y2],
            [short / 16, y2],
        ]);
        const headBase = width - short / 2;
        const arrow = pixelPath([
            [(short * 5) / 32, y1],
            [headBase, y1],
            [headBase, 0],
            [width, height / 2],
            [headBase, height],
            [headBase, y2],
            [(short * 5) / 32, y2],
        ]);
        return `${stripe1} ${stripe2} ${arrow}`;
    }
    if (shapeName === "rightArrowCallout") return pixelPath(rightCalloutPoints(width, height));
    if (shapeName === "leftArrowCallout") return pixelPath(rotateRightCallout(width, height, "left"));
    if (shapeName === "upArrowCallout") return pixelPath(rotateRightCallout(width, height, "up"));
    if (shapeName === "downArrowCallout") return pixelPath(rotateRightCallout(width, height, "down"));
    if (shapeName === "leftRightArrowCallout") return pixelPath(leftRightCalloutPoints(width, height));
    if (shapeName === "upDownArrowCallout") {
        const source = leftRightCalloutPoints(height, width);
        return pixelPath(source.map(([x, y]) => [y, height - x]));
    }
    if (shapeName === "quadArrowCallout") return pixelPath(quadCalloutPoints(width, height));
    return undefined;
}

function presetPath(shapeName: string, width: number, height: number): string | undefined {
    if (shapeName === "triangle")
        return polygonPath(
            [
                [0.5, 0],
                [1, 1],
                [0, 1],
            ],
            width,
            height,
        );
    if (shapeName === "rtTriangle")
        return polygonPath(
            [
                [0, 0],
                [1, 1],
                [0, 1],
            ],
            width,
            height,
        );
    if (shapeName === "diamond")
        return polygonPath(
            [
                [0.5, 0],
                [1, 0.5],
                [0.5, 1],
                [0, 0.5],
            ],
            width,
            height,
        );
    if (shapeName === "parallelogram")
        return polygonPath(
            [
                [0.25, 0],
                [1, 0],
                [0.75, 1],
                [0, 1],
            ],
            width,
            height,
        );
    if (shapeName === "trapezoid")
        return polygonPath(
            [
                [0.25, 0],
                [0.75, 0],
                [1, 1],
                [0, 1],
            ],
            width,
            height,
        );
    if (shapeName === "nonIsoscelesTrapezoid")
        return polygonPath(
            [
                [0.15, 0],
                [0.75, 0],
                [1, 1],
                [0, 1],
            ],
            width,
            height,
        );
    if (shapeName === "hexagon") {
        const inset = Math.min(width, height) / 4;
        return pixelPath([
            [inset, 0],
            [width - inset, 0],
            [width, height / 2],
            [width - inset, height],
            [inset, height],
            [0, height / 2],
        ]);
    }
    const sides = POLYGON_SIDES[shapeName as keyof typeof POLYGON_SIDES];
    if (sides) return radialPath(sides, width, height);
    const points = STAR_POINTS[shapeName as keyof typeof STAR_POINTS];
    if (points) return radialPath(points, width, height, points === 4 ? 0.18 : 0.382);
    return arrowPath(shapeName, width, height);
}

function normalizeShapeLink(options: PptxGenJS.ShapeProps): NormalizedShape["link"] {
    if (!options.hyperlink) return undefined;
    if (options.hyperlink.url) return { href: options.hyperlink.url, tooltip: options.hyperlink.tooltip };
    if (options.hyperlink.slide) {
        return { href: `#slide-${options.hyperlink.slide}`, tooltip: options.hyperlink.tooltip, slide: options.hyperlink.slide };
    }
    throw new Error("hyperlink requires either url or slide");
}

function shapeTextInsets(shapeName: CustomShapeName, width: number, height: number): NormalizedShape["textInsets"] {
    const short = Math.min(width, height);
    if (shapeName === "diamond") return [height / 4, width / 4, height / 4, width / 4];
    if (shapeName === "hexagon") return [0, short / 4, 0, short / 4];
    if (shapeName === "rightArrow") return [height / 4, short / 2, height / 4, 0];
    return undefined;
}

export function normalizeShape(shapeName: CustomShapeName, options: PptxGenJS.ShapeProps, width: number, height: number, pageSize: PageSize): NormalizedShape {
    if (!CORE_SVG_SHAPES.includes(shapeName as (typeof CORE_SVG_SHAPES)[number])) {
        throw new Error(`Unsupported shape geometry: ${shapeName}`);
    }
    const link = normalizeShapeLink(options);
    let geometry: NormalizedShape["geometry"];
    if (shapeName === "rect") geometry = { kind: "rect", radius: 0 };
    else if (shapeName === "roundRect") {
        const radius =
            options.rectRadius === undefined
                ? Math.min(width, height) / 6
                : Math.min(Math.min(width, height) / 2, inchesToPixels(Math.max(0, options.rectRadius)));
        geometry = { kind: "rect", radius };
    } else if (shapeName === "ellipse") geometry = { kind: "ellipse" };
    else if (shapeName === "line" || shapeName === "lineInv") geometry = { kind: "line", inverse: shapeName === "lineInv" };
    else if (shapeName === "custGeom") geometry = { kind: "path", data: normalizeCustomPath(options.points, pageSize) };
    else if (shapeName === "curvedRightArrow") geometry = curvedArrowGeometry(width, height, "right");
    else if (shapeName === "curvedLeftArrow") geometry = curvedArrowGeometry(width, height, "left");
    else if (shapeName === "curvedUpArrow") geometry = curvedArrowGeometry(width, height, "up");
    else if (shapeName === "curvedDownArrow") geometry = curvedArrowGeometry(width, height, "down");
    else if (CIRCULAR_SHAPES.includes(shapeName as (typeof CIRCULAR_SHAPES)[number])) {
        geometry = circularShapeGeometry(shapeName as (typeof CIRCULAR_SHAPES)[number], options, width, height);
    } else if (BRACE_BRACKET_SHAPES.includes(shapeName as (typeof BRACE_BRACKET_SHAPES)[number])) {
        geometry = braceBracketGeometry(shapeName as (typeof BRACE_BRACKET_SHAPES)[number], width, height);
    } else if (RIBBON_SCROLL_SHAPES.includes(shapeName as (typeof RIBBON_SCROLL_SHAPES)[number])) {
        geometry = ribbonScrollGeometry(shapeName as (typeof RIBBON_SCROLL_SHAPES)[number], width, height);
    } else if (ACTION_BUTTON_SHAPES.includes(shapeName as (typeof ACTION_BUTTON_SHAPES)[number])) {
        geometry = actionButtonGeometry(shapeName as (typeof ACTION_BUTTON_SHAPES)[number], width, height);
    } else if (SYMBOL_SHAPES.includes(shapeName as (typeof SYMBOL_SHAPES)[number])) {
        geometry = symbolGeometry(shapeName as (typeof SYMBOL_SHAPES)[number], width, height);
    } else if (FLOWCHART_SHAPES.includes(shapeName as (typeof FLOWCHART_SHAPES)[number])) {
        geometry = flowchartGeometry(shapeName as (typeof FLOWCHART_SHAPES)[number], width, height);
    } else if (GENERATED_PRESET_NAMES.includes(shapeName as (typeof GENERATED_PRESET_NAMES)[number])) {
        geometry = generatedPresetGeometry(shapeName as (typeof GENERATED_PRESET_NAMES)[number], width, height);
    } else geometry = { kind: "path", data: presetPath(shapeName, width, height)! };
    return { name: shapeName, width, height, geometry, textInsets: shapeTextInsets(shapeName, width, height), link };
}

export function normalizeShapeTextBox(text: NormalizedTextBox, shape: NormalizedShape): NormalizedTextBox {
    if (!shape.textInsets) return text;
    const [insetTop, insetRight, insetBottom, insetLeft] = shape.textInsets;
    const [marginTop, marginRight, marginBottom, marginLeft] = text.margin;
    return {
        ...text,
        margin: [marginTop + insetTop, marginRight + insetRight, marginBottom + insetBottom, marginLeft + insetLeft],
    };
}

export function normalizeShapeLine(options: PptxGenJS.ShapeProps, normalize: (line?: PptxGenJS.ShapeLineProps) => NormalizedLine): NormalizedLine {
    const hasDeprecatedLine =
        options.lineSize !== undefined || options.lineDash !== undefined || options.lineHead !== undefined || options.lineTail !== undefined;
    if (!options.line && !hasDeprecatedLine) return normalize(undefined);
    const source = typeof options.line === "string" ? { color: options.line } : (options.line ?? {});
    return normalize({
        ...source,
        width: options.lineSize ?? source.width,
        dashType: options.lineDash ?? source.dashType,
        beginArrowType: options.lineHead ?? source.beginArrowType,
        endArrowType: options.lineTail ?? source.endArrowType,
    });
}
