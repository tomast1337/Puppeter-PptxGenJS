import { CURVED_ARROW_GEOMETRY } from "./curvedArrow";
import { leftRightCalloutPoints, quadCalloutPoints, rightCalloutPoints, rotateRightCallout } from "./arrowCallout";
import { arcPathCommand, type PixelPoint, pixelPath, pointCommand, type ShapeGeometry } from "./path";

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

function quadArrowPoints(width: number, height: number): PixelPoint[] {
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
    points.push([x4, y6], [x5, y6], [width / 2, height], [x2, y6], [x3, y6]);
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

function notchedRightArrowPath(width: number, height: number): string {
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

function stripedRightArrowPath(width: number, height: number): string {
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

const path =
    (data: (width: number, height: number) => string): ShapeGeometry =>
    (width, height) => ({ kind: "path", data: data(width, height) });
const polygon = (points: (width: number, height: number) => PixelPoint[]) => path((width, height) => pixelPath(points(width, height)));

export const ARROW_GEOMETRY = {
    rightArrow: polygon(rightArrowPoints),
    leftArrow: polygon((width, height) => rotateRightArrow(width, height, "left")),
    upArrow: polygon((width, height) => rotateRightArrow(width, height, "up")),
    downArrow: polygon((width, height) => rotateRightArrow(width, height, "down")),
    leftRightArrow: polygon(leftRightArrowPoints),
    upDownArrow: polygon((width, height) => leftRightArrowPoints(height, width).map(([x, y]) => [y, height - x])),
    quadArrow: polygon(quadArrowPoints),
    notchedRightArrow: path(notchedRightArrowPath),
    stripedRightArrow: path(stripedRightArrowPath),
    leftUpArrow: polygon(leftUpArrowPoints),
    bentUpArrow: polygon(bentUpArrowPoints),
    bentArrow: path(bentArrowPath),
    uturnArrow: path(uturnArrowPath),
    ...CURVED_ARROW_GEOMETRY,
    swooshArrow: path(swooshArrowPath),
    rightArrowCallout: polygon(rightCalloutPoints),
    leftArrowCallout: polygon((width, height) => rotateRightCallout(width, height, "left")),
    upArrowCallout: polygon((width, height) => rotateRightCallout(width, height, "up")),
    downArrowCallout: polygon((width, height) => rotateRightCallout(width, height, "down")),
    leftRightArrowCallout: polygon(leftRightCalloutPoints),
    upDownArrowCallout: polygon((width, height) => leftRightCalloutPoints(height, width).map(([x, y]) => [y, height - x])),
    quadArrowCallout: polygon(quadCalloutPoints),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
