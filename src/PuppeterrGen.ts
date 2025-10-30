import PptxGenJS from "pptxgenjs";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import * as jsdom from "jsdom";
import puppeteer from "puppeteer";
import { convertToPixels, colorToCSS, alignToCSS, valignToCSS, pointsToPixels, inchesToPixels } from "./utils";
import type { PageSize } from "./pageLayouts";
import { DEFAULT_PAGE_SIZE } from "./pageLayouts";

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
            this.applyPositionAndSize(shapeElm, options);
            this.applyShapeStyles(shapeElm, options);
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
        
        if (options) {
            this.applyPositionAndSize(tableContainer, options);
        }
        
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
        if (options) {
            this.applyPositionAndSize(textElm, options);
            this.applyTextStyles(textElm, options);
        }
        
        this.slideElm.appendChild(textElm);
        return this;
    }
    
    private applyPositionAndSize(element: HTMLElement, options: any): void {
        const pageWidthPx = inchesToPixels(this.pageSize.width);
        const pageHeightPx = inchesToPixels(this.pageSize.height);
        
        if (options.x !== undefined) {
            element.style.left = `${convertToPixels(options.x, pageWidthPx)}px`;
        }
        
        if (options.y !== undefined) {
            element.style.top = `${convertToPixels(options.y, pageHeightPx)}px`;
        }
        
        if (options.w !== undefined) {
            element.style.width = `${convertToPixels(options.w, pageWidthPx)}px`;
        }
        
        if (options.h !== undefined) {
            element.style.height = `${convertToPixels(options.h, pageHeightPx)}px`;
        }
    }
    
    private applyTextStyles(element: HTMLElement, options: PptxGenJS.TextPropsOptions): void {
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
        
        if (options.underline) {
            element.style.textDecoration = "underline";
        }
        
        if (options.align) {
            element.style.textAlign = alignToCSS(options.align);
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
        
        if (options.underline) {
            span.style.textDecoration = "underline";
        }
    }
    
    private applyShapeStyles(element: HTMLElement, options: PptxGenJS.ShapeProps): void {
        if (options.fill) {
            element.style.backgroundColor = colorToCSS(options.fill as any);
        }
        
        if (options.line) {
            element.style.borderColor = colorToCSS(options.line as any);
            element.style.borderWidth = "1px";
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
    font-family: Arial, Helvetica, sans-serif;
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
    overflow: hidden;
    word-wrap: break-word;
}

.slide-shape {
    border-style: solid;
}

.slide-image {
    object-fit: contain;
}

.slide-table {
    border-collapse: collapse;
    width: 100%;
}

.slide-table td,
.slide-table th {
    border: 1px solid #ddd;
    padding: 8px;
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
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Set viewport to match page size
        await page.setViewport({
            width: Math.round(inchesToPixels(this.pageSize.width)),
            height: Math.round(inchesToPixels(this.pageSize.height))
        });
        
        const pdf = await page.pdf({
            width: `${this.pageSize.width}in`,
            height: `${this.pageSize.height}in`,
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });
        
        await browser.close();
        await Bun.write(fileName, pdf);
        return fileName;
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
