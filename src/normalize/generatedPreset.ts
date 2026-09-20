import { GENERATED_PRESET_SHAPES } from "../generatedPresetShapes";
import type { NormalizedShape } from "../model/types";

type PresetName = keyof typeof GENERATED_PRESET_SHAPES;
type PresetDefinition = {
    readonly adjustments: readonly (readonly [string, string])[];
    readonly guides: readonly (readonly [string, string])[];
    readonly paths: readonly {
        readonly w?: string;
        readonly h?: string;
        readonly fill?: string;
        readonly stroke?: string;
        readonly commands: readonly (readonly string[])[];
    }[];
};
type Point = readonly [number, number];

const ANGLE = 60000;
const clean = (value: number) => (Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6)));
const angleRadians = (value: number) => ((value / ANGLE) * Math.PI) / 180;

function variables(width: number, height: number): Record<string, number> {
    const values: Record<string, number> = {
        w: width,
        h: height,
        l: 0,
        t: 0,
        r: width,
        b: height,
        hc: width / 2,
        vc: height / 2,
        ss: Math.min(width, height),
        ls: Math.max(width, height),
        cd2: 180 * ANGLE,
        cd4: 90 * ANGLE,
        cd8: 45 * ANGLE,
        cd16: 22.5 * ANGLE,
        "3cd4": 270 * ANGLE,
        "3cd8": 135 * ANGLE,
        "5cd8": 225 * ANGLE,
        "7cd8": 315 * ANGLE,
    };
    for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 32]) {
        values[`wd${divisor}`] = width / divisor;
        values[`hd${divisor}`] = height / divisor;
        values[`ssd${divisor}`] = values.ss! / divisor;
        values[`lsd${divisor}`] = values.ls! / divisor;
    }
    return values;
}

function formulaValue(token: string, values: Record<string, number>): number {
    const numeric = Number(token);
    if (!Number.isNaN(numeric)) return numeric;
    const value = values[token];
    if (value === undefined) throw new Error(`Unknown DrawingML guide: ${token}`);
    return value;
}

function evaluate(formula: string, values: Record<string, number>): number {
    const [operator, ...tokens] = formula.trim().split(/\s+/);
    const args = tokens.map(token => formulaValue(token, values));
    const [x = 0, y = 0, z = 0] = args;
    switch (operator) {
        case "val":
            return x;
        case "pin":
            return Math.max(x, Math.min(y, z));
        case "*/":
            return z === 0 ? 0 : (x * y) / z;
        case "+-":
            return x + y - z;
        case "+/":
            return (x + y) / z;
        case "?:":
            return x > 0 ? y : z;
        case "abs":
            return Math.abs(x);
        case "at2":
            return ((Math.atan2(y, x) * 180) / Math.PI) * ANGLE;
        case "cat2":
            return x * Math.cos(Math.atan2(z, y));
        case "cos":
            return x * Math.cos(angleRadians(y));
        case "max":
            return Math.max(x, y);
        case "min":
            return Math.min(x, y);
        case "mod":
            return Math.hypot(x, y, z);
        case "sat2":
            return x * Math.sin(Math.atan2(z, y));
        case "sin":
            return x * Math.sin(angleRadians(y));
        case "sqrt":
            return Math.sqrt(Math.max(0, x));
        case "tan":
            return x * Math.tan(angleRadians(y));
        default:
            throw new Error(`Unsupported DrawingML formula: ${operator}`);
    }
}

function radialParameter(angle: number, rx: number, ry: number): number {
    const radians = angleRadians(angle);
    return Math.atan2(rx * Math.sin(radians), ry * Math.cos(radians));
}

