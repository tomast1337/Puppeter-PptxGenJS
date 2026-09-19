import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../../src/PuppeterrGen";
import { PAGE_SIZES } from "../../src/pageLayouts";
import { populateParityFixture } from "./fixture";

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

const reference = new pptxgen();
reference.defineLayout({ name: "PARITY", width: 10, height: 5.625 });
reference.layout = "PARITY";
populateParityFixture(reference);
await reference.writeFile({ fileName: referencePptx });

const actual = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
populateParityFixture(actual);
await actual.writeFile({ fileName: actualPdf });

const libreOfficeProfile = join(artifacts, "libreoffice-profile");
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
await run(["pdftoppm", "-png", "-r", "96", referencePdf, join(artifacts, "reference")]);
await run(["pdftoppm", "-png", "-r", "96", actualPdf, join(artifacts, "actual")]);

const files = await readdir(artifacts);
const referencePages = files.filter(file => /^reference-\d+\.png$/.test(file)).sort();
const actualPages = files.filter(file => /^actual-\d+\.png$/.test(file)).sort();
if (referencePages.length !== actualPages.length || referencePages.length === 0) {
    throw new Error(`Page count mismatch: reference=${referencePages.length}, actual=${actualPages.length}`);
}

const pageScores: number[] = [];
for (let index = 0; index < referencePages.length; index++) {
    const output = await run([
        "magick",
        "compare",
        "-metric",
        "RMSE",
        join(artifacts, referencePages[index]!),
        join(artifacts, actualPages[index]!),
        join(artifacts, `diff-${index + 1}.png`),
    ], [0, 1]);
    const normalizedScore = output.match(/\((\d*\.?\d+)\)/)?.[1];
    if (!normalizedScore) throw new Error(`Could not parse ImageMagick metric: ${output}`);
    pageScores.push(Number(normalizedScore));
}

const worstScore = Math.max(...pageScores);
console.log(`Visual parity RMSE by page: ${pageScores.map(score => score.toFixed(4)).join(", ")}`);
console.log(`Acceptance threshold: ${threshold.toFixed(4)}`);
console.log(`Artifacts: ${artifacts}`);

if (worstScore > threshold) {
    throw new Error(`Visual difference ${worstScore.toFixed(4)} exceeds ${threshold.toFixed(4)}`);
}
