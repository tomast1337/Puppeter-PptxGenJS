import type PptxGenJS from "pptxgenjs";
import { cleanNumber, ellipseArcCommands, type PathGeometry, type ShapeGeometry } from "./path";

/** The [start, end] angles (degrees) each preset draws without `angleRange`. */
const DEFAULT_ANGLE_RANGES = { arc: [270, 0], pie: [0, 270], chord: [45, 270], blockArc: [180, 0] } as const;
const MIN_INNER_RADIUS = 0.001;
const DEFAULT_ARC_THICKNESS_RATIO = 0.5;

function normalizedSweep(start: number, end: number): number {
    const delta = (((end - start) % 360) + 360) % 360;
    return delta === 0 ? 360 : delta;
}

/** The outer ellipse arc of an angle-range preset, from `angleRange` or the preset's default range. */
function outerArc(shapeName: keyof typeof DEFAULT_ANGLE_RANGES, options: PptxGenJS.ShapeProps, width: number, height: number) {
    const range = options.angleRange ?? DEFAULT_ANGLE_RANGES[shapeName];
    const start = ((range[0] % 360) + 360) % 360;
    const end = ((range[1] % 360) + 360) % 360;
    const sweep = normalizedSweep(start, end);
    return { end, sweep, outer: ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, start, sweep) };
}

function arc(width: number, height: number, options: PptxGenJS.ShapeProps): PathGeometry {
    const { outer } = outerArc("arc", options, width, height);
    const face = `${outer.move} ${outer.arcs} L ${cleanNumber(width / 2)} ${cleanNumber(height / 2)} Z`;
    const outline = `${outer.move} ${outer.arcs}`;
    return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
}

function pie(width: number, height: number, options: PptxGenJS.ShapeProps): PathGeometry {
    const { outer } = outerArc("pie", options, width, height);
    return { kind: "path", data: `${outer.move} ${outer.arcs} L ${cleanNumber(width / 2)} ${cleanNumber(height / 2)} Z` };
}

function pieWedge(width: number, height: number): PathGeometry {
    const arc = ellipseArcCommands(width, height, width, height, 180, 90);
    return { kind: "path", data: `${arc.move} ${arc.arcs} L ${cleanNumber(width)} ${cleanNumber(height)} Z` };
}

function chord(width: number, height: number, options: PptxGenJS.ShapeProps): PathGeometry {
    const { outer } = outerArc("chord", options, width, height);
    return { kind: "path", data: `${outer.move} ${outer.arcs} Z` };
}

function blockArc(width: number, height: number, options: PptxGenJS.ShapeProps): PathGeometry {
    const { outer, end, sweep } = outerArc("blockArc", options, width, height);
    const ratio = Math.min(1, Math.max(0, options.arcThicknessRatio ?? DEFAULT_ARC_THICKNESS_RATIO));
    const thickness = (Math.min(width, height) * ratio) / 2;
    const innerX = Math.max(width / 2 - thickness, MIN_INNER_RADIUS);
    const innerY = Math.max(height / 2 - thickness, MIN_INNER_RADIUS);
    const inner = ellipseArcCommands(width / 2, height / 2, innerX, innerY, end, -sweep);
    return {
        kind: "path",
        data: `${outer.move} ${outer.arcs} L ${cleanNumber(inner.start[0])} ${cleanNumber(inner.start[1])} ${inner.arcs} Z`,
    };
}

function donut(width: number, height: number): PathGeometry {
    const thickness = Math.min(width, height) / 4;
    const innerX = Math.max(width / 2 - thickness, MIN_INNER_RADIUS);
    const innerY = Math.max(height / 2 - thickness, MIN_INNER_RADIUS);
    const outer = ellipseArcCommands(width / 2, height / 2, width / 2, height / 2, 180, 360);
    const inner = ellipseArcCommands(width / 2, height / 2, innerX, innerY, 180, -360);
    return { kind: "path", data: `${outer.move} ${outer.arcs} Z ${inner.move} ${inner.arcs} Z` };
}

export const CIRCULAR_GEOMETRY = { arc, pie, pieWedge, chord, blockArc, donut } as const satisfies Readonly<Record<string, ShapeGeometry>>;
