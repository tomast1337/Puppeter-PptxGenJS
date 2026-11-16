import { cleanNumber, drawingPath, OOXML_PERCENT, type PathGeometry, type ShapeGeometry } from "./path";

function ribbonGeometry(width: number, height: number): PathGeometry {
    const rx = width / 32;
    const ry = (height * 16667) / 400000;
    const x2 = width / 4;
    const x3 = x2 + rx;
    const x5 = x2 + width / 8;
    const x4 = x5 - rx;
    const x9 = (width * 3) / 4;
    const x8 = x9 - rx;
    const x6 = x9 - width / 8;
    const x7 = x6 + rx;
    const y1 = (height * 16667) / 200000;
    const y2 = (height * 16667) / OOXML_PERCENT;
    const y4 = height - y2;
    const y3 = y4 / 2;
    const y5 = height - ry;
    const y6 = y2 - ry;
    const main = drawingPath()
        .move(0, 0)
        .line(x4, 0)
        .arc(rx, ry, 270, 180)
        .line(x3, y1)
        .arc(rx, ry, 270, -180)
        .line(x8, y2)
        .arc(rx, ry, 90, -180)
        .line(x7, y1)
        .arc(rx, ry, 90, 180)
        .line(width, 0)
        .line((width * 7) / 8, y3)
        .line(width, y4)
        .line(x9, y4)
        .line(x9, y5)
        .arc(rx, ry, 0, 90)
        .line(x3, height)
        .arc(rx, ry, 90, 90)
        .line(x2, y4)
        .line(0, y4)
        .line(width / 8, y3)
        .close()
        .data();
    const dark = drawingPath().move(x5, ry).arc(rx, ry, 0, 90).line(x3, y1).arc(rx, ry, 270, -180).line(x5, y2).close().move(x6, ry).arc(rx, ry, 180, -90).line(x8, y1).arc(rx, ry, 270, 180).line(x6, y2).close().data();
    const details = drawingPath().move(x5, ry).line(x5, y2).move(x6, y2).line(x6, ry).move(x2, y4).line(x2, y6).move(x9, y6).line(x9, y4).data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function ellipseRibbonGeometry(width: number, height: number): PathGeometry {
    const x2 = width / 4;
    const x3 = x2 + width / 8;
    const x4 = width - x3;
    const x5 = width - x2;
    const x6 = (width * 7) / 8;
    const cx1 = x3 / 2;
    const cx2 = width - cx1;
    const cx4 = x2 / 2;
    const cx5 = width - cx4;
    const dy1 = height / 8;
    const f1 = (4 * dy1) / width;
    const bandHeight = height / 4;
    const dy3 = bandHeight - dy1;
    const y1 = f1 * (x3 - (x3 * x3) / width);
    const cy1 = f1 * cx1;
    const q5 = f1 * (x2 - (x2 * x2) / width);
    const y3 = q5 + dy3;
    const cy3 = dy1 + dy3 - y3 + dy1 + dy3;
    const rh = height - bandHeight;
    const y2 = ((dy1 * 14) / 16 + rh) / 2;
    const y5 = q5 + rh;
    const y6 = y3 + rh;
    const cy4 = f1 * cx4 + rh;
    const cy6 = cy3 + rh;
    const y7 = y1 + dy3;
    const cy7 = bandHeight * 2 - y7;
    const main = drawingPath()
        .move(0, 0)
        .quadratic(cx1, cy1, x3, y1)
        .line(x2, y3)
        .quadratic(width / 2, cy3, x5, y3)
        .line(x4, y1)
        .quadratic(cx2, cy1, width, 0)
        .line(x6, y2)
        .line(width, rh)
        .quadratic(cx5, cy4, x5, y5)
        .line(x5, y6)
        .quadratic(width / 2, cy6, x2, y6)
        .line(x2, y5)
        .quadratic(cx4, cy4, 0, rh)
        .line(width / 8, y2)
        .close()
        .data();
    const dark = drawingPath()
        .move(x3, y7)
        .line(x3, y1)
        .line(x2, y3)
        .quadratic(width / 2, cy3, x5, y3)
        .line(x4, y1)
        .line(x4, y7)
        .quadratic(width / 2, cy7, x3, y7)
        .close()
        .data();
    const details = drawingPath().move(x2, y5).line(x2, y3).move(x5, y3).line(x5, y5).move(x3, y1).line(x3, y7).move(x4, y7).line(x4, y1).data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function leftRightRibbonGeometry(width: number, height: number): PathGeometry {
    const short = Math.min(width, height);
    const x1 = Math.min(short / 2, (width * 15) / 32);
    const x4 = width - x1;
    const x2 = (width * 15) / 32;
    const x3 = (width * 17) / 32;
    const ly1 = height / 6;
    const ly2 = (height * 5) / 12;
    const ly3 = (height * 2) / 3;
    const ly4 = (height * 5) / 6;
    const ry1 = height / 6;
    const ry2 = height / 3;
    const ry3 = (height * 7) / 12;
    const ry4 = (height * 5) / 6;
    const rx = width / 32;
    const ry = (short * 16667) / 400000;
    const main = drawingPath()
        .move(0, ly2)
        .line(x1, 0)
        .line(x1, ly1)
        .line(width / 2, ly1)
        .arc(rx, ry, 270, 180)
        .arc(rx, ry, 270, -180)
        .line(x4, ry2)
        .line(x4, ry1)
        .line(width, ry3)
        .line(x4, height)
        .line(x4, ry4)
        .line(width / 2, ry4)
        .arc(rx, ry, 90, 90)
        .line(x2, ly3)
        .line(x1, ly3)
        .line(x1, ly4)
        .close()
        .data();
    const dark = drawingPath()
        .move(x3, ly1 + ry)
        .arc(rx, ry, 0, 90)
        .arc(rx, ry, 270, -180)
        .line(x3, ry2)
        .close()
        .data();
    const details = drawingPath()
        .move(x3, ly1 + ry)
        .line(x3, ry2)
        .move(x2, ry2 - ry)
        .line(x2, ly3)
        .data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: `${main} ${details}`,
    };
}

function verticalScrollGeometry(width: number, height: number): PathGeometry {
    const curl = Math.min(width, height) / 8;
    const half = curl / 2;
    const quarter = curl / 4;
    const x3 = curl * 1.5;
    const x4 = curl * 2;
    const x6 = width - curl;
    const x7 = width - half;
    const y3 = height - curl;
    const y4 = height - half;
    const main = drawingPath()
        .move(half, height)
        .arc(half, half, 90, -90)
        .line(half, y4)
        .arc(quarter, quarter, 90, -180)
        .line(curl, y3)
        .line(curl, half)
        .arc(half, half, 180, 90)
        .line(x7, 0)
        .arc(half, half, 270, 180)
        .line(x6, curl)
        .line(x6, y4)
        .arc(half, half, 0, 90)
        .close()
        .move(x4, half)
        .arc(half, half, 0, 90)
        .arc(quarter, quarter, 90, 180)
        .close()
        .data();
    const dark = drawingPath().move(x4, half).arc(half, half, 0, 90).arc(quarter, quarter, 90, 180).close().move(curl, y4).arc(half, half, 0, 270).arc(quarter, quarter, 270, 180).close().data();
    const outline = drawingPath()
        .move(curl, y3)
        .line(curl, half)
        .arc(half, half, 180, 90)
        .line(x7, 0)
        .arc(half, half, 270, 180)
        .line(x6, curl)
        .line(x6, y4)
        .arc(half, half, 0, 90)
        .line(half, height)
        .arc(half, half, 90, 180)
        .close()
        .move(x3, 0)
        .arc(half, half, 270, 180)
        .arc(quarter, quarter, 90, 180)
        .line(x4, half)
        .move(x6, curl)
        .line(x3, curl)
        .move(half, y3)
        .arc(quarter, quarter, 270, 180)
        .line(curl, y4)
        .move(half, height)
        .arc(half, half, 90, -90)
        .line(curl, y3)
        .data();
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: outline,
    };
}

/** The `2` ribbons are their base preset mirrored vertically. */
const flippedVertically =
    (draw: (width: number, height: number) => PathGeometry): ShapeGeometry =>
    (width, height) => ({ ...draw(width, height), transform: `matrix(1 0 0 -1 0 ${cleanNumber(height)})` });

export const RIBBON_SCROLL_GEOMETRY = {
    ribbon: ribbonGeometry,
    ribbon2: flippedVertically(ribbonGeometry),
    ellipseRibbon: ellipseRibbonGeometry,
    ellipseRibbon2: flippedVertically(ellipseRibbonGeometry),
    leftRightRibbon: leftRightRibbonGeometry,
    horizontalScroll: (width, height) => ({ ...verticalScrollGeometry(height, width), transform: "matrix(0 1 1 0 0 0)" }),
    verticalScroll: verticalScrollGeometry,
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
