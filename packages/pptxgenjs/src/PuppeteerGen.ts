import type PptxGenJS from "pptxgenjs";
import type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
import { normalizeComponent } from "./components/normalize";
import { ComponentRegistry } from "./components/registry";
import type { ComponentDefinition, ComponentInput, ComponentOptions, ComponentProps } from "./components/types";
import { DEFAULT_RENDERING_TARGET, PPTX_DEFAULTS, PPTXGENJS_VERSION, RENDERING_TARGETS, type RenderingTarget } from "./defaults";
import { ALIGN_H, ALIGN_V, CHART_TYPE, DEPRECATED_CHART_TYPE, DEPRECATED_SCHEME_COLOR, DEPRECATED_SHAPE_TYPE, OUTPUT_TYPE, SCHEME_COLOR, SHAPE_TYPE } from "./enums";
import type { NormalizedImage, NormalizedPresentation, NormalizedSlide, NormalizedSlideObject, PresentationMetadata } from "@pdflapas/model";
import { normalizeChart } from "./normalize/chart";
import { findHtmlTable, normalizeHtmlTable } from "./normalize/table/html";
import { type ImageSourceOptions, imageResolver, normalizeImage, resolveRemoteImageSource } from "./normalize/image";
import { normalizeObjectStyle } from "./normalize/object";
import { normalizeShape, normalizeShapeLine, normalizeShapeTextBox, normalizeTextLine, straightLineLength } from "./normalize/shape";
import { normalizeSlideNumber } from "./normalize/slideNumber";
import { normalizeColor, normalizeLine } from "./normalize/style";
import { normalizeTable } from "./normalize/table";
import { paginateTableRows } from "./normalize/table/pagination";
import { collapseTextMargins, normalizeText, type TextInput } from "./normalize/text";
import type { PageSize } from "./pageLayouts";
import { CUSTOM_PAGE_SIZE_NAME, DEFAULT_PAGE_SIZE, PPTX_LAYOUT_PAGE_SIZES } from "./pageLayouts";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import { chartSize, renderChartExtension, renderChartExtensionSvg } from "./render/chart";
import { renderComponent } from "./render/component";
import { type HtmlPresentationDocument, lazyDocument, modelToHtml, type PresentationRenderer } from "./render/document";
import { convertPdfOutput, downloadPdf, resolveFileName, resolveOutputType } from "./output";
import { UnsupportedFeatureError } from "./UnsupportedFeatureError";
import { pixelsToInches } from "./units";
import { createBrowserDocument, objectIdScope } from "./render/slide";

/** A `placeholder` names one on the slide's layout, which only defineSlideMaster() can define. */
function placeholderError(method: "addText" | "addImage"): UnsupportedFeatureError {
    return new UnsupportedFeatureError(`${method}({ placeholder })`, "Placeholders come from slide layouts, which need defineSlideMaster(), and PdfLapas has no slide masters. Remove `placeholder` and give the object its own x, y, w, h and style.", "property");
}

/**
 * Whether a master name is PptxGenJS 4.0.1's built-in layout ("DEFAULT"), the only one that exists without defineSlideMaster().
 * PptxGenJS treats a falsy name as none; any other name needs a master, so it throws instead of drawing a plain slide.
 */
function isBuiltInMaster(name: unknown, feature: string, workaround: string): boolean {
    if (!name) return false;
    if (name === PPTX_DEFAULTS.presentation.layoutName) return true;
    throw new UnsupportedFeatureError(feature, `Slide masters need defineSlideMaster(), and PdfLapas has no slide masters. ${workaround}`, "property");
}

