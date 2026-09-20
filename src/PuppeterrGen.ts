import * as jsdom from "jsdom";
import type PptxGenJS from "pptxgenjs";
import puppeteer from "puppeteer";
import type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
import { PPTX_DEFAULTS, tableMarginToCSS, textMarginToCSS } from "./defaults";
import { normalizeChart } from "./normalize/chart";
import { normalizeHtmlTable } from "./normalize/htmlTable";
import { normalizeImage, resolveDocumentImages } from "./normalize/image";
import { normalizeObjectStyle } from "./normalize/object";
import { normalizeShape, normalizeShapeLine, normalizeShapeTextBox } from "./normalize/shape";
import { normalizeColor, normalizeLine } from "./normalize/style";
import { normalizeTable } from "./normalize/table";
import { paginateTableRows } from "./normalize/tablePagination";
import { normalizeText, type TextInput } from "./normalize/text";
import type { PageSize } from "./pageLayouts";
import { DEFAULT_PAGE_SIZE } from "./pageLayouts";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import { renderChart, renderChartExtension } from "./render/chart";
import { renderImage } from "./render/image";
import { renderShape, renderShapeSvg } from "./render/shape";
import { applyObjectStyle } from "./render/style";
import { renderTable } from "./render/table";
import { renderText } from "./render/text";
import { inchesToPixels, pointsToPixels } from "./utils";

export class PuppeteerSlide implements PptxSlide {
    constructor(slideElm: HTMLDivElement, pageSize: PageSize, document: Document, getContinuationSlide: (offset: number) => PuppeteerSlide) {
        this.slideElm = slideElm;
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
    slideElm: HTMLDivElement;
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

    get background(): PptxGenJS.BackgroundProps {
        return this._background;
    }

    set background(value: PptxGenJS.BackgroundProps) {
        this._background = value;
        if (value?.color) this.slideElm.style.backgroundColor = normalizeColor(value);
    }

    get bkgd(): string {
        return this._bkgd;
    }

    set bkgd(value: string) {
        this._bkgd = value;
        this.slideElm.style.backgroundColor = normalizeColor(value);
    }

    get color(): string {
        return this._color;
    }

    set color(value: string) {
        this._color = value;
        this.slideElm.style.setProperty("--slide-text-color", normalizeColor(value));
    }

    get hidden(): boolean {
        return this._hidden;
    }

    set hidden(value: boolean) {
        this._hidden = value;
        this.slideElm.dataset.hidden = String(value);
    }

    private nextObjectName(kind: string, explicit?: string): string {
        const index = this.objectCounts[kind] ?? 0;
        this.objectCounts[kind] = index + 1;
        return explicit ?? `${kind} ${index}`;
    }

    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: any[], options?: PptxGenJS.IChartOpts | undefined): PptxGenJS.Slide {
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
        this.slideElm.appendChild(renderChart(this.document, chart, style));
        return this;
    }

