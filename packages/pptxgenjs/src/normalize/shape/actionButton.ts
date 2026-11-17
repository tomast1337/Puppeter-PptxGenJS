import { ellipseArcCommands, pixelPath, type ShapeGeometry } from "./path";

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

// The other action buttons are generated (#153). actionButtonInformation stays hand-drawn: with the generated
// geometry its wide crop scores 0.0190 against 0.0189 here (raw RMSE 0.018925 -> 0.018962) and its WASM-deck crop
// p20-Shape4 0.0203 against 0.0202, although the generated "i" shade is closer to the reference.
export const ACTION_BUTTON_GEOMETRY = {
    actionButtonInformation: button(information),
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