export class PuppeteerSlide implements PptxSlide {
    /** `getDocument` gives the `context.document` of components rendered to check them when they are added; toHtml() does not use it. */
    constructor(
        pageSize: PageSize,
        private readonly getDocument: () => Document,
        private readonly slideIndex: number,
        getContinuationSlide: (offset: number) => PuppeteerSlide,
        /** PptxGenJS's `setSlideNumber` callback: every slide's `slideNumber` setter also sets the master's. */
        private readonly setMasterSlideNumber: (props: PptxGenJS.SlideNumberProps | null) => void,
        private readonly components = new ComponentRegistry(),
        /** `pres.theme.bodyFontFace`: the font of text, table cells and chart legends that name none (PowerPoint's `+mn-lt`). */
        private readonly bodyFontFace: () => string = () => PPTX_DEFAULTS.theme.bodyFontFace,
        /** The presentation's rendering target, which text is normalized for. */
        private readonly target: RenderingTarget = DEFAULT_RENDERING_TARGET,
    ) {
        this.pageSize = pageSize;
        this.getContinuationSlide = getContinuationSlide;
        this.background = {
            color: PPTX_DEFAULTS.slide.backgroundColor,
            type: "solid",
        };
        this.color = PPTX_DEFAULTS.slide.color;
        this.hidden = false;
        this.newAutoPagedSlides = [];
        this.bkgd = PPTX_DEFAULTS.slide.backgroundColor;
    }
    pageSize: PageSize;
    private _background: PptxGenJS.BackgroundProps = { color: PPTX_DEFAULTS.slide.backgroundColor };
    private _bkgd: string = PPTX_DEFAULTS.slide.backgroundColor;
    private _color: string = PPTX_DEFAULTS.slide.color;
    private _hidden: boolean = PPTX_DEFAULTS.slide.hidden;
    private _slideNumber: PptxGenJS.SlideNumberProps | null = null;
    /** The background picture, checked when it is set; drawn under every object over the whole slide. */
    private backgroundImage: NormalizedImage | undefined;
    private readonly getContinuationSlide: (offset: number) => PuppeteerSlide;
    newAutoPagedSlides: PptxGenJS.PresSlide[];
    private objectCounts: Record<string, number> = {};
    /** Normalized, JSON-serializable record of this slide; toHtml() renders the slide from it alone. */
    readonly model: NormalizedSlide = {
        background: normalizeColor(PPTX_DEFAULTS.slide.backgroundColor),
        color: normalizeColor(PPTX_DEFAULTS.slide.color),
        hidden: PPTX_DEFAULTS.slide.hidden,
        objects: [],
    };

    get background(): PptxGenJS.BackgroundProps {
        return this._background;
    }

    set background(value: PptxGenJS.BackgroundProps) {
        // PptxGenJS takes the picture of a deprecated object `bkgd` set before (`src` as `path`) and ignores
        // `background.src`. A picture stays once set: a later color-only background does not remove it.
        const bkgd: unknown = this._bkgd;
        const old = typeof bkgd === "object" && bkgd !== null ? (bkgd as { data?: string; path?: string; src?: string }) : {};
        const data = old.data || value?.data;
        const path = old.src || old.path || value?.path;
        if (data || path) this.backgroundImage = normalizeImage({ ...(data ? { data } : {}), ...(path ? { path } : {}) }, this.pageSize);
        this._background = value;
        // PptxGenJS copies the deprecated `fill` to `color`.
        const color = value?.color ?? value?.fill;
        if (!color) return;
        this.model.background = normalizeColor({ ...value, color });
    }

    get bkgd(): string {
        return this._bkgd;
    }

    set bkgd(value: string) {
        this._bkgd = value;
        // An object (`{ path | data | src }`, deprecated) draws nothing until `background` is set, as in PptxGenJS.
        if (typeof value !== "string") return;
        this.model.background = normalizeColor(value);
    }

    get color(): string {
        return this._color;
    }

    set color(value: string) {
        this._color = value;
        this.model.color = normalizeColor(value);
    }

    get hidden(): boolean {
        return this._hidden;
    }

    set hidden(value: boolean) {
        // A hidden slide is left out of the PDF (toHtml() does not write it), as LibreOffice and PowerPoint export it.
        this._hidden = value;
        this.model.hidden = Boolean(value);
    }

    get slideNumber(): PptxGenJS.SlideNumberProps {
        // PptxGenJS returns null until a slide number is set; its declaration file leaves null out.
        return this._slideNumber as PptxGenJS.SlideNumberProps;
    }

    set slideNumber(value: PptxGenJS.SlideNumberProps) {
        this._slideNumber = value;
        this.setMasterSlideNumber(value);
    }

    /**
     * The slide's model as getModel() returns it: the background picture first, stretched over `pageSize` (the
     * presentation's), then the slide's objects, then its number, which PptxGenJS writes last. `masterSlideNumber` is
     * the `slideNumber` set last on any slide.
     */
    toModel(pageSize: PageSize, masterSlideNumber: PptxGenJS.SlideNumberProps | null): NormalizedSlide {
        const backgroundStyle = () => normalizeObjectStyle({ x: 0, y: 0, w: pageSize.width, h: pageSize.height }, PPTX_DEFAULTS.image, pageSize, PPTX_DEFAULTS.backgroundImage.objectName);
        const background: NormalizedSlideObject[] = this.backgroundImage ? [{ kind: "image", style: backgroundStyle(), image: this.backgroundImage }] : [];
        const slideNumber = this._slideNumber ? [normalizeSlideNumber(this._slideNumber, masterSlideNumber ?? {}, this.slideIndex + 1, this.pageSize, this.bodyFontFace(), this.target)] : [];
        // PptxGenJS writes the picture alone, so its transparent parts show white (LibreOffice), not the color.
        const color = this.backgroundImage ? normalizeColor(PPTX_DEFAULTS.slide.backgroundColor) : this.model.background;
        return { ...this.model, background: color, objects: [...background, ...this.model.objects, ...slideNumber] };
    }

