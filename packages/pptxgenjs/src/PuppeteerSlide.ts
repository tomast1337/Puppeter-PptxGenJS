import type PptxGenJS from "pptxgenjs";
import type { NormalizedImage, NormalizedSlide, NormalizedSlideObject } from "@pdflapas/model";
import type { ChartExtensionInput, ChartExtensionOptions } from "./chart/types";
import { normalizeComponent } from "./components/normalize";
import type { ComponentInput, ComponentOptions } from "./components/types";
import { PPTX_DEFAULTS } from "./defaults";
import { normalizeChart } from "./normalize/chart";
import { normalizeImage } from "./normalize/image";
import { normalizeObjectStyle } from "./normalize/object";
import { normalizeShape, normalizeShapeTextBox } from "./normalize/shape";
import { normalizeShapeLine, normalizeTextLine, straightLineLength } from "./normalize/shape/line";
import { normalizeSlideNumber } from "./normalize/slideNumber";
import { normalizeColor, normalizeLine } from "./normalize/style";
import { normalizeTable } from "./normalize/table";
import { paginateTableRows } from "./normalize/table/pagination";
import { collapseTextMargins, normalizeText, type TextInput } from "./normalize/text";
import type { PageSize } from "./pageLayouts";
import type { PptxSlide } from "./pptx";
import { chartSize, renderChartExtension, renderChartExtensionSvg } from "./render/chart";
import { renderComponent } from "./render/component";
import { objectIdScope } from "./render/slide";
import type { SlideContext } from "./slideContext";
import { UnsupportedFeatureError } from "./UnsupportedFeatureError";
import { pixelsToInches } from "./units";

/** A `placeholder` names one on the slide's layout, which only defineSlideMaster() can define. */
function placeholderError(method: "addText" | "addImage"): UnsupportedFeatureError {
    return new UnsupportedFeatureError(`${method}({ placeholder })`, "Placeholders come from slide layouts, which need defineSlideMaster(), and PdfLapas has no slide masters. Remove `placeholder` and give the object its own x, y, w, h and style.", "property");
}

export class PuppeteerSlide implements PptxSlide {
    /** `context` is created by the presentation that owns the slide; every field is required, so nothing falls back to a default here. */
    constructor(private readonly context: SlideContext) {
        this.pageSize = context.pageSize;
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
        this.context.setMasterSlideNumber(value);
    }

    /**
     * The slide's model as getModel() returns it: the background picture first, stretched over `pageSize` (the
     * presentation's), then the slide's objects, then its number, which PptxGenJS writes last. `masterSlideNumber` is
     * the `slideNumber` set last on any slide.
     */
    toModel(pageSize: PageSize, masterSlideNumber: PptxGenJS.SlideNumberProps | null): NormalizedSlide {
        const backgroundStyle = () => normalizeObjectStyle({ x: 0, y: 0, w: pageSize.width, h: pageSize.height }, PPTX_DEFAULTS.image, pageSize, PPTX_DEFAULTS.backgroundImage.objectName);
        const background: NormalizedSlideObject[] = this.backgroundImage ? [{ kind: "image", style: backgroundStyle(), image: this.backgroundImage }] : [];
        const slideNumber = this._slideNumber ? [normalizeSlideNumber(this._slideNumber, masterSlideNumber ?? {}, this.context.slideIndex + 1, this.pageSize, this.context.bodyFontFace(), this.context.target, this.context.fontMetrics)] : [];
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
        return objectIdScope(this.context.slideIndex, this.model.objects.length);
    }

    addComponent(input: ComponentInput, options: ComponentOptions): this {
        const normalized = normalizeComponent(input, options, this.pageSize, options?.objectName ?? "Component");
        const definition = this.context.components.get(normalized.input.type, normalized.input.version);
        // Application code: render it once here so its validation and render errors throw from addComponent
        // and leave the slide unchanged. The markup is dropped; toHtml() renders the model again.
        renderComponent(normalized, definition, this.nextIdScope(), this.context.getDocument);
        // The default name is only consumed after a successful render.
        const objectName = this.nextObjectName("Component", options.objectName);
        return this.addObject({ kind: "component", style: { ...normalized.style, objectName }, component: normalized.input });
    }

    // PptxGenJS declares `data: any[]`; `unknown[]` accepts every argument that does and is narrowed below.
    addChart(type: PptxGenJS.CHART_NAME | PptxGenJS.IChartMulti[], data: unknown[], options?: PptxGenJS.IChartOpts | undefined): PptxGenJS.Slide {
        // PptxGenJS treats the second argument as the shared options object for
        // IChartMulti[] calls; each mixed entry already carries its own data.
        // `as`: PptxGenJS types `data` as an array, which this call shape breaks; it is the options object here.
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
        const chart = normalizeChart(type, Array.isArray(data) ? (data as PptxGenJS.OptsChartData[]) : [], { ...chartOptions, legendFontFace: chartOptions.legendFontFace ?? this.context.bodyFontFace() });
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
                const target = index === 0 ? this : this.context.continuationSlide(index);
                if (index > 0) continuationSlides.push(target);
                target.addTable(page.rows, {
                    ...tableOptions,
                    // PptxGenJS 4.0.1 addTableDefinition (step 6 C) adds each page with the caller's options, so its
                    // rows keep the caller's rowH or h and otherwise size to their content.
                    y: page.y,
                    autoPage: false,
                });
            });
            this.newAutoPagedSlides = continuationSlides;
            return this;
        }
        const table = normalizeTable(tableRows, { ...tableOptions, fontFace: tableOptions.fontFace ?? this.context.bodyFontFace() }, this.pageSize, this.context.target, this.context.fontMetrics);
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
        const normalizedText = normalizeText(text, { color: this.color, ...textOptions, fontFace: textOptions.fontFace ?? this.context.bodyFontFace() }, this.context.target, this.context.fontMetrics, this.context.bodyFontFace());
        const height = textStyle.geometry.height ?? 0;
        if (!textOptions.shape) return this.addObject({ kind: "text", style: textStyle, text: collapseTextMargins(normalizedText, height) });
        // `as`: PptxGenJS writes a text box's shape from its own options object, so normalizeShape reads them as ShapeProps.
        const shapeOptions = textOptions as unknown as PptxGenJS.ShapeProps;
        const shape = normalizeShape(textOptions.shape, shapeOptions, textStyle.geometry.width ?? 0, height, this.pageSize);
        return this.addObject({ kind: "text", style: textStyle, text: collapseTextMargins(normalizeShapeTextBox(normalizedText, shape), height), shape });
    }
}
