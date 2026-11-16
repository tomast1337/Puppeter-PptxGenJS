import { OOXML_PERCENT, type PathGeometry, presetArcPath, type ShapeGeometry } from "./path";

// presetShapeDefinitions.xml avLst defaults: the brace and bracket corner (adj1/adj) and the bracketPair corner.
const BRACE_CORNER = 8333;
const BRACKET_PAIR_CORNER = 16667;

/** An open outline whose fill closes it with a straight edge. */
function openShape(outline: string): PathGeometry {
    const face = `${outline} Z`;
    return { kind: "path", data: face, faces: [{ data: face }], outlineData: outline };
}

const brace =
    (side: "left" | "right"): ShapeGeometry =>
    (width, height) => {
        const radiusY = Math.min((Math.min(width, height) * BRACE_CORNER) / OOXML_PERCENT, height / 4);
        const path = () => presetArcPath(width / 2, radiusY);
        if (side === "left") {
            return openShape(
                path()
                    .move(width, height)
                    .arc(90, 90)
                    .line(width / 2, height / 2 + radiusY)
                    .arc(0, -90)
                    .arc(90, -90)
                    .line(width / 2, radiusY)
                    .arc(180, 90)
                    .data(),
            );
        }
        return openShape(
            path()
                .move(0, 0)
                .arc(270, 90)
                .line(width / 2, height / 2 - radiusY)
                .arc(180, -90)
                .arc(270, -90)
                .line(width / 2, height - radiusY)
                .arc(0, 90)
                .data(),
        );
    };

function bracePair(width: number, height: number): PathGeometry {
    const radius = (Math.min(width, height) * BRACE_CORNER) / OOXML_PERCENT;
    const x2 = radius * 2;
    const x3 = width - x2;
    const x4 = width - radius;
    const path = () => presetArcPath(radius, radius);
    const left = path()
        .move(x2, height)
        .arc(90, 90)
        .line(radius, height / 2 + radius)
        .arc(0, -90)
        .arc(90, -90)
        .line(radius, radius)
        .arc(180, 90)
        .data();
    const right = path()
        .move(x3, 0)
        .arc(270, 90)
        .line(x4, height / 2 - radius)
        .arc(180, -90)
        .arc(270, -90)
        .line(x4, height - radius)
        .arc(0, 90)
        .data();
    const face = path()
        .move(x2, height)
        .arc(90, 90)
        .line(radius, height / 2 + radius)
        .arc(0, -90)
        .arc(90, -90)
        .line(radius, radius)
        .arc(180, 90)
        .line(x3, 0)
        .arc(270, 90)
        .line(x4, height / 2 - radius)
        .arc(180, -90)
        .arc(270, -90)
        .line(x4, height - radius)
        .arc(0, 90)
        .close()
        .data();
    return { kind: "path", data: face, faces: [{ data: face }], outlineData: `${left} ${right}` };
}

const bracket =
    (side: "left" | "right"): ShapeGeometry =>
    (width, height) => {
        const radiusY = Math.min((Math.min(width, height) * BRACE_CORNER) / OOXML_PERCENT, height / 2);
        const path = () => presetArcPath(width, radiusY);
        if (side === "left") return openShape(path().move(width, height).arc(90, 90).line(0, radiusY).arc(180, 90).data());
        return openShape(
            path()
                .move(0, 0)
                .arc(270, 90)
                .line(width, height - radiusY)
                .arc(0, 90)
                .data(),
        );
    };

function bracketPair(width: number, height: number): PathGeometry {
    const radius = (Math.min(width, height) * BRACKET_PAIR_CORNER) / OOXML_PERCENT;
    const x2 = width - radius;
    const path = () => presetArcPath(radius, radius);
    const face = path()
        .move(0, radius)
        .arc(180, 90)
        .line(x2, 0)
        .arc(270, 90)
        .line(width, height - radius)
        .arc(0, 90)
        .line(radius, height)
        .arc(90, 90)
        .close()
        .data();
    const leftOutline = path().move(radius, height).arc(90, 90).line(0, radius).arc(180, 90).data();
    const rightOutline = path()
        .move(x2, 0)
        .arc(270, 90)
        .line(width, height - radius)
        .arc(0, 90)
        .data();
    return { kind: "path", data: face, faces: [{ data: face }], outlineData: `${leftOutline} ${rightOutline}` };
}

export const BRACE_BRACKET_GEOMETRY = {
    leftBrace: brace("left"),
    rightBrace: brace("right"),
    bracePair,
    leftBracket: bracket("left"),
    rightBracket: bracket("right"),
    bracketPair,
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
