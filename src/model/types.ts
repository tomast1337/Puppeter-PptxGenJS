export type Coord = number | `${number}%`;

export interface NormalizedGeometry {
    x: number;
    y: number;
    width?: number;
    height?: number;
}

export interface NormalizedFill {
    visible: boolean;
    color: string;
}

export interface NormalizedLine {
    visible: boolean;
    color: string;
    width: number;
    style: "solid" | "dashed" | "dotted";
}

export interface NormalizedShadow {
    visible: boolean;
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
    inset: boolean;
}

export interface NormalizedTransform {
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    opacity: number;
}

export interface NormalizedObjectStyle {
    geometry: NormalizedGeometry;
    transform: NormalizedTransform;
    fill?: NormalizedFill;
    line?: NormalizedLine;
    shadow?: NormalizedShadow;
    objectName: string;
}
