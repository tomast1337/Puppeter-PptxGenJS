import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "./PuppeterrGen";

{
    // 1. Create a Presentation
    let pres = new pptxgen();

    // 2. Add a Slide to the presentation
    let slide = pres.addSlide();

    // 3. Add 1+ objects (Tables, Shapes, etc.) to the Slide
    let textboxText = "Hello World from PptxGenJS!";
    let textboxOpts = { x: 1, y: 1, color: "363636" };
    slide.addText(textboxText, textboxOpts);

    // 4. Save the Presentation
    pres.writeFile({ fileName: "Hello-World.pptx" });
}

{
    let pres = new PuppeteerGen();
    let slide = pres.addSlide();
    slide.addText("Hello World from PuppeteerGen!", { x: 1, y: 1, color: "363636" });
    pres.writeFile({ fileName: "Hello-World.pdf" });
}