    addChartEx(input: ChartExtensionInput, options: ChartExtensionOptions): PuppeteerSlide {
        const style = normalizeObjectStyle(options, PPTX_DEFAULTS.chart, this.pageSize, this.nextObjectName("Chart", options.objectName));
        this.slideElm.appendChild(renderChartExtension(this.document, input, style, options.altText ?? ""));
        return this;
    }

    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
        const image = normalizeImage(options, this.pageSize);
        const { transparency: _imageTransparency, ...opaqueOptions } = options;
        const geometryOptions = options.sizing ? { ...opaqueOptions, w: options.sizing.w, h: options.sizing.h } : opaqueOptions;
        const style = normalizeObjectStyle(geometryOptions, PPTX_DEFAULTS.image, this.pageSize, this.nextObjectName("Image", options.objectName), { shadow: true });
        this.slideElm.appendChild(renderImage(this.document, image, style));
        return this;
    }

    addMedia(_options: PptxGenJS.MediaProps): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }

    addNotes(_notes: string): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }

    addShape(shapeName: PptxGenJS.SHAPE_NAME | "custGeom", options?: PptxGenJS.ShapeProps | undefined): PptxGenJS.Slide {
        const shapeOptions = options ?? {};
        const style = normalizeObjectStyle(shapeOptions, PPTX_DEFAULTS.shape, this.pageSize, this.nextObjectName("Shape", shapeOptions.objectName ?? shapeOptions.shapeName), { fill: true, shadow: true });
        style.line = normalizeShapeLine(shapeOptions, normalizeLine);
        const shape = normalizeShape(shapeName, shapeOptions, style.geometry.width ?? 0, style.geometry.height ?? 0, this.pageSize);
        this.slideElm.appendChild(renderShape(this.document, shape, style));
        return this;
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
        const tableContainer = this.document.createElement("div");
        tableContainer.className = "slide-element slide-table-container";
        const tableStyle = normalizeObjectStyle(
            {
                ...tableOptions,
                w: table.width / 96,
                h: table.height === undefined ? undefined : table.height / 96,
            },
            {
                x: PPTX_DEFAULTS.table.x,
                y: PPTX_DEFAULTS.table.y,
                w: table.width / 96,
            },
            this.pageSize,
            this.nextObjectName("Table", tableOptions.objectName),
        );
        applyObjectStyle(tableContainer, tableStyle);
        tableContainer.appendChild(renderTable(this.document, table));
        this.slideElm.appendChild(tableContainer);
        return this;
    }

    addText(text: TextInput, options?: PptxGenJS.TextPropsOptions | undefined): PptxGenJS.Slide {
        const textElm = this.document.createElement("div");
        textElm.className = "slide-element slide-text";

        const textOptions = options ?? {};
        // Text transparency is a run color property, not object opacity.
        const { transparency: _textTransparency, ...boxOptions } = textOptions;
        const textStyle = normalizeObjectStyle(boxOptions, PPTX_DEFAULTS.text, this.pageSize, this.nextObjectName("Text", textOptions.objectName), { fill: true, line: true, shadow: true });
        let normalizedText = normalizeText(text, { color: this.color, ...textOptions });
        if (textOptions.shape) {
            const shapeOptions = textOptions as unknown as PptxGenJS.ShapeProps;
            textStyle.line = normalizeShapeLine(shapeOptions, normalizeLine);
            const shape = normalizeShape(textOptions.shape, shapeOptions, textStyle.geometry.width ?? 0, textStyle.geometry.height ?? 0, this.pageSize);
            applyObjectStyle(textElm, { ...textStyle, fill: undefined, line: undefined, shadow: undefined });
            textElm.dataset.shape = shape.name;
            textElm.appendChild(renderShapeSvg(this.document, shape, textStyle));
            normalizedText = normalizeShapeTextBox(normalizedText, shape);
        } else applyObjectStyle(textElm, textStyle);
        renderText(this.document, textElm, normalizedText);

        this.slideElm.appendChild(textElm);
        return this;
    }
}

export class PuppeteerGen implements Omit<PptxGenJSLike, "version" | "presLayout" | "AlignH" | "AlignV" | "ChartType" | "OutputType" | "SchemeColor" | "ShapeType" | "PlaceholderType" | "layout" | "rtlMode" | "author" | "company" | "revision" | "subject" | "theme" | "title"> {
    private dom: jsdom.JSDOM;
    private pageSize: PageSize;
    page: Document;
    private slideCount = 0;
    private slides: PuppeteerSlide[] = [];

    constructor(pageSize: PageSize = DEFAULT_PAGE_SIZE) {
        this.dom = new jsdom.JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
        this.page = this.dom.window.document;
        this.pageSize = pageSize;
        this.injectCSS();
    }

    /**
     * Set a custom page size
     */
    setPageSize(pageSize: PageSize): void {
        this.pageSize = pageSize;
        this.injectCSS();
    }

    /**
     * Inject CSS into the document
     */
    private injectCSS(): void {
        // Remove existing style tag if present
        const existingStyle = this.page.querySelector("style#puppeteer-gen-styles");
        if (existingStyle) {
            existingStyle.remove();
        }

        const style = this.page.createElement("style");
        style.id = "puppeteer-gen-styles";
        style.textContent = this.generateCSS();
        this.page.head.appendChild(style);
    }

