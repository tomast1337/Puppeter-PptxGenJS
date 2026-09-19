// Main exports for the PuppeteerGen library
export { PuppeteerGen } from "./PuppeterrGen";
export { PAGE_SIZES, DEFAULT_PAGE_SIZE } from "./pageLayouts";
export type { PageSize, PageLayout, PageSizeName, Orientation } from "./pageLayouts";
export { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION, textMarginToCSS, tableMarginToCSS } from "./defaults";
export type { FourSideMargin } from "./defaults";
export { 
    inchesToPixels, 
    percentageToPixels, 
    convertToPixels, 
    generatePageCSS,
    colorToCSS,
    alignToCSS,
    valignToCSS,
    pointsToPixels
} from "./utils";
