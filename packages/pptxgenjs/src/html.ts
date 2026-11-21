// Browser-safe entry: must not load puppeteer, jsdom or node:* modules (enforced by tests/html.test.ts and scripts/build.ts).
import { UnsupportedChartError } from "./chart/errors";
import { API_COMPATIBILITY, CHART_TYPE_COMPATIBILITY, COMPATIBILITY, SHAPE_GEOMETRY_COMPATIBILITY } from "./compatibility";
import { parseComponentProps } from "./components/schema";
import { PPTX_DEFAULTS, PPTX_DEFAULTS_VERSION } from "./defaults";
import { FontFileError, readFontWinMetrics, readGlyphAdvances } from "./fontMetrics";
import { tableMarginToCSS, textMarginToCSS } from "./normalize/margin";
import { PuppeteerGen } from "./PuppeteerGen";
import { UnsupportedFeatureError } from "./UnsupportedFeatureError";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./pageLayouts";
import { alignToCSS, valignToCSS } from "./alignment";
import { colorToCSS } from "./color";
import { generatePageCSS } from "./pageCss";
import { completeProfileHtml, pptxHtmlDocument } from "./render/completion";
import { InvalidModelError, parseModel } from "./modelSchema";
import { modelToHtml } from "./render/document";
import { IMAGE_SOURCE_LIMITS, UnresolvedImageError } from "./normalize/image";
import { TABLE_HTML_LIMITS } from "./normalize/table/htmlLimits";
import { POWERPOINT_FACES } from "./target";
import { inchesToPixels, percentageToPixels, pointsToPixels } from "@pdflapas/model";
import { convertToPixels } from "./units";

export {
    alignToCSS,
    API_COMPATIBILITY,
    CHART_TYPE_COMPATIBILITY,
    COMPATIBILITY,
    colorToCSS,
    // Fills the values a hand-written or edited profile document may omit, from PPTX_DEFAULTS (#69).
    completeProfileHtml,
    convertToPixels,
    DEFAULT_PAGE_SIZE,
    FontFileError,
    generatePageCSS,
    // The default image resolvers' timeout, size and concurrency limits (#149).
    IMAGE_SOURCE_LIMITS,
    inchesToPixels,
    // What parseModel() and modelToHtml() throw for model JSON that is not a valid model (#282).
    InvalidModelError,
    // The model -> HTML step for producers that build the JSON model themselves (#69); checks the model first.
    modelToHtml,
    PAGE_SIZES,
    // Checks model JSON from another producer and returns the typed model (#282).
    parseModel,
    // For @pdflapas/react, which applies component schemas the same way as the registry.
    parseComponentProps,
    PPTX_DEFAULTS,
    PPTX_DEFAULTS_VERSION,
    // Stored, edited or hand-written profile HTML -> the renderer input, completed with PptxGenJS defaults (#69).
    pptxHtmlDocument,
    PuppeteerGen,
    percentageToPixels,
    // Reads a font file's metrics for the `fontMetrics` option (#249).
    readFontWinMetrics,
    // Reads a font file's advance widths for the `resolveGlyphAdvances` option (the PowerPoint advance grid).
    readGlyphAdvances,
    pointsToPixels,
    // The faces the PowerPoint target needs installed, with what goes wrong without each (#407).
    POWERPOINT_FACES,
    SHAPE_GEOMETRY_COMPATIBILITY,
    // The size and nesting limits on tableToSlides() HTML markup (#359).
    TABLE_HTML_LIMITS,
    tableMarginToCSS,
    textMarginToCSS,
    // What toHtml() throws when a resolveImage result is not a data URI (#284).
    UnresolvedImageError,
    UnsupportedChartError,
    UnsupportedFeatureError,
    valignToCSS,
};
export default PuppeteerGen;

export type { UnsupportedChartDetails, UnsupportedChartReason } from "./chart/errors";
export type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
export type { ApiEntry, ApiStatus, CompatibilityEntry, CompatibilityStatus } from "./compatibility";
export type { ComponentContext, ComponentDefinition, ComponentInput, ComponentOptions, ComponentProps, ComponentValue } from "./components/types";
export type { FontWinMetrics, FourSideMargin, GlyphAdvances } from "./defaults";
export type { PowerPointFace, PowerPointFaceRole, RenderingTarget } from "./target";
export type { MissingFont, MissingFontPolicy, NormalizedPresentation, NormalizedSlide, NormalizedSlideObject } from "@pdflapas/model";
export { MissingFontError } from "@pdflapas/model";
export type { ImageSourceOptions } from "./normalize/image";
export type { PdfMetadataOptions } from "./normalize/pdfMetadata";
export type { TableHtmlLimits } from "./normalize/table/htmlLimits";
export type { PuppeteerGenOptions } from "./PuppeteerGen";
export type { PuppeteerSlide } from "./PuppeteerSlide";
export type { Orientation, PageLayout, PageSize, PageSizeInput, PageSizeName } from "./pageLayouts";
export type { PptxGenJSLike, PptxShapeProps, PptxSlide, PptxTableProps, PptxTableRow, PptxTextProps, PptxTextPropsOptions, PptxWriteFileProps, PptxWriteProps } from "./pptx";
export type { HtmlPresentationDocument, ModelToHtmlOptions, PresentationRenderer } from "./render/document";
export type { ComponentLookup } from "./render/slide";
export type { ColorProps } from "./color";
