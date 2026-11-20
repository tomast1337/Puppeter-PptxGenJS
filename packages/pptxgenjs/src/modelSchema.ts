import { type CssColor, type DataUri, inches, LINK_URL_SCHEME, type NormalizedPresentation, px } from "@pdflapas/model";
import { z } from "zod";
import { cloneComponentProps } from "#src/components/normalize";
import { isSpaces, isWord, runPieces } from "#src/normalize/advanceGrid";
import { RESOLVED_IMAGE } from "#src/normalize/image";

/**
 * The checks on model JSON another producer built (#282). Each value that reaches CSS, an attribute or an SVG
 * attribute is held to the forms the PptxGenJS normalizer writes, so a foreign model cannot add CSS declarations,
 * external references or links our own decks could not have.
 */

// The forms colorToCSS writes (color.ts): `#RRGGBB`, `rgba(r, g, b, a)` with a JavaScript number alpha, `transparent`.
const CSS_COLOR = /^(?:#[\da-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, \d*\.?\d+(?:e-\d+)?\)|transparent)$/i;
// SVG path data, transform lists and dash arrays: commands, function names, numbers, separators; nothing that ends an attribute value or opens url().
const SVG_SYNTAX = /^[a-z\d().,\s+-]*$/i;
// Written into a quoted CSS string (fontFamilyCSS) and the chart SVG: a control character or `;{}` could end the declaration.
const FONT_FACE = /^[^\u0000-\u001f\u007f;{}]*$/;
// BCP 47 tags as the `lang` attribute takes them (`en-US`); empty leaves the language unknown.
const LANGUAGE = /^[a-z\d-]*$/i;
// normalizeHyperlink's two forms: an allowed URL, or a jump to a slide's `id`.
const SLIDE_LINK = /^#slide-\d+$/;

const MODEL_FIX = "build the model with getModel() or match NormalizedPresentation from @pdflapas/model (docs/HTML_PROFILE.md)";

const finite = z.number();
const nonNegative = z.number().nonnegative();
const pxValue = z.number().transform(px);
const integerFrom = (minimum: number) => z.number().int().min(minimum);
// `as`: CSS_COLOR matched one of the forms CssColor lists.
const cssColor = z
    .string()
    .regex(CSS_COLOR, { error: "is not a CssColor: write #RRGGBB, rgba(r, g, b, a) or transparent, as colorToCSS() does" })
    .transform(value => value as CssColor);
// `as`: RESOLVED_IMAGE matched the data:image/…;base64, form DataUri lists.
const dataUri = z
    .string()
    .regex(RESOLVED_IMAGE, { error: 'is not a data URI: write "data:image/<type>;base64,<data>", or use sourceKind "path" or "remote" for a path or URL' })
    .transform(value => value as DataUri);
const svgSyntax = z.string().regex(SVG_SYNTAX, { error: "holds characters SVG path data, transforms and dash arrays do not use: write numbers, commands and separators only" });
const fontFace = z.string().regex(FONT_FACE, { error: "holds a control character or one of ;{}: write the font's family name" });
const href = z.string().refine(value => LINK_URL_SCHEME.test(value) || SLIDE_LINK.test(value), { error: "is not a supported link: use an http:, https: or mailto: URL, or #slide-<number>" });

const shadow = z.strictObject({ visible: z.boolean(), color: cssColor, blur: finite, offsetX: finite, offsetY: finite, inset: z.boolean() });
const fill = z.strictObject({ visible: z.boolean(), color: cssColor });
const arrow = z.enum(["none", "arrow", "diamond", "oval", "stealth", "triangle"]);
const link = z.strictObject({ href, tooltip: z.string().optional(), slide: integerFrom(1).optional() });

const objectStyle = z.strictObject({
    geometry: z.strictObject({ x: pxValue, y: pxValue, width: pxValue.optional(), height: pxValue.optional() }),
    transform: z.strictObject({ rotation: finite, flipH: z.boolean(), flipV: z.boolean(), opacity: z.number().min(0).max(1) }),
    fill: fill.optional(),
    line: z
        .strictObject({
            visible: z.boolean(),
            color: cssColor,
            width: nonNegative,
            style: z.enum(["solid", "dashed", "dotted"]),
            dashArray: svgSyntax.optional(),
            beginArrow: arrow.optional(),
            endArrow: arrow.optional(),
            beginHeadPath: svgSyntax.optional(),
            endHeadPath: svgSyntax.optional(),
        })
        .optional(),
    shadow: shadow.optional(),
    objectName: z.string(),
});

const textRun = z
    .strictObject({
        text: z.string(),
        fontFace,
        fallbackFaces: z.array(fontFace).optional(),
        fontSize: nonNegative,
        color: cssColor,
        bold: z.boolean(),
        italic: z.boolean(),
        decoration: z.strictObject({
            underline: z.boolean(),
            underlineStyle: z.enum(["solid", "double", "dashed", "dotted", "wavy"]),
            underlineColor: cssColor.optional(),
            underlineFromFont: z.boolean().optional(),
            underlineBand: z.strictObject({ position: finite, thickness: z.number().positive() }).optional(),
            underlineHeavy: z.boolean().optional(),
            strike: z.boolean(),
            doubleStrike: z.boolean(),
        }),
        verticalAlign: z.enum(["baseline", "sub", "super"]),
        baselineOffset: finite,
        characterSpacing: finite,
        wordCharacterSpacing: z.array(finite).optional(),
        spaceCharacterSpacing: z.array(finite).optional(),
        kerning: z.literal(false).optional(),
        syntheticBold: nonNegative.optional(),
        syntheticItalic: finite.optional(),
        nonBreakingHyphen: z.literal("hyphen-minus").optional(),
        highlight: cssColor.optional(),
        outline: z.strictObject({ color: cssColor, width: nonNegative }).optional(),
        glow: shadow.optional(),
        shadow: shadow.optional(),
        language: z.string().regex(LANGUAGE, { error: "is not a language tag: write a BCP 47 tag such as en-US" }),
        link: link.optional(),
        softBreakBefore: z.boolean(),
    })
    .refine(run => run.wordCharacterSpacing === undefined || run.wordCharacterSpacing.length === runPieces(run.text).filter(isWord).length, {
        error: "wordCharacterSpacing must hold one value per word of text (the stretches between spaces and tabs)",
        path: ["wordCharacterSpacing"],
    })
    .refine(run => run.spaceCharacterSpacing === undefined || (run.wordCharacterSpacing !== undefined && run.spaceCharacterSpacing.length === runPieces(run.text).filter(isSpaces).length), {
        error: "spaceCharacterSpacing must hold one value per stretch of spaces in text (a tab ends one), and comes with wordCharacterSpacing",
        path: ["spaceCharacterSpacing"],
    });

const textBox = z.strictObject({
    paragraphs: z.array(
        z.strictObject({
            runs: z.array(textRun),
            align: z.enum(["left", "center", "right", "justify"]),
            textJustify: z.literal("inter-word").optional(),
            rtl: z.boolean(),
            lineBox: z.strictObject({ height: nonNegative, baseline: finite, markBaseline: finite.optional(), breakBaseline: finite.optional() }),
            spaceBefore: finite,
            spaceAfter: finite,
            tabStops: z.array(z.strictObject({ position: finite, alignment: z.enum(["left", "right", "center", "decimal"]) })),
            defaultTabStop: nonNegative,
            bullet: z
                .strictObject({
                    kind: z.enum(["bullet", "number"]),
                    marker: z.string(),
                    indent: finite,
                    level: integerFrom(0),
                    start: z.number().int(),
                    numberType: z.string().optional(),
                })
                .optional(),
        }),
    ),
    margin: z.tuple([finite, finite, finite, finite]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    wrap: z.boolean(),
    fit: z.enum(["none", "shrink", "resize"]),
    direction: z.enum(["horizontal", "vertical", "vertical270", "stacked"]),
    rtl: z.boolean(),
});

const shape = z.strictObject({
    name: z.string(),
    width: pxValue,
    height: pxValue,
    geometry: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("rect"), radius: pxValue }),
        z.strictObject({ kind: z.literal("ellipse") }),
        z.strictObject({ kind: z.literal("line"), inverse: z.boolean() }),
        z.strictObject({
            kind: z.literal("path"),
            data: svgSyntax,
            transform: svgSyntax.optional(),
            faces: z.array(z.strictObject({ data: svgSyntax, fillModifier: z.enum(["darken", "darkenLess", "lighten", "lightenLess"]).optional() })).optional(),
            outlineData: svgSyntax.optional(),
        }),
    ]),
    textInsets: z.tuple([finite, finite, finite, finite]).optional(),
    link: link.optional(),
});

