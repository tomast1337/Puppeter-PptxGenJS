import pptxgen from "pptxgenjs";
import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

function main(pres: pptxgen | PuppeteerGen) {
    // First slide with simple text
    let slide1 = pres.addSlide();
    slide1.addText("Hello World from PptxGenJS/PuppeteerGen!", { 
        x: 1, 
        y: 1, 
        w: 8,
        h: 1,
        color: "#363636",
        fontSize: 32,
        bold: true
    });
    
    // Second slide with multiple elements
    let slide2 = pres.addSlide();
    slide2.addText("Positioned Text", { 
        x: 0.5, 
        y: 0.5, 
        w: 3,
        h: 0.5,
        color: "#FF0000",
        fontSize: 24
    });
    
    slide2.addText("Centered Text", { 
        x: 2, 
        y: 2, 
        w: 6,
        h: 1,
        color: "#0000FF",
        fontSize: 20,
        align: "center",
        fill: { color: "#F0F0F0" }
    });
    
    // Third slide with table
    let slide3 = pres.addSlide();
    slide3.addText("Table Example", { 
        x: 0.5, 
        y: 0.5, 
        fontSize: 24,
        bold: true
    });
    
    slide3.addTable([
        [{ text: "Header 1" }, { text: "Header 2" }, { text: "Header 3" }],
        [{ text: "Row 1, Col 1" }, { text: "Row 1, Col 2" }, { text: "Row 1, Col 3" }],
        [{ text: "Row 2, Col 1" }, { text: "Row 2, Col 2" }, { text: "Row 2, Col 3" }]
    ], {
        x: 0.5,
        y: 1.5,
        w: 8,
        h: 2
    });
    
    pres.writeFile({ fileName: `Hello-World-${pres.constructor.name}.${pres.constructor.name === "pptxgen" ? "pptx" : "pdf"}` });
}

// Create presentation with PptxGenJS
const pres1 = new pptxgen();

// Create presentation with PuppeteerGen using 16:9 layout
const pres2 = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);

// Run both
main(pres1);
main(pres2);

console.log("Presentations generated successfully!");
