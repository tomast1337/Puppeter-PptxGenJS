import type PptxGenJS from "pptxgenjs";
import type { NormalizedShape } from "@pdflapas/model";
import type { PageSize } from "#src/pageLayouts";

/** DrawingML percentage guides (ST_Percentage, ECMA-376 20.1.10.40) are in 1/1000ths of a percent. */
export const OOXML_PERCENT = 100000;

export type PathGeometry = Extract<NormalizedShape["geometry"], { kind: "path" }>;
/** Draws one preset at the given size (px); every preset name maps to one of these. */
export type ShapeGeometry = (width: number, height: number, options: PptxGenJS.ShapeProps, pageSize: PageSize) => NormalizedShape["geometry"];

export function cleanNumber(value: number): number {
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

type PixelPoint = readonly [number, number];

export function pixelPath(points: ReadonlyArray<PixelPoint>): string {
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

export function drawingPath() {
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

export function arcPathCommand(current: PixelPoint, rx: number, ry: number, startDegrees: number, sweepDegrees: number): { command: string; end: PixelPoint } {
    const end = arcEndpoint(current, rx, ry, startDegrees, sweepDegrees);
    return {
        command: `A ${cleanNumber(rx)} ${cleanNumber(ry)} 0 ${Math.abs(sweepDegrees) > 180 ? 1 : 0} ${sweepDegrees >= 0 ? 1 : 0} ${cleanNumber(end[0])} ${cleanNumber(end[1])}`,
        end,
    };
}

export function ellipseArcCommands(
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
