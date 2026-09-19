import PptxGenJS from "pptxgenjs";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import * as jsdom from "jsdom";
import puppeteer from "puppeteer";
import { alignToCSS, valignToCSS, pointsToPixels, inchesToPixels } from "./utils";
import type { PageSize } from "./pageLayouts";
import { DEFAULT_PAGE_SIZE } from "./pageLayouts";
import { PPTX_DEFAULTS, tableMarginToCSS, textMarginToCSS, type FourSideMargin } from "./defaults";
import { normalizeObjectStyle } from "./normalize/object";
import { normalizeColor } from "./normalize/style";
import { resolveDocumentImages } from "./normalize/image";
import { applyObjectStyle } from "./render/style";

class PuppeteerSlide implements PptxSlide {
    constructor(slideElm: HTMLDivElement, pageSize: PageSize, document: Document) {
        this.slideElm = slideElm;
        this.pageSize = pageSize;
        this.document = document;
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
        throw new Error("Method not implemented.");
    }
    
    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
        const imgElm = this.document.createElement("img");
        imgElm.className = "slide-element slide-image";
        
        if (options.data) imgElm.src = options.data;
        else if (options.path) imgElm.dataset.sourcePath = options.path;

        const style = normalizeObjectStyle(
            options,
            PPTX_DEFAULTS.image,
            this.pageSize,
            this.nextObjectName("Image", options.objectName),
            { shadow: true },
        );
        applyObjectStyle(imgElm, style);
        imgElm.alt = options.altText ?? PPTX_DEFAULTS.image.altText;
        imgElm.style.borderRadius = options.rounding ? "50%" : "0";
        imgElm.style.objectFit = options.sizing?.type === "cover" || options.sizing?.type === "crop"
            ? "cover"
            : options.sizing?.type === "contain" ? "contain" : "fill";
        this.slideElm.appendChild(imgElm);
        return this;
    }
    
    addMedia(options: PptxGenJS.MediaProps): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    
    addNotes(notes: string): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    
    addShape(shapeName: PptxGenJS.SHAPE_NAME, options?: PptxGenJS.ShapeProps | undefined): PptxGenJS.Slide {
        const shapeElm = this.document.createElement("div");
        shapeElm.className = "slide-element slide-shape";
        shapeElm.dataset.shape = shapeName;

        const shapeOptions = options ?? {};
        const style = normalizeObjectStyle(
            shapeOptions,
            PPTX_DEFAULTS.shape,
            this.pageSize,
            this.nextObjectName("Shape", shapeOptions.objectName),
            { fill: true, line: true, shadow: true },
        );
        applyObjectStyle(shapeElm, style);
        
        this.slideElm.appendChild(shapeElm);
        return this;
    }
    
    addTable(tableRows: PptxGenJS.TableRow[], options?: PptxGenJS.TableProps | undefined): PptxGenJS.Slide {
        const tableContainer = this.document.createElement("div");
        tableContainer.className = "slide-element";
        
        const tableElm = this.document.createElement("table");
        tableElm.className = "slide-table";
        
        tableRows.forEach(row => {
            const tr = this.document.createElement("tr");
            row.forEach(cell => {
                const td = this.document.createElement("td");
                if (typeof cell === "object" && "text" in cell) {
                    td.textContent = cell.text as string;
                    if (cell.options) {
                        this.applyCellStyles(td, cell.options);
                    }
                } else {
                    td.textContent = String(cell);
                }
                tr.appendChild(td);
            });
            tableElm.appendChild(tr);
        });
        
        tableContainer.appendChild(tableElm);
        
        const tableOptions = options ?? {};
        const tableStyle = normalizeObjectStyle(tableOptions, {
            x: PPTX_DEFAULTS.table.x,
            y: PPTX_DEFAULTS.table.y,
            w: this.pageSize.width - PPTX_DEFAULTS.slide.marginIn * 2,
        }, this.pageSize, this.nextObjectName("Table", options?.objectName));
        applyObjectStyle(tableContainer, tableStyle);
        tableElm.style.fontSize = `${pointsToPixels(options?.fontSize ?? PPTX_DEFAULTS.table.fontSizePt)}px`;
        tableElm.style.color = normalizeColor(options?.color ?? PPTX_DEFAULTS.table.color);
        const tableMargin = options?.margin as number | FourSideMargin | undefined;
        tableElm.querySelectorAll("td").forEach(cell => {
            if (!cell.style.padding) cell.style.padding = tableMarginToCSS(tableMargin);
        });
        
        this.slideElm.appendChild(tableContainer);
        return this;
    }
    
    addText(text: string | PptxGenJS.TextProps[], options?: PptxGenJS.TextPropsOptions | undefined): PptxGenJS.Slide {
        const textElm = this.document.createElement("div");
        textElm.className = "slide-element slide-text";
        
        // Handle text content
        if (typeof text === "string") {
            textElm.textContent = text;
        } else {
            // Handle TextProps array
            text.forEach(textProp => {
                const span = this.document.createElement("span");
                span.textContent = textProp.text || "";
                
                if (textProp.options) {
                    this.applyTextPropsToSpan(span, textProp.options);
                }
                
                textElm.appendChild(span);
            });
        }
        
        // Apply options if provided
        const textOptions = options ?? {};
        const textStyle = normalizeObjectStyle(
            textOptions,
            PPTX_DEFAULTS.text,
            this.pageSize,
            this.nextObjectName("Text", textOptions.objectName),
            { fill: true, line: true, shadow: true },
        );
        applyObjectStyle(textElm, textStyle);
        this.applyTextStyles(textElm, textOptions);
        
        this.slideElm.appendChild(textElm);
        return this;
    }
    
    private applyTextStyles(element: HTMLElement, options: PptxGenJS.TextPropsOptions): void {
        element.style.padding = textMarginToCSS(options.margin as number | FourSideMargin | undefined);

        if (options.wrap === false) {
            element.style.whiteSpace = "pre";
        }

        if (options.color) {
            element.style.color = normalizeColor(options.color);
        }
        
        if (options.fontSize) {
            element.style.fontSize = `${pointsToPixels(options.fontSize)}px`;
        }
        
        if (options.fontFace) {
            element.style.fontFamily = options.fontFace;
        }
        
        if (options.bold) {
            element.style.fontWeight = "bold";
        }
        
        if (options.italic) {
            element.style.fontStyle = "italic";
        }
        
        if (options.underline && options.underline.style !== "none") {
            element.style.textDecorationLine = "underline";
            if (options.underline.color) {
                element.style.textDecorationColor = normalizeColor(options.underline.color);
            }
        }
        
        if (options.align) {
            element.style.textAlign = alignToCSS(options.align);
            // Also set justify-content for flex containers
            const alignValue = options.align.toLowerCase();
            if (alignValue === "center") {
                element.style.justifyContent = "center";
            } else if (alignValue === "right") {
                element.style.justifyContent = "flex-end";
            } else if (alignValue === "left") {
                element.style.justifyContent = "flex-start";
            }
        }
        
        if (options.valign) {
            element.style.alignItems = valignToCSS(options.valign);
        }
        
    }
    
    private applyTextPropsToSpan(span: HTMLSpanElement, options: any): void {
        if (options.color) {
            span.style.color = normalizeColor(options.color);
        }
        
        if (options.fontSize) {
            span.style.fontSize = `${pointsToPixels(options.fontSize)}px`;
        }
        
        if (options.fontFace) {
            span.style.fontFamily = options.fontFace;
        }
        
        if (options.bold) {
            span.style.fontWeight = "bold";
        }
        
        if (options.italic) {
            span.style.fontStyle = "italic";
        }
        
        if (options.underline && options.underline.style !== "none") {
            span.style.textDecorationLine = "underline";
            if (options.underline.color) {
                span.style.textDecorationColor = normalizeColor(options.underline.color);
            }
        }
    }
    
    private applyCellStyles(cell: HTMLTableCellElement, options: any): void {
        if (options.fill) {
            cell.style.backgroundColor = normalizeColor(options.fill);
        }
        
        if (options.color) {
            cell.style.color = normalizeColor(options.color);
        }
        
        if (options.fontSize) {
            cell.style.fontSize = `${pointsToPixels(options.fontSize)}px`;
        }
        
        if (options.bold) {
            cell.style.fontWeight = "bold";
        }
        
        if (options.align) {
            cell.style.textAlign = alignToCSS(options.align);
        }
    }
}

