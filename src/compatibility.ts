import { CORE_SVG_SHAPES } from "./normalize/shape";

export type CompatibilityStatus = "unsupported" | "partial" | "implemented" | "verified";

export interface CompatibilityEntry {
    readonly status: CompatibilityStatus;
    readonly options: Readonly<Record<string, CompatibilityStatus>>;
}

export const SHAPE_GEOMETRY_COMPATIBILITY = Object.freeze(Object.fromEntries(
    CORE_SVG_SHAPES.map(name => [name, "implemented"]),
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
            text: "partial", deprecatedLineSize: "implemented", deprecatedLineDash: "implemented",
            deprecatedLineHead: "implemented", deprecatedLineTail: "implemented", deprecatedShapeName: "implemented",
            lineSize: "implemented", lineHead: "implemented", lineTail: "implemented", shapeName: "implemented",
        }),
    }),
    table: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "verified", y: "verified", w: "verified", h: "verified", objectName: "implemented",
            plainText: "verified", richText: "verified", align: "verified", valign: "verified",
            bold: "verified", italic: "verified", breakLine: "verified", bullet: "verified",
            color: "verified", fontFace: "verified", fontSize: "verified", highlight: "implemented",
            lang: "implemented", softBreakBefore: "implemented", tabStops: "partial",
            textDirection: "verified", transparency: "verified", underline: "verified",
            fill: "verified", margin: "verified", border: "verified", colspan: "verified",
            rowspan: "verified", colW: "verified", rowH: "verified", inheritance: "verified",
            autoPage: "verified", autoPageCharWeight: "implemented", autoPageLineWeight: "implemented",
            autoPageRepeatHeader: "verified", autoPageHeaderRows: "verified",
            autoPageSlideStartY: "verified", newSlideStartY: "implemented",
            verbose: "unsupported", tableToSlides: "verified",
            addImage: "implemented", addShape: "verified", addTable: "implemented", addText: "verified",
            slideMargin: "verified", addHeaderToEach: "implemented", masterSlideName: "unsupported",
        }),
    }),
} as const);
