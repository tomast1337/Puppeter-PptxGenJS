import PptxGenJS from "pptxgenjs";
import { CORE_SVG_SHAPES } from "./normalize/shape";

export type CompatibilityStatus = "unsupported" | "partial" | "implemented" | "verified";

export interface CompatibilityEntry {
    readonly status: CompatibilityStatus;
    readonly options: Readonly<Record<string, CompatibilityStatus>>;
}

const coreShapeSet = new Set<string>(CORE_SVG_SHAPES);
const pptxShapeNames = Object.values(new PptxGenJS().ShapeType) as string[];

export const SHAPE_GEOMETRY_COMPATIBILITY = Object.freeze(Object.fromEntries(
    pptxShapeNames.map(name => [name, coreShapeSet.has(name) ? "implemented" : "unsupported"]),
)) as Readonly<Record<string, "implemented" | "unsupported">>;

export const COMPATIBILITY = Object.freeze({
    text: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            plainText: "verified", numericText: "implemented", richText: "implemented",
            align: "verified", valign: "verified", bold: "verified", italic: "implemented",
            breakLine: "implemented", softBreakBefore: "implemented", hardLineBreaks: "implemented",
            emptyParagraphs: "implemented", bullet: "implemented", bulletCharacterCode: "implemented",
            bulletIndent: "implemented", bulletNumberType: "unsupported", bulletDeprecatedStyle: "implemented",
            bulletNumberStartAt: "implemented",
            color: "verified", fontFace: "implemented", fontSize: "verified", highlight: "implemented",
            lang: "implemented", tabStops: "partial", textDirection: "unsupported", transparency: "implemented",
            underline: "implemented", baseline: "implemented", charSpacing: "implemented", fit: "partial",
            fill: "implemented", flipH: "implemented", flipV: "implemented", glow: "implemented",
            hyperlink: "implemented", indentLevel: "implemented", isTextBox: "unsupported", line: "partial",
            lineSpacing: "implemented", lineSpacingMultiple: "implemented", margin: "verified",
            outline: "implemented", paraSpaceAfter: "implemented", paraSpaceBefore: "implemented",
            placeholder: "unsupported", rectRadius: "partial", rotate: "implemented",
            rtlMode: "implemented", shadow: "implemented", shape: "partial", strike: "implemented",
            subscript: "implemented", superscript: "implemented", vert: "implemented", wrap: "implemented",
            autoFit: "partial", shrinkText: "partial", inset: "unsupported", lineDash: "partial",
            lineHead: "unsupported", lineSize: "partial", lineTail: "unsupported",
            data: "unsupported", path: "unsupported",
        }),
    }),
    image: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified",
            path: "implemented", data: "verified", remotePath: "implemented", fileUrl: "implemented",
            objectName: "implemented", altText: "implemented", flipH: "verified", flipV: "verified",
            hyperlink: "implemented", placeholder: "unsupported", rotate: "verified", rounding: "verified",
            shadow: "verified", transparency: "verified", sizing: "verified", sizingContain: "verified",
            sizingCover: "verified", sizingCrop: "verified", sizingOffsets: "verified",
            png: "implemented", jpeg: "implemented", gifFirstFrame: "implemented",
            svg: "verified", webp: "implemented", malformedSourceErrors: "implemented",
        }),
    }),
    shape: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            align: "unsupported", angleRange: "implemented", arcThicknessRatio: "implemented",
            fill: "verified", fillTransparency: "implemented", flipH: "implemented", flipV: "implemented",
            hyperlink: "implemented", line: "implemented", lineTransparency: "implemented",
            lineDash: "implemented", lineBeginArrow: "implemented", lineEndArrow: "implemented",
            points: "implemented", rectRadius: "implemented", rotate: "implemented", shadow: "partial",
            rectangle: "implemented", roundedRectangle: "implemented", ellipse: "implemented", lineShape: "implemented",
            presetGeometry: "implemented", customGeometry: "implemented", arrows: "implemented",
            text: "unsupported", deprecatedLineSize: "partial", deprecatedLineDash: "partial",
            deprecatedLineHead: "implemented", deprecatedLineTail: "implemented", deprecatedShapeName: "unsupported",
            lineSize: "partial", lineHead: "implemented", lineTail: "implemented", shapeName: "unsupported",
        }),
    }),
    table: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            plainText: "partial", richText: "unsupported", align: "partial", valign: "partial",
            bold: "implemented", italic: "unsupported", breakLine: "partial", bullet: "unsupported",
            color: "implemented", fontFace: "partial", fontSize: "implemented", highlight: "unsupported",
            lang: "unsupported", softBreakBefore: "unsupported", tabStops: "unsupported",
            textDirection: "unsupported", transparency: "unsupported", underline: "unsupported",
            fill: "implemented", margin: "verified", border: "unsupported", colspan: "unsupported",
            rowspan: "unsupported", colW: "unsupported", rowH: "unsupported", inheritance: "partial",
            autoPage: "unsupported", autoPageCharWeight: "unsupported", autoPageLineWeight: "unsupported",
            autoPageRepeatHeader: "unsupported", autoPageHeaderRows: "unsupported",
            autoPageSlideStartY: "unsupported", verbose: "unsupported", tableToSlides: "unsupported",
        }),
    }),
} as const);
