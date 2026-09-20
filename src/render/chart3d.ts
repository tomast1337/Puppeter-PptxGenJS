import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedChart } from "../model/types";
import { pointsToPixels } from "../utils";

interface Point {
    x: number;
    y: number;
}
interface Bar {
    category: number;
    series: number;
    base: number;
    value: number;
}

const n = (value: number): string => Number(value.toFixed(2)).toString();
const p = (point: Point): string => `${n(point.x)},${n(point.y)}`;
const escapeXml = (value: string): string =>
    value.replace(
        /[&<>"']/g,
        character =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&apos;",
            })[character]!,
    );

function shade(hex: string, amount: number): string {
    const value = hex.replace(/^#/, "");
    const channels = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
    const adjusted = channels.map(channel => (amount >= 0 ? Math.round(channel + (255 - channel) * amount) : Math.round(channel * (1 + amount))));
    return `#${adjusted.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function tickLabel(value: number): string {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** Deterministic, browser-independent 3D bar projection used instead of WebGL. */
export function renderBar3DSvg(width: number, height: number, chart: NormalizedChart): string {
    const titleSpace = chart.showTitle ? height * 0.1 : 0;
    const origin: Point = { x: width * 0.13, y: height * 0.51 };
    const perspectiveScale = chart.rightAngleAxes3D ? 0.82 : 0.7 + chart.perspective3D / 100;
    const rotationFactor = Math.cos(((chart.rotationY3D - 30) * Math.PI) / 180);
    const tilt = Math.max(-1, Math.min(1, chart.rotationX3D / 90));
    const xAxis: Point = { x: width * 0.59, y: height * (0.31 + tilt * 0.21) };
    const depthAxis: Point = {
        x: width * 0.15 * perspectiveScale * rotationFactor,
        y: -height * 0.24 * perspectiveScale,
    };
    const valueAxis: Point = { x: 0, y: -height * (0.25 - (titleSpace / height) * 0.08) };
    const minimum = chart.grouping === "percentStacked" ? 0 : chart.valueAxisMinimum;
    const maximum = chart.grouping === "percentStacked" ? 100 : chart.valueAxisMaximum;
    const range = Math.max(1e-9, maximum - minimum);
    const project = (x: number, depth: number, value: number): Point => {
        const normalizedValue = (value - minimum) / range;
        return {
            x: origin.x + x * xAxis.x + depth * depthAxis.x + normalizedValue * valueAxis.x,
            y: origin.y + x * xAxis.y + depth * depthAxis.y + normalizedValue * valueAxis.y,
        };
    };
    const polygon = (className: string, points: Point[], fill: string): string =>
        `<polygon class="${className}" points="${points.map(p).join(" ")}" fill="${fill}"/>`;
    const labels = chart.series[0]?.labels ?? [];
    const categoryCount = Math.max(1, labels.length, ...chart.series.map(series => series.values.length));
    const seriesCount = Math.max(1, chart.series.length);
    const tickCount = 4;
    const grid = Array.from({ length: tickCount + 1 }, (_, index) => {
        const value = minimum + (range * index) / tickCount;
        const left = project(0, 1, value);
        const right = project(1, 1, value);
        const label = project(0, 0, value);
        return (
            `<line x1="${n(left.x)}" y1="${n(left.y)}" x2="${n(right.x)}" y2="${n(right.y)}" stroke="#${chart.gridLineColor.replace(/^#/, "")}" stroke-width="${n(pointsToPixels(chart.gridLineWidth))}"/>` +
            `<text x="${n(label.x - 8)}" y="${n(label.y + 4)}" text-anchor="end">${escapeXml(tickLabel(value))}</text>`
        );
    }).join("");
    const backBottomLeft = project(0, 1, minimum);
    const backBottomRight = project(1, 1, minimum);
    const backTopRight = project(1, 1, maximum);
    const backTopLeft = project(0, 1, maximum);
    const frontBottomLeft = project(0, 0, minimum);
    const frontBottomRight = project(1, 0, minimum);
    const floor = polygon(
        "bar3d-floor",
        [frontBottomLeft, frontBottomRight, backBottomRight, backBottomLeft],
        `#${PPTX_DEFAULTS.chart.bar3DLighting.floorColor}`,
    );
    const wall = polygon("bar3d-wall", [backBottomLeft, backBottomRight, backTopRight, backTopLeft], `#${PPTX_DEFAULTS.chart.bar3DLighting.wallColor}`);
    const frame = `<polyline class="bar3d-frame" points="${[frontBottomLeft, frontBottomRight, backBottomRight, backTopRight, backTopLeft, backBottomLeft, frontBottomLeft].map(p).join(" ")}" fill="none" stroke="#${chart.gridLineColor.replace(/^#/, "")}" stroke-width="${n(pointsToPixels(chart.gridLineWidth))}"/>`;
    const gradients = `<defs>${chart.colors.map((color, index) => `<linearGradient id="bar3d-front-${index}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.13)}"/><stop offset="1" stop-color="${shade(color, -0.08)}"/></linearGradient>`).join("")}</defs>`;

    const bars: Bar[] = [];
    if (chart.grouping === "stacked" || chart.grouping === "percentStacked") {
        for (let category = 0; category < categoryCount; category++) {
            let positive = 0;
            let negative = 0;
            const total = chart.series.reduce((sum, series) => sum + Math.abs(series.values[category] ?? 0), 0);
            chart.series.forEach((series, seriesIndex) => {
                let value = series.values[category] ?? 0;
                if (chart.grouping === "percentStacked") value = total === 0 ? 0 : (value / total) * 100;
                const base = value >= 0 ? positive : negative;
                bars.push({ category, series: seriesIndex, base, value: base + value });
                if (value >= 0) positive += value;
                else negative += value;
            });
        }
    } else {
        for (let series = seriesCount - 1; series >= 0; series--) {
            for (let category = 0; category < categoryCount; category++) {
                bars.push({ category, series, base: 0, value: chart.series[series]?.values[category] ?? 0 });
            }
        }
    }

    const gapFactor = 1 / (1 + chart.barGapWidthPercent / 100);
    const halfWidth = Math.max(0.025, 0.6 * gapFactor) / categoryCount;
    const depthThickness = Math.max(0.06, 0.45 / (1 + chart.barGapDepthPercent / 100));
    const barSvg = bars
        .map(bar => {
            const cx = (bar.category + 0.5) / categoryCount;
            const stacked = chart.grouping === "stacked" || chart.grouping === "percentStacked";
            const cz = stacked ? 0.55 : 0.28 + (seriesCount === 1 ? 0.28 : (bar.series * 0.56) / (seriesCount - 1));
            const x0 = cx - halfWidth;
            const x1 = cx + halfWidth;
            const z0 = Math.max(0, cz - depthThickness / 2);
            const z1 = Math.min(1, cz + depthThickness / 2);
            const base = Math.max(minimum, Math.min(maximum, bar.base));
            const value = Math.max(minimum, Math.min(maximum, bar.value));
            const low = Math.min(base, value);
            const high = Math.max(base, value);
            const color = chart.colors[bar.series % chart.colors.length] ?? "#4472C4";
            const frontColor = `url(#bar3d-front-${bar.series % chart.colors.length})`;
            const topColor = shade(color, PPTX_DEFAULTS.chart.bar3DLighting.topLighten);
            const sideColor = shade(color, -PPTX_DEFAULTS.chart.bar3DLighting.sideDarken);
            const opacity = n(chart.colorOpacity);
            const bfl = project(x0, z0, low);
            const bfr = project(x1, z0, low);
            const bbr = project(x1, z1, low);
            const bbl = project(x0, z1, low);
            const tfl = project(x0, z0, high);
            const tfr = project(x1, z0, high);
            const tbr = project(x1, z1, high);
            const tbl = project(x0, z1, high);
            const shapeClass = `bar3d-mark bar3d-${chart.bar3DShape}`;
            if (chart.bar3DShape === "pyramid" || chart.bar3DShape === "pyramidToMax") {
                const apex = project(cx, (z0 + z1) / 2, high);
                return (
                    `<g class="${shapeClass}" data-series="${bar.series}" data-category="${bar.category}" opacity="${opacity}">` +
                    polygon("bar3d-front", [bfl, bfr, apex], frontColor) +
                    polygon("bar3d-side", [bfr, bbr, apex], sideColor) +
                    polygon("bar3d-back", [bbr, bbl, apex], topColor) +
                    `</g>`
                );
            }
            if (chart.bar3DShape === "cone" || chart.bar3DShape === "coneToMax") {
                const bottom = project(cx, (z0 + z1) / 2, low);
                const apex = project(cx, (z0 + z1) / 2, high);
                const radiusX = Math.max(3, Math.hypot(bfr.x - bfl.x, bfr.y - bfl.y) / 2);
                const radiusY = Math.max(2, Math.abs(bbr.y - bfr.y) / 2);
                return (
                    `<g class="${shapeClass}" data-series="${bar.series}" data-category="${bar.category}" opacity="${opacity}">` +
                    `<path class="bar3d-front" d="M ${n(bottom.x - radiusX)} ${n(bottom.y)} Q ${n(bottom.x)} ${n(bottom.y + radiusY)} ${n(bottom.x + radiusX)} ${n(bottom.y)} L ${n(apex.x)} ${n(apex.y)} Z" fill="${frontColor}"/>` +
                    `<ellipse class="bar3d-base" cx="${n(bottom.x)}" cy="${n(bottom.y)}" rx="${n(radiusX)}" ry="${n(radiusY)}" fill="${sideColor}"/>` +
                    `</g>`
                );
            }
            if (chart.bar3DShape === "cylinder") {
                const bottom = project(cx, (z0 + z1) / 2, low);
                const top = project(cx, (z0 + z1) / 2, high);
                const radiusX = Math.max(3, Math.hypot(bfr.x - bfl.x, bfr.y - bfl.y) / 2);
                const radiusY = Math.max(2, Math.abs(bbr.y - bfr.y) / 2);
                return (
                    `<g class="${shapeClass}" data-series="${bar.series}" data-category="${bar.category}" opacity="${opacity}">` +
                    `<path class="bar3d-front" d="M ${n(top.x - radiusX)} ${n(top.y)} L ${n(bottom.x - radiusX)} ${n(bottom.y)} A ${n(radiusX)} ${n(radiusY)} 0 0 0 ${n(bottom.x + radiusX)} ${n(bottom.y)} L ${n(top.x + radiusX)} ${n(top.y)} Z" fill="${frontColor}"/>` +
                    `<ellipse class="bar3d-top" cx="${n(top.x)}" cy="${n(top.y)}" rx="${n(radiusX)}" ry="${n(radiusY)}" fill="${topColor}"/>` +
                    `</g>`
                );
            }
            return (
                `<g class="${shapeClass}" data-series="${bar.series}" data-category="${bar.category}" opacity="${opacity}">` +
                polygon("bar3d-front", [bfl, bfr, tfr, tfl], frontColor) +
                polygon("bar3d-side", [bfr, bbr, tbr, tfr], sideColor) +
                polygon("bar3d-top", [tfl, tfr, tbr, tbl], topColor) +
                `</g>`
            );
        })
        .join("");

    const categoryLabels = Array.from({ length: categoryCount }, (_, index) => {
        const point = project((index + 0.5) / categoryCount, 0, minimum);
        const label = labels[index] ?? String(index + 1);
        return `<text x="${n(point.x + 5)}" y="${n(point.y + 20)}" text-anchor="middle">${escapeXml(label)}</text>`;
    }).join("");
    const seriesLabels = chart.series
        .map((series, index) => {
            const depth = 0.28 + (seriesCount === 1 ? 0.28 : (index * 0.56) / (seriesCount - 1));
            const point = project(1, depth, minimum);
            return `<text class="bar3d-series-label" x="${n(point.x + 12)}" y="${n(point.y + 5)}">${escapeXml(series.name)}</text>`;
        })
        .join("");
    const legend = chart.showLegend
        ? chart.series
              .map((series, index) => {
                  const itemWidth = Math.min(100, width / Math.max(2, chart.series.length + 1));
                  const x = width / 2 + (index - (chart.series.length - 1) / 2) * itemWidth;
                  const y = height - 12;
                  const color = chart.colors[index % chart.colors.length] ?? "#4472C4";
                  return (
                      `<rect x="${n(x - 34)}" y="${n(y - 8)}" width="12" height="8" fill="${color}"/>` +
                      `<text class="bar3d-legend" x="${n(x - 17)}" y="${n(y)}">${escapeXml(series.name)}</text>`
                  );
              })
              .join("")
        : "";
    const title = chart.showTitle
        ? `<text class="bar3d-title" x="${n(width / 2)}" y="${n(pointsToPixels(chart.titleFontSize) + 4)}" text-anchor="middle" font-family="${escapeXml(chart.titleFontFace)}" font-size="${n(pointsToPixels(chart.titleFontSize))}" font-weight="${chart.titleBold ? "bold" : "normal"}" fill="${chart.titleColor}">${escapeXml(chart.title)}</text>`
        : "";

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" data-chart-type="bar3D" data-bar3d-shape="${chart.bar3DShape}">` +
        `<g font-family="${escapeXml(chart.fontFace)}" font-size="${n(pointsToPixels(chart.fontSize))}" fill="#000000">` +
        gradients +
        title +
        wall +
        floor +
        frame +
        grid +
        barSvg +
        categoryLabels +
        seriesLabels +
        legend +
        `</g></svg>`
    );
}
