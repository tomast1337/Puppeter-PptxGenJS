import type PptxGenJS from "pptxgenjs";
import type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
import { normalizeComponent } from "./components/normalize";
import { ComponentRegistry } from "./components/registry";
import type { ComponentDefinition, ComponentInput, ComponentOptions, ComponentProps } from "./components/types";
import { PPTX_DEFAULTS } from "./defaults";
import type { NormalizedPresentation, NormalizedSlide, NormalizedSlideObject } from "@pdfdeck/model";
import { normalizeChart } from "./normalize/chart";
import { normalizeHtmlTable } from "./normalize/table/html";
import { normalizeImage, resolveModelImages, resolveRemoteImageSource } from "./normalize/image";
import { normalizeObjectStyle } from "./normalize/object";
import { normalizeShape, normalizeShapeLine, normalizeShapeTextBox, straightLineLength } from "./normalize/shape";
import { normalizeColor, normalizeLine } from "./normalize/style";
import { normalizeTable } from "./normalize/table";
import { paginateTableRows } from "./normalize/table/pagination";
import { normalizeText, type TextInput } from "./normalize/text";
import type { PageSize } from "./pageLayouts";
import { DEFAULT_PAGE_SIZE } from "./pageLayouts";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import { chartSize, renderChartExtension, renderChartExtensionSvg } from "./render/chart";
import { renderComponent } from "./render/component";
import { type HtmlPresentationDocument, type ModelRenderer, modelToHtml, type PresentationRenderer } from "./render/document";
import { convertPdfOutput, resolveOutputType } from "./output";
import { UnsupportedFeatureError } from "./UnsupportedFeatureError";
import { pixelsToInches } from "./units";
import { createBrowserDocument, objectIdScope } from "./render/slide";

export class PuppeteerSlide implements PptxSlide {
    /** `document` only hosts the renders that check charts and components when they are added; toHtml() builds its own. */
    constructor(
        pageSize: PageSize,
        document: Document,
        private readonly slideIndex: number,
        getContinuationSlide: (offset: number) => PuppeteerSlide,
        private readonly components = new ComponentRegistry(),
    ) {
        this.pageSize = pageSize;
        this.document = document;
        this.getContinuationSlide = getContinuationSlide;
        this.background = {
            color: PPTX_DEFAULTS.slide.backgroundColor,
            type: "solid",
        };
        this.color = PPTX_DEFAULTS.slide.color;
        this.hidden = false;
        this.slideNumber = {
            margin: 0,
        };
        this.newAutoPagedSlides = [];
        this.bkgd = PPTX_DEFAULTS.slide.backgroundColor;
    }
    pageSize: PageSize;
    document: Document;
    private _background: PptxGenJS.BackgroundProps = { color: PPTX_DEFAULTS.slide.backgroundColor };
    private _bkgd: string = PPTX_DEFAULTS.slide.backgroundColor;
    private _color: string = PPTX_DEFAULTS.slide.color;
    private _hidden: boolean = PPTX_DEFAULTS.slide.hidden;
    private readonly getContinuationSlide: (offset: number) => PuppeteerSlide;
    slideNumber: PptxGenJS.SlideNumberProps;
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
        this._background = value;
        if (!value?.color) return;
        this.model.background = normalizeColor(value);
    }

    get bkgd(): string {
        return this._bkgd;
    }

    set bkgd(value: string) {
        this._bkgd = value;
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
        this._hidden = value;
        this.model.hidden = value;
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
        // and leave the slide unchanged. The element is dropped; toHtml() renders the model again.
        renderComponent(this.document, normalized, definition, this.nextIdScope());
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
        const chart = normalizeChart(type, Array.isArray(data) ? (data as PptxGenJS.OptsChartData[]) : [], chartOptions);
        chartSize(style);
        return this.addObject({ kind: "chart", style, chart });
    }

    addChartEx(input: ChartExtensionInput, options: ChartExtensionOptions): PuppeteerSlide {
        const style = normalizeObjectStyle(options, PPTX_DEFAULTS.chart, this.pageSize, this.nextObjectName("Chart", options.objectName));
        const svg = renderChartExtensionSvg(input, style);
        const altText = options.altText ?? "";
        // Parses the caller's SVG so a non-SVG root or an external reference throws here; the element is dropped.
        renderChartExtension(this.document, svg, style, altText, this.nextIdScope());
        return this.addObject({ kind: "chartExtension", style, svg, altText });
    }

    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
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
        const table = normalizeTable(tableRows, tableOptions, this.pageSize);
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
        // Text transparency is a run color property, not object opacity.
        const { transparency: _textTransparency, ...boxOptions } = textOptions;
        const textStyle = normalizeObjectStyle(boxOptions, PPTX_DEFAULTS.text, this.pageSize, this.nextObjectName("Text", textOptions.objectName), {
            fill: true,
            line: true,
            shadow: true,
        });
        const normalizedText = normalizeText(text, { color: this.color, ...textOptions });
        if (!textOptions.shape) return this.addObject({ kind: "text", style: textStyle, text: normalizedText });
        const shapeOptions = textOptions as unknown as PptxGenJS.ShapeProps;
        textStyle.line = normalizeShapeLine(shapeOptions, line => normalizeLine(line, straightLineLength(textOptions.shape ?? "", textStyle.geometry.width ?? 0, textStyle.geometry.height ?? 0)));
        const shape = normalizeShape(textOptions.shape, shapeOptions, textStyle.geometry.width ?? 0, textStyle.geometry.height ?? 0, this.pageSize);
        return this.addObject({ kind: "text", style: textStyle, text: normalizeShapeTextBox(normalizedText, shape), shape });
    }
}