    private nextObjectName(kind: string, explicit?: string): string {
        const index = this.objectCounts[kind] ?? 0;
        this.objectCounts[kind] = index + 1;
        return explicit ?? `${kind} ${index}`;
    }

    private addObject(object: NormalizedSlideObject): this {
        this.model.objects.push(object);
        return this;
    }

    private nextIdScope(): string {
        return objectIdScope(this.slideIndex, this.model.objects.length);
    }

    addComponent(input: ComponentInput, options: ComponentOptions): this {
        const normalized = normalizeComponent(input, options, this.pageSize, options?.objectName ?? "Component");
        const definition = this.components.get(normalized.input.type, normalized.input.version);
        // Application code: render it once here so its validation and render errors throw from addComponent
        // and leave the slide unchanged. The markup is dropped; toHtml() renders the model again.
        renderComponent(normalized, definition, this.nextIdScope(), this.getDocument);
        // The default name is only consumed after a successful render.
        const objectName = this.nextObjectName("Component", options.objectName);
        return this.addObject({ kind: "component", style: { ...normalized.style, objectName }, component: normalized.input });
    }

    // PptxGenJS declares `data: any[]`; `unknown[]` accepts every argument that does and is narrowed below.
    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: unknown[], options?: PptxGenJS.IChartOpts | undefined): PptxGenJS.Slide {
        // PptxGenJS treats the second argument as the shared options object for
        // IChartMulti[] calls; each mixed entry already carries its own data.
        const chartOptions = Array.isArray(type) && !Array.isArray(data) ? (data as unknown as PptxGenJS.IChartOpts) : (options ?? {});
        const style = normalizeObjectStyle(
            {
                x: chartOptions.x,
                y: chartOptions.y,
                w: chartOptions.w,
                h: chartOptions.h,
                objectName: chartOptions.objectName,
            },
            PPTX_DEFAULTS.chart,
            this.pageSize,
            this.nextObjectName("Chart", chartOptions.objectName),
        );
        const chart = normalizeChart(type, Array.isArray(data) ? (data as PptxGenJS.OptsChartData[]) : [], { ...chartOptions, legendFontFace: chartOptions.legendFontFace ?? this.bodyFontFace() });
        chartSize(style);
        return this.addObject({ kind: "chart", style, chart });
    }

    addChartEx(input: ChartExtensionInput, options: ChartExtensionOptions): PuppeteerSlide {
        const style = normalizeObjectStyle(options, PPTX_DEFAULTS.chart, this.pageSize, this.nextObjectName("Chart", options.objectName));
        const svg = renderChartExtensionSvg(input, style);
        const altText = options.altText ?? "";
        // Parses the caller's SVG so a non-SVG root or an external reference throws here; the markup is dropped.
        renderChartExtension(svg, style, altText, this.nextIdScope());
        return this.addObject({ kind: "chartExtension", style, svg, altText });
    }

    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
        if (options.placeholder !== undefined) throw placeholderError("addImage");
        const image = normalizeImage(options, this.pageSize);
        const { transparency: _imageTransparency, ...opaqueOptions } = options;
        const geometryOptions = options.sizing ? { ...opaqueOptions, w: options.sizing.w, h: options.sizing.h } : opaqueOptions;
        const style = normalizeObjectStyle(geometryOptions, PPTX_DEFAULTS.image, this.pageSize, this.nextObjectName("Image", options.objectName), {
            shadow: true,
        });
        return this.addObject({ kind: "image", style, image });
    }

    addMedia(_options: PptxGenJS.MediaProps): PptxGenJS.Slide {
        throw new UnsupportedFeatureError("addMedia", "A PDF cannot play audio or video; add a poster frame with addImage() and link the media through its `hyperlink` option.");
    }

    addNotes(_notes: string): PptxGenJS.Slide {
        // PptxGenJS writes notes to the notes page only; the slide, and so a PDF of it, never shows them.
        return this;
    }

    addShape(shapeName: PptxGenJS.SHAPE_NAME | "custGeom", options?: PptxGenJS.ShapeProps | undefined): PptxGenJS.Slide {
        const shapeOptions = options ?? {};
        const style = normalizeObjectStyle(shapeOptions, PPTX_DEFAULTS.shape, this.pageSize, this.nextObjectName("Shape", shapeOptions.objectName ?? shapeOptions.shapeName), { fill: true, shadow: true });
        style.line = normalizeShapeLine(shapeOptions, line => normalizeLine(line, straightLineLength(shapeName, style.geometry.width ?? 0, style.geometry.height ?? 0)));
        const shape = normalizeShape(shapeName, shapeOptions, style.geometry.width ?? 0, style.geometry.height ?? 0, this.pageSize);
        return this.addObject({ kind: "shape", style, shape });
    }

    addTable(tableRows: PptxGenJS.TableRow[], options?: PptxGenJS.TableProps | undefined): PptxGenJS.Slide {
        const tableOptions = options ?? {};
        this.newAutoPagedSlides = [];
        if (tableOptions.autoPage) {
            const pages = paginateTableRows(tableRows, tableOptions, this.pageSize);
            const continuationSlides: PuppeteerSlide[] = [];
            pages.forEach((page, index) => {
                const target = index === 0 ? this : this.getContinuationSlide(index);
                if (index > 0) continuationSlides.push(target);
                target.addTable(page.rows, {
                    ...tableOptions,
                    y: page.y,
                    rowH: page.rowHeights,
                    autoPage: false,
                });
            });
            this.newAutoPagedSlides = continuationSlides as unknown as PptxGenJS.PresSlide[];
            return this;
        }
        const table = normalizeTable(tableRows, { ...tableOptions, fontFace: tableOptions.fontFace ?? this.bodyFontFace() }, this.pageSize, this.target);
        const tableStyle = normalizeObjectStyle(
            {
                ...tableOptions,
                w: pixelsToInches(table.width),
                h: table.height === undefined ? undefined : pixelsToInches(table.height),
            },
            {
                x: PPTX_DEFAULTS.table.x,
                y: PPTX_DEFAULTS.table.y,
                w: pixelsToInches(table.width),
            },
            this.pageSize,
            this.nextObjectName("Table", tableOptions.objectName),
        );
        return this.addObject({ kind: "table", style: tableStyle, table });
    }

    addText(text: TextInput, options?: PptxGenJS.TextPropsOptions | undefined): PptxGenJS.Slide {
        const textOptions = options ?? {};
        if (textOptions.placeholder !== undefined) throw placeholderError("addText");
        // Text transparency is a run color property, not object opacity.
        const { transparency: _textTransparency, ...boxOptions } = textOptions;
        const textStyle = normalizeObjectStyle(boxOptions, PPTX_DEFAULTS.text, this.pageSize, this.nextObjectName("Text", textOptions.objectName), {
            fill: true,
            shadow: true,
        });
        textStyle.line = normalizeTextLine(textOptions, straightLineLength(textOptions.shape ?? "", textStyle.geometry.width ?? 0, textStyle.geometry.height ?? 0));
        const normalizedText = normalizeText(text, { color: this.color, ...textOptions, fontFace: textOptions.fontFace ?? this.bodyFontFace() }, this.target);
        const height = textStyle.geometry.height ?? 0;
        if (!textOptions.shape) return this.addObject({ kind: "text", style: textStyle, text: collapseTextMargins(normalizedText, height) });
        const shapeOptions = textOptions as unknown as PptxGenJS.ShapeProps;
        const shape = normalizeShape(textOptions.shape, shapeOptions, textStyle.geometry.width ?? 0, height, this.pageSize);
        return this.addObject({ kind: "text", style: textStyle, text: collapseTextMargins(normalizeShapeTextBox(normalizedText, shape), height), shape });
    }
}

