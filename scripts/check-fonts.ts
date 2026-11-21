// Lists the faces the PowerPoint target needs, and any given as arguments, that fontconfig has not installed; exits 1
// when one is missing. `bun run fonts:check "My Brand Sans"`.
import { checkPowerPointFonts } from "../packages/pptxgenjs/src/node";
import { POWERPOINT_FACES } from "../packages/pptxgenjs/src/target";

const { present, missing } = checkPowerPointFonts({ faces: process.argv.slice(2) });

for (const face of present) {
    console.log(`present  ${face}`);
}

for (const face of missing) {
    const known = POWERPOINT_FACES.find(({ name }) => name === face);

    console.log(`missing  ${face}${known ? ` (${known.role}): ${known.withoutIt}` : " (deck face)"}`);
}

if (missing.length) {
    process.exitCode = 1;
}
