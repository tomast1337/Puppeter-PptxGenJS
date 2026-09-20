import { mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../../src/PuppeterrGen";
import { PAGE_SIZES } from "../../src/pageLayouts";
import { PARITY_REGIONS, populateParityFixture } from "./fixture";
import { writeVisualGallery } from "./gallery";

const threshold = Number(process.env.VISUAL_DIFF_THRESHOLD ?? "0.12");
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("VISUAL_DIFF_THRESHOLD must be a number between 0 and 1");
}

const requiredTools = ["libreoffice", "pdftoppm", "magick"] as const;
for (const tool of requiredTools) {
    if (!Bun.which(tool)) {
        throw new Error(`Visual comparison requires '${tool}' on PATH`);
    }
}

async function run(command: string[], acceptedExitCodes = [0]): Promise<string> {
    const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ]);

    if (!acceptedExitCodes.includes(exitCode)) {
        throw new Error(`${command.join(" ")} failed (${exitCode})\n${stderr || stdout}`);
    }
    return `${stdout}\n${stderr}`.trim();
}

const artifacts = await mkdtemp(join(tmpdir(), "puppeteer-gen-parity-"));
const referencePptx = join(artifacts, "reference.pptx");
const referencePdf = join(artifacts, "reference.pdf");
const actualPdf = join(artifacts, "actual.pdf");

// PptxGenJS's tableToSlides API reads a browser-global DOM. JSDOM supplies
// computed styles, while these two layout/text shims provide the properties
// its synchronous extractor consumes.
const sourceDom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
Object.defineProperty(sourceDom.window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) { return parseFloat(this.style.width) || Number(this.getAttribute("width")) || 0; },
});
Object.defineProperty(sourceDom.window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
        const read = (node: Node): string => node.nodeType === node.TEXT_NODE
            ? node.nodeValue ?? ""
            : node instanceof sourceDom.window.HTMLBRElement
                ? "\n"
                : Array.from(node.childNodes).map(read).join("");
        return read(this).trim();
    },
});
// PptxGenJS asks for the same computed style dozens of times per table cell.
// JSDOM computes a new declaration on every call. Under Bun 1.4.0, creating
// all those duplicates makes a later cssstyle mutation grow native memory
// without bound, so reuse declarations for this immutable fixture DOM.
const computedStyles = new WeakMap<Element, CSSStyleDeclaration>();
const getComputedStyle = sourceDom.window.getComputedStyle.bind(sourceDom.window);
sourceDom.window.getComputedStyle = ((element: Element, pseudoElement?: string | null) => {
    if (pseudoElement) return getComputedStyle(element, pseudoElement);
    const cached = computedStyles.get(element);
    if (cached) return cached;
    const style = getComputedStyle(element);
    computedStyles.set(element, style);
    return style;
}) as typeof sourceDom.window.getComputedStyle;
Object.assign(globalThis, { document: sourceDom.window.document, window: sourceDom.window });
const progress = (stage: string) => { if (process.env.VISUAL_PROGRESS) console.log(`[visual] ${stage}`); };

const reference = new pptxgen();
reference.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
reference.layout = "PARITY";
progress("populate reference");
populateParityFixture(reference);
progress("write reference pptx");
await reference.writeFile({ fileName: referencePptx });

const actual = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
progress("populate actual");
populateParityFixture(actual);
progress("write actual pdf");
await actual.writeFile({ fileName: actualPdf });

const libreOfficeProfile = join(artifacts, "libreoffice-profile");
progress("convert reference pdf");
await run([
    "libreoffice",
    "--headless",
    `-env:UserInstallation=file://${libreOfficeProfile}`,
    "--convert-to",
    "pdf",
    "--outdir",
    artifacts,
    referencePptx,
]);
progress("rasterize PDFs");
await run(["pdftoppm", "-png", "-r", "96", referencePdf, join(artifacts, "reference")]);
await run(["pdftoppm", "-png", "-r", "96", actualPdf, join(artifacts, "actual")]);

