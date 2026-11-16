import { type PathGeometry, pixelPath, polygonPath, type ShapeGeometry } from "./path";

const STAR_INNER_RATIO = 0.382;

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

const polygon =
    (points: ReadonlyArray<readonly [number, number]>): ShapeGeometry =>
    (width, height) => ({ kind: "path", data: polygonPath(points, width, height) });
const regular =
    (vertices: number, innerRatio?: number): ShapeGeometry =>
    (width, height) => ({ kind: "path", data: radialPath(vertices, width, height, innerRatio) });
const star = (points: number) => regular(points, STAR_INNER_RATIO);

function hexagon(width: number, height: number): PathGeometry {
    const inset = Math.min(width, height) / 4;
    return {
        kind: "path",
        data: pixelPath([
            [inset, 0],
            [width - inset, 0],
            [width, height / 2],
            [width - inset, height],
            [inset, height],
            [0, height / 2],
        ]),
    };
}

export const POLYGON_GEOMETRY = {
    triangle: polygon([
        [0.5, 0],
        [1, 1],
        [0, 1],
    ]),
    rtTriangle: polygon([
        [0, 0],
        [1, 1],
        [0, 1],
    ]),
    diamond: polygon([
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
    ]),
    parallelogram: polygon([
        [0.25, 0],
        [1, 0],
        [0.75, 1],
        [0, 1],
    ]),
    trapezoid: polygon([
        [0.25, 0],
        [0.75, 0],
        [1, 1],
        [0, 1],
    ]),
    nonIsoscelesTrapezoid: polygon([
        [0.15, 0],
        [0.75, 0],
        [1, 1],
        [0, 1],
    ]),
    pentagon: regular(5),
    hexagon,
    heptagon: regular(7),
    octagon: regular(8),
    decagon: regular(10),
    dodecagon: regular(12),
    star5: star(5),
    star6: star(6),
    star7: star(7),
    star8: star(8),
    star10: star(10),
    star12: star(12),
    star16: star(16),
    star24: star(24),
    star32: star(32),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
