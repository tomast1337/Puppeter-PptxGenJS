import type PptxGenJS from "pptxgenjs";
import type { NormalizedLine, NormalizedShape } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels, inchesToPixels } from "../utils";

const POLYGON_SIDES = Object.freeze({ pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, decagon: 10, dodecagon: 12 } as const);
const STAR_POINTS = Object.freeze({ star4: 4, star5: 5, star6: 6, star7: 7, star8: 8, star10: 10, star12: 12, star16: 16, star24: 24, star32: 32 } as const);
const ARROW_SHAPES = Object.freeze([
    "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow",
    "quadArrow", "leftRightUpArrow", "notchedRightArrow", "stripedRightArrow",
    "leftUpArrow", "bentUpArrow", "bentArrow", "uturnArrow",
    "curvedRightArrow", "curvedLeftArrow", "curvedUpArrow", "curvedDownArrow", "swooshArrow",
    "rightArrowCallout", "leftArrowCallout", "upArrowCallout", "downArrowCallout",
    "leftRightArrowCallout", "upDownArrowCallout", "quadArrowCallout",
] as const);
const CIRCULAR_SHAPES = Object.freeze(["arc", "pie", "pieWedge", "chord", "blockArc", "donut"] as const);
const FLOWCHART_SHAPES = Object.freeze([
    "flowChartAlternateProcess", "flowChartCollate", "flowChartConnector", "flowChartDecision",
    "flowChartDelay", "flowChartDisplay", "flowChartExtract", "flowChartInputOutput",
    "flowChartInternalStorage", "flowChartManualInput", "flowChartManualOperation", "flowChartMerge",
    "flowChartOffpageConnector", "flowChartOr", "flowChartPredefinedProcess", "flowChartPreparation",
    "flowChartProcess", "flowChartSort", "flowChartSummingJunction", "flowChartTerminator",
] as const);

export const CORE_SVG_SHAPES = Object.freeze([
    "rect", "roundRect", "ellipse", "line", "lineInv", "custGeom",
    "triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "nonIsoscelesTrapezoid",
    ...Object.keys(POLYGON_SIDES), ...Object.keys(STAR_POINTS), ...ARROW_SHAPES, ...CIRCULAR_SHAPES, ...FLOWCHART_SHAPES,
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
    const radians = degrees * Math.PI / 180;
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
                commands.push(`C ${coordinate(point.curve.x1, "x", pageSize)} ${coordinate(point.curve.y1, "y", pageSize)} ${coordinate(point.curve.x2, "x", pageSize)} ${coordinate(point.curve.y2, "y", pageSize)} ${x} ${y}`);
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
        const angle = -Math.PI / 2 + evenRotation + index * Math.PI * 2 / count;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
    });
    const xs = raw.map(([x]) => x); const ys = raw.map(([, y]) => y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return polygonPath(raw.map(([x, y]) => [(x - minX) / (maxX - minX), (y - minY) / (maxY - minY)] as const), width, height);
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
        data() { return commands.join(" "); },
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
    return [[0, height / 4], [base, height / 4], [base, 0], [width, height / 2], [base, height], [base, height * 3 / 4], [0, height * 3 / 4]];
}

function rotateRightArrow(width: number, height: number, direction: "left" | "up" | "down"): PixelPoint[] {
    if (direction === "left") return rightArrowPoints(width, height).map(([x, y]) => [width - x, y]);
    const source = rightArrowPoints(height, width);
    return source.map(([x, y]) => direction === "up" ? [y, height - x] : [width - y, x]);
}

function leftRightArrowPoints(width: number, height: number): PixelPoint[] {
    const head = Math.min(width, height) / 2;
    const y1 = height / 4;
    return [[0, height / 2], [head, 0], [head, y1], [width - head, y1], [width - head, 0], [width, height / 2], [width - head, height], [width - head, height - y1], [head, height - y1], [head, height]];
}

function rightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const y1 = height / 2 - short / 4;
    const y2 = height / 2 - short / 8;
    const y3 = height / 2 + short / 8;
    const y4 = height / 2 + short / 4;
    const x2 = width * 0.64977;
    const x3 = width - short / 4;
    return [[0, 0], [x2, 0], [x2, y2], [x3, y2], [x3, y1], [width, height / 2], [x3, y4], [x3, y3], [x2, y3], [x2, height], [0, height]];
}