/** Runtime adapters. The Node entry supplies jsdom, filesystem image paths and Puppeteer by default. */
export interface PuppeteerGenOptions {
    /** Turns the toHtml() document into PDF bytes for toPdf() and writeFile(); every renderer reads the HTML (#69). */
    renderer?: PresentationRenderer;
    /** Resolves an addImage() path or URL to a data URI before serialization. */
    resolveImage?: (source: string) => Promise<string>;
    /**
     * Limits and confinement of the default resolver: `timeoutMs`, `maxBytes`, `baseDir` (Node entry) and
     * `allowRemote`. Unset, any readable path and any http(s) URL resolve, as in PptxGenJS, within the default
     * limits. Cannot be combined with `resolveImage`.
     */
    imageSources?: ImageSourceOptions;
    /** Creates the documents tableToSlides() parses HTML strings into and components may build elements in, only when one is needed. */
    createDocument?: () => Document;
    /**
     * Whose rendering the PDF matches where LibreOffice and PowerPoint draw the same file differently: "libreoffice"
     * (the default) or "powerpoint". PuppeteerGenLibreOffice and PuppeteerGenPowerPoint set it.
     */
    target?: RenderingTarget;
}

/** The constructor's `target`, checked: a misspelled one would otherwise render silently for the default. */
function renderingTarget(target: unknown): RenderingTarget {
    if (target === undefined) return DEFAULT_RENDERING_TARGET;
    if (typeof target === "string" && Object.hasOwn(RENDERING_TARGETS, target)) return target as RenderingTarget; // `as`: hasOwn checked it is a key
    throw new TypeError(
        `PuppeteerGen option \`target\` must be one of ${Object.keys(RENDERING_TARGETS)
            .map(name => `"${name}"`)
            .join(", ")}, got ${JSON.stringify(target)}`,
    );
}

