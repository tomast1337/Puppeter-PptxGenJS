import { ellipseArcCommands, pixelPath, type ShapeGeometry } from "./path";

// The other action buttons are generated (#153). actionButtonInformation stays hand-drawn: with the generated
// geometry its wide crop scores 0.0190 against 0.0189 here (raw RMSE 0.018925 -> 0.018962) and its WASM-deck crop
// p20-Shape4 0.0203 against 0.0202, although the generated "i" shade is closer to the reference.
export const ACTION_BUTTON_GEOMETRY = {
    actionButtonInformation: (width, height) => {
        const base = pixelPath([
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
        ]);
        // The icon square every action button draws in: 3/4 of the short side, centred.
        const short = Math.min(width, height);
        const cx = width / 2;
        const cy = height / 2;
        const half = (short * 3) / 8;
        const left = cx - half;
        const top = cy - half;
        // The icon: a circle, its "i" dot and stem drawn lighter as outline-only details.
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
        const icon = `${circle.move} ${circle.arcs} Z`;

        return {
            kind: "path",
            data: `${base} ${icon}`,
            faces: [{ data: base }, { data: icon, fillModifier: "darken" }, { data: details, fillModifier: "lighten" }],
            outlineData: `${base} ${icon} ${details}`,
        };
    },
} as const satisfies Readonly<Record<string, ShapeGeometry>>;
