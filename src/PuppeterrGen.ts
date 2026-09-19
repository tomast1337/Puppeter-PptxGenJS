import PptxGenJS from "pptxgenjs";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import * as jsdom from "jsdom";
import puppeteer from "puppeteer";
import { convertToPixels, colorToCSS, alignToCSS, valignToCSS, pointsToPixels, inchesToPixels } from "./utils";
import type { PageSize } from "./pageLayouts";
import { DEFAULT_PAGE_SIZE } from "./pageLayouts";
import { PPTX_DEFAULTS, tableMarginToCSS, textMarginToCSS, type FourSideMargin } from "./defaults";

class PuppeteerSlide implements PptxSlide {
    constructor(slideElm: HTMLDivElement, pageSize: PageSize, document: Document) {
        this.background = {
            color: "white",
            type: "solid",
        };
        this.color = "black";
        this.hidden = false;
        this.slideNumber = {
            margin: 0,
        };
        this.newAutoPagedSlides = [];
        this.bkgd = "white";

        this.slideElm = slideElm;
        this.pageSize = pageSize;
        this.document = document;
    }
    bkgd: string;
    slideElm: HTMLDivElement;
    pageSize: PageSize;
    document: Document;
    background: PptxGenJS.BackgroundProps;
    color: string;
    hidden: boolean;
    slideNumber: PptxGenJS.SlideNumberProps;
    newAutoPagedSlides: PptxGenJS.PresSlide[];
    
    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: any[], options?: PptxGenJS.IChartOpts | undefined): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    
    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
        const imgElm = this.document.createElement("img");
        imgElm.className = "slide-element slide-image";
        
        if (options.path || options.data) {
            imgElm.src = options.data || options.path || "";
        }
        
        this.applyPositionAndSize(imgElm, options);
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
        
        if (options) {
            this.applyPositionAndSize(shapeElm, options, PPTX_DEFAULTS.shape);
            this.applyShapeStyles(shapeElm, options);
        } else {
            this.applyPositionAndSize(shapeElm, {}, PPTX_DEFAULTS.shape);
        }
        
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
        this.applyPositionAndSize(tableContainer, tableOptions, {
            x: PPTX_DEFAULTS.table.x,
            y: PPTX_DEFAULTS.table.y,
            w: this.pageSize.width - PPTX_DEFAULTS.slide.marginIn * 2,
        });
        tableElm.style.fontSize = `${pointsToPixels(options?.fontSize ?? PPTX_DEFAULTS.table.fontSizePt)}px`;
        tableElm.style.color = colorToCSS(options?.color ?? PPTX_DEFAULTS.table.color);
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
        this.applyPositionAndSize(textElm, textOptions, PPTX_DEFAULTS.text);
        this.applyTextStyles(textElm, textOptions);
        
        this.slideElm.appendChild(textElm);
        return this;
    }
    
    private applyPositionAndSize(element: HTMLElement, options: any, defaults: any = {}): void {
        const pageWidthPx = inchesToPixels(this.pageSize.width);
        const pageHeightPx = inchesToPixels(this.pageSize.height);
        const x = options.x ?? defaults.x;
        const y = options.y ?? defaults.y;
        const w = options.w ?? defaults.w;
        const h = options.h ?? defaults.h;
        
        if (x !== undefined) {
            element.style.left = `${convertToPixels(x, pageWidthPx)}px`;
        }
        
        if (y !== undefined) {
            element.style.top = `${convertToPixels(y, pageHeightPx)}px`;
        }
        
        if (w !== undefined) {
            element.style.width = `${convertToPixels(w, pageWidthPx)}px`;
        }
        
        if (h !== undefined) {
            element.style.height = `${convertToPixels(h, pageHeightPx)}px`;
        }
    }
    
    private applyTextStyles(element: HTMLElement, options: PptxGenJS.TextPropsOptions): void {
        element.style.padding = textMarginToCSS(options.margin as number | FourSideMargin | undefined);

        if (options.wrap === false) {
            element.style.whiteSpace = "pre";
        }

        if (options.color) {
            element.style.color = colorToCSS(options.color);
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
                element.style.textDecorationColor = colorToCSS(options.underline.color);
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
        
        if (options.fill) {
            const fillColor = typeof options.fill === "string" ? options.fill : (options.fill as any).color;
            if (fillColor) {
                element.style.backgroundColor = colorToCSS(fillColor);
            }
        }
    }
    
    private applyTextPropsToSpan(span: HTMLSpanElement, options: any): void {
        if (options.color) {
            span.style.color = colorToCSS(options.color);
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
                span.style.textDecorationColor = colorToCSS(options.underline.color);
            }
        }
    }
    
    private applyShapeStyles(element: HTMLElement, options: PptxGenJS.ShapeProps): void {
        if (options.fill) {
            element.style.backgroundColor = colorToCSS(options.fill);
        }
        
        if (options.line) {
            element.style.borderColor = colorToCSS(options.line);
            element.style.borderWidth = `${pointsToPixels(options.line.width ?? 1)}px`;
            const dashType = options.line.dashType ?? options.line.lineDash;
            element.style.borderStyle = dashType === "solid" || !dashType ? "solid" : "dashed";
        }
    }
    
    private applyCellStyles(cell: HTMLTableCellElement, options: any): void {
        if (options.fill) {
            cell.style.backgroundColor = colorToCSS(options.fill);
        }
        
        if (options.color) {
            cell.style.color = colorToCSS(options.color);
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
    font-family: Calibri, Arial, Helvetica, sans-serif;
}

.slide-container {
    width: ${widthPx}px;
    height: ${heightPx}px;
    position: relative;
    page-break-after: always;
    background: white;
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
    color: #000000;
    font-family: Calibri, Arial, Helvetica, sans-serif;
    font-size: 24px;
    padding: 4.8px 9.6px;
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
    color: #000000;
    font-size: 16px;
}

.slide-table td,
.slide-table th {
    border: none;
    padding: 4.8px 9.6px;
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
        
        // Set background if provided in props
        if (typeof masterName === "object" && masterName !== null) {
            const props = masterName as any;
            if (props.bkgd) {
                slideElm.style.backgroundColor = colorToCSS(props.bkgd);
            }
        }
        
        this.page.body.appendChild(slideElm);
        return new PuppeteerSlide(slideElm, this.pageSize, this.page);
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
