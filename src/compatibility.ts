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
            plainText: "verified", richText: "partial", align: "verified", valign: "verified",
            bold: "verified", italic: "implemented", breakLine: "partial", softBreakBefore: "unsupported",
            bullet: "unsupported", bulletCharacterCode: "unsupported", bulletIndent: "unsupported",
            bulletNumberType: "unsupported", bulletNumberStartAt: "unsupported", color: "verified",
            fontFace: "implemented", fontSize: "verified", highlight: "unsupported", lang: "unsupported",
            tabStops: "unsupported", textDirection: "unsupported", transparency: "partial",
            underline: "partial", baseline: "unsupported", charSpacing: "unsupported", fit: "unsupported",
            fill: "implemented", flipH: "implemented", flipV: "implemented", glow: "unsupported",
            hyperlink: "unsupported", indentLevel: "unsupported", isTextBox: "unsupported", line: "partial",
            lineSpacing: "unsupported", lineSpacingMultiple: "unsupported", margin: "verified",
            outline: "unsupported", paraSpaceAfter: "unsupported", paraSpaceBefore: "unsupported",
            placeholder: "unsupported", rectRadius: "unsupported", rotate: "implemented",
            rtlMode: "unsupported", shadow: "implemented", shape: "unsupported", strike: "unsupported",
            subscript: "unsupported", superscript: "unsupported", vert: "unsupported", wrap: "implemented",
        }),
    }),
    image: Object.freeze<CompatibilityEntry>({
        status: "partial",
        options: Object.freeze({
            x: "implemented", y: "implemented", w: "implemented", h: "implemented",
            path: "implemented", data: "implemented", objectName: "implemented", altText: "implemented",
            flipH: "implemented", flipV: "implemented", hyperlink: "unsupported", placeholder: "unsupported",
            rotate: "implemented", rounding: "implemented", shadow: "implemented", transparency: "implemented",
            sizingContain: "partial", sizingCover: "partial", sizingCrop: "unsupported",
            sizingOffsets: "unsupported",
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
