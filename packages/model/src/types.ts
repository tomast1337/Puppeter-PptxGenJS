import type { Inches, Px } from "./units";

declare const color: unique symbol;

/**
 * A color that is safe to write into CSS or SVG as is. Only the PptxGenJS color normalizer (`colorToCSS`) makes one,
 * in exactly these forms: `#RRGGBB` (the caller's six hex digits, case kept), `rgba(r, g, b, a)` (channels 0 to 255,
 * alpha in 0 to 1, below 1) for a color with transparency, or `transparent`. Type-only: the JSON holds a plain string.
 */
export type CssColor = string & { readonly [color]: "css-color" };

declare const dataUri: unique symbol;

/**
 * A resolved image source, `data:image/…;base64,…`: the only image source the HTML profile writes as `src`. Only the
 * PptxGenJS image normalizer (`imageDataUri`, `dataUri`) and its check on what `resolveImage` returns make one.
 * Type-only: the JSON holds a plain string.
 */
export type DataUri = string & { readonly [dataUri]: "data-uri" };

export interface PageSize {
    width: Inches;
    height: Inches;
    name: string;
}

export type ComponentValue = null | boolean | number | string | ComponentValue[] | { [key: string]: ComponentValue };
export type ComponentProps = { [key: string]: ComponentValue };

/** Names and versions are application-owned contracts, independent of document schema versions. */
export interface ComponentInput {
    type: string;
    version: number;
    props: ComponentProps;
}

export type Coord = number | `${number}%`;

/** The object's frame on the slide, from the slide's top left corner. */
export interface NormalizedGeometry {
    x: Px;
    y: Px;
    width?: Px;
    height?: Px;
}

export interface NormalizedFill {
    visible: boolean;
    color: CssColor;
}

export interface NormalizedLine {
    visible: boolean;
    color: CssColor;
    width: number;
    style: "solid" | "dashed" | "dotted";
    dashArray?: string;
    beginArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
    endArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
    /** Resolved head outlines: closed SVG path data (px) with the line end at the origin and +x pointing out of the line, filled in the line color. */
    beginHeadPath?: string;
    endHeadPath?: string;
}

export interface NormalizedShadow {
    visible: boolean;
    color: CssColor;
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
    underlineColor?: CssColor;
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
    color: CssColor;
    bold: boolean;
    italic: boolean;
    decoration: NormalizedTextDecoration;
    /** What the run asked for; `fontSize` and `baselineOffset` already hold the resulting size and shift. */
    verticalAlign: "baseline" | "sub" | "super";
    /** Baseline shift in px, positive up. */
    baselineOffset: number;
    /** Extra advance after each character in px: `charSpacing`, plus on the PowerPoint target its advance grid's rounding. */
    characterSpacing: number;
    /** `false`: drawn without the font's pair kerning (PowerPoint, below the run's `kern` size); omitted: kerned. */
    kerning?: false;
    highlight?: CssColor;
    outline?: { color: CssColor; width: number };
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
    /**
     * Each line's height and its baseline's distance below the line top, in px (a font-independent line box, as the
     * target draws it). `markBaseline` replaces `baseline` on the paragraph's last line and `breakBaseline` on a line
     * that ends in a soft break (`softBreakBefore` on the next run); absent, those lines use `baseline` too.
     */
    lineBox: { height: number; baseline: number; markBaseline?: number; breakBaseline?: number };
    /** Adjacent spaces collapse to the larger (CSS margins); a producer that wants them added moves the space after here. */
    spaceBefore: number;
    /** 0 on a text box's last paragraph: PowerPoint and LibreOffice leave its space after out of the text height. */
    spaceAfter: number;
    /** Explicit stops, `position` in px from the text area's left edge, in increasing order. */
    tabStops: ReadonlyArray<{ position: number; alignment: "left" | "right" | "center" | "decimal" }>;
    /** Spacing of the default stops after the last explicit one, in px. */
    defaultTabStop: number;
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
}

