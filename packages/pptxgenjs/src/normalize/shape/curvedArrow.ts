import { type PathGeometry, presetArcPath, type ShapeGeometry } from "./path";

type CurvedArrowDirection = "right" | "left" | "up" | "down";

/** Default DrawingML curved-arrow guides of the horizontal preset, `w` along the arrow and `h` across it. */
function curvedArrowGuides(w: number, h: number, left: boolean) {
    const short = Math.min(w, h);
    const thickness = short / 4;
    const arrowWidth = short / 2;
    const radiusY = h / 2 - (thickness + arrowWidth) / 4;
    const diameter = radiusY * 2;
    const idx = (Math.sqrt(diameter * diameter - thickness * thickness) * w) / diameter;
    const arrowHeight = Math.min(short / 4, idx);
    const y3 = radiusY + thickness;
    const dy = (Math.sqrt(w * w - arrowHeight * arrowHeight) * radiusY) / w;
    const y5 = radiusY + dy;
    const y7 = y3 + dy;
    const halfDifference = (arrowWidth - thickness) / 2;
    return {
        w,
        thickness,
        radiusY,
        y3,
        y4: y5 - halfDifference,
        y5,
        y6: h - arrowWidth / 2,
        y7,
        y8: y7 + halfDifference,
        x1: left ? arrowHeight : w - arrowHeight,
        sweep: (Math.atan2(dy, arrowHeight) * 180) / Math.PI,
        diagonal: (Math.atan2(thickness / 2, idx) * 180) / Math.PI,
    };
}

type CurvedArrowGuides = ReturnType<typeof curvedArrowGuides>;
type CurvedArrowPaths = { main: string; dark: string; outline: string };

function leftCurvedArrowPaths({ w, radiusY, y3, y4, y5, y6, y8, x1, sweep, diagonal }: CurvedArrowGuides): CurvedArrowPaths {
    const path = () => presetArcPath(w, radiusY);
    return {
        main: path()
            .move(0, y6)
            .line(x1, y4)
            .line(x1, y5)
            .arc(sweep, diagonal - sweep)
            .arc(-diagonal, sweep + diagonal)
            .line(x1, y8)
            .close()
            .data(),
        dark: path().move(w, y3).arc(0, -90).line(0, 0).arc(270, 90).close().data(),
        outline: path()
            .move(w, y3)
            .arc(0, -90)
            .line(0, 0)
            .arc(270, 90)
            .line(w, y3)
            .arc(0, sweep)
            .line(x1, y8)
            .line(0, y6)
            .line(x1, y4)
            .line(x1, y5)
            .arc(sweep, diagonal - sweep)
            .data(),
    };
}

function rightCurvedArrowPaths({ w, thickness, radiusY, y4, y6, y7, y8, x1, sweep, diagonal }: CurvedArrowGuides): CurvedArrowPaths {
    const path = () => presetArcPath(w, radiusY);
    return {
        main: path()
            .move(0, radiusY)
            .arc(180, -sweep)
            .line(x1, y4)
            .line(w, y6)
            .line(x1, y8)
            .line(x1, y7)
            .arc(180 - sweep, sweep)
            .close()
            .data(),
        dark: path()
            .move(w, thickness)
            .arc(270, diagonal - 90)
            .arc(180 - diagonal, 90 + diagonal)
            .close()
            .data(),
        outline: path()
            .move(0, radiusY)
            .arc(180, -sweep)
            .line(x1, y4)
            .line(w, y6)
            .line(x1, y8)
            .line(x1, y7)
            .arc(180 - sweep, sweep)
            .line(0, radiusY)
            .arc(180, 90)
            .line(w, thickness)
            .arc(270, diagonal - 90)
            .data(),
    };
}

function curvedArrowGeometry(width: number, height: number, direction: CurvedArrowDirection): PathGeometry {
    // Transposing the horizontal definitions gives the vertical presets, including their face boundaries.
    const vertical = direction === "up" || direction === "down";
    const left = direction === "left" || direction === "up";
    const guides = vertical ? curvedArrowGuides(height, width, left) : curvedArrowGuides(width, height, left);
    const { main, dark, outline } = left ? leftCurvedArrowPaths(guides) : rightCurvedArrowPaths(guides);
    return {
        kind: "path",
        data: `${main} ${dark}`,
        faces: [{ data: main }, { data: dark, fillModifier: "darkenLess" }],
        outlineData: outline,
        transform: vertical ? "matrix(0 1 1 0 0 0)" : undefined,
    };
}

const curvedArrow =
    (direction: CurvedArrowDirection): ShapeGeometry =>
    (width, height) =>
        curvedArrowGeometry(width, height, direction);

export const CURVED_ARROW_GEOMETRY = {
    curvedRightArrow: curvedArrow("right"),
    curvedLeftArrow: curvedArrow("left"),
    curvedUpArrow: curvedArrow("up"),
    curvedDownArrow: curvedArrow("down"),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
