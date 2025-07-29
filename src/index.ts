import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "./PuppeterrGen";

function main(pres: pptxgen | PuppeteerGen) {
    let slide = pres.addSlide();
    slide.addText("Hello World from PptxGenJS!", { x: 1, y: 1, color: "363636" });
    pres.writeFile({ fileName: `Hello-World-${pres.constructor.name}.${pres.constructor.name === "pptxgen" ? "pptx" : "pdf"}` });
}

const pres1 = new pptxgen();

const pres2 = new PuppeteerGen();

main(pres1);
main(pres2);