function arcSegments(current: Point, rx: number, ry: number, start: number, sweep: number, sx = 1, sy = 1): { data: string; end: Point } {
    const startParameter = radialParameter(start, rx, ry);
    const center: Point = [current[0] - rx * Math.cos(startParameter), current[1] - ry * Math.sin(startParameter)];
    const commands: string[] = [];
    let travelled = 0;
    let end = current;
    while (Math.abs(sweep - travelled) > 1e-6) {
        const remainder = sweep - travelled;
        const step = Math.sign(remainder) * Math.min(Math.abs(remainder), 180 * ANGLE);
        travelled += step;
        const parameter = radialParameter(start + travelled, rx, ry);
        end = [center[0] + rx * Math.cos(parameter), center[1] + ry * Math.sin(parameter)];
        commands.push(`A ${clean(rx * sx)} ${clean(ry * sy)} 0 0 ${step >= 0 ? 1 : 0} ${clean(end[0] * sx)} ${clean(end[1] * sy)}`);
    }
    return { data: commands.join(" "), end };
}

function renderPath(path: PresetDefinition["paths"][number], values: Record<string, number>, width: number, height: number): string {
    const sourceWidth = path.w ? Number(path.w) : width;
    const sourceHeight = path.h ? Number(path.h) : height;
    const sx = width / sourceWidth;
    const sy = height / sourceHeight;
    const x = (token: string) => formulaValue(token, values);
    const y = (token: string) => formulaValue(token, values);
    const commands: string[] = [];
    let current: Point = [0, 0];
    for (const command of path.commands) {
        const [kind, ...args] = command;
        if (kind === "M" || kind === "L") {
            current = [x(args[0]!), y(args[1]!)];
            commands.push(`${kind} ${clean(current[0] * sx)} ${clean(current[1] * sy)}`);
        } else if (kind === "A") {
            const arc = arcSegments(current, x(args[0]!), y(args[1]!), formulaValue(args[2]!, values), formulaValue(args[3]!, values), sx, sy);
            commands.push(arc.data);
            current = arc.end;
        } else if (kind === "Q") {
            current = [x(args[2]!), y(args[3]!)];
            commands.push(`Q ${clean(x(args[0]!) * sx)} ${clean(y(args[1]!) * sy)} ${clean(current[0] * sx)} ${clean(current[1] * sy)}`);
        } else if (kind === "C") {
            current = [x(args[4]!), y(args[5]!)];
            commands.push(`C ${clean(x(args[0]!) * sx)} ${clean(y(args[1]!) * sy)} ${clean(x(args[2]!) * sx)} ${clean(y(args[3]!) * sy)} ${clean(current[0] * sx)} ${clean(current[1] * sy)}`);
        } else commands.push("Z");
    }
    return commands.join(" ");
}

export const GENERATED_PRESET_NAMES = Object.freeze(Object.keys(GENERATED_PRESET_SHAPES) as PresetName[]);

export function generatedPresetGeometry(name: PresetName, width: number, height: number): Extract<NormalizedShape["geometry"], { kind: "path" }> {
    // PptxGenJS 4.0.1 emits the non-standard `folderCorner` token while the
    // DrawingML preset is named `foldedCorner`; LibreOffice therefore renders
    // the pinned reference as an empty shape.
    if (name === "folderCorner") return { kind: "path", data: "M 0 0", faces: [], outlineData: "M 0 0" };
    const definition = GENERATED_PRESET_SHAPES[name] as PresetDefinition;
    const values = variables(width, height);
    for (const [guide, formula] of [...definition.adjustments, ...definition.guides]) values[guide] = evaluate(formula, values);
    const rendered = definition.paths.map(path => ({ path, data: renderPath(path, values, width, height) }));
    const faces = rendered
        .filter(({ path }) => path.fill !== "none")
        .map(({ path, data }) => ({
            data,
            ...(["darken", "darkenLess", "lighten", "lightenLess"].includes(path.fill ?? "") ? { fillModifier: path.fill as "darken" | "darkenLess" | "lighten" | "lightenLess" } : {}),
        }));
    const outlineData = rendered
        .filter(({ path }) => path.stroke !== "false")
        .map(({ data }) => data)
        .join(" ");
    return { kind: "path", data: rendered.map(({ data }) => data).join(" "), faces, outlineData };
}
