import type PptxGenJS from "pptxgenjs";
import type { NormalizedLine, NormalizedShape } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels, inchesToPixels } from "../utils";

const POLYGON_SIDES = Object.freeze({ pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, decagon: 10, dodecagon: 12 } as const);
const STAR_POINTS = Object.freeze({ star4: 4, star5: 5, star6: 6, star7: 7, star8: 8, star10: 10, star12: 12, star16: 16, star24: 24, star32: 32 } as const);
const ARROW_SHAPES = Object.freeze([
    "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow",
    "quadArrow", "leftRightUpArrow", "notchedRightArrow", "stripedRightArrow",
    "rightArrowCallout", "leftArrowCallout", "upArrowCallout", "downArrowCallout",
    "leftRightArrowCallout", "upDownArrowCallout", "quadArrowCallout",
] as const);

export const CORE_SVG_SHAPES = Object.freeze([
    "rect", "roundRect", "ellipse", "line", "lineInv", "custGeom",
    "triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "nonIsoscelesTrapezoid",
    ...Object.keys(POLYGON_SIDES), ...Object.keys(STAR_POINTS), ...ARROW_SHAPES,
] as const);

type CustomShapeName = PptxGenJS.SHAPE_NAME | "custGeom";
type ShapePoint = NonNullable<PptxGenJS.ShapeProps["points"]>[number];

function coordinate(value: PptxGenJS.Coord, axis: "x" | "y", pageSize: PageSize): number {
    return convertToPixels(value, (axis === "x" ? pageSize.width : pageSize.height) * 96);
}

function cleanNumber(value: number): number {
    return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function arcCommand(
    current: { x: number; y: number },
    curve: Extract<ShapePoint, { curve: unknown }>["curve"] & { type: "arc" },
    pageSize: PageSize,
): { command: string; end: { x: number; y: number } } {
    const rx = coordinate(curve.wR, "x", pageSize);
    const ry = coordinate(curve.hR, "y", pageSize);
    const start = curve.stAng * Math.PI / 180;
    const sweep = curve.swAng * Math.PI / 180;
    const centerX = current.x - rx * Math.cos(start);
    const centerY = current.y - ry * Math.sin(start);
    const end = {
        x: cleanNumber(centerX + rx * Math.cos(start + sweep)),
        y: cleanNumber(centerY + ry * Math.sin(start + sweep)),
    };
    return {
        command: `A ${rx} ${ry} 0 ${Math.abs(curve.swAng) > 180 ? 1 : 0} ${curve.swAng >= 0 ? 1 : 0} ${end.x} ${end.y}`,
        end,
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
