import { PuppeteerGen } from "../src/PuppeterrGen";
import { PAGE_SIZES } from "../src/pageLayouts";

// Example 1: Using different page sizes
async function examplePageSizes() {
    console.log("Example 1: Creating presentations with different page sizes...");
    
    // 16:9 Landscape (default for presentations)
    const pres1 = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
    const slide1 = pres1.addSlide();
    slide1.addText("16:9 Landscape Presentation", { 
        x: 1, 
        y: 2, 
        fontSize: 44, 
        bold: true,
        color: "#0066CC"
    });
    await pres1.writeFile({ fileName: "example-16x9-landscape.pdf" });
    
    // A4 Portrait
    const pres2 = new PuppeteerGen(PAGE_SIZES.A4.portrait);
    const slide2 = pres2.addSlide();
    slide2.addText("A4 Portrait Document", { 
        x: 1, 
        y: 2, 
        fontSize: 36, 
        bold: true,
        color: "#CC0000"
    });
    await pres2.writeFile({ fileName: "example-a4-portrait.pdf" });
    
    // Letter Landscape
    const pres3 = new PuppeteerGen(PAGE_SIZES.LETTER.landscape);
    const slide3 = pres3.addSlide();
    slide3.addText("Letter Landscape Document", { 
        x: 1, 
        y: 2, 
        fontSize: 36, 
        bold: true,
        color: "#009900"
    });
    await pres3.writeFile({ fileName: "example-letter-landscape.pdf" });
    
    console.log("✓ Generated 3 PDFs with different page sizes");
}

// Example 2: Using inches and percentages for positioning
async function examplePositioning() {
    console.log("\nExample 2: Demonstrating positioning with inches...");
    
    const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
    const slide = pres.addSlide();
    
    // Position using inches (standard in PptxGenJS)
    slide.addText("Top Left (0.5in, 0.5in)", { 
        x: 0.5, 
        y: 0.5, 
        fontSize: 18,
        color: "#FF0000"
    });
    
    slide.addText("Centered (3in, 2.5in)", { 
        x: 3, 
        y: 2.5, 
        fontSize: 24,
        bold: true,
        color: "#0000FF"
    });
    
    slide.addText("Bottom Right (7in, 4.5in)", { 
        x: 7, 
        y: 4.5, 
        fontSize: 18,
        color: "#00AA00"
    });
    
    await pres.writeFile({ fileName: "example-positioning.pdf" });
    console.log("✓ Generated example-positioning.pdf");
}

// Example 3: Text styling
async function exampleTextStyling() {
    console.log("\nExample 3: Demonstrating text styling...");
    
    const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
    const slide = pres.addSlide();
    
    slide.addText("Bold Text", { 
        x: 1, 
        y: 0.5, 
        fontSize: 28,
        bold: true
    });
    
    slide.addText("Italic Text", { 
        x: 1, 
        y: 1.2, 
        fontSize: 28,
        italic: true
    });
    
    slide.addText("Underlined Text", { 
        x: 1, 
        y: 1.9, 
        fontSize: 28,
        underline: true
    });
    
    slide.addText("Colored and Background", { 
        x: 1, 
        y: 2.6,
        w: 5,
        h: 0.6,
        fontSize: 28,
        color: "#FFFFFF",
        fill: { color: "#336699" },
        bold: true
    });
    
    slide.addText("Left Aligned", { 
        x: 1, 
        y: 3.5,
        w: 8,
        fontSize: 20,
        align: "left"
    });
    
    slide.addText("Center Aligned", { 
        x: 1, 
        y: 4,
        w: 8,
        fontSize: 20,
        align: "center"
    });
    
    slide.addText("Right Aligned", { 
        x: 1, 
        y: 4.5,
        w: 8,
        fontSize: 20,
        align: "right"
    });
    
    await pres.writeFile({ fileName: "example-text-styling.pdf" });
    console.log("✓ Generated example-text-styling.pdf");
}

