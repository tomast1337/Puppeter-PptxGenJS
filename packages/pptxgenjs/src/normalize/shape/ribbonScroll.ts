import { drawingPath, type PathGeometry, type ShapeGeometry } from "./path";

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

// The other ribbons and scrolls are generated (#153). leftRightRibbon stays hand-drawn: with the generated geometry its
// tall crop scores 0.0173 against 0.0172 here, in both backends (one pixel). The spec writes adj3 as 16667, the hand copy
// uses the exact 1/6 it stands for, which shifts the fold by 0.00024 px.
export const RIBBON_SCROLL_GEOMETRY = {
    leftRightRibbon: leftRightRibbonGeometry,
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