function isBuiltInLayout(name: string): name is keyof typeof PPTX_LAYOUT_PAGE_SIZES {
    return Object.hasOwn(PPTX_LAYOUT_PAGE_SIZES, name);
}

// PptxGenJS 4.0.1 declares `PlaceholderType` but its instance has no such member (it reads undefined), so neither has this one.
export class PuppeteerGen implements Omit<PptxGenJSLike, "PlaceholderType"> {
    private pageSize: PageSize;
    /** The name last assigned to `layout`; undefined until then, as in PptxGenJS. */
    private layoutName: string | undefined;
    private presLayoutName: string;
    /** `defineLayout()` sizes by name, which `layout` can then select (PptxGenJS's `LAYOUTS`). */
    private readonly definedLayouts = new Map<string, PageSize>();
    private themeProps: PptxGenJS.ThemeProps | undefined;
    private rtl: boolean = PPTX_DEFAULTS.presentation.rtlMode;
    // PptxGenJS writes these to docProps/core.xml and app.xml; toHtml() writes them to <head> and the renderers to the PDF.
    // Only what the caller sets: PptxGenJS's defaults ("PptxGenJS", "PptxGenJS Presentation", "1") are its branding,
    // not the caller's, so an unset one reads "" and reaches neither the HTML nor the PDF (owner decision, #102).
    private metadata: PresentationMetadata = {};
    /** The `slideNumber` set last on any slide: PptxGenJS writes it to the master, which slide numbers inherit from. */
    private masterSlideNumber: PptxGenJS.SlideNumberProps | null = null;
    private readonly components = new ComponentRegistry();
    private slides: PuppeteerSlide[] = [];
    private readonly renderer: PresentationRenderer | undefined;
    private readonly resolveImage: (source: string) => Promise<string>;
    private readonly createDocument: () => Document;
    private readonly target: RenderingTarget;
    /** The `context.document` of components checked in addComponent(), created the first time one reads it. */
    private readonly componentDocument: () => Document;

    constructor(pageSize: PageSize = DEFAULT_PAGE_SIZE, options: PuppeteerGenOptions = {}) {
        this.pageSize = pageSize;
        this.presLayoutName = pageSize === DEFAULT_PAGE_SIZE ? PPTX_DEFAULTS.presentation.layouts.LAYOUT_16x9.presLayoutName : pageSize.name;
        this.renderer = options.renderer;
        this.resolveImage = imageResolver(options, resolveRemoteImageSource);
        this.createDocument = options.createDocument ?? createBrowserDocument;
        this.target = renderingTarget(options.target);
        this.componentDocument = lazyDocument(this.createDocument);
    }

    get version(): string {
        return PPTXGENJS_VERSION;
    }

    /**
     * PptxGenJS `layout`: LAYOUT_16x9, LAYOUT_16x10, LAYOUT_4x3, LAYOUT_WIDE or a `defineLayout()` name. The page size
     * applies to every slide, as PptxGenJS writes one slide size; a slide's percentage positions use the size it had when
     * it was added, as PptxGenJS resolves them against that slide's layout.
     */
    get layout(): string {
        // PptxGenJS returns undefined until a layout is assigned, although its declaration says string.
        return this.layoutName as string;
    }

