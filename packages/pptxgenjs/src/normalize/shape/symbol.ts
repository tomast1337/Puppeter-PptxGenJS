import { MATH_GEOMETRY } from "./math";
import { arcPathCommand, drawingPath, ellipsePath, LEGACY_PATH_SPACE, OOXML_PERCENT, type PathGeometry, type PixelPoint, pixelPath, pointCommand, type ShapeGeometry } from "./path";

function plus(width: number, height: number): PathGeometry {
    const arm = Math.min(width, height) / 4;
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

function heart(width: number, height: number): PathGeometry {
    const cx = width / 2;
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

/** presetShapeDefinitions.xml lightningBolt vertices, in LEGACY_PATH_SPACE units. */
const LIGHTNING_BOLT = [
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

function lightningBolt(width: number, height: number): PathGeometry {
    return { kind: "path", data: pixelPath(LIGHTNING_BOLT.map(([x, y]) => [(x * width) / LEGACY_PATH_SPACE, (y * height) / LEGACY_PATH_SPACE])) };
}

/** The sun preset's guides at its default adj (25000), in OOXML_PERCENT units. */
function sunGuides() {
    const a = 25000;
    const g0 = 50000 - a;
    const g1 = (g0 * 30274) / 32768;
    const g2 = (g0 * 12540) / 32768;
    const g5 = 50000 - g1;
    const g6 = 50000 - g2;
    const g10 = (g5 * 3) / 4;
    const g12 = (g5 * 3) / 4 + 3662;
    const g13 = (g6 * 3) / 4 + 3662;
    const g14 = (g6 * 3) / 4 + 12500;
    return { g0, g10, g12, g13, g14, g15: OOXML_PERCENT - g10, g16: OOXML_PERCENT - g12, g17: OOXML_PERCENT - g13, g18: OOXML_PERCENT - g14 };
}

function sun(width: number, height: number): PathGeometry {
    const cx = width / 2;
    const cy = height / 2;
    const { g0, g10, g12, g13, g14, g15, g16, g17, g18 } = sunGuides();
    const px = (n: number) => (width * n) / OOXML_PERCENT;
    const py = (n: number) => (height * n) / OOXML_PERCENT;
    // The diagonal ray tips sit at 3163 and 18436 of the legacy path space.
    const lx = (n: number) => (width * n) / LEGACY_PATH_SPACE;
    const ly = (n: number) => (height * n) / LEGACY_PATH_SPACE;
    const rays: PixelPoint[][] = [
        [
            [width, cy],
            [px(g15), py(g18)],
            [px(g15), py(g14)],
        ],
        [
            [lx(18436), ly(3163)],
            [px(g16), py(g13)],
            [px(g17), py(g12)],
        ],
        [
            [cx, 0],
            [px(g18), py(g10)],
            [px(g14), py(g10)],
        ],
        [
            [lx(3163), ly(3163)],
            [px(g13), py(g12)],
            [px(g12), py(g13)],
        ],
        [
            [0, cy],
            [px(g10), py(g14)],
            [px(g10), py(g18)],
        ],
        [
            [lx(3163), ly(18436)],
            [px(g12), py(g17)],
            [px(g13), py(g16)],
        ],
        [
            [cx, height],
            [px(g14), py(g15)],
            [px(g18), py(g15)],
        ],
        [
            [lx(18436), ly(18436)],
            [px(g17), py(g16)],
            [px(g16), py(g17)],
        ],
    ];
    const center = ellipsePath(cx, cy, px(g0), py(g0));
    return { kind: "path", data: `${rays.map(pixelPath).join(" ")} ${center}` };
}

function smileyFace(width: number, height: number): PathGeometry {
    const cx = width / 2;
    const face = ellipsePath(cx, height / 2, width / 2, height / 2);
    const eyeY = (height * 7570) / LEGACY_PATH_SPACE;
    const eyeRX = (width * 1125) / LEGACY_PATH_SPACE;
    const eyeRY = (height * 1125) / LEGACY_PATH_SPACE;
    // DrawingML's eye X coordinates are the left edges of the ellipses,
    // not their centers. Including the radius centers the pair at 10800.
    const eyeX1 = (width * (6215 + 1125)) / LEGACY_PATH_SPACE;
    const eyeX2 = (width * (13135 + 1125)) / LEGACY_PATH_SPACE;
    const eyes = `${ellipsePath(eyeX1, eyeY, eyeRX, eyeRY)} ${ellipsePath(eyeX2, eyeY, eyeRX, eyeRY)}`;
    const y3 = (height * 16515) / LEGACY_PATH_SPACE;
    const dy2 = (height * 4653) / OOXML_PERCENT;
    const y2 = y3 - dy2;
    const y5 = y3 + dy2 + (height * 4653) / 50000;
    // 21699, not LEGACY_PATH_SPACE: presetShapeDefinitions.xml writes the smile's x1 guide as `*/ w 4969 21699`.
    const smile = drawingPath()
        .move((width * 4969) / 21699, y2)
        .quadratic(cx, y5, (width * 16640) / LEGACY_PATH_SPACE, y2)
        .data();
    return {
        kind: "path",
        data: `${face} ${eyes}`,
        faces: [{ data: face }, { data: eyes, fillModifier: "darkenLess" }],
        outlineData: `${face} ${eyes} ${smile}`,
    };
}

/** The noSmoking ring thickness (adj, 18750) in OOXML_PERCENT units of the short side. */
const NO_SMOKING_RING = 18750;

function noSmoking(width: number, height: number): PathGeometry {
    const cx = width / 2;
    const cy = height / 2;
    const inset = (Math.min(width, height) * NO_SMOKING_RING) / OOXML_PERCENT;
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

function moon(width: number, height: number): PathGeometry {
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

export const SYMBOL_GEOMETRY = {
    plus,
    ...MATH_GEOMETRY,
    heart,
    lightningBolt,
    moon,
    sun,
    smileyFace,
    noSmoking,
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
