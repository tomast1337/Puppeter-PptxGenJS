import { cleanNumber, compoundShape, ellipseArcCommands, fullEllipsePath, LEGACY_PATH_SPACE, type PathGeometry, polygonPath, type ShapeGeometry } from "./path";

const polygon =
    (points: ReadonlyArray<readonly [number, number]>): ShapeGeometry =>
    (width, height) => ({ kind: "path", data: polygonPath(points, width, height) });

const DIAMOND = [
    [0, 0.5],
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
] as const;

function rectanglePath(width: number, height: number): string {
    return `M 0 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${cleanNumber(height)} L 0 ${cleanNumber(height)} Z`;
}

function delay(width: number, height: number): PathGeometry {
    const arc = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 270, 180);
    return { kind: "path", data: `M 0 0 L ${cleanNumber(width / 2)} 0 ${arc.arcs} L 0 ${cleanNumber(height)} Z` };
}

function display(width: number, height: number): PathGeometry {
    const arc = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 270, 180);
    return {
        kind: "path",
        data: `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width / 6)} 0 L ${cleanNumber((width * 5) / 6)} 0 ${arc.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} Z`,
    };
}

function terminator(width: number, height: number): PathGeometry {
    const radiusX = (width * 3475) / LEGACY_PATH_SPACE;
    const rightArc = ellipseArcCommands(width - radiusX, height / 2, radiusX, height / 2, 270, 180);
    const leftArc = ellipseArcCommands(radiusX, height / 2, radiusX, height / 2, 90, 180);
    return {
        kind: "path",
        data: `M ${cleanNumber(radiusX)} 0 L ${cleanNumber(width - radiusX)} 0 ${rightArc.arcs} L ${cleanNumber(radiusX)} ${cleanNumber(height)} ${leftArc.arcs} Z`,
    };
}

function documentShape(width: number, height: number): PathGeometry {
    const y1 = (height * 17322) / LEGACY_PATH_SPACE;
    return {
        kind: "path",
        data: `M 0 0 L ${cleanNumber(width)} 0 L ${cleanNumber(width)} ${cleanNumber(y1)} C ${cleanNumber(width / 2)} ${cleanNumber(y1)} ${cleanNumber(width / 2)} ${cleanNumber((height * 23922) / LEGACY_PATH_SPACE)} 0 ${cleanNumber((height * 20172) / LEGACY_PATH_SPACE)} Z`,
    };
}

function magneticDisk(width: number, height: number): PathGeometry {
    const top = ellipseArcCommands(width / 2, height / 6, width / 2, height / 6, 180, 180);
    const bottom = ellipseArcCommands(width / 2, (height * 5) / 6, width / 2, height / 6, 0, 180);
    const face = `${top.move} ${top.arcs} L ${cleanNumber(width)} ${cleanNumber((height * 5) / 6)} ${bottom.arcs} Z`;
    const inner = ellipseArcCommands(width / 2, height / 6, width / 2, height / 6, 0, 180);
    return compoundShape(face, `${inner.move} ${inner.arcs}`);
}

function magneticDrum(width: number, height: number): PathGeometry {
    const right = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 270, 180);
    const left = ellipseArcCommands(width / 6, height / 2, width / 6, height / 2, 90, 180);
    const face = `M ${cleanNumber(width / 6)} 0 L ${cleanNumber((width * 5) / 6)} 0 ${right.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} ${left.arcs} Z`;
    const inner = ellipseArcCommands((width * 5) / 6, height / 2, width / 6, height / 2, 90, 180);
    return compoundShape(face, `${inner.move} ${inner.arcs}`);
}

function onlineStorage(width: number, height: number): PathGeometry {
    const concave = ellipseArcCommands(width, height / 2, width / 6, height / 2, 270, -180);
    const left = ellipseArcCommands(width / 6, height / 2, width / 6, height / 2, 90, 180);
    return {
        kind: "path",
        data: `M ${cleanNumber(width / 6)} 0 L ${cleanNumber(width)} 0 ${concave.arcs} L ${cleanNumber(width / 6)} ${cleanNumber(height)} ${left.arcs} Z`,
    };
}

function offlineStorage(width: number, height: number): PathGeometry {
    const face = polygonPath(
        [
            [0, 0],
            [1, 0],
            [0.5, 1],
        ],
        width,
        height,
    );
    return compoundShape(face, `M ${cleanNumber((width * 2) / 5)} ${cleanNumber((height * 4) / 5)} L ${cleanNumber((width * 3) / 5)} ${cleanNumber((height * 4) / 5)}`);
}