const border = z.strictObject({ visible: z.boolean(), color: cssColor, width: nonNegative, style: z.enum(["solid", "dashed"]), dashArray: svgSyntax.optional() });
const table = z.strictObject({
    width: pxValue,
    height: pxValue.optional(),
    columns: z.array(pxValue),
    rows: z.array(
        z.strictObject({
            height: pxValue.optional(),
            cells: z.array(z.strictObject({ text: textBox, colspan: integerFrom(1), rowspan: integerFrom(1), fill: fill.optional(), borders: z.tuple([border, border, border, border]) })),
        }),
    ),
    contentRowSlack: pxValue.optional(),
});

const imageCommon = {
    sizing: z.discriminatedUnion("type", [z.strictObject({ type: z.literal("stretch") }), z.strictObject({ type: z.enum(["contain", "cover"]), x: pxValue, y: pxValue, width: pxValue, height: pxValue }), z.strictObject({ type: z.literal("crop"), offsetX: pxValue, offsetY: pxValue, width: pxValue, height: pxValue })]),
    rounding: z.boolean(),
    opacity: z.number().min(0).max(1),
    altText: z.string(),
    link: link.optional(),
};
// A path or URL is only a key here: modelToHtml() resolves it, and resolvedImageDataUri() checks what comes back.
const image = z.discriminatedUnion("sourceKind", [z.strictObject({ source: dataUri, sourceKind: z.literal("data"), ...imageCommon }), z.strictObject({ source: z.string(), sourceKind: z.enum(["path", "remote"]), ...imageCommon })]);