function rotateRightCallout(width: number, height: number, direction: "left" | "up" | "down"): PixelPoint[] {
    if (direction === "left") return rightCalloutPoints(width, height).map(([x, y]) => [width - x, y]);
    const source = rightCalloutPoints(height, width);
    return source.map(([x, y]) => direction === "up" ? [y, height - x] : [width - y, x]);
}

function leftRightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short / 4;
    const y1 = height / 2 - head;
    const y2 = height / 2 - head / 2;
    const y3 = height / 2 + head / 2;
    const y4 = height / 2 + head;
    const bodyHalf = width * 0.48123 / 2;
    const x2 = width / 2 - bodyHalf;
    const x3 = width / 2 + bodyHalf;
    return [[0, height / 2], [head, y1], [head, y2], [x2, y2], [x2, 0], [x3, 0], [x3, y2], [width - head, y2], [width - head, y1], [width, height / 2], [width - head, y4], [width - head, y3], [x3, y3], [x3, height], [x2, height], [x2, y3], [head, y3], [head, y4]];
}

function quadCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short * 0.18515;
    const headHalfWidth = short * 0.18515;
    const shaftHalfWidth = short * 0.092575;
    const bodyHalfWidth = width * 0.48123 / 2;
    const bodyHalfHeight = height * 0.48123 / 2;
    const x2 = width / 2 - bodyHalfWidth; const x7 = width / 2 + bodyHalfWidth;
    const x3 = width / 2 - headHalfWidth; const x6 = width / 2 + headHalfWidth;
    const x4 = width / 2 - shaftHalfWidth; const x5 = width / 2 + shaftHalfWidth;
    const y2 = height / 2 - bodyHalfHeight; const y7 = height / 2 + bodyHalfHeight;
    const y3 = height / 2 - headHalfWidth; const y6 = height / 2 + headHalfWidth;
    const y4 = height / 2 - shaftHalfWidth; const y5 = height / 2 + shaftHalfWidth;
    return [[0, height / 2], [head, y3], [head, y4], [x2, y4], [x2, y2], [x4, y2], [x4, head], [x3, head], [width / 2, 0], [x6, head], [x5, head], [x5, y2], [x7, y2], [x7, y4], [width - head, y4], [width - head, y3], [width, height / 2], [width - head, y6], [width - head, y5], [x7, y5], [x7, y7], [x5, y7], [x5, height - head], [x6, height - head], [width / 2, height], [x3, height - head], [x4, height - head], [x4, y7], [x2, y7], [x2, y5], [head, y5], [head, y6]];
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
    const points: PixelPoint[] = [[0, height / 2], [headInset, y2], [headInset, y3], [x3, y3], [x3, headInset], [x2, headInset], [width / 2, 0], [x5, headInset], [x4, headInset], [x4, y3], [x6, y3], [x6, y2], [width, height / 2], [x6, y5], [x6, y4], [x4, y4]];
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
    const x3 = x4 - dx3; const x5 = x4 + dx3;
    const y3 = y4 - dx3; const y5 = y4 + dx3;
    return [[0, y4], [x1, y2], [x1, y3], [x3, y3], [x3, x1], [x2, x1], [x4, 0], [width, x1], [x5, x1], [x5, y5], [x1, y5], [x1, height]];
}

function bentUpArrowPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const y1 = short / 4;
    const x1 = width - short / 2;
    const x3 = width - short / 4;
    const dx2 = short / 8;
    const x2 = x3 - dx2; const x4 = x3 + dx2;
    const y2 = height - short / 4;
    return [[0, y2], [x2, y2], [x2, y1], [x1, y1], [x3, 0], [width, y1], [x4, y1], [x4, height], [0, height]];
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
    commands.push(arc.command, pointCommand("L", [[x4, delta]]), pointCommand("L", [[x4, 0]]), pointCommand("L", [[width, arrowHalf]]), pointCommand("L", [[x4, y4]]), pointCommand("L", [[x4, y3]]), pointCommand("L", [[x3, y3]]));
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
    const x5 = x7 - innerBend;
    const commands = [pointCommand("M", [[0, height]]), pointCommand("L", [[0, bend]])];
    let arc = arcPathCommand([0, bend], bend, bend, 180, 90);
    commands.push(arc.command, pointCommand("L", [[x4, 0]]));
    arc = arcPathCommand([x4, 0], bend, bend, 270, 90);
    commands.push(arc.command, pointCommand("L", [[x9, y4]]), pointCommand("L", [[width, y4]]), pointCommand("L", [[x8, y5]]), pointCommand("L", [[x6, y4]]), pointCommand("L", [[x7, y4]]), pointCommand("L", [[x7, x3]]));
    arc = arcPathCommand([x7, x3], innerBend, innerBend, 0, -90);
    commands.push(arc.command, pointCommand("L", [[x3, thickness]]));
    arc = arcPathCommand([x3, thickness], innerBend, innerBend, 270, -90);
    commands.push(arc.command, pointCommand("L", [[thickness, height]]), "Z");
    return commands.join(" ");
}