    /**
     * Generate CSS for the current page size
     */
    private generateCSS(): string {
        const widthPx = inchesToPixels(this.pageSize.width);
        const heightPx = inchesToPixels(this.pageSize.height);

        return `
@page {
    size: ${this.pageSize.width}in ${this.pageSize.height}in;
    margin: 0;
}

body {
    margin: 0;
    padding: 0;
    font-family: ${PPTX_DEFAULTS.text.fontFace}, Arial, Helvetica, sans-serif;
}

[data-puppeteer-gen-source="true"] {
    display: none !important;
}

.slide-container {
    width: ${widthPx}px;
    height: ${heightPx}px;
    position: relative;
    page-break-after: always;
    background: ${normalizeColor(PPTX_DEFAULTS.slide.backgroundColor)};
    overflow: hidden;
    box-sizing: border-box;
}

.slide-container:last-child {
    page-break-after: auto;
}

.slide-element {
    position: absolute;
    box-sizing: border-box;
    /* PowerPoint paints slide objects in insertion order. Give every object a
       stacking context so an earlier object's internal text layer cannot paint
       over a later object's fill. Equal z-index contexts retain DOM order. */
    z-index: 0;
}

.slide-text {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    color: var(--slide-text-color, ${normalizeColor(PPTX_DEFAULTS.text.color)});
    font-family: ${PPTX_DEFAULTS.text.fontFace}, Arial, Helvetica, sans-serif;
    font-size: ${pointsToPixels(PPTX_DEFAULTS.text.fontSizePt)}px;
    padding: ${textMarginToCSS()};
    overflow: hidden;
    white-space: pre-wrap;
    word-wrap: break-word;
}

.slide-text > .shape-svg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
}

.slide-text > .text-content {
    position: relative;
    z-index: 1;
}

.slide-shape {
    border-style: none;
}

.slide-image {
    display: block;
    color: inherit;
    text-decoration: none;
}

.slide-image-content {
    border: 0;
}

.slide-table {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    height: 100%;
    color: ${normalizeColor(PPTX_DEFAULTS.table.color)};
    font-size: ${pointsToPixels(PPTX_DEFAULTS.table.fontSizePt)}px;
}

.slide-table td,
.slide-table th {
    border: none;
    padding: ${tableMarginToCSS()};
    vertical-align: top;
}

@media print {
    body {
        margin: 0;
        padding: 0;
    }
    
    .slide-container {
        page-break-after: always;
        break-after: page;
    }
    
    .slide-container:last-child {
        page-break-after: auto;
        break-after: auto;
    }
}
        `.trim();
    }

    stream(_props?: PptxWriteBaseProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
        throw new Error("Method not implemented.");
    }

    write(_props?: PptxWriteProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
        throw new Error("Method not implemented.");
    }