    set layout(name: string) {
        const defined = this.definedLayouts.get(name);
        if (defined) {
            this.pageSize = defined;
            this.presLayoutName = name;
        } else if (isBuiltInLayout(name)) {
            this.pageSize = PPTX_LAYOUT_PAGE_SIZES[name];
            this.presLayoutName = PPTX_DEFAULTS.presentation.layouts[name].presLayoutName;
        } else {
            // PptxGenJS throws Error('UNKNOWN-LAYOUT') here; keep that code and say how to fix it.
            throw new Error(`UNKNOWN-LAYOUT: '${name}' is not a layout. Use ${Object.keys(PPTX_LAYOUT_PAGE_SIZES).join(", ")}, or call pres.defineLayout({ name: '${name}', width, height }) first.`);
        }
        this.layoutName = name;
    }

    /** PptxGenJS `presLayout`: the current page size in EMU and its PptxGenJS name (`screen16x9`, a `defineLayout()` name). */
    get presLayout(): PptxGenJS.PresLayout {
        const emuPerInch = PPTX_DEFAULTS.units.emuPerInch;
        return { name: this.presLayoutName, width: Math.round(this.pageSize.width * emuPerInch), height: Math.round(this.pageSize.height * emuPerInch) };
    }

    /**
     * PptxGenJS `theme`. `bodyFontFace` is the font of text, table cells and chart legends that name none, as PowerPoint
     * resolves their `+mn-lt` from theme1.xml. `headFontFace` only styles title placeholders, which need a slide master.
     */
    get theme(): PptxGenJS.ThemeProps {
        // PptxGenJS returns undefined until a theme is assigned, although its declaration says ThemeProps.
        return this.themeProps as PptxGenJS.ThemeProps;
    }

    set theme(value: PptxGenJS.ThemeProps) {
        for (const key of ["headFontFace", "bodyFontFace"] as const) {
            const font: unknown = value?.[key];
            if (font !== undefined && typeof font !== "string") throw new TypeError(`pres.theme.${key} must be a font name such as "Arial", got ${JSON.stringify(font)}`);
        }
        // PptxGenJS treats an empty font name as unset (`theme.bodyFontFace ? ... : Calibri`).
        const bodyFontFace = value?.bodyFontFace || PPTX_DEFAULTS.theme.bodyFontFace;
        if (bodyFontFace !== this.bodyFontFace() && this.slides.some(slide => slide.model.objects.length > 0)) {
            throw new Error(`pres.theme.bodyFontFace "${bodyFontFace}" was set after slide objects were added: PdfLapas resolves an object's default font when it is added, PptxGenJS when it writes the file. Set pres.theme before adding text, tables or charts.`);
        }
        this.themeProps = value;
    }

    /**
     * PptxGenJS `rtlMode` writes `<p:presentation rtl="1">`, which orients PowerPoint's editing views; slides look the
     * same, so the PDF does too. Right-to-left text is the `rtlMode` option of addText().
     */
    get rtlMode(): boolean {
        return this.rtl;
    }

    set rtlMode(value: boolean) {
        this.rtl = value;
    }

    get author(): string {
        return this.metadata.author ?? "";
    }

    set author(value: string) {
        this.setMetadata("author", value);
    }

    get company(): string {
        return this.metadata.company ?? "";
    }

    set company(value: string) {
        this.setMetadata("company", value);
    }

    get revision(): string {
        return this.metadata.revision ?? "";
    }

    set revision(value: string) {
        this.setMetadata("revision", value);
    }

    get subject(): string {
        return this.metadata.subject ?? "";
    }

    set subject(value: string) {
        this.setMetadata("subject", value);
    }

    get title(): string {
        return this.metadata.title ?? "";
    }

    set title(value: string) {
        this.setMetadata("title", value);
    }

    private setMetadata(key: keyof PresentationMetadata, value: unknown): void {
        if (typeof value !== "string") throw new TypeError(`pres.${key} must be a string, got ${value === null ? "null" : typeof value}; an empty string leaves it out of the PDF`);
        this.metadata = { ...this.metadata, [key]: value };
    }

    // PptxGenJS's enum objects. Each one is a plain object with the enum's keys and values, which tests/presentation.test.ts
    // compares with the pinned runtime; the declaration file's enum types cannot see that.
    get AlignH(): typeof PptxGenJS.AlignH {
        return ALIGN_H as unknown as typeof PptxGenJS.AlignH;
    }

    get AlignV(): typeof PptxGenJS.AlignV {
        return ALIGN_V as unknown as typeof PptxGenJS.AlignV;
    }