const chartType = z.enum(["area", "bar", "bar3D", "bubble", "doughnut", "line", "mixed", "pie", "radar", "scatter"]);
const tickMark = z.enum(["none", "inside", "outside", "cross"]);
const valueAxis = z.strictObject({
    minimum: finite,
    maximum: finite,
    hidden: z.boolean(),
    showTitle: z.boolean(),
    title: z.string(),
    titleColor: cssColor,
    titleFontFace: fontFace,
    titleFontSize: nonNegative,
    titleRotate: finite.optional(),
    labelColor: cssColor,
    labelFontFace: fontFace,
    labelFontSize: nonNegative,
    labelBold: z.boolean(),
    labelItalic: z.boolean(),
    labelRotate: finite,
    labelPosition: z.enum(["none", "low", "high", "nextTo"]),
    labelFormatCode: z.string(),
    lineColor: cssColor,
    lineWidth: nonNegative,
    lineStyle: z.enum(["solid", "dash", "dot"]),
    lineVisible: z.boolean(),
    majorTickMark: tickMark,
    minorTickMark: tickMark,
    majorUnit: finite.optional(),
    logScaleBase: finite.optional(),
    gridLineColor: cssColor,
    gridLineWidth: nonNegative,
    gridLineStyle: z.enum(["solid", "dash", "dot", "none"]),
    gridLineCap: z.enum(["flat", "round", "square"]),
});
const chart = z.strictObject({
    type: chartType,
    series: z.array(
        z.strictObject({
            type: chartType,
            name: z.string(),
            labels: z.array(z.string()),
            values: z.array(finite),
            sizes: z.array(finite).optional(),
            colorIndex: integerFrom(0),
            varyColors: z.boolean(),
            valueAxisIndex: z.union([z.literal(0), z.literal(1)]),
        }),
    ),
    colors: z.array(cssColor),
    colorOpacity: z.number().min(0).max(1),
    showLegend: z.boolean(),
    legendPosition: z.enum(["b", "l", "r", "t", "tr"]),
    showTitle: z.boolean(),
    title: z.string(),
    fontFace,
    fontSize: nonNegative,
    titleFontFace: fontFace,
    titleFontSize: nonNegative,
    titleBold: z.boolean(),
    titleColor: cssColor,
    legendFontFace: fontFace,
    legendFontSize: nonNegative,
    legendColor: cssColor,
    barDirection: z.enum(["bar", "col"]),
    grouping: z.enum(["clustered", "stacked", "percentStacked", "standard"]),
    barGapWidthPercent: finite,
    barGapDepthPercent: finite,
    bar3DShape: z.enum(["box", "cylinder", "cone", "coneToMax", "pyramid", "pyramidToMax"]),
    perspective3D: finite,
    rightAngleAxes3D: z.boolean(),
    rotationX3D: finite,
    rotationY3D: finite,
    gridLineColor: cssColor,
    gridLineWidth: nonNegative,
    axisLineVisible: z.boolean(),
    categoryMajorTickMark: tickMark,
    valueAxisMinimum: finite,
    valueAxisMaximum: finite,
    valueAxes: z.array(valueAxis),
    doughnutHoleSize: finite,
    firstSliceAngle: finite,
    radarStyle: z.enum(["standard", "marker", "filled"]),
    lineSmooth: z.boolean(),
    lineSymbol: z.enum(["circle", "dash", "diamond", "dot", "none", "square", "triangle"]),
    lineSymbolSize: nonNegative,
    lineSize: nonNegative,
    altText: z.string(),
});