const files = await readdir(artifacts);
const pageNumber = (file: string) => Number(file.match(/-(\d+)\.png$/)?.[1]);
const referencePages = files.filter(file => /^reference-\d+\.png$/.test(file)).sort((a, b) => pageNumber(a) - pageNumber(b));
const actualPages = files.filter(file => /^actual-\d+\.png$/.test(file)).sort((a, b) => pageNumber(a) - pageNumber(b));
if (referencePages.length !== actualPages.length || referencePages.length === 0) {
    throw new Error(`Page count mismatch: reference=${referencePages.length}, actual=${actualPages.length}`);
}
const pageDigits = Math.max(2, String(referencePages.length).length);
const pageFiles = await Promise.all(referencePages.map(async (referencePage, index) => {
    const page = String(index + 1).padStart(pageDigits, "0");
    const referenceName = `${page}-reference.png`;
    const actualName = `${page}-actual.png`;
    await Promise.all([
        rename(join(artifacts, referencePage), join(artifacts, referenceName)),
        rename(join(artifacts, actualPages[index]!), join(artifacts, actualName)),
    ]);
    return { page, referenceName, actualName };
}));

const pageScores: number[] = [];
for (const page of pageFiles) {
    const output = await run([
        "magick",
        "compare",
        "-metric",
        "RMSE",
        join(artifacts, page.referenceName),
        join(artifacts, page.actualName),
        join(artifacts, `${page.page}-diff.png`),
    ], [0, 1]);
    const normalizedScore = output.match(/\((\d*\.?\d+)\)/)?.[1];
    if (!normalizedScore) throw new Error(`Could not parse ImageMagick metric: ${output}`);
    pageScores.push(Number(normalizedScore));
}

const regionFailures: string[] = [];
for (const region of PARITY_REGIONS) {
    const pageIndex = region.page - 1;
    const page = pageFiles[pageIndex]!;
    const geometry = `${region.w}x${region.h}+${region.x}+${region.y}`;
    const referenceCrop = join(artifacts, `${page.page}-${region.name}-reference.png`);
    const actualCrop = join(artifacts, `${page.page}-${region.name}-actual.png`);
    await run(["magick", join(artifacts, page.referenceName), "-crop", geometry, "+repage", referenceCrop]);
    await run(["magick", join(artifacts, page.actualName), "-crop", geometry, "+repage", actualCrop]);
    const output = await run([
        "magick", "compare", "-metric", "RMSE", referenceCrop, actualCrop,
        join(artifacts, `${page.page}-${region.name}-diff.png`),
    ], [0, 1]);
    const metric = output.match(/\((\d*\.?\d+)\)/)?.[1];
    if (!metric) throw new Error(`Could not parse region metric: ${output}`);
    const score = Number(metric);
    console.log(`${region.name}: ${score.toFixed(4)} (limit ${region.threshold.toFixed(4)})`);
    if (score > region.threshold) regionFailures.push(`${region.name}: ${score.toFixed(4)} > ${region.threshold}`);
}

const worstScore = Math.max(...pageScores);
console.log(`Visual parity RMSE by page: ${pageScores.map(score => score.toFixed(4)).join(", ")}`);
console.log(`Acceptance threshold: ${threshold.toFixed(4)}`);
console.log(`Artifacts: ${artifacts}`);

if (worstScore > threshold) {
    throw new Error(`Visual difference ${worstScore.toFixed(4)} exceeds ${threshold.toFixed(4)}`);
}
if (regionFailures.length) {
    throw new Error(`Feature crop differences exceed acceptance:\n${regionFailures.join("\n")}`);
}

if (process.env.VISUAL_GALLERY_DIR) {
    const galleryDirectory = resolve(process.env.VISUAL_GALLERY_DIR);
    if (galleryDirectory === resolve(".")) throw new Error("VISUAL_GALLERY_DIR must not be the repository root");
    await writeVisualGallery(artifacts, pageFiles, pageScores, threshold, galleryDirectory);
    console.log(`Gallery: ${galleryDirectory}`);
}
