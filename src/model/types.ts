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
    dashArray?: string;
    beginArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
    endArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
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

export type NormalizedTextDirection = "horizontal" | "vertical" | "vertical270" | "stacked";

export interface NormalizedTextDecoration {
    underline: boolean;
    underlineStyle: "solid" | "double" | "dashed" | "dotted" | "wavy";
    underlineColor?: string;
    strike: boolean;
    doubleStrike: boolean;
}

export interface NormalizedTextLink {
    href: string;
    tooltip?: string;
    slide?: number;
}

export interface NormalizedTextRun {
    text: string;
    fontFace: string;
    fontSize: number;
    color: string;
    bold: boolean;
    italic: boolean;
    decoration: NormalizedTextDecoration;
    verticalAlign: "baseline" | "sub" | "super";
    baselineOffset: number;
    characterSpacing: number;
    highlight?: string;
    outline?: { color: string; width: number };
    glow?: NormalizedShadow;
    shadow?: NormalizedShadow;
    language: string;
    link?: NormalizedTextLink;
    softBreakBefore: boolean;
}

export interface NormalizedTextBullet {
    kind: "bullet" | "number";
    marker: string;
    indent: number;
    level: number;
    start: number;
    numberType?: string;
}

export interface NormalizedTextParagraph {
    runs: NormalizedTextRun[];
    align: "left" | "center" | "right" | "justify";
    rtl: boolean;
    lineHeight?: number;
    spaceBefore: number;
    spaceAfter: number;
    tabStops: ReadonlyArray<{ position: number; alignment: "left" | "right" | "center" | "decimal" }>;
    bullet?: NormalizedTextBullet;
}

export interface NormalizedTextBox {
    paragraphs: NormalizedTextParagraph[];
    margin: [number, number, number, number];
    verticalAlign: "top" | "middle" | "bottom";
    wrap: boolean;
    fit: "none" | "shrink" | "resize";
    direction: NormalizedTextDirection;
    rtl: boolean;
    borderRadius: number;
}

export type NormalizedImageSizing =
    | { type: "stretch" }
    | { type: "contain" | "cover"; x: number; y: number; width: number; height: number }
    | { type: "crop"; offsetX: number; offsetY: number; width: number; height: number };

export interface NormalizedImageLink {
    href: string;
    tooltip?: string;
    slide?: number;
}

export interface NormalizedImage {
    source: string;
    sourceKind: "data" | "path" | "remote";
    sizing: NormalizedImageSizing;
    rounding: boolean;
    opacity: number;
    altText: string;
    link?: NormalizedImageLink;
}

export interface NormalizedShapeLink {
    href: string;
    tooltip?: string;
    slide?: number;
}

export type NormalizedShapeGeometry =
    | { kind: "rect"; radius: number }
    | { kind: "ellipse" }
    | { kind: "line"; inverse: boolean }
    | { kind: "path"; data: string };

export interface NormalizedShape {
    name: string;
    width: number;
    height: number;
    geometry: NormalizedShapeGeometry;
    link?: NormalizedShapeLink;
}