function curvedArrowGeometry(width: number, height: number, direction: "right" | "left" | "up" | "down"): Extract<NormalizedShape["geometry"], { kind: "path" }> {
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
    const idx = Math.sqrt(diameter * diameter - thickness * thickness) * w / diameter;
    const arrowHeight = Math.min(short / 4, idx);
    const y3 = radiusY + thickness;
    const dy = Math.sqrt(w * w - arrowHeight * arrowHeight) * radiusY / w;
    const y5 = radiusY + dy;
    const y7 = y3 + dy;
    const halfDifference = (arrowWidth - thickness) / 2;
    const y4 = y5 - halfDifference;
    const y8 = y7 + halfDifference;
    const y6 = h - arrowWidth / 2;
    const x1 = left ? arrowHeight : w - arrowHeight;
    const sweep = Math.atan2(dy, arrowHeight) * 180 / Math.PI;
    const diagonal = Math.atan2(thickness / 2, idx) * 180 / Math.PI;
    const path = () => presetArcPath(w, radiusY);
    let main: string;
    let dark: string;
    let outline: string;
    if (left) {
        main = path().move(0, y6).line(x1, y4).line(x1, y5)
            .arc(sweep, diagonal - sweep).arc(-diagonal, sweep + diagonal)
            .line(x1, y8).close().data();
        dark = path().move(w, y3).arc(0, -90).line(0, 0)
            .arc(270, 90).close().data();
        outline = path().move(w, y3).arc(0, -90).line(0, 0).arc(270, 90)
            .line(w, y3).arc(0, sweep).line(x1, y8).line(0, y6)
            .line(x1, y4).line(x1, y5).arc(sweep, diagonal - sweep).data();
    } else {
        main = path().move(0, radiusY).arc(180, -sweep)
            .line(x1, y4).line(w, y6).line(x1, y8).line(x1, y7)
            .arc(180 - sweep, sweep).close().data();
        dark = path().move(w, thickness).arc(270, diagonal - 90)
            .arc(180 - diagonal, 90 + diagonal).close().data();
        outline = path().move(0, radiusY).arc(180, -sweep)
            .line(x1, y4).line(w, y6).line(x1, y8).line(x1, y7)
            .arc(180 - sweep, sweep).line(0, radiusY).arc(180, 90)
            .line(w, thickness).arc(270, diagonal - 90).data();
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
    const delta = ((end - start) % 360 + 360) % 360;
    return delta === 0 ? 360 : delta;
}

function ellipseArcCommands(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): {
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
    shapeName: typeof CIRCULAR_SHAPES[number],
    options: PptxGenJS.ShapeProps,
    width: number,
    height: number,
): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    const defaults: Record<"arc" | "pie" | "chord" | "blockArc", readonly [number, number]> = {
        arc: [270, 0], pie: [0, 270], chord: [45, 270], blockArc: [180, 0],
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
    const thickness = Math.min(width, height) * ratio / 2;
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

function flowchartGeometry(
    shapeName: typeof FLOWCHART_SHAPES[number],
    width: number,
    height: number,
): NormalizedShape["geometry"] {
    if (shapeName === "flowChartProcess") return { kind: "rect", radius: 0 };
    if (shapeName === "flowChartAlternateProcess") return { kind: "rect", radius: Math.min(width, height) / 6 };
    if (shapeName === "flowChartConnector") return { kind: "ellipse" };
    if (shapeName === "flowChartDecision") return { kind: "path", data: polygonPath([[0, .5], [.5, 0], [1, .5], [.5, 1]], width, height) };
    if (shapeName === "flowChartCollate") return { kind: "path", data: polygonPath([[0, 0], [1, 0], [.5, .5], [1, 1], [0, 1], [.5, .5]], width, height) };
    if (shapeName === "flowChartExtract") return { kind: "path", data: polygonPath([[0, 1], [.5, 0], [1, 1]], width, height) };
    if (shapeName === "flowChartMerge") return { kind: "path", data: polygonPath([[0, 0], [1, 0], [.5, 1]], width, height) };
    if (shapeName === "flowChartInputOutput") return { kind: "path", data: polygonPath([[0, 1], [.2, 0], [1, 0], [.8, 1]], width, height) };
    if (shapeName === "flowChartManualInput") return { kind: "path", data: polygonPath([[0, .2], [1, 0], [1, 1], [0, 1]], width, height) };
    if (shapeName === "flowChartManualOperation") return { kind: "path", data: polygonPath([[0, 0], [1, 0], [.8, 1], [.2, 1]], width, height) };
    if (shapeName === "flowChartOffpageConnector") return { kind: "path", data: polygonPath([[0, 0], [1, 0], [1, .8], [.5, 1], [0, .8]], width, height) };
    if (shapeName === "flowChartPreparation") return { kind: "path", data: polygonPath([[0, .5], [.2, 0], [.8, 0], [1, .5], [.8, 1], [.2, 1]], width, height) };
    if (shapeName === "flowChartDelay") {
        const arc = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 270, 180);
        return { kind: "path", data: `M 0 0 L ${cleanNumber(width / 2)} 0 ${arc.arcs} L 0 ${cleanNumber(height)} Z` };
    }
    if (shapeName === "flowChartDisplay") {
        const arc = ellipseArcCommands(width * 5 / 6, height / 2, width / 6, height / 2, 270, 180);
        return { kind: "path", data: `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width / 6)} 0 L ${cleanNumber(width * 5 / 6)} 0 ${arc.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} Z` };
    }
    if (shapeName === "flowChartTerminator") {
        const radiusX = width * 3475 / 21600;
        const rightArc = ellipseArcCommands(width - radiusX, height / 2, radiusX, height / 2, 270, 180);
        const leftArc = ellipseArcCommands(radiusX, height / 2, radiusX, height / 2, 90, 180);
        return { kind: "path", data: `M ${cleanNumber(radiusX)} 0 L ${cleanNumber(width - radiusX)} 0 ${rightArc.arcs} L ${cleanNumber(radiusX)} ${cleanNumber(height)} ${leftArc.arcs} Z` };
    }

    const rectangle = `M 0 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${cleanNumber(height)} L 0 ${cleanNumber(height)} Z`;
    if (shapeName === "flowChartInternalStorage") {
        return compoundShape(rectangle, `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 8)} L ${cleanNumber(width)} ${cleanNumber(height / 8)}`);
    }
    if (shapeName === "flowChartPredefinedProcess") {
        return compoundShape(rectangle, `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M ${cleanNumber(width * 7 / 8)} 0 L ${cleanNumber(width * 7 / 8)} ${cleanNumber(height)}`);
    }
    if (shapeName === "flowChartSort") {
        const diamond = polygonPath([[0, .5], [.5, 0], [1, .5], [.5, 1]], width, height);
        return compoundShape(diamond, `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`);
    }
    const ellipse = fullEllipsePath(width, height);
    if (shapeName === "flowChartOr") {
        return compoundShape(ellipse, `M ${cleanNumber(width / 2)} 0 L ${cleanNumber(width / 2)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`);
    }
    const insetX = width / 2 * Math.SQRT1_2;
    const insetY = height / 2 * Math.SQRT1_2;
    return compoundShape(ellipse, `M ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 + insetY)} M ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 + insetY)}`);
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
    return [pointCommand("M", [[0, height]]), pointCommand("Q", [[width / 6, height / 3], [xB, yB]]), pointCommand("L", [[xC, 0]]), pointCommand("L", [[width, yD]]), pointCommand("L", [[xE, yE]]), pointCommand("L", [[xF, yF]]), pointCommand("Q", [[width / 4, yF + height / 12], [0, height]]), "Z"].join(" ");
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
        return pixelPath([[0, height / 4], [base, height / 4], [base, 0], [width, height / 2], [base, height], [base, height * 3 / 4], [0, height * 3 / 4], [height / 4, height / 2]]);
    }
    if (shapeName === "stripedRightArrow") {
        const short = Math.min(width, height);
        const y1 = height / 4; const y2 = height * 3 / 4;
        const stripe1 = pixelPath([[0, y1], [short / 32, y1], [short / 32, y2], [0, y2]]);
        const stripe2 = pixelPath([[short / 16, y1], [short / 8, y1], [short / 8, y2], [short / 16, y2]]);
        const headBase = width - short / 2;
        const arrow = pixelPath([[short * 5 / 32, y1], [headBase, y1], [headBase, 0], [width, height / 2], [headBase, height], [headBase, y2], [short * 5 / 32, y2]]);
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
    if (shapeName === "triangle") return polygonPath([[0.5, 0], [1, 1], [0, 1]], width, height);
    if (shapeName === "rtTriangle") return polygonPath([[0, 0], [1, 1], [0, 1]], width, height);
    if (shapeName === "diamond") return polygonPath([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], width, height);
    if (shapeName === "parallelogram") return polygonPath([[0.25, 0], [1, 0], [0.75, 1], [0, 1]], width, height);
    if (shapeName === "trapezoid") return polygonPath([[0.25, 0], [0.75, 0], [1, 1], [0, 1]], width, height);
    if (shapeName === "nonIsoscelesTrapezoid") return polygonPath([[0.15, 0], [0.75, 0], [1, 1], [0, 1]], width, height);
    const sides = POLYGON_SIDES[shapeName as keyof typeof POLYGON_SIDES];
    if (sides) return radialPath(sides, width, height);
    const points = STAR_POINTS[shapeName as keyof typeof STAR_POINTS];
    if (points) return radialPath(points, width, height, points === 4 ? 0.18 : 0.382);
    return arrowPath(shapeName, width, height);
}

export function normalizeShape(
    shapeName: CustomShapeName,
    options: PptxGenJS.ShapeProps,
    width: number,
    height: number,
    pageSize: PageSize,
): NormalizedShape {
    if (!CORE_SVG_SHAPES.includes(shapeName as typeof CORE_SVG_SHAPES[number])) {
        throw new Error(`Unsupported shape geometry: ${shapeName}`);
    }
    if (options.hyperlink && !options.hyperlink.url && !options.hyperlink.slide) {
        throw new Error("hyperlink requires either url or slide");
    }
    const link = options.hyperlink?.url
        ? { href: options.hyperlink.url, tooltip: options.hyperlink.tooltip }
        : options.hyperlink?.slide
            ? { href: `#slide-${options.hyperlink.slide}`, tooltip: options.hyperlink.tooltip, slide: options.hyperlink.slide }
            : undefined;
    let geometry: NormalizedShape["geometry"];
    if (shapeName === "rect") geometry = { kind: "rect", radius: 0 };
    else if (shapeName === "roundRect") {
        const radius = options.rectRadius === undefined
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
    else if (CIRCULAR_SHAPES.includes(shapeName as typeof CIRCULAR_SHAPES[number])) {
        geometry = circularShapeGeometry(shapeName as typeof CIRCULAR_SHAPES[number], options, width, height);
    }
    else if (FLOWCHART_SHAPES.includes(shapeName as typeof FLOWCHART_SHAPES[number])) {
        geometry = flowchartGeometry(shapeName as typeof FLOWCHART_SHAPES[number], width, height);
    }
    else geometry = { kind: "path", data: presetPath(shapeName, width, height)! };
    return { name: shapeName, width, height, geometry, link };
}

export function normalizeShapeLine(options: PptxGenJS.ShapeProps, normalize: (line?: PptxGenJS.ShapeLineProps) => NormalizedLine): NormalizedLine {
    if (!options.line) return normalize(undefined);
    const source = typeof options.line === "string" ? { color: options.line } : options.line;
    return normalize({
        ...source,
        width: options.lineSize ?? source.width,
        dashType: options.lineDash ?? source.dashType,
        beginArrowType: options.lineHead ?? source.beginArrowType,
        endArrowType: options.lineTail ?? source.endArrowType,
    });
}
