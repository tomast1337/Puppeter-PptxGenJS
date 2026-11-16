import { ellipsePath, OOXML_PERCENT, type PathGeometry, pixelPath, type ShapeGeometry } from "./path";

// presetShapeDefinitions.xml values of the math presets, in OOXML_PERCENT units: the bar thickness (adj1), the bar
// length across the box (the dx1 guide's 73490), the gap between bars (mathEqual adj2, mathNotEqual adj3) and
// mathMultiply's 51965 (its rw guide). The not-equal slash leans 20 degrees off vertical (adj2 6600000 = 110 deg).
const BAR_THICKNESS = 23520;
const BAR_EXTENT = 73490;
const BAR_GAP = 11760;
const MULTIPLY_ARM = 51965;
const NOT_EQUAL_SLASH_DEGREES = 20;

/** The left and right ends of the horizontal bars. */
function barEnds(width: number) {
    const extentX = (width * BAR_EXTENT) / 200000;
    return { x1: width / 2 - extentX, x8: width / 2 + extentX };
}

function bar(x1: number, x8: number, top: number, bottom: number): string {
    return pixelPath([
        [x1, top],
        [x8, top],
        [x8, bottom],
        [x1, bottom],
    ]);
}

function mathPlus(width: number, height: number): PathGeometry {
    const cx = width / 2;
    const cy = height / 2;
    const extentX = (width * BAR_EXTENT) / 200000;
    const extentY = (height * BAR_EXTENT) / 200000;
    const halfThickness = (Math.min(width, height) * BAR_THICKNESS) / 200000;
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

function mathMinus(width: number, height: number): PathGeometry {
    const { x1, x8 } = barEnds(width);
    const halfThickness = (height * BAR_THICKNESS) / 200000;
    return { kind: "path", data: bar(x1, x8, height / 2 - halfThickness, height / 2 + halfThickness) };
}

function mathEqual(width: number, height: number): PathGeometry {
    const { x1, x8 } = barEnds(width);
    const cy = height / 2;
    const thickness = (height * BAR_THICKNESS) / OOXML_PERCENT;
    const halfGap = (height * BAR_GAP) / 200000;
    return { kind: "path", data: `${bar(x1, x8, cy - halfGap - thickness, cy - halfGap)} ${bar(x1, x8, cy + halfGap, cy + halfGap + thickness)}` };
}

function mathDivide(width: number, height: number): PathGeometry {
    const { x1, x8 } = barEnds(width);
    const cx = width / 2;
    const cy = height / 2;
    const halfThickness = (height * BAR_THICKNESS) / 200000;
    // LibreOffice renders the pinned PptxGenJS preset's dot gap at half
    // the ECMA guide value (4.23px rather than 8.47px at 144px high).
    const gap = (height * 5880) / 200000;
    const radius = (height * BAR_GAP) / OOXML_PERCENT;
    return {
        kind: "path",
        data: `${ellipsePath(cx, cy - halfThickness - gap - radius, radius, radius)} ${ellipsePath(cx, cy + halfThickness + gap + radius, radius, radius)} ${bar(x1, x8, cy - halfThickness, cy + halfThickness)}`,
    };
}

function mathMultiply(width: number, height: number): PathGeometry {
    const cx = width / 2;
    const cy = height / 2;
    const diagonal = Math.hypot(width, height);
    const sin = height / diagonal;
    const cos = width / diagonal;
    const thickness = (Math.min(width, height) * BAR_THICKNESS) / OOXML_PERCENT;
    const middleLength = diagonal * (1 - MULTIPLY_ARM / OOXML_PERCENT);
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
    return {
        kind: "path",
        data: pixelPath([
            [xA, yA],
            [xB, yB],
            [cx, yC],
            [xD, yB],
            [xE, yA],
            [xE - xOffset, cy],
            [xE, height - yA],
            [xD, height - yB],
            [cx, height - yC],
            [xB, height - yB],
            [xA, height - yA],
            [xA + xOffset, cy],
        ]),
    };
}

function mathNotEqual(width: number, height: number): PathGeometry {
    const { x1, x8 } = barEnds(width);
    const cx = width / 2;
    const cy = height / 2;
    const thickness = (height * BAR_THICKNESS) / OOXML_PERCENT;
    const halfGap = (height * BAR_GAP) / 200000;
    const y2 = cy - halfGap;
    const y3 = cy + halfGap;
    const yTop = y2 - thickness;
    const yBottom = y3 + thickness;
    const xAdj = (height / 2) * Math.tan((NOT_EQUAL_SLASH_DEGREES * Math.PI) / 180);
    const length = Math.hypot(xAdj, height / 2);
    const slashWidth = (length * thickness) / (height / 2);
    const x7 = cx + xAdj - slashWidth / 2;
    const atY = (y: number) => x7 - (xAdj * y) / (height / 2);
    const x6 = atY(yTop);
    const x5 = atY(y2);
    const x4 = atY(y3);
    const x3 = atY(yBottom);
    const rx = (x: number) => x + slashWidth;
    const topRight = x7 + (thickness * (height / 2)) / length;
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
            [width - x7, height],
            [width - topRight, height - (thickness * xAdj) / length],
            [x3, yBottom],
            [x1, yBottom],
            [x1, y3],
            [x4, y3],
            [x5, y2],
            [x1, y2],
        ]),
    };
}

export const MATH_GEOMETRY = { mathPlus, mathMinus, mathEqual, mathNotEqual, mathMultiply, mathDivide } as const satisfies Readonly<Record<string, ShapeGeometry>>;
