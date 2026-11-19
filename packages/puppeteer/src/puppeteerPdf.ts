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
    strokeTableBorders();
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
                    // shortcut: the scaled shift keeps the unscaled line's strut floor (printWorkarounds strutBaseline),
                    // up to 1 device px off; recompute it from data-line-baseline when shrunk baselines are measured.
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

    /**
     * Strokes table borders as the profile draws them (docs/HTML_PROFILE.md, Table): one line per run of grid edges
     * with the same border, at the border's width, centred on the grid line. Chromium paints a CSS border as a filled
     * box floored to whole device px (a 0.5pt border prints 0.47pt high), which viewers anti-alias to a pale line,
     * where they draw a stroke crisp. The CSS borders keep their width, so the layout stays as it is, and turn
     * transparent; an SVG over the table strokes the lines on the edges of the cells, which a collapsed border centres
     * on the grid line. Read after the text has settled, since a row grows to its text.
     */
    function strokeTableBorders(): void {
        const BORDER = /(?:^|; )border-(top|right|bottom|left): ([^ ;]+)px ([^ ;]+) ([^;]+)(?=;|$)/g;
        const SVG = "http://www.w3.org/2000/svg";
        const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        type Side = { width: number; color: string; dash: string | undefined };
        for (const table of Array.from(document.querySelectorAll<HTMLTableElement>("table.slide-table"))) {
            const container = table.parentElement;
            if (!container) continue;
            // A transform moves no layout: measure without the object's rotation or flip, in CSS px from its corner.
            const transform = container.style.transform;
            container.style.transform = "none";
            const origin = container.getBoundingClientRect();
            const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("td"), cell => {
                const rect = cell.getBoundingClientRect();
                const sides: Record<string, Side> = {};
                for (const [, name = "", width, style, color = ""] of (cell.getAttribute("style") ?? "").matchAll(BORDER)) {
                    if (style === "none" || !(Number(width) > 0)) continue;
                    sides[name] = { width: Number(width), color, dash: cell.getAttribute(`data-border-${name}-dash-array`) ?? undefined };
                }
                const at = (value: number, from: number) => (value - from) / zoom;
                return { sides, left: at(rect.left, origin.left), right: at(rect.right, origin.left), top: at(rect.top, origin.top), bottom: at(rect.bottom, origin.top) };
            });
            container.style.transform = transform;
            // After every read: a style write between two reads makes Chromium recompute styles for the second.
            table.querySelectorAll<HTMLTableCellElement>("td").forEach(cell => (cell.style.borderColor = "transparent"));

            // The grid lines are the cells' edges; a key rounds away layout-unit noise. The first line is drawn on the
            // object's corner, where DrawingML starts the grid: the table offset centres only the widest border there.
            const key = (value: number) => Math.round(value * 64);
            const grid = (values: number[]) => {
                const sorted = Array.from(new Map(values.map(value => [key(value), value])).values()).sort((a, b) => a - b);
                const first = sorted[0] ?? 0;
                return { lines: sorted.map(value => value - first), index: new Map(sorted.map((value, index) => [key(value), index])) };
            };
            const xs = grid(cells.flatMap(cell => [cell.left, cell.right]));
            const ys = grid(cells.flatMap(cell => [cell.top, cell.bottom]));
            // Edge `line * steps + step` of each direction. The wider side wins an edge two cells share, as in CSS's
            // collapsing border model, and on a tie the first cell in document order keeps it.
            const horizontal: (Side | undefined)[] = [];
            const vertical: (Side | undefined)[] = [];
            const columns = xs.lines.length - 1;
            const rows = ys.lines.length - 1;
            const claim = (edges: (Side | undefined)[], slot: number, side: Side | undefined) => {
                const held = edges[slot];
                if (side && (!held || side.width > held.width)) edges[slot] = side;
            };
            for (const { sides, left, right, top, bottom } of cells) {
                const [x0 = 0, x1 = 0, y0 = 0, y1 = 0] = [xs.index.get(key(left)), xs.index.get(key(right)), ys.index.get(key(top)), ys.index.get(key(bottom))];
                for (let column = x0; column < x1; column++) {
                    claim(horizontal, y0 * columns + column, sides.top);
                    claim(horizontal, y1 * columns + column, sides.bottom);
                }
                for (let row = y0; row < y1; row++) {
                    claim(vertical, x0 * rows + row, sides.left);
                    claim(vertical, x1 * rows + row, sides.right);
                }
            }

            const svg = document.createElementNS(SVG, "svg");
            svg.setAttribute("style", "position: absolute; left: 0px; top: 0px; width: 1px; height: 1px; overflow: visible;");
            /** The dashes of `side` from `from` to `to`: Skia prints a dashed stroke as filled outlines, so each dash is its own subpath. */
            const dashes = (side: Side, from: number, to: number): [number, number][] => {
                const pattern = (side.dash ?? "").split(/[\s,]+/).map(Number);
                const period = pattern.reduce((sum, part) => sum + part, 0);
                if (!(period > 0) || pattern.some(part => !(part >= 0))) return [[from, to]];
                const on: [number, number][] = [];
                for (let at = from, index = 0; at < to; index++) {
                    const length = pattern[index % pattern.length] ?? 0;
                    if (index % 2 === 0 && length > 0) on.push([at, Math.min(at + length, to)]);
                    at += length;
                }
                return on;
            };
            const strokeLines = (edges: (Side | undefined)[], lines: number[], steps: number[], segment: (at: number, from: number, to: number) => string) =>
                lines.forEach((at, line) => {
                    let run: { start: number; side: Side } | undefined;
                    for (let step = 0; step <= steps.length - 1; step++) {
                        const side = step < steps.length - 1 ? edges[line * (steps.length - 1) + step] : undefined;
                        if (run && side && side.width === run.side.width && side.color === run.side.color && side.dash === run.side.dash) continue;
                        if (run) {
                            const path = document.createElementNS(SVG, "path");
                            path.setAttribute(
                                "d",
                                dashes(run.side, steps[run.start] ?? 0, steps[step] ?? 0)
                                    .map(([from, to]) => segment(at, from, to))
                                    .join(" "),
                            );
                            path.setAttribute("fill", "none");
                            path.setAttribute("stroke", run.side.color);
                            path.setAttribute("stroke-width", String(run.side.width));
                            // Solid lines close the corners they share with the lines across them.
                            path.setAttribute("stroke-linecap", run.side.dash ? "butt" : "square");
                            svg.append(path);
                        }
                        run = side && { start: step, side };
                    }
                });
            strokeLines(horizontal, ys.lines, xs.lines, (y, from, to) => `M ${from} ${y} H ${to}`);
            strokeLines(vertical, xs.lines, ys.lines, (x, from, to) => `M ${x} ${from} V ${to}`);
            if (svg.childElementCount) table.after(svg);
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
