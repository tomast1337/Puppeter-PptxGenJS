import { CSS_PX_PER_INCH, type HtmlPresentationDocument, type PresentationRenderer } from "@pdflapas/model";
import type { Page } from "puppeteer";
import { withBrowser } from "./browser";
import { DEFAULT_LAUNCH_OPTIONS, type PuppeteerLaunchOptions } from "./launchOptions";
import { type DocumentInfo, withDocumentInfo } from "./pdfInfo";
import { PRINT_ZOOM, printHtml } from "./printWorkarounds";

// Model page sizes are in inches.
const inchesToPixels = (inches: number): number => inches * CSS_PX_PER_INCH;

/** Options for `PuppeteerPdfRenderer`. */
export interface PuppeteerPdfRendererOptions {
    /** Merged over `DEFAULT_LAUNCH_OPTIONS` (shallowly: `args` given here replaces the default args). */
    readonly launchOptions?: PuppeteerLaunchOptions;
}

export class PuppeteerPdfRenderer implements PresentationRenderer {
    private readonly launchOptions: PuppeteerLaunchOptions;

    constructor({ launchOptions }: PuppeteerPdfRendererOptions = {}) {
        this.launchOptions = { ...DEFAULT_LAUNCH_OPTIONS, ...launchOptions };
    }

    render(document: HtmlPresentationDocument): Promise<Uint8Array> {
        return withBrowser(async browser => {
            const page = await browser.newPage();
            try {
                return await printPdf(page, document);
            } finally {
                await page.close();
            }
        }, this.launchOptions);
    }
}

async function printPdf(page: Page, { html, pageSize }: HtmlPresentationDocument): Promise<Uint8Array> {
    await page.setViewport({
        width: Math.round(inchesToPixels(pageSize.width)),
        height: Math.round(inchesToPixels(pageSize.height)),
    });
    // Images are inlined by resolveDocumentImages; prepareForPrint waits for fonts and decoding.
    // The print workarounds are in the document before anything measures it: its text shrinking scales them.
    await page.setContent(printHtml(html), { waitUntil: "load" });
    const failed = await page.evaluate(prepareForPrint);
    if (failed.length) throw new Error(`Image failed to decode: ${failed.join(", ")}`);

    const pdf = await page.pdf({
        width: `${pageSize.width}in`,
        height: `${pageSize.height}in`,
        // The document's @page size wins over width and height, which are only the fallback. Chromium rounds a
        // width/height paper up and centres the @page box on it at a whole CSS px, shifting everything by up to
        // 1px (0.75pt) on sizes such as 8.2646 x 11.695in; LibreOffice and PowerPoint place it at the origin.
        preferCSSPageSize: true,
        // printHtml lays the document out at PRINT_ZOOM; this scales it back to the deck size.
        scale: 1 / PRINT_ZOOM,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return withDocumentInfo(pdf, await page.evaluate(documentInfo));
}

// prepareForPrint and documentInfo run inside the page: page.evaluate sends their source text, so they may use only
// their own code (prepareForPrint's stages are nested in it for that reason) and the page's globals.

/**
 * Settles the document for printing in one page.evaluate round trip, and returns the names of the images that did
 * not decode.
 */
async function prepareForPrint(): Promise<string[]> {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, settled));
    // The frozen GIFs decode again from their new PNG source.
    await Promise.all((await freezeGifs()).map(settled));
    scaleImagesToBox();
    shrinkTextToFit();
    return failedImages();

    /** Resolves once `image` has loaded or failed. */
    function settled(image: HTMLImageElement): Promise<void> {
        if (image.complete) return Promise.resolve();
        return new Promise<void>(resolve => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
        });
    }

    /**
     * LibreOffice's PDF export drops animated GIFs, so it cannot be used as the visual oracle here. Freeze through
     * Chromium's static bitmap decoder to match PowerPoint's PDF first frame. Returns the frozen images.
     */
    async function freezeGifs(): Promise<HTMLImageElement[]> {
        const gifs = Array.from(document.images).filter(image => image.src.startsWith("data:image/gif"));
        if (!gifs.length) return gifs;
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
        return gifs;
    }

    /**
     * PowerPoint scales the decoded image surface into its declared blip rectangle. Explicitly transform from
     * natural pixels so SVG preserveAspectRatio rules cannot override that geometry.
     */
    function scaleImagesToBox(): void {
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
    }

    /**
     * Shrinks the text of `fit: "shrink"` boxes until it fits inside the box padding, by the rule the box states
     * (docs/HTML_PROFILE.md, Text): run and bullet font sizes, px line heights and the baseline shift scale together.
     */
    function shrinkTextToFit(): void {
        document.querySelectorAll<HTMLElement>('.slide-text[data-text-fit="shrink"]').forEach(box => {
            const content = box.querySelector<HTMLElement>(".text-content");
            if (!content) return;
            const step = Number(box.dataset.textFitStep);
            const maxSteps = Number(box.dataset.textFitMaxSteps);
            const tolerance = Number(box.dataset.textFitTolerance);
            if (!(step > 0 && step < 1) || !Number.isInteger(maxSteps) || maxSteps < 0 || !(tolerance >= 0)) {
                const name = box.dataset.objectName ?? "unnamed text box";
                throw new Error(`Cannot print '${name}': a data-text-fit="shrink" box needs data-text-fit-step (between 0 and 1), data-text-fit-max-steps (a whole number) and data-text-fit-tolerance (px); complete hand-written HTML with completeProfileHtml()`);
            }
            const boxStyle = getComputedStyle(box);
            const availableWidth = box.clientWidth - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight);
            const availableHeight = box.clientHeight - parseFloat(boxStyle.paddingTop) - parseFloat(boxStyle.paddingBottom);
            for (let iteration = 0; iteration < maxSteps && (content.scrollWidth > availableWidth + tolerance || content.scrollHeight > availableHeight + tolerance); iteration++) {
                content.querySelectorAll<HTMLElement>(".text-run, .text-bullet").forEach(run => {
                    run.style.fontSize = `${parseFloat(getComputedStyle(run).fontSize) * step}px`;
                });
                content.querySelectorAll<HTMLElement>(".text-paragraph").forEach(paragraph => {
                    const lineHeight = paragraph.style.lineHeight;
                    if (lineHeight.endsWith("px")) paragraph.style.lineHeight = `${parseFloat(lineHeight) * step}px`;
                    // The baseline shift is a fraction of the line box and font size, so it shrinks with them.
                    if (paragraph.style.top.endsWith("px")) paragraph.style.top = `${parseFloat(paragraph.style.top) * step}px`;
                });
            }
        });
    }

    /** The names of the images that did not decode. */
    function failedImages(): string[] {
        return Array.from(document.images)
            .filter(image => image.naturalWidth === 0 || image.naturalHeight === 0)
            .map(image => image.alt || image.closest<HTMLElement>("[data-object-name]")?.dataset.objectName || "unnamed image");
    }
}

/** Chromium writes only the Title (from <title>); the meta tags become Author, Subject, Company and Revision. */
function documentInfo(): DocumentInfo {
    const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
    return { Title: document.title, Author: meta("author"), Subject: meta("description"), Company: meta("pdflapas-company"), Revision: meta("pdflapas-revision") };
}