    get ChartType(): typeof PptxGenJS.ChartType {
        return CHART_TYPE as unknown as typeof PptxGenJS.ChartType;
    }

    get OutputType(): typeof PptxGenJS.OutputType {
        return OUTPUT_TYPE as unknown as typeof PptxGenJS.OutputType;
    }

    get SchemeColor(): typeof PptxGenJS.SchemeColor {
        return SCHEME_COLOR as unknown as typeof PptxGenJS.SchemeColor;
    }

    get ShapeType(): typeof PptxGenJS.ShapeType {
        return SHAPE_TYPE as unknown as typeof PptxGenJS.ShapeType;
    }

    /** @deprecated PptxGenJS's runtime alias of `ChartType`, absent from its types. */
    get charts(): typeof DEPRECATED_CHART_TYPE {
        return DEPRECATED_CHART_TYPE;
    }

    /** @deprecated PptxGenJS's runtime alias of `SchemeColor`, absent from its types. */
    get colors(): typeof DEPRECATED_SCHEME_COLOR {
        return DEPRECATED_SCHEME_COLOR;
    }

    /** @deprecated PptxGenJS's runtime alias of `ShapeType`, absent from its types. */
    get shapes(): typeof DEPRECATED_SHAPE_TYPE {
        return DEPRECATED_SHAPE_TYPE;
    }

    private bodyFontFace(): string {
        return this.themeProps?.bodyFontFace || PPTX_DEFAULTS.theme.bodyFontFace;
    }

    registerComponent<Props extends object = ComponentProps>(type: string, version: number, definition: ComponentDefinition<Props>): this {
        this.components.register(type, version, definition);
        return this;
    }

    /**
     * Set a custom page size
     */
    setPageSize(pageSize: PageSize): void {
        this.pageSize = pageSize;
        this.presLayoutName = pageSize.name;
    }

    /**
     * The normalized slide-object model that toHtml() and toPdf() render, as a detached JSON-serializable copy.
     * `component` objects keep only type, version and props; rendering them needs the registered definitions.
     */
    getModel(): NormalizedPresentation {
        return structuredClone({ pageSize: this.pageSize, metadata: this.metadata, slides: this.slides.map(slide => slide.toModel(this.pageSize, this.masterSlideNumber)) });
    }

    /** PptxGenJS `stream()`: the PDF as a Node Buffer. `compression` is ignored (zip-only). */
    async stream(_props?: PptxWriteBaseProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
        return convertPdfOutput(await this.toPdf(), "STREAM");
    }

    /** PptxGenJS `write()`: the PDF as the requested outputType, default `blob`. `compression` is ignored (zip-only). */
    async write(props?: PptxWriteProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
        const outputType = resolveOutputType(props);
        return convertPdfOutput(await this.toPdf(), outputType);
    }

    /** The complete self-contained HTML document (images inlined as data URIs). Does not launch a browser. */
    async toHtml(): Promise<HtmlPresentationDocument> {
        return modelToHtml(this.getModel(), { components: this.components, resolveImage: this.resolveImage, createDocument: this.createDocument });
    }

    /** PDF bytes from the configured renderer; nothing is written to disk. */
    async toPdf(): Promise<Uint8Array> {
        if (!this.renderer) throw new Error('toPdf() requires a renderer: pass { renderer } to the PuppeteerGen constructor, or use the Node entry ("puppeteer-pptxgenjs") for the Puppeteer default');
        // A renderer with only renderModel() (the model input, removed in #69) would otherwise fail as "render is not a function".
        if (typeof this.renderer.render !== "function") throw new Error("toPdf() renderer must implement render(document: HtmlPresentationDocument): every renderer reads the toHtml() document, renderModel(model) was removed (#69)");
        return this.renderer.render(await this.toHtml());
    }

