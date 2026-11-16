import { drawingPath, ellipseArcCommands, LEGACY_PATH_SPACE, type PathGeometry, pixelPath, type ShapeGeometry } from "./path";

/** The icon square every action button draws in: 3/4 of the short side, centred. */
type ButtonBox = { short: number; cx: number; cy: number; half: number; left: number; right: number; top: number; bottom: number };
type FillModifier = "darken" | "darkenLess" | "lighten";
/** The icon paths of one button; `details` are outline-only strokes. */
type ButtonIcon = {
    icon: string;
    details?: string;
    iconModifier?: "darken" | "darkenLess";
    darkLess?: readonly string[];
    dark?: readonly string[];
    light?: readonly string[];
};

function framePath(width: number, height: number): string {
    return pixelPath([
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
    ]);
}

function buttonBox(width: number, height: number): ButtonBox {
    const short = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const half = (short * 3) / 8;
    return { short, cx, cy, half, left: cx - half, right: cx + half, top: cy - half, bottom: cy + half };
}

const faces = (paths: readonly string[], fillModifier: FillModifier) => paths.map(data => ({ data, fillModifier }));

const button =
    (draw: (box: ButtonBox) => ButtonIcon): ShapeGeometry =>
    (width, height) => {
        const base = framePath(width, height);
        const { icon, details = "", iconModifier = "darken", darkLess = [], dark = [], light = [] } = draw(buttonBox(width, height));
        return {
            kind: "path",
            data: `${base} ${icon}`,
            faces: [{ data: base }, ...(icon ? [{ data: icon, fillModifier: iconModifier }] : []), ...faces(darkLess, "darkenLess"), ...faces(dark, "darken"), ...faces(light, "lighten")],
            outlineData: `${base} ${icon} ${details}`,
        };
    };

function blank(width: number, height: number): PathGeometry {
    const base = framePath(width, height);
    return { kind: "path", data: base, faces: [{ data: base }], outlineData: base };
}

