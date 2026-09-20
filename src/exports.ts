import { PuppeteerGen } from "./PuppeterrGen";
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from "./pageLayouts";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION, textMarginToCSS, tableMarginToCSS } from "./defaults";
import { COMPATIBILITY, SHAPE_GEOMETRY_COMPATIBILITY } from "./compatibility";
import {
    inchesToPixels,
    percentageToPixels,
    convertToPixels,
    generatePageCSS,
    colorToCSS,
    alignToCSS,
    valignToCSS,
    pointsToPixels,
} from "./utils";

export {
    PuppeteerGen,
    PAGE_SIZES,
    DEFAULT_PAGE_SIZE,
    PPTX_DEFAULTS,
    PPTX_DEFAULTS_VERSION,
    textMarginToCSS,
    tableMarginToCSS,
    COMPATIBILITY,
    SHAPE_GEOMETRY_COMPATIBILITY,
    inchesToPixels,
    percentageToPixels,
    convertToPixels,
    generatePageCSS,
    colorToCSS,
    alignToCSS,
    valignToCSS,
    pointsToPixels,
};
export default PuppeteerGen;

export type { PageSize, PageLayout, PageSizeName, Orientation } from "./pageLayouts";
export type { FourSideMargin } from "./defaults";
export type { CompatibilityEntry, CompatibilityStatus } from "./compatibility";
export type {
    PptxGenJSLike,
    PptxSlide,
    PptxTableRow,
    PptxTableProps,
    PptxTextProps,
    PptxTextPropsOptions,
    PptxShapeProps,
    PptxWriteProps,
    PptxWriteFileProps,
} from "./pptx";
export type { ColorProps } from "./utils";