export interface NormalizedTableBorder {
    visible: boolean;
    color: CssColor;
    width: number;
    style: "solid" | "dashed";
    /** SVG stroke-dasharray in px for a dashed border, resolved from the DrawingML preset dash. */
    dashArray?: string;
}

export interface NormalizedTableCell {
    text: NormalizedTextBox;
    colspan: number;
    rowspan: number;
    fill?: NormalizedFill;
    borders: [NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder, NormalizedTableBorder];
}

export interface NormalizedTableRow {
    height?: Px;
    cells: NormalizedTableCell[];
}

export interface NormalizedTable {
    width: Px;
    height?: Px;
    columns: Px[];
    rows: NormalizedTableRow[];
    /**
     * Px a row without a height (when the table has none either) is taller than its tallest cell's text and
     * margins, as free space of each cell's text area, where the cell's vertical anchor places the text.
     */
    contentRowSlack?: Px;
}

/** `contain`/`cover`: the image's box inside the object's frame; `crop`: the whole image's size and the offset of the part the frame shows. */
export type NormalizedImageSizing = { type: "stretch" } | { type: "contain" | "cover"; x: Px; y: Px; width: Px; height: Px } | { type: "crop"; offsetX: Px; offsetY: Px; width: Px; height: Px };

export interface NormalizedImageLink {
    href: string;
    tooltip?: string;
    slide?: number;
}

/** A `data` image is inlined at normalization; a `path` or `remote` one keeps the caller's string until `toHtml()` resolves it. */
export type NormalizedImageSource = { source: DataUri; sourceKind: "data" } | { source: string; sourceKind: "path" | "remote" };

export type NormalizedImage = NormalizedImageSource & {
    sizing: NormalizedImageSizing;
    rounding: boolean;
    opacity: number;
    altText: string;
    link?: NormalizedImageLink;
};

export interface NormalizedShapeLink {
    href: string;
    tooltip?: string;
    slide?: number;
}

export type NormalizedShapeGeometry =
    | { kind: "rect"; radius: Px }
    | { kind: "ellipse" }
    | { kind: "line"; inverse: boolean }
    | {
          kind: "path";
          data: string;
          transform?: string;
          faces?: ReadonlyArray<{ data: string; fillModifier?: "darken" | "darkenLess" | "lighten" | "lightenLess" }>;
          outlineData?: string;
      };

export interface NormalizedShape {
    name: string;
    width: Px;
    height: Px;
    geometry: NormalizedShapeGeometry;
    textInsets?: [number, number, number, number];
    link?: NormalizedShapeLink;
}

export type NormalizedChartType = "area" | "bar" | "bar3D" | "bubble" | "doughnut" | "line" | "mixed" | "pie" | "radar" | "scatter";

export interface NormalizedChartSeries {
    type: NormalizedChartType;
    name: string;
    labels: string[];
    values: number[];
    sizes?: number[];
    colorIndex: number;
    varyColors: boolean;
    valueAxisIndex: 0 | 1;
}

export interface NormalizedChartValueAxis {
    minimum: number;
    maximum: number;
    hidden: boolean;
    showTitle: boolean;
    title: string;
    titleColor: CssColor;
    titleFontFace: string;
    titleFontSize: number;
    titleRotate?: number;
    labelColor: CssColor;
    labelFontFace: string;
    labelFontSize: number;
    labelBold: boolean;
    labelItalic: boolean;
    labelRotate: number;
    labelPosition: "none" | "low" | "high" | "nextTo";
    labelFormatCode: string;
    lineColor: CssColor;
    lineWidth: number;
    lineStyle: "solid" | "dash" | "dot";
    lineVisible: boolean;
    majorTickMark: "none" | "inside" | "outside" | "cross";
    minorTickMark: "none" | "inside" | "outside" | "cross";
    majorUnit?: number;
    logScaleBase?: number;
    gridLineColor: CssColor;
    gridLineWidth: number;
    gridLineStyle: "solid" | "dash" | "dot" | "none";
    gridLineCap: "flat" | "round" | "square";
}