function backPrevious({ cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    return {
        icon: pixelPath([
            [left, cy],
            [right, top],
            [right, bottom],
        ]),
    };
}

function forwardNext({ cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    return {
        icon: pixelPath([
            [right, cy],
            [left, bottom],
            [left, top],
        ]),
    };
}

function beginning({ short, cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    const bar = (short * 3) / 32;
    return {
        icon: `${pixelPath([
            [left + (short * 3) / 16, cy],
            [right, top],
            [right, bottom],
        ])} ${pixelPath([
            [left, top],
            [left + bar, top],
            [left + bar, bottom],
            [left, bottom],
        ])}`,
    };
}

function end({ short, cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    const bar = (short * 3) / 32;
    return {
        icon: `${pixelPath([
            [right - (short * 3) / 16, cy],
            [left, bottom],
            [left, top],
        ])} ${pixelPath([
            [right - bar, top],
            [right, top],
            [right, bottom],
            [right - bar, bottom],
        ])}`,
    };
}

function documentIcon({ short, cx, top, bottom }: ButtonBox): ButtonIcon {
    const fold = (short * 3) / 16;
    const documentLeft = cx - (short * 9) / 32;
    const documentRight = cx + (short * 9) / 32;
    const corner = pixelPath([
        [documentRight - fold, top],
        [documentRight - fold, top + fold],
        [documentRight, top + fold],
    ]);
    return {
        icon: pixelPath([
            [documentLeft, top],
            [documentRight - fold, top],
            [documentRight, top + fold],
            [documentRight, bottom],
            [documentLeft, bottom],
        ]),
        details: corner,
        iconModifier: "darkenLess",
        dark: [corner],
    };
}

function home({ short, cx, cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    const unit = (short * 3) / 4;
    const g24 = top + unit / 16;
    const g25 = top + (unit * 3) / 16;
    const g26 = top + (unit * 5) / 16;
    const g27 = top + (unit * 3) / 4;
    const g28 = left + unit / 8;
    const g29 = left + (unit * 7) / 16;
    const g30 = left + (unit * 9) / 16;
    const g31 = left + (unit * 11) / 16;
    const g32 = left + (unit * 13) / 16;
    const g33 = left + (unit * 7) / 8;
    const homeOutline = pixelPath([
        [cx, top],
        [left, cy],
        [g28, cy],
        [g28, bottom],
        [g33, bottom],
        [g33, cy],
        [right, cy],
        [g32, g26],
        [g32, g24],
        [g31, g24],
        [g31, g25],
    ]);
    const strokes = drawingPath().move(g31, g25).line(g32, g26).move(g33, cy).line(g28, cy).move(g29, bottom).line(g29, g27).line(g30, g27).line(g30, bottom).data();
    const chimney = pixelPath([
        [g32, g26],
        [g32, g24],
        [g31, g24],
        [g31, g25],
    ]);
    const body = pixelPath([
        [g28, cy],
        [g28, bottom],
        [g29, bottom],
        [g29, g27],
        [g30, g27],
        [g30, bottom],
        [g33, bottom],
        [g33, cy],
    ]);
    const roof = pixelPath([
        [cx, top],
        [left, cy],
        [right, cy],
    ]);
    const door = pixelPath([
        [g29, g27],
        [g30, g27],
        [g30, bottom],
        [g29, bottom],
    ]);
    return { icon: "", details: `${homeOutline} ${strokes}`, darkLess: [chimney, body], dark: [roof, door] };
}

function information({ short, cx, cy, half, left, top }: ButtonBox): ButtonIcon {
    const circle = ellipseArcCommands(cx, cy, half, half, 270, 360);
    const dotRadius = (short * 9) / 128;
    const dot = ellipseArcCommands(cx, top + (short * 3) / 128 + dotRadius, dotRadius, dotRadius, 270, 360);
    const stemLeft = left + (short * 15) / 64;
    const stemInnerLeft = left + (short * 39) / 128;
    const stemInnerRight = left + (short * 57) / 128;
    const stemRight = left + (short * 33) / 64;
    const y28 = top + (short * 15) / 64;
    const y29 = top + (short * 9) / 32;
    const y30 = top + (short * 39) / 64;
    const y31 = top + (short * 21) / 32;
    const stem = pixelPath([
        [stemLeft, y28],
        [stemInnerRight, y28],
        [stemInnerRight, y30],
        [stemRight, y30],
        [stemRight, y31],
        [stemLeft, y31],
        [stemLeft, y30],
        [stemInnerLeft, y30],
        [stemInnerLeft, y29],
        [stemLeft, y29],
    ]);
    const details = `${dot.move} ${dot.arcs} Z ${stem}`;
    return { icon: `${circle.move} ${circle.arcs} Z`, details, light: [details] };
}

function help({ short, cx, left, top }: ButtonBox): ButtonIcon {
    const g13 = (short * 3) / 4;
    const g14 = g13 / 7;
    const g15 = (g13 * 3) / 14;
    const g16 = (g13 * 2) / 7;
    const g19 = (g13 * 3) / 7;
    const g20 = (g13 * 4) / 7;
    const g21 = (g13 * 17) / 28;
    const g23 = (g13 * 21) / 28;
    const g24 = (g13 * 11) / 14;
    const g27 = top + g16;
    const g29 = top + g21;
    const g30 = top + g23;
    const g31 = top + g24;
    const g33 = left + g15;
    const g36 = left + g19;
    const g37 = left + g20;
    const g41 = g13 / 14;
    const g42 = (g13 * 3) / 28;
    const question = drawingPath().move(g33, g27).arc(g16, g16, 180, 180).arc(g14, g15, 0, 90).arc(g41, g42, 270, -90).line(g37, g30).line(g36, g30).line(g36, g29).arc(g14, g15, 180, 90).arc(g41, g42, 90, -90).arc(g14, g14, 0, -180).close().data();
    const dot = ellipseArcCommands(cx, g31 + g42, g42, g42, 270, 360);
    return { icon: `${question} ${dot.move} ${dot.arcs} Z` };
}

function movie({ short, left, right, top }: ButtonBox): ButtonIcon {
    const g13 = (short * 3) / 4;
    const gx = (value: number) => left + (g13 * value) / LEGACY_PATH_SPACE;
    const gy = (value: number) => top + (g13 * value) / LEGACY_PATH_SPACE;
    return {
        icon: pixelPath([
            [left, gy(5280)],
            [left, gy(9555)],
            [gx(1455), gy(9555)],
            [gx(1905), gy(9067)],
            [gx(2325), gy(9067)],
            [gx(2325), gy(15592)],
            [gx(17010), gy(15592)],
            [gx(17010), gy(13342)],
            [gx(19335), gy(13342)],
            [gx(20595), gy(14580)],
            [right, gy(14580)],
            [right, gy(6630)],
            [gx(20595), gy(6630)],
            [gx(19725), gy(7492)],
            [gx(17010), gy(7492)],
            [gx(17010), gy(6630)],
            [gx(16155), gy(5730)],
            [gx(1905), gy(5730)],
            [gx(1455), gy(5280)],
        ]),
    };
}

function returnIcon({ short, cx, left, right, top, bottom }: ButtonBox): ButtonIcon {
    const g13 = (short * 3) / 4;
    const g14 = (g13 * 7) / 8;
    const g15 = (g13 * 3) / 4;
    const g16 = (g13 * 5) / 8;
    const g17 = (g13 * 3) / 8;
    const g18 = g13 / 4;
    const radius = g13 / 8;
    const g19 = top + g15;
    const g20 = top + g16;
    const g21 = top + g18;
    const g22 = left + g14;
    const g23 = left + g15;
    const g24 = left + g16;
    const g25 = left + g17;
    const g26 = left + g18;
    return {
        icon: drawingPath().move(right, g21).line(g23, top).line(cx, g21).line(g24, g21).line(g24, g20).arc(radius, radius, 0, 90).line(g25, g19).arc(radius, radius, 90, 90).line(g26, g21).line(left, g21).line(left, g20).arc(g17, g17, 180, -90).line(cx, bottom).arc(g17, g17, 90, -90).line(g22, g21).close().data(),
    };
}

function sound({ short, cy, left, right, top, bottom }: ButtonBox): ButtonIcon {
    const g13 = (short * 3) / 4;
    const g20 = top + g13 / 8;
    const g21 = top + (g13 * 5) / 16;
    const g22 = top + (g13 * 11) / 16;
    const g23 = top + (g13 * 7) / 8;
    const g24 = left + (g13 * 5) / 16;
    const g25 = left + (g13 * 5) / 8;
    const g26 = left + (g13 * 3) / 4;
    return {
        icon: pixelPath([
            [left, g21],
            [left, g22],
            [g24, g22],
            [g25, bottom],
            [g25, top],
            [g24, g21],
        ]),
        details: drawingPath().move(g26, g21).line(right, g20).move(g26, cy).line(right, cy).move(g26, g22).line(right, g23).data(),
    };
}

export const ACTION_BUTTON_GEOMETRY = {
    actionButtonBackPrevious: button(backPrevious),
    actionButtonBeginning: button(beginning),
    actionButtonBlank: blank,
    actionButtonDocument: button(documentIcon),
    actionButtonEnd: button(end),
    actionButtonForwardNext: button(forwardNext),
    actionButtonHelp: button(help),
    actionButtonHome: button(home),
    actionButtonInformation: button(information),
    actionButtonMovie: button(movie),
    actionButtonReturn: button(returnIcon),
    actionButtonSound: button(sound),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
