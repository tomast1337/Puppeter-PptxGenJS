// Shapes and lines: preset shapes, fills with transparency, outlines, a shadow, arrowheads and text in a shape.
// Run: bun run examples/shapes.ts (writes shapes.pdf to the working directory).
import pptxgen from "@pdflapas/pptxgenjs";

const pres = new pptxgen();
const slide = pres.addSlide();
const outline = { color: "333333", width: 1.5 };

// Preset shapes take `pres.ShapeType.*` or the same string names ("rect", "ellipse", ...).
slide.addShape(pres.ShapeType.rect, { x: 0.5, y: 0.5, w: 2, h: 1.2, fill: { color: "CCCCCC" }, line: outline });
slide.addShape(pres.ShapeType.roundRect, { x: 2.9, y: 0.5, w: 2, h: 1.2, fill: { color: "999999" }, rectRadius: 0.3 });
slide.addShape(pres.ShapeType.ellipse, { x: 5.3, y: 0.5, w: 2, h: 1.2, fill: { color: "666666", transparency: 50 } });
slide.addShape(pres.ShapeType.triangle, { x: 7.7, y: 0.5, w: 1.8, h: 1.2, fill: { color: "AAAAAA" }, rotate: 15 });

// An outer shadow. An inner shadow on a shape throws UnsupportedFeatureError (see docs/MIGRATION.md).
const shadow = { type: "outer", color: "000000", opacity: 0.4, blur: 6, offset: 4, angle: 45 } as const;

slide.addShape("rect", { x: 0.5, y: 2.2, w: 2.5, h: 1.2, fill: { color: "FFFFFF" }, line: outline, shadow });

// Text inside a shape: addText with `shape`.
slide.addText("Text in a shape", { shape: pres.ShapeType.cloud, x: 3.5, y: 2, w: 3, h: 1.6, fill: { color: "DDDDDD" }, align: "center", fontSize: 16, color: "333333" });

// Lines: the `line` option sets width, dash type and arrowheads.
slide.addShape(pres.ShapeType.line, { x: 0.5, y: 4.2, w: 4, h: 0, line: { color: "333333", width: 2, endArrowType: "triangle" } });
slide.addShape(pres.ShapeType.line, { x: 0.5, y: 4.8, w: 4, h: 0, line: { color: "333333", width: 2, dashType: "dash", beginArrowType: "oval", endArrowType: "arrow" } });
slide.addShape(pres.ShapeType.line, { x: 5.5, y: 4, w: 3.5, h: 1, line: { color: "666666", width: 3 }, flipV: true });

console.log(`Wrote ${await pres.writeFile({ fileName: "shapes.pdf" })}`);