// Example 4: Tables
async function exampleTables() {
    console.log("\nExample 4: Creating tables...");
    
    const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
    const slide = pres.addSlide();
    
    slide.addText("Sales Report Q4 2025", { 
        x: 1, 
        y: 0.5, 
        fontSize: 32,
        bold: true,
        color: "#003366"
    });
    
    slide.addTable([
        [
            { text: "Month", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
            { text: "Revenue", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
            { text: "Expenses", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }},
            { text: "Profit", options: { bold: true, fill: "#4472C4", color: "#FFFFFF" }}
        ],
        [
            { text: "October" },
            { text: "$125,000", options: { align: "right" }},
            { text: "$75,000", options: { align: "right" }},
            { text: "$50,000", options: { align: "right", color: "#00AA00", bold: true }}
        ],
        [
            { text: "November" },
            { text: "$135,000", options: { align: "right" }},
            { text: "$80,000", options: { align: "right" }},
            { text: "$55,000", options: { align: "right", color: "#00AA00", bold: true }}
        ],
        [
            { text: "December" },
            { text: "$150,000", options: { align: "right" }},
            { text: "$85,000", options: { align: "right" }},
            { text: "$65,000", options: { align: "right", color: "#00AA00", bold: true }}
        ],
        [
            { text: "Total", options: { bold: true, fill: "#D9E2F3" }},
            { text: "$410,000", options: { bold: true, align: "right", fill: "#D9E2F3" }},
            { text: "$240,000", options: { bold: true, align: "right", fill: "#D9E2F3" }},
            { text: "$170,000", options: { bold: true, align: "right", fill: "#D9E2F3", color: "#00AA00" }}
        ]
    ], {
        x: 1,
        y: 1.5,
        w: 8,
        h: 3
    });
    
    await pres.writeFile({ fileName: "example-tables.pdf" });
    console.log("✓ Generated example-tables.pdf");
}

// Example 5: Multiple slides
async function exampleMultipleSlides() {
    console.log("\nExample 5: Creating multi-slide presentation...");
    
    const pres = new PuppeteerGen(PAGE_SIZES.SCREEN_16X9.landscape);
    
    // Slide 1: Title
    const slide1 = pres.addSlide();
    slide1.addText("My Presentation", { 
        x: 1, 
        y: 2, 
        w: 8,
        fontSize: 48,
        bold: true,
        align: "center",
        color: "#003366"
    });
    slide1.addText("By PuppeteerGen", { 
        x: 1, 
        y: 3, 
        w: 8,
        fontSize: 24,
        align: "center",
        color: "#666666"
    });
    
    // Slide 2: Agenda
    const slide2 = pres.addSlide();
    slide2.addText("Agenda", { 
        x: 1, 
        y: 0.5, 
        fontSize: 36,
        bold: true,
        color: "#003366"
    });
    slide2.addText("• Introduction\n• Key Features\n• Use Cases\n• Conclusion", { 
        x: 1.5, 
        y: 1.5,
        w: 7,
        h: 3,
        fontSize: 24
    });
    
    // Slide 3: Key Features
    const slide3 = pres.addSlide();
    slide3.addText("Key Features", { 
        x: 1, 
        y: 0.5, 
        fontSize: 36,
        bold: true,
        color: "#003366"
    });
    slide3.addText("✓ Multiple page sizes\n✓ Inch-based positioning\n✓ Rich text formatting\n✓ Tables and shapes\n✓ PDF output", { 
        x: 1.5, 
        y: 1.5,
        w: 7,
        h: 3,
        fontSize: 22
    });
    
    // Slide 4: Thank You
    const slide4 = pres.addSlide();
    slide4.addText("Thank You!", { 
        x: 1, 
        y: 2.5, 
        w: 8,
        fontSize: 48,
        bold: true,
        align: "center",
        color: "#003366"
    });
    
    await pres.writeFile({ fileName: "example-multiple-slides.pdf" });
    console.log("✓ Generated example-multiple-slides.pdf with 4 slides");
}

// Example 6: Custom layout
async function exampleCustomLayout() {
    console.log("\nExample 6: Using custom layout...");
    
    const pres = new PuppeteerGen();
    
    // Define custom layout
    pres.defineLayout({
        name: "Custom Wide",
        width: 12,
        height: 6
    });
    
    const slide = pres.addSlide();
    slide.addText("Custom Wide Layout (12\" × 6\")", { 
        x: 2, 
        y: 2, 
        fontSize: 36,
        bold: true,
        color: "#660066"
    });
    
    await pres.writeFile({ fileName: "example-custom-layout.pdf" });
    console.log("✓ Generated example-custom-layout.pdf");
}

// Run all examples
async function runAllExamples() {
    console.log("=".repeat(60));
    console.log("PuppeteerGen Comprehensive Examples");
    console.log("=".repeat(60));
    
    await examplePageSizes();
    await examplePositioning();
    await exampleTextStyling();
    await exampleTables();
    await exampleMultipleSlides();
    await exampleCustomLayout();
    
    console.log("\n" + "=".repeat(60));
    console.log("All examples completed successfully!");
    console.log("=".repeat(60));
}

// Run if this file is executed directly
if (import.meta.main) {
    runAllExamples().catch(console.error);
}

export {
    examplePageSizes,
    examplePositioning,
    exampleTextStyling,
    exampleTables,
    exampleMultipleSlides,
    exampleCustomLayout
};