export interface NormalizedChart {
    type: NormalizedChartType;
    series: NormalizedChartSeries[];
    colors: CssColor[];
    colorOpacity: number;
    showLegend: boolean;
    legendPosition: "b" | "l" | "r" | "t" | "tr";
    showTitle: boolean;
    title: string;
    fontFace: string;
    fontSize: number;
    titleFontFace: string;
    titleFontSize: number;
    titleBold: boolean;
    titleColor: CssColor;
    legendFontFace: string;
    legendFontSize: number;
    legendColor: CssColor;
    barDirection: "bar" | "col";
    grouping: "clustered" | "stacked" | "percentStacked" | "standard";
    barGapWidthPercent: number;
    barGapDepthPercent: number;
    bar3DShape: "box" | "cylinder" | "cone" | "coneToMax" | "pyramid" | "pyramidToMax";
    perspective3D: number;
    rightAngleAxes3D: boolean;
    rotationX3D: number;
    rotationY3D: number;
    gridLineColor: CssColor;
    gridLineWidth: number;
    axisLineVisible: boolean;
    categoryMajorTickMark: "none" | "inside" | "outside" | "cross";
    valueAxisMinimum: number;
    valueAxisMaximum: number;
    valueAxes: NormalizedChartValueAxis[];
    doughnutHoleSize: number;
    firstSliceAngle: number;
    radarStyle: "standard" | "marker" | "filled";
    lineSmooth: boolean;
    lineSymbol: "circle" | "dash" | "diamond" | "dot" | "none" | "square" | "triangle";
    lineSymbolSize: number;
    lineSize: number;
    altText: string;
}

/**
 * One slide object as recorded by the PptxGenJS-compatible API, after option
 * normalization. Every variant is plain JSON data. `component` keeps only the
 * registry key, version and JSON props; rendering it needs the application's
 * registered definition. `chartExtension` keeps the SVG produced from the
 * caller's renderer input, because ECharts options may contain functions.
 */
export type NormalizedSlideObject =
    | { kind: "text"; style: NormalizedObjectStyle; text: NormalizedTextBox; shape?: NormalizedShape }
    | { kind: "shape"; style: NormalizedObjectStyle; shape: NormalizedShape }
    | { kind: "image"; style: NormalizedObjectStyle; image: NormalizedImage }
    | { kind: "table"; style: NormalizedObjectStyle; table: NormalizedTable }
    | { kind: "chart"; style: NormalizedObjectStyle; chart: NormalizedChart }
    | { kind: "chartExtension"; style: NormalizedObjectStyle; svg: string; altText: string }
    | { kind: "component"; style: NormalizedObjectStyle; component: ComponentInput };

export interface NormalizedSlide {
    /** CSS colors, as applied to the slide container. */
    background: CssColor;
    color: CssColor;
    /** Left out of the HTML and the PDF; the other slides keep their number. */
    hidden: boolean;
    /**
     * In paint order. PptxGenJS's background picture is the first object (an image named "Background" over the whole
     * slide) and its slide number the last (a text box named "Slide Number").
     */
    objects: NormalizedSlideObject[];
}

/**
 * Document properties, as PptxGenJS writes them to docProps/core.xml (title, subject, author as dc:creator, revision)
 * and docProps/app.xml (company). An absent or empty one is not written: no element in the HTML, no entry in the PDF.
 */
export interface PresentationMetadata {
    title?: string;
    author?: string;
    subject?: string;
    company?: string;
    revision?: string;
}

export interface NormalizedPresentation {
    pageSize: PageSize;
    metadata?: PresentationMetadata;
    slides: NormalizedSlide[];
}
