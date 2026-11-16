import type { PixelPoint } from "./path";

export function rightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const y1 = height / 2 - short / 4;
    const y2 = height / 2 - short / 8;
    const y3 = height / 2 + short / 8;
    const y4 = height / 2 + short / 4;
    const x2 = width * 0.64977;
    const x3 = width - short / 4;
    return [
        [0, 0],
        [x2, 0],
        [x2, y2],
        [x3, y2],
        [x3, y1],
        [width, height / 2],
        [x3, y4],
        [x3, y3],
        [x2, y3],
        [x2, height],
        [0, height],
    ];
}

export function rotateRightCallout(width: number, height: number, direction: "left" | "up" | "down"): PixelPoint[] {
    if (direction === "left") return rightCalloutPoints(width, height).map(([x, y]) => [width - x, y]);
    const source = rightCalloutPoints(height, width);
    return source.map(([x, y]) => (direction === "up" ? [y, height - x] : [width - y, x]));
}

export function leftRightCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short / 4;
    const y1 = height / 2 - head;
    const y2 = height / 2 - head / 2;
    const y3 = height / 2 + head / 2;
    const y4 = height / 2 + head;
    const bodyHalf = (width * 0.48123) / 2;
    const x2 = width / 2 - bodyHalf;
    const x3 = width / 2 + bodyHalf;
    return [
        [0, height / 2],
        [head, y1],
        [head, y2],
        [x2, y2],
        [x2, 0],
        [x3, 0],
        [x3, y2],
        [width - head, y2],
        [width - head, y1],
        [width, height / 2],
        [width - head, y4],
        [width - head, y3],
        [x3, y3],
        [x3, height],
        [x2, height],
        [x2, y3],
        [head, y3],
        [head, y4],
    ];
}

export function quadCalloutPoints(width: number, height: number): PixelPoint[] {
    const short = Math.min(width, height);
    const head = short * 0.18515;
    const headHalfWidth = short * 0.18515;
    const shaftHalfWidth = short * 0.092575;
    const bodyHalfWidth = (width * 0.48123) / 2;
    const bodyHalfHeight = (height * 0.48123) / 2;
    const x2 = width / 2 - bodyHalfWidth;
    const x7 = width / 2 + bodyHalfWidth;
    const x3 = width / 2 - headHalfWidth;
    const x6 = width / 2 + headHalfWidth;
    const x4 = width / 2 - shaftHalfWidth;
    const x5 = width / 2 + shaftHalfWidth;
    const y2 = height / 2 - bodyHalfHeight;
    const y7 = height / 2 + bodyHalfHeight;
    const y3 = height / 2 - headHalfWidth;
    const y6 = height / 2 + headHalfWidth;
    const y4 = height / 2 - shaftHalfWidth;
    const y5 = height / 2 + shaftHalfWidth;
    return [
        [0, height / 2],
        [head, y3],
        [head, y4],
        [x2, y4],
        [x2, y2],
        [x4, y2],
        [x4, head],
        [x3, head],
        [width / 2, 0],
        [x6, head],
        [x5, head],
        [x5, y2],
        [x7, y2],
        [x7, y4],
        [width - head, y4],
        [width - head, y3],
        [width, height / 2],
        [width - head, y6],
        [width - head, y5],
        [x7, y5],
        [x7, y7],
        [x5, y7],
        [x5, height - head],
        [x6, height - head],
        [width / 2, height],
        [x3, height - head],
        [x4, height - head],
        [x4, y7],
        [x2, y7],
        [x2, y5],
        [head, y5],
        [head, y6],
    ];
}
