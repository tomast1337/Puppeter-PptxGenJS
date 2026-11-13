// Browser-safe entry: must not load puppeteer, jsdom or node:* modules (enforced by tests/html.test.ts and scripts/build.ts).
import { UnsupportedChartError } from "./chart/errors";
import { CHART_TYPE_COMPATIBILITY, COMPATIBILITY, SHAPE_GEOMETRY_COMPATIBILITY } from "./compatibility";
import { parseComponentProps } from "./components/schema";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION, tableMarginToCSS, textMarginToCSS } from "./defaults";
import { PuppeteerGen } from "./PuppeteerGen";
import { UnsupportedFeatureError } from "./UnsupportedFeatureError";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./pageLayouts";
import { alignToCSS, valignToCSS } from "./alignment";
import { colorToCSS } from "./color";
import { generatePageCSS } from "./pageCss";
import { modelToHtml } from "./render/document";
import { convertToPixels, inchesToPixels, percentageToPixels, pointsToPixels } from "./units";

export {
    alignToCSS,
    CHART_TYPE_COMPATIBILITY,
    COMPATIBILITY,
    colorToCSS,
    convertToPixels,
    DEFAULT_PAGE_SIZE,
    generatePageCSS,
    inchesToPixels,
    // The model -> HTML step for producers that build the JSON model themselves (#69).
    modelToHtml,
    PAGE_SIZES,
    // For @pdfdeck/react, which applies component schemas the same way as the registry.
    parseComponentProps,
    PPTX_DEFAULTS,
    PPTX_DEFAULTS_VERSION,
    PuppeteerGen,
    percentageToPixels,
    pointsToPixels,
    SHAPE_GEOMETRY_COMPATIBILITY,
    tableMarginToCSS,
    textMarginToCSS,
    UnsupportedChartError,
    UnsupportedFeatureError,
    valignToCSS,
};
export default PuppeteerGen;

export type { UnsupportedChartDetails, UnsupportedChartReason } from "./chart/errors";
export type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
export type { CompatibilityEntry, CompatibilityStatus } from "./compatibility";
export type { ComponentContext, ComponentDefinition, ComponentInput, ComponentOptions, ComponentProps, ComponentValue } from "./components/types";
export type { FourSideMargin } from "./defaults";
export type { NormalizedPresentation, NormalizedSlide, NormalizedSlideObject } from "@pdfdeck/model";
export type { PuppeteerGenOptions, PuppeteerSlide } from "./PuppeteerGen";
export type { Orientation, PageLayout, PageSize, PageSizeName } from "./pageLayouts";
export type { PptxGenJSLike, PptxShapeProps, PptxSlide, PptxTableProps, PptxTableRow, PptxTextProps, PptxTextPropsOptions, PptxWriteFileProps, PptxWriteProps } from "./pptx";
export type { HtmlPresentationDocument, ModelRenderer, ModelToHtmlOptions, PresentationRenderer } from "./render/document";
export type { ComponentLookup } from "./render/slide";
export type { ColorProps } from "./color";