/** Runtime adapters. The Node entry supplies jsdom, filesystem image paths and Puppeteer by default. */
export interface PuppeteerGenOptions {
    /** Turns the serialized HTML (PresentationRenderer) or the normalized model (ModelRenderer) into PDF bytes for toPdf() and writeFile(). */
    renderer?: PresentationRenderer | ModelRenderer;
    /** Resolves an addImage() path or URL to a data URI before serialization. */
    resolveImage?: (source: string) => Promise<string>;
    /** Creates the empty HTML document slides are rendered into. */
    createDocument?: () => Document;
}

export class PuppeteerGen implements Omit<PptxGenJSLike, "version" | "presLayout" | "AlignH" | "AlignV" | "ChartType" | "OutputType" | "SchemeColor" | "ShapeType" | "PlaceholderType" | "layout" | "rtlMode" | "author" | "company" | "revision" | "subject" | "theme" | "title"> {
    private pageSize: PageSize;
    /**
     * Input document for tableToSlides(tableId) only: put the source <table> here. Slides are not written
     * into it, so editing it does not change toHtml() or the PDF (#69). #72 tracks option (b): tableToSlides
     * takes an element or HTML string and `page` is deprecated.
     */
    page: Document;
    private readonly components = new ComponentRegistry();
    private slides: PuppeteerSlide[] = [];
    private readonly renderer: PresentationRenderer | ModelRenderer | undefined;
    private readonly resolveImage: (source: string) => Promise<string>;
    private readonly createDocument: () => Document;

    constructor(pageSize: PageSize = DEFAULT_PAGE_SIZE, options: PuppeteerGenOptions = {}) {
        this.pageSize = pageSize;
        this.renderer = options.renderer;
        this.resolveImage = options.resolveImage ?? resolveRemoteImageSource;
        this.createDocument = options.createDocument ?? createBrowserDocument;
        this.page = this.createDocument();
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
    }

    /**
     * The normalized slide-object model that toHtml() and toPdf() render, as a detached JSON-serializable copy.
     * `component` objects keep only type, version and props; rendering them needs the registered definitions.
     */
    getModel(): NormalizedPresentation {
        return structuredClone({ pageSize: this.pageSize, slides: this.slides.map(slide => slide.model) });
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
        if ("renderModel" in this.renderer) return this.renderer.renderModel(await resolveModelImages(this.getModel(), this.resolveImage));
        return this.renderer.render(await this.toHtml());
    }

    async writeFile(_props: PptxWriteFileProps): Promise<string> {
        throw new Error('writeFile() needs filesystem access and is only available from the Node entry ("puppeteer-pptxgenjs"); use toPdf() or toHtml() instead');
    }

    addSection(props: PptxSectionProps): void {
        // Sections only group slides in PowerPoint's slide list and draw nothing; keep PptxGenJS's input warnings.
        if (!props) console.warn("addSection requires an argument");
        else if (!props.title) console.warn("addSection requires a title");
    }

    addSlide(props?: PptxAddSlideProps | undefined): PuppeteerSlide;
    addSlide(masterName?: string | undefined): PuppeteerSlide;
    addSlide(masterName?: unknown): PuppeteerSlide {
        const slideIndex = this.slides.length;
        const slide = new PuppeteerSlide(
            this.pageSize,
            this.page,
            slideIndex,
            offset => {
                const targetIndex = slideIndex + offset;
                while (this.slides.length <= targetIndex) this.addSlide();
                return this.slides[targetIndex]!;
            },
            this.components,
        );
        this.slides.push(slide);

        if (typeof masterName === "object" && masterName !== null) {
            const props = masterName as { bkgd?: string; background?: PptxGenJS.BackgroundProps };
            if (props.background) slide.background = props.background;
            else if (props.bkgd) slide.bkgd = props.bkgd;
        }

        return slide;
    }

    defineLayout(layout: PptxGenJS.PresLayout): void {
        // Update page size based on layout
        if (layout.width && layout.height) {
            this.pageSize = {
                width: layout.width,
                height: layout.height,
                name: layout.name || "Custom",
            };
        }
    }

    defineSlideMaster(_props: PptxSlideMasterProps): void {
        throw new UnsupportedFeatureError("defineSlideMaster", "Set `slide.background` and add the shared objects to each slide from a helper function instead of a master.");
    }

    tableToSlides(eleId: string, props?: PptxTableToSlidesProps | undefined): void {
        const options = props ?? {};
        const table = normalizeHtmlTable(this.page, eleId, options, this.pageSize);
        const firstSlide = this.addSlide(options.masterSlideName ? { masterName: options.masterSlideName } : undefined);
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
