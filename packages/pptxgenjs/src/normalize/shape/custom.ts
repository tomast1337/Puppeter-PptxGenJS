import type PptxGenJS from "pptxgenjs";
import type { PageSize } from "#src/pageLayouts";
import { inchesToPixels } from "@pdflapas/model";
import { convertToPixels } from "#src/units";
import { arcPathCommand, cleanNumber } from "./path";

function coordinate(value: PptxGenJS.Coord, axis: "x" | "y", pageSize: PageSize): number {
    return convertToPixels(value, inchesToPixels(axis === "x" ? pageSize.width : pageSize.height));
}

export function normalizeCustomPath(points: PptxGenJS.ShapeProps["points"], pageSize: PageSize): string {
    if (!points?.length) {
        throw new Error("Custom geometry requires at least one point");
    }

    const commands: string[] = [];
    let current = { x: 0, y: 0 };

    for (const [index, point] of points.entries()) {
        if ("close" in point) {
            commands.push("Z");

            continue;
        }

        if ("curve" in point) {
            const x = coordinate(point.x, "x", pageSize);
            const y = coordinate(point.y, "y", pageSize);

            if (point.curve.type === "cubic") {
                commands.push(`C ${coordinate(point.curve.x1, "x", pageSize)} ${coordinate(point.curve.y1, "y", pageSize)} ${coordinate(point.curve.x2, "x", pageSize)} ${coordinate(point.curve.y2, "y", pageSize)} ${x} ${y}`);
                current = { x, y };
            } else if (point.curve.type === "quadratic") {
                commands.push(`Q ${coordinate(point.curve.x1, "x", pageSize)} ${coordinate(point.curve.y1, "y", pageSize)} ${x} ${y}`);
                current = { x, y };
            } else {
                const rx = coordinate(point.curve.wR, "x", pageSize);
                const ry = coordinate(point.curve.hR, "y", pageSize);
                const arc = arcPathCommand([current.x, current.y], rx, ry, point.curve.stAng, point.curve.swAng);

                commands.push(arc.command);
                current = { x: cleanNumber(arc.end[0]), y: cleanNumber(arc.end[1]) };
            }

            continue;
        }

        current = { x: coordinate(point.x, "x", pageSize), y: coordinate(point.y, "y", pageSize) };
        commands.push(`${point.moveTo || index === 0 ? "M" : "L"} ${current.x} ${current.y}`);
    }

    return commands.join(" ");
}
