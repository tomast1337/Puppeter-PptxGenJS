export type CompatibilityStatus = "unsupported" | "partial" | "implemented" | "verified";

export interface CompatibilityEntry {
    readonly status: CompatibilityStatus;
    readonly options: Readonly<Record<string, CompatibilityStatus>>;
}

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
            align: "unsupported", angleRange: "unsupported", arcThicknessRatio: "unsupported",
            fill: "verified", fillTransparency: "implemented", flipH: "implemented", flipV: "implemented",
            hyperlink: "unsupported", line: "implemented", lineTransparency: "implemented",
            lineDash: "partial", lineBeginArrow: "unsupported", lineEndArrow: "unsupported",
            points: "unsupported", rectRadius: "unsupported", rotate: "implemented", shadow: "implemented",
            rectangle: "partial", ellipse: "unsupported", lineShape: "unsupported",
            presetGeometry: "unsupported", customGeometry: "unsupported", arrows: "unsupported",
            text: "unsupported", deprecatedLineSize: "partial", deprecatedLineDash: "partial",
            deprecatedLineHead: "unsupported", deprecatedLineTail: "unsupported",
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
