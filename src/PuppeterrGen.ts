import PptxGenJS from "pptxgenjs";
import type { PptxAddSlideProps, PptxGenJSLike, PptxSectionProps, PptxSlide, PptxSlideMasterProps, PptxTableToSlidesProps, PptxWriteBaseProps, PptxWriteFileProps, PptxWriteProps } from "./pptx";
import * as jsdom from "jsdom";
import puppeteer from "puppeteer";
import { $ } from "bun";

class PuppeteerSlide implements PptxSlide {
    constructor(slideElm: HTMLDivElement) {
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
    }
    bkgd: string;
    slideElm: HTMLDivElement;
    background: PptxGenJS.BackgroundProps;
    color: string;
    hidden: boolean;
    slideNumber: PptxGenJS.SlideNumberProps;
    newAutoPagedSlides: PptxGenJS.PresSlide[];
    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: any[], options?: PptxGenJS.IChartOpts | undefined): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addImage(options: PptxGenJS.ImageProps): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addMedia(options: PptxGenJS.MediaProps): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addNotes(notes: string): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addShape(shapeName: PptxGenJS.SHAPE_NAME, options?: PptxGenJS.ShapeProps | undefined): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addTable(tableRows: PptxGenJS.TableRow[], options?: PptxGenJS.TableProps | undefined): PptxGenJS.Slide {
        throw new Error("Method not implemented.");
    }
    addText(text: string | PptxGenJS.TextProps[], options?: PptxGenJS.TextPropsOptions | undefined): PptxGenJS.Slide {
        const textElm = this.slideElm.appendChild(new jsdom.JSDOM().window.document.createElement("div"));
        textElm.textContent = typeof text === "string" ? text : text.map((t) => t.text).join("");
        return this;
    }
}

export class PuppeteerGen implements Omit<PptxGenJSLike, "version" | "presLayout" | "AlignH" | "AlignV" | "ChartType" | "OutputType" | "SchemeColor" | "ShapeType" | "PlaceholderType" | "layout" | "rtlMode" | "author" | "company" | "revision" | "subject" | "theme" | "title"> {
    constructor() {
        this.page = new jsdom.JSDOM().window.document;
    }
    page: Document;
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

        // print the page as a pdf
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.setContent(this.page.body.innerHTML);
        const pdf = await page.pdf();
        await browser.close();
        Bun.write(fileName, pdf);
        return fileName;
    }
    addSection(props: PptxSectionProps): void {
        throw new Error("Method not implemented.");
    }
    addSlide(props?: PptxAddSlideProps | undefined): PptxSlide;
    addSlide(masterName?: string | undefined): PptxSlide;
    addSlide(masterName?: unknown): PptxSlide {
        const slideElm = new jsdom.JSDOM().window.document.createElement("div");
        this.page.body.appendChild(slideElm);
        return new PuppeteerSlide(slideElm);
    }
    defineLayout(layout: PptxGenJS.PresLayout): void {
        throw new Error("Method not implemented.");
    }
    defineSlideMaster(props: PptxSlideMasterProps): void {
        throw new Error("Method not implemented.");
    }
    tableToSlides(eleId: string, props?: PptxTableToSlidesProps | undefined): void {
        throw new Error("Method not implemented.");
    }
}