    /** PptxGenJS `writeFile()`: in a browser, downloads the PDF as PptxGenJS downloads its .pptx; returns the file name. */
    async writeFile(props?: PptxWriteFileProps | string): Promise<string> {
        const fileName = resolveFileName(props);
        if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
            throw new Error('writeFile() downloads the PDF in a browser, or writes it to disk from the Node entry ("puppeteer-pptxgenjs"); this runtime has neither a document nor a filesystem, so use toPdf() or toHtml() instead');
        }
        downloadPdf(document, fileName, await this.toPdf());
        return fileName;
    }

    addSection(props: PptxSectionProps): void {
        // Sections only group slides in PowerPoint's slide list and draw nothing; keep PptxGenJS's input warnings.
        if (!props) console.warn("addSection requires an argument");
        else if (!props.title) console.warn("addSection requires a title");
    }

    addSlide(props?: PptxAddSlideProps | undefined): PuppeteerSlide;
    addSlide(masterName?: string | undefined): PuppeteerSlide;
    addSlide(props?: unknown): PuppeteerSlide {
        // A string is PptxGenJS's deprecated master name argument. `as`: PptxGenJS reads `masterName` off any object.
        const masterName = typeof props === "object" && props !== null ? (props as PptxAddSlideProps).masterName : props;
        isBuiltInMaster(masterName, "addSlide({ masterName })", "Remove `masterName` and add what the master held to each slide from a helper function, setting `slide.background` there.");
        const slideIndex = this.slides.length;
        const slide = new PuppeteerSlide(
            this.pageSize,
            this.componentDocument,
            slideIndex,
            offset => {
                const targetIndex = slideIndex + offset;
                while (this.slides.length <= targetIndex) this.addSlide();
                return this.slides[targetIndex]!;
            },
            props => {
                this.masterSlideNumber = props;
            },
            this.components,
            () => this.bodyFontFace(),
            this.target,
        );
        this.slides.push(slide);
        return slide;
    }

    /**
     * PptxGenJS `defineLayout()`: registers the size under its name for `layout`. Unlike PptxGenJS, it also applies the
     * size at once, as PdfLapas always has; PptxGenJS code assigns `layout` next, which gives the same page.
     */
    defineLayout(layout: PptxGenJS.PresLayout): void {
        // PptxGenJS warns and writes a NaN slide size; a PDF needs a real one.
        const width = Number(layout?.width);
        const height = Number(layout?.height);
        if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
            throw new Error(`defineLayout() needs { name, width, height } with width and height in inches greater than zero, got ${JSON.stringify(layout)}`);
        }
        this.pageSize = { width, height, name: layout.name || CUSTOM_PAGE_SIZE_NAME };
        this.presLayoutName = this.pageSize.name;
        if (layout.name) this.definedLayouts.set(layout.name, this.pageSize);
    }

    defineSlideMaster(_props: PptxSlideMasterProps): void {
        throw new UnsupportedFeatureError("defineSlideMaster", "Set `slide.background` and add the shared objects to each slide from a helper function instead of a master.");
    }

    /**
     * PptxGenJS `tableToSlides()`: the table, paginated over as many slides as it needs. `source` is the id of a
     * <table> in the global document, as in PptxGenJS (in Node, a jsdom `document` you install),
     * the <table> element itself, or HTML markup holding one (a string starting with `<`).
     */
    tableToSlides(source: string | HTMLTableElement, props?: PptxTableToSlidesProps | undefined): void {
        // PptxGenJS takes the built-in layout's 0.5in margins over `slideMargin` (genTableToSlides, step 1).
        const builtInMaster = isBuiltInMaster(props?.masterSlideName, "tableToSlides({ masterSlideName })", "Remove `masterSlideName` and draw what the master held on each generated slide with the `addImage`, `addShape` and `addText` options.");
        const options = builtInMaster ? { ...props, slideMargin: PPTX_DEFAULTS.slide.marginIn } : (props ?? {});
        const table = normalizeHtmlTable(findHtmlTable(source, this.createDocument), options, this.pageSize);
        const firstSlide = this.addSlide();
        firstSlide.addTable(table.rows, {
            ...options,
            x: table.x,
            y: table.y,
            colW: table.columnWidths,
            autoPage: true,
            autoPageRepeatHeader: options.autoPageRepeatHeader ?? options.addHeaderToEach ?? false,
            autoPageHeaderRows: table.headerRows || 1,
            autoPageSlideStartY: table.continuationY,
        });
        const generatedSlides = [firstSlide, ...firstSlide.newAutoPagedSlides] as PptxSlide[];
        generatedSlides.forEach(slide => {
            if (options.addImage?.image && (options.addImage.image.path || options.addImage.image.data)) {
                slide.addImage({
                    ...options.addImage.image,
                    ...(options.addImage.options ?? {}),
                } as PptxGenJS.ImageProps);
            }
            if (options.addShape) slide.addShape(options.addShape.shapeName, options.addShape.options ?? {});
            if (options.addTable) slide.addTable(options.addTable.rows, options.addTable.options ?? {});
            if (options.addText) slide.addText(options.addText.text, options.addText.options ?? {});
        });
    }
}