export class PuppeteerGen implements Omit<PptxGenJSLike, "version" | "presLayout" | "AlignH" | "AlignV" | "ChartType" | "OutputType" | "SchemeColor" | "ShapeType" | "PlaceholderType" | "layout" | "rtlMode" | "author" | "company" | "revision" | "subject" | "theme" | "title"> {
    private dom: jsdom.JSDOM;
    private pageSize: PageSize;
    page: Document;
    
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

.slide-shape {
    border-style: none;
}

.slide-image {
    object-fit: contain;
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
    
    stream(props?: PptxWriteBaseProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
        throw new Error("Method not implemented.");
    }
    
    write(props?: PptxWriteProps | undefined): Promise<string | ArrayBuffer | Blob | Uint8Array> {
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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        try {
            const page = await browser.newPage();
            await page.setViewport({
                width: Math.round(inchesToPixels(this.pageSize.width)),
                height: Math.round(inchesToPixels(this.pageSize.height))
            });
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(Array.from(document.images, image => image.complete
                    ? Promise.resolve()
                    : new Promise<void>(resolve => {
                        image.addEventListener("load", () => resolve(), { once: true });
                        image.addEventListener("error", () => resolve(), { once: true });
                    })));
            });

            const pdf = await page.pdf({
                width: `${this.pageSize.width}in`,
                height: `${this.pageSize.height}in`,
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 }
            });

            await Bun.write(fileName, pdf);
            return fileName;
        } finally {
            await browser.close();
        }
    }
    
    addSection(props: PptxSectionProps): void {
        throw new Error("Method not implemented.");
    }
    
    addSlide(props?: PptxAddSlideProps | undefined): PptxSlide;
    addSlide(masterName?: string | undefined): PptxSlide;
    addSlide(masterName?: unknown): PptxSlide {
        const slideElm = this.page.createElement("div");
        slideElm.className = "slide-container";
        this.page.body.appendChild(slideElm);
        const slide = new PuppeteerSlide(slideElm, this.pageSize, this.page);

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
                name: layout.name || "Custom"
            };
            this.injectCSS();
        }
    }
    
    defineSlideMaster(props: PptxSlideMasterProps): void {
        throw new Error("Method not implemented.");
    }
    
    tableToSlides(eleId: string, props?: PptxTableToSlidesProps | undefined): void {
        throw new Error("Method not implemented.");
    }
}