    async writeFile({ fileName }: PptxWriteFileProps): Promise<string> {
        if (!fileName) {
            throw new Error("fileName is required");
        }

        await resolveDocumentImages(this.page);

        // Get the full HTML content
        const htmlContent = this.page.documentElement.outerHTML;

        // Launch puppeteer and generate PDF
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        try {
            const page = await browser.newPage();
            await page.setViewport({
                width: Math.round(inchesToPixels(this.pageSize.width)),
                height: Math.round(inchesToPixels(this.pageSize.height)),
            });
            await page.setContent(htmlContent, { waitUntil: "networkidle0" });
            const failedImages = await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(
                    Array.from(document.images, image =>
                        image.complete
                            ? Promise.resolve()
                            : new Promise<void>(resolve => {
                                  image.addEventListener("load", () => resolve(), { once: true });
                                  image.addEventListener("error", () => resolve(), { once: true });
                              }),
                    ),
                );

                // LibreOffice's PDF export drops animated GIFs, so it cannot be
                // used as the visual oracle here. Freeze through Chromium's
                // static bitmap decoder to match PowerPoint's PDF first frame.
                const gifs = Array.from(document.images).filter(image => image.src.startsWith("data:image/gif"));
                if (gifs.length) {
                    if (typeof createImageBitmap !== "function") {
                        throw new Error("This Chromium build cannot freeze animated GIF images");
                    }
                    await Promise.all(
                        gifs.map(async image => {
                            const frame = await createImageBitmap(await (await fetch(image.src)).blob());
                            const canvas = document.createElement("canvas");
                            canvas.width = frame.width;
                            canvas.height = frame.height;
                            canvas.getContext("2d")?.drawImage(frame, 0, 0);
                            image.src = canvas.toDataURL("image/png");
                            frame.close();
                        }),
                    );
                    await Promise.all(
                        gifs.map(image =>
                            image.complete
                                ? Promise.resolve()
                                : new Promise<void>(resolve => {
                                      image.addEventListener("load", () => resolve(), { once: true });
                                      image.addEventListener("error", () => resolve(), { once: true });
                                  }),
                        ),
                    );
                }

                // PowerPoint scales the decoded image surface into its declared
                // blip rectangle. Explicitly transform from natural pixels so
                // SVG preserveAspectRatio rules cannot override that geometry.
                document.querySelectorAll<HTMLImageElement>(".slide-image-content").forEach(image => {
                    if (!image.naturalWidth || !image.naturalHeight) return;
                    const computed = getComputedStyle(image);
                    const targetWidth = parseFloat(computed.width);
                    const targetHeight = parseFloat(computed.height);
                    if (!targetWidth || !targetHeight) return;
                    image.style.width = `${image.naturalWidth}px`;
                    image.style.height = `${image.naturalHeight}px`;
                    image.style.transformOrigin = "top left";
                    image.style.transform = `scale(${targetWidth / image.naturalWidth}, ${targetHeight / image.naturalHeight})`;
                });

                document.querySelectorAll<HTMLElement>('.slide-text[data-text-fit="shrink"]').forEach(box => {
                    const content = box.querySelector<HTMLElement>(".text-content");
                    if (!content) return;
                    const boxStyle = getComputedStyle(box);
                    const availableWidth = box.clientWidth - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight);
                    const availableHeight = box.clientHeight - parseFloat(boxStyle.paddingTop) - parseFloat(boxStyle.paddingBottom);
                    for (let iteration = 0; iteration < 20 && (content.scrollWidth > availableWidth + 0.5 || content.scrollHeight > availableHeight + 0.5); iteration++) {
                        content.querySelectorAll<HTMLElement>(".text-run, .text-bullet").forEach(run => {
                            run.style.fontSize = `${parseFloat(getComputedStyle(run).fontSize) * 0.95}px`;
                        });
                        content.querySelectorAll<HTMLElement>(".text-paragraph").forEach(paragraph => {
                            const lineHeight = paragraph.style.lineHeight;
                            if (lineHeight.endsWith("px")) paragraph.style.lineHeight = `${parseFloat(lineHeight) * 0.95}px`;
                        });
                    }
                });
                return Array.from(document.images)
                    .filter(image => image.naturalWidth === 0 || image.naturalHeight === 0)
                    .map(image => image.alt || image.closest<HTMLElement>("[data-object-name]")?.dataset.objectName || "unnamed image");
            });
            if (failedImages.length) throw new Error(`Image failed to decode: ${failedImages.join(", ")}`);

            const pdf = await page.pdf({
                width: `${this.pageSize.width}in`,
                height: `${this.pageSize.height}in`,
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
            });

            await Bun.write(fileName, pdf);
            return fileName;
        } finally {
            await browser.close();
        }
    }

    addSection(_props: PptxSectionProps): void {
        throw new Error("Method not implemented.");
    }

    addSlide(props?: PptxAddSlideProps | undefined): PuppeteerSlide;
    addSlide(masterName?: string | undefined): PuppeteerSlide;
    addSlide(masterName?: unknown): PuppeteerSlide {
        const slideElm = this.page.createElement("div");
        slideElm.className = "slide-container";
        slideElm.id = `slide-${++this.slideCount}`;
        this.page.body.appendChild(slideElm);
        const slideIndex = this.slides.length;
        const slide = new PuppeteerSlide(slideElm, this.pageSize, this.page, offset => {
            const targetIndex = slideIndex + offset;
            while (this.slides.length <= targetIndex) this.addSlide();
            return this.slides[targetIndex]!;
        });
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
            this.injectCSS();
        }
    }

    defineSlideMaster(_props: PptxSlideMasterProps): void {
        throw new Error("Method not implemented.");
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