// The same check addComponent() applies to props: JSON values only, no reserved keys.
const componentProps = z.unknown().transform((props, context) => {
    try {
        return cloneComponentProps(props);
    } catch (error) {
        context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
        return z.NEVER;
    }
});

const slideObject = z.discriminatedUnion(
    "kind",
    [
        z.strictObject({ kind: z.literal("text"), style: objectStyle, text: textBox, shape: shape.optional() }),
        z.strictObject({ kind: z.literal("shape"), style: objectStyle, shape }),
        z.strictObject({ kind: z.literal("image"), style: objectStyle, image }),
        z.strictObject({ kind: z.literal("table"), style: objectStyle, table }),
        z.strictObject({ kind: z.literal("chart"), style: objectStyle, chart }),
        // The SVG is checked where it is drawn (chartSvg: one <svg> root, no external resources).
        z.strictObject({ kind: z.literal("chartExtension"), style: objectStyle, svg: z.string(), altText: z.string() }),
        z.strictObject({ kind: z.literal("component"), style: objectStyle, component: z.strictObject({ type: z.string().trim().min(1), version: integerFrom(1), props: componentProps }) }),
    ],
    { error: "is not a slide object: kind must be text, shape, image, table, chart, chartExtension or component" },
);

const PAGE_LENGTH_ERROR = "must be a finite number of inches above 0";
const pageLength = z.number({ error: PAGE_LENGTH_ERROR }).positive({ error: PAGE_LENGTH_ERROR }).transform(inches);

// The annotation makes tsc check that every parsed value is a NormalizedPresentation.
const presentation: z.ZodType<NormalizedPresentation> = z.strictObject({
    pageSize: z.strictObject({ width: pageLength, height: pageLength, name: z.string() }),
    metadata: z.strictObject({ title: z.string().optional(), author: z.string().optional(), subject: z.string().optional(), company: z.string().optional(), revision: z.string().optional() }).optional(),
    slides: z.array(z.strictObject({ background: cssColor, color: cssColor, hidden: z.boolean(), objects: z.array(slideObject) })),
});

/** What parseModel() found wrong, one entry per problem, each at its JSON path (`slides[0].background`). */
export class InvalidModelError extends Error {
    readonly issues: ReadonlyArray<{ readonly path: string; readonly message: string }>;

    constructor(issues: ReadonlyArray<{ readonly path: string; readonly message: string }>) {
        super(`model JSON is not a valid presentation model: ${MODEL_FIX}\n${issues.map(issue => `  ${issue.path}: ${issue.message}`).join("\n")}`);
        this.name = "InvalidModelError";
        this.issues = issues;
    }
}

/** `["slides", 0, "background"]` as `slides[0].background`; the root is `model`. */
function jsonPath(path: readonly PropertyKey[]): string {
    let text = "model";
    for (const key of path) text += typeof key === "number" ? `[${key}]` : `.${String(key)}`;
    return text;
}

/**
 * Checks model JSON from another producer (a stored or hand-built getModel() result) and returns it as the typed,
 * branded model modelToHtml() renders. Throws InvalidModelError naming every wrong value's path. A new object:
 * the input is not modified.
 */
export function parseModel(input: unknown): NormalizedPresentation {
    const result = presentation.safeParse(input);
    if (result.success) return result.data;
    throw new InvalidModelError(result.error.issues.map(issue => ({ path: jsonPath(issue.path), message: issue.message })));
}
