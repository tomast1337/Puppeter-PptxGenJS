import { UnsupportedChartError } from "./chart/errors";
import { CHART_TYPE_COMPATIBILITY, COMPATIBILITY, SHAPE_GEOMETRY_COMPATIBILITY } from "./compatibility";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION, tableMarginToCSS, textMarginToCSS } from "./defaults";
import { PuppeteerGen } from "./PuppeterrGen";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./pageLayouts";
import { alignToCSS, colorToCSS, convertToPixels, generatePageCSS, inchesToPixels, percentageToPixels, pointsToPixels, valignToCSS } from "./utils";

export {
    alignToCSS,
    CHART_TYPE_COMPATIBILITY,
    COMPATIBILITY,
    colorToCSS,
    convertToPixels,
    DEFAULT_PAGE_SIZE,
    generatePageCSS,
    inchesToPixels,
    PAGE_SIZES,
    PPTX_DEFAULTS,
    PPTX_DEFAULTS_VERSION,
    PuppeteerGen,
    percentageToPixels,
    pointsToPixels,
    SHAPE_GEOMETRY_COMPATIBILITY,
    tableMarginToCSS,
    textMarginToCSS,
    UnsupportedChartError,
    valignToCSS,
};
export default PuppeteerGen;

export type { UnsupportedChartDetails, UnsupportedChartReason } from "./chart/errors";
export type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
export type { CompatibilityEntry, CompatibilityStatus } from "./compatibility";
export type { FourSideMargin } from "./defaults";
export type { PuppeteerSlide } from "./PuppeterrGen";
export type { Orientation, PageLayout, PageSize, PageSizeName } from "./pageLayouts";
export type {
    PptxGenJSLike,
    PptxShapeProps,
    PptxSlide,
    PptxTableProps,
    PptxTableRow,
    PptxTextProps,
    PptxTextPropsOptions,
    PptxWriteFileProps,
    PptxWriteProps,
} from "./pptx";
export type { ColorProps } from "./utils";
