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
    const marked = markedParagraphs();
    shrinkTextToFit();
    raiseMarkedLines(marked);
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

    /**
     * The horizontal paragraphs whose last line (data-mark-baseline) or lines ending in a soft break
     * (data-break-baseline) sit higher in their line box than data-line-baseline, where the print step put every line,
     * with those raises as fractions of the line height: read before shrinkTextToFit scales the line height.
     */
    function markedParagraphs(): { paragraph: HTMLElement; mark: number; soft: number }[] {
        return Array.from(document.querySelectorAll<HTMLElement>(".text-paragraph[data-mark-baseline], .text-paragraph[data-break-baseline]")).flatMap(paragraph => {
            const content = paragraph.parentElement;
            if (!content?.classList.contains("text-content") || content.parentElement?.dataset.textDirection !== "horizontal") return [];
            const { lineBaseline = "", markBaseline = lineBaseline, breakBaseline = lineBaseline } = paragraph.dataset;
            const [baseline, mark, soft, height] = [parseFloat(lineBaseline), parseFloat(markBaseline), parseFloat(breakBaseline), parseFloat(paragraph.style.lineHeight)] as const;
            if (!Number.isFinite(baseline) || !Number.isFinite(mark) || !Number.isFinite(soft) || !height) {
                const name = paragraph.closest<HTMLElement>("[data-object-name]")?.dataset.objectName ?? "unnamed text box";
                throw new Error(`Cannot print '${name}': a .text-paragraph with data-mark-baseline or data-break-baseline needs numeric data-line-baseline, data-mark-baseline and data-break-baseline (px) and a px line-height (PdfLapas HTML profile)`);
            }
            return [{ paragraph, mark: (baseline - mark) / height, soft: (baseline - soft) / height }];
        });
    }

    /**
     * Raises the glyphs of each paragraph's last line by its mark raise and of each line ending in a soft break by its
     * break raise. Which characters are on that line is known only after layout, so the text from the line's first
     * character on is wrapped in relatively positioned spans, which move the glyphs and leave every line break as it is.
     */
    function raiseMarkedLines(paragraphs: { paragraph: HTMLElement; mark: number; soft: number }[]): void {
        // Client rects are in zoomed px (the print zoom on <html>), line heights in CSS px.
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const range = document.createRange();
        const moves: { nodes: Text[]; offset: number; raise: number; bullet?: HTMLElement }[] = [];
        // All reads first, so the wrapping below does not lay the document out again for each paragraph.
        for (const { paragraph, mark, soft } of paragraphs) {
            const height = parseFloat(paragraph.style.lineHeight);
            const segments: Text[][] = [[]];
            for (const child of Array.from(paragraph.children)) {
                if (child.tagName === "BR") segments.push([]);
                else if (child.classList.contains("text-run")) segments[segments.length - 1]?.push(...Array.from(child.childNodes).filter((node): node is Text => node instanceof Text && node.length > 0));
            }
            segments.forEach((nodes, index) => {
                const raise = (index === segments.length - 1 ? mark : soft) * height;
                const start = raise ? lastLineStart(nodes, (height * zoom) / 2) : undefined;
                if (!start) return;
                const onFirstLine = index === 0 && start.index === 0 && start.offset === 0;
                const bullet = onFirstLine ? (paragraph.querySelector<HTMLElement>(":scope > .text-bullet") ?? undefined) : undefined;
                moves.push({ nodes: nodes.slice(start.index), offset: start.offset, raise, bullet });
            });
        }
        for (const { nodes, offset, raise, bullet } of moves) {
            nodes.forEach((node, index) => {
                const span = document.createElement("span");
                span.style.position = "relative";
                span.style.top = `${-raise}px`;
                const moved = index === 0 && offset > 0 ? node.splitText(offset) : node;
                moved.replaceWith(span);
                span.append(moved);
            });
            if (bullet) {
                bullet.style.position = "relative";
                bullet.style.top = `${-raise}px`;
            }
        }

        /** The vertical centre of the character at `offset` in `node`, in client px; undefined when it draws no box. */
        function centre(node: Text, offset: number): number | undefined {
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getClientRects()[0];
            return rect && rect.top + rect.height / 2;
        }

        /**
         * Where the line of the last character of `nodes` starts: the node index and offset of its first character. Each
         * line is one line height tall, so a character is on that line when its centre is within `band` of the last one's.
         */
        function lastLineStart(nodes: Text[], band: number): { index: number; offset: number } | undefined {
            const lastNode = nodes[nodes.length - 1];
            const last = lastNode && centre(lastNode, lastNode.length - 1);
            if (!lastNode || last === undefined) return undefined;
            const onLine = (node: Text, offset: number) => {
                const y = centre(node, offset);
                return y === undefined || Math.abs(y - last) < band;
            };
            let start = { index: nodes.length - 1, offset: lastNode.length - 1 };
            for (let index = nodes.length - 1; index >= 0; index--) {
                const node = nodes[index];
                if (!node || !onLine(node, node.length - 1)) break;
                if (onLine(node, 0)) {
                    start = { index, offset: 0 };
                    continue;
                }
                // Lines only move down through the text: offset `low` is on an earlier line, `high` on this one.
                let [low, high] = [0, node.length - 1];
                while (high - low > 1) {
                    const middle = Math.floor((low + high) / 2);
                    if (onLine(node, middle)) high = middle;
                    else low = middle;
                }
                return { index, offset: high };
            }
            return start;
        }
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
