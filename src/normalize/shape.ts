import type PptxGenJS from "pptxgenjs";
import type { NormalizedLine, NormalizedShape } from "../model/types";
import type { PageSize } from "../pageLayouts";
import { convertToPixels, inchesToPixels } from "../utils";

const POLYGON_SIDES = Object.freeze({ pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, decagon: 10, dodecagon: 12 } as const);
const STAR_POINTS = Object.freeze({ star4: 4, star5: 5, star6: 6, star7: 7, star8: 8, star10: 10, star12: 12, star16: 16, star24: 24, star32: 32 } as const);

export const CORE_SVG_SHAPES = Object.freeze([
    "rect", "roundRect", "ellipse", "line", "lineInv", "custGeom",
    "triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "nonIsoscelesTrapezoid",
    ...Object.keys(POLYGON_SIDES), ...Object.keys(STAR_POINTS),
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
    return undefined;
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