function punchedTape(width: number, height: number): PathGeometry {
    const topLeft = ellipseArcCommands(width / 4, height / 10, width / 4, height / 10, 180, -180);
    const topRight = ellipseArcCommands((width * 3) / 4, height / 10, width / 4, height / 10, 180, 180);
    const bottomRight = ellipseArcCommands((width * 3) / 4, (height * 9) / 10, width / 4, height / 10, 0, -180);
    const bottomLeft = ellipseArcCommands(width / 4, (height * 9) / 10, width / 4, height / 10, 0, 180);
    return {
        kind: "path",
        data: `${topLeft.move} ${topLeft.arcs} ${topRight.arcs} L ${cleanNumber(width)} ${cleanNumber((height * 9) / 10)} ${bottomRight.arcs} ${bottomLeft.arcs} Z`,
    };
}

function magneticTape(width: number, height: number): PathGeometry {
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

function multidocument(width: number, height: number): PathGeometry {
    const x = (value: number) => cleanNumber((width * value) / LEGACY_PATH_SPACE);
    const y = (value: number) => cleanNumber((height * value) / LEGACY_PATH_SPACE);
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

function internalStorage(width: number, height: number): PathGeometry {
    return compoundShape(rectanglePath(width, height), `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 8)} L ${cleanNumber(width)} ${cleanNumber(height / 8)}`);
}

function predefinedProcess(width: number, height: number): PathGeometry {
    return compoundShape(rectanglePath(width, height), `M ${cleanNumber(width / 8)} 0 L ${cleanNumber(width / 8)} ${cleanNumber(height)} M ${cleanNumber((width * 7) / 8)} 0 L ${cleanNumber((width * 7) / 8)} ${cleanNumber(height)}`);
}

function sort(width: number, height: number): PathGeometry {
    return compoundShape(polygonPath(DIAMOND, width, height), `M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`);
}

function or(width: number, height: number): PathGeometry {
    return compoundShape(fullEllipsePath(width, height), `M ${cleanNumber(width / 2)} 0 L ${cleanNumber(width / 2)} ${cleanNumber(height)} M 0 ${cleanNumber(height / 2)} L ${cleanNumber(width)} ${cleanNumber(height / 2)}`);
}

function summingJunction(width: number, height: number): PathGeometry {
    const insetX = (width / 2) * Math.SQRT1_2;
    const insetY = (height / 2) * Math.SQRT1_2;
    return compoundShape(
        fullEllipsePath(width, height),
        `M ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 + insetY)} M ${cleanNumber(width / 2 + insetX)} ${cleanNumber(height / 2 - insetY)} L ${cleanNumber(width / 2 - insetX)} ${cleanNumber(height / 2 + insetY)}`,
    );
}

export const FLOWCHART_GEOMETRY = {
    flowChartAlternateProcess: (width, height) => ({ kind: "rect", radius: Math.min(width, height) / 6 }),
    flowChartCollate: polygon([
        [0, 0],
        [1, 0],
        [0.5, 0.5],
        [1, 1],
        [0, 1],
        [0.5, 0.5],
    ]),
    flowChartConnector: () => ({ kind: "ellipse" }),
    flowChartDecision: polygon(DIAMOND),
    flowChartDelay: delay,
    flowChartDisplay: display,
    flowChartExtract: polygon([
        [0, 1],
        [0.5, 0],
        [1, 1],
    ]),
    flowChartInputOutput: polygon([
        [0, 1],
        [0.2, 0],
        [1, 0],
        [0.8, 1],
    ]),
    flowChartInternalStorage: internalStorage,
    flowChartDocument: documentShape,
    flowChartMagneticDisk: magneticDisk,
    flowChartMagneticDrum: magneticDrum,
    flowChartMagneticTape: magneticTape,
    flowChartManualInput: polygon([
        [0, 0.2],
        [1, 0],
        [1, 1],
        [0, 1],
    ]),
    flowChartManualOperation: polygon([
        [0, 0],
        [1, 0],
        [0.8, 1],
        [0.2, 1],
    ]),
    flowChartMerge: polygon([
        [0, 0],
        [1, 0],
        [0.5, 1],
    ]),
    flowChartMultidocument: multidocument,
    flowChartOfflineStorage: offlineStorage,
    flowChartOffpageConnector: polygon([
        [0, 0],
        [1, 0],
        [1, 0.8],
        [0.5, 1],
        [0, 0.8],
    ]),
    flowChartOnlineStorage: onlineStorage,
    flowChartOr: or,
    flowChartPredefinedProcess: predefinedProcess,
    flowChartPreparation: polygon([
        [0, 0.5],
        [0.2, 0],
        [0.8, 0],
        [1, 0.5],
        [0.8, 1],
        [0.2, 1],
    ]),
    flowChartProcess: () => ({ kind: "rect", radius: 0 }),
    flowChartPunchedCard: polygon([
        [0, 0.2],
        [0.2, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ]),
    flowChartPunchedTape: punchedTape,
    flowChartSort: sort,
    flowChartSummingJunction: summingJunction,
    flowChartTerminator: terminator,
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
