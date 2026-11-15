import { PPTX_DEFAULTS } from "../defaults";
import type { NormalizedChart } from "@pdflapas/model";
import { pointsToPixels } from "../units";

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

interface CameraPoint extends Point {
    /** Distance along the view direction from the box center; larger is farther. */
    distance: number;
}

const DEGREE = Math.PI / 180;

/**
 * The OOXML view3D camera on a box `depth` and `height` deep and tall per unit of category-axis width: rotY turns
 * it about the vertical axis, rotX tilts it toward the viewer, and the perspective is the field of view in half
 * degrees (ECMA-376 21.2.2.135), which the camera distance turns into for the whole box. Right-angle axes use a
 * parallel projection, as the spec ignores the perspective there.
 * shortcut: Office also keeps the category axis horizontal with right-angle axes; fix when a fixture sets v3DRAngAx.
 */
function view3D(chart: NormalizedChart, depth: number, height: number): (x: number, y: number, z: number) => CameraPoint {
    const yaw = chart.rotationY3D * DEGREE;
    const pitch = chart.rotationX3D * DEGREE;
    const fieldOfView = (chart.perspective3D / 2) * DEGREE;
    const distance = chart.rightAngleAxes3D || fieldOfView === 0 ? Infinity : Math.hypot(1, depth, height) / (2 * Math.tan(fieldOfView / 2));
    return (x, y, z) => {
        const cx = x - 0.5;
        const cy = (y - 0.5) * height;
        const cz = (z - 0.5) * depth;
        const turned = -cx * Math.sin(yaw) + cz * Math.cos(yaw);
        const up = cy * Math.cos(pitch) + turned * Math.sin(pitch);
        const along = -cy * Math.sin(pitch) + turned * Math.cos(pitch);
        const scale = distance === Infinity ? 1 : distance / (distance + along);
        return { x: (cx * Math.cos(yaw) + cz * Math.sin(yaw)) * scale, y: -up * scale, distance: along };
    };
}

const BOX_CORNERS: readonly (readonly [number, number, number])[] = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => [x, y, z] as const)));

/** Screen bounds of the unit box under a camera. */
function boxBounds(camera: (x: number, y: number, z: number) => CameraPoint) {
    const points = BOX_CORNERS.map(([x, y, z]) => camera(x, y, z));
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Fits the box into `area`. The depth is fixed (one series slot per category slot); the height is automatic, as in
 * LibreOffice (chart2 BarChart::getPreferredDiagramAspectRatio leaves Y free), so it is chosen to fill the area.
 */
function fitView3D(chart: NormalizedChart, depth: number, area: { x: number; y: number; width: number; height: number }) {
    const aspect = area.width / Math.max(1e-9, area.height);
    // The box's screen aspect falls as it grows taller: bisect the height on a log scale.
    let low = Math.log(0.02);
    let high = Math.log(50);
    for (let step = 0; step < 40; step++) {
        const middle = (low + high) / 2;
        const bounds = boxBounds(view3D(chart, depth, Math.exp(middle)));
        if (bounds.width / Math.max(1e-9, bounds.height) > aspect) low = middle;
        else high = middle;
    }
    const camera = view3D(chart, depth, Math.exp((low + high) / 2));
    const bounds = boxBounds(camera);
    const scale = Math.min(area.width / bounds.width, area.height / bounds.height);
    const left = area.x + (area.width - bounds.width * scale) / 2 - bounds.left * scale;
    const top = area.y + (area.height - bounds.height * scale) / 2 - bounds.top * scale;
    return (x: number, y: number, z: number): CameraPoint => {
        const point = camera(x, y, z);
        return { x: left + point.x * scale, y: top + point.y * scale, distance: point.distance };
    };
}

/** Deterministic, browser-independent 3D bar projection used instead of WebGL. */
export function renderBar3DSvg(width: number, height: number, chart: NormalizedChart): string {
    const labels = chart.series[0]?.labels ?? [];
    const categoryCount = Math.max(1, labels.length, ...chart.series.map(series => series.values.length));
    const seriesCount = Math.max(1, chart.series.length);
    const stacked = chart.grouping === "stacked" || chart.grouping === "percentStacked";
    // The same text bands as the 2D plot area (chart.ts chartGrid): the legend and the category labels below the box.
    const gap = height * PPTX_DEFAULTS.chart.plotAreaGapRatio;
    const lineEm = PPTX_DEFAULTS.text.singleLineEm;
    const top = gap + (chart.showTitle ? pointsToPixels(chart.titleFontSize) * lineEm + gap : 0);
    const bottom = gap + (chart.showLegend ? pointsToPixels(chart.legendFontSize) * lineEm + gap : 0) + pointsToPixels(chart.fontSize) * lineEm;
    const side = width * PPTX_DEFAULTS.chart.bar3DSideMarginRatio;
    const camera = fitView3D(chart, (stacked ? 1 : seriesCount) / categoryCount, { x: side, y: top, width: width - 2 * side, height: height - top - bottom });
    const minimum = chart.grouping === "percentStacked" ? 0 : chart.valueAxisMinimum;
    const maximum = chart.grouping === "percentStacked" ? 100 : chart.valueAxisMaximum;
    const range = Math.max(1e-9, maximum - minimum);
    /** `x` and `depth` run 0..1 along the category axis and the depth axis. */
    const project = (x: number, depth: number, value: number): CameraPoint => camera(x, (value - minimum) / range, depth);
    // The walls stand on the far sides of the floor, the faces drawn on a bar on the near ones.
    const backDepth = Math.cos(chart.rotationY3D * DEGREE) >= 0 ? 1 : 0;
    const frontDepth = 1 - backDepth;
    const sideX = Math.sin(chart.rotationY3D * DEGREE) >= 0 ? 0 : 1;
    const polygon = (className: string, points: Point[], fill: string): string => `<polygon class="${className}" points="${points.map(p).join(" ")}" fill="${fill}"/>`;
    const tickCount = 4;
    const otherX = 1 - sideX;
    const gridStroke = `stroke="#${chart.gridLineColor.replace(/^#/, "")}" stroke-width="${n(pointsToPixels(chart.gridLineWidth))}"`;
    // Office draws the value gridlines across the side wall and the back wall, labelled at the wall's front edge.
    const grid = Array.from({ length: tickCount + 1 }, (_, index) => {
        const value = minimum + (range * index) / tickCount;
        const label = project(sideX, frontDepth, value);
        const line = [label, project(sideX, backDepth, value), project(otherX, backDepth, value)];
        const labelX = sideX === 0 ? `x="${n(label.x - 8)}" text-anchor="end"` : `x="${n(label.x + 8)}"`;
        return `<polyline points="${line.map(p).join(" ")}" fill="none" ${gridStroke}/>` + `<text ${labelX} y="${n(label.y + 4)}">${escapeXml(tickLabel(value))}</text>`;
    }).join("");
    const backSideBottom = project(sideX, backDepth, minimum);
    const backSideTop = project(sideX, backDepth, maximum);
    const backOtherBottom = project(otherX, backDepth, minimum);
    const backOtherTop = project(otherX, backDepth, maximum);
    const frontSideBottom = project(sideX, frontDepth, minimum);
    const frontSideTop = project(sideX, frontDepth, maximum);
    const frontOtherBottom = project(otherX, frontDepth, minimum);
    const floor = polygon("bar3d-floor", [frontSideBottom, frontOtherBottom, backOtherBottom, backSideBottom], `#${PPTX_DEFAULTS.chart.bar3DLighting.floorColor}`);
    const wall = polygon("bar3d-wall", [backSideBottom, backOtherBottom, backOtherTop, backSideTop], `#${PPTX_DEFAULTS.chart.bar3DLighting.wallColor}`) + polygon("bar3d-wall", [frontSideBottom, backSideBottom, backSideTop, frontSideTop], `#${PPTX_DEFAULTS.chart.bar3DLighting.wallColor}`);
    const frame =
        `<polyline class="bar3d-frame" points="${[frontSideTop, frontSideBottom, frontOtherBottom, backOtherBottom, backOtherTop, backSideTop, frontSideTop].map(p).join(" ")}" fill="none" ${gridStroke}/>` +
        `<polyline class="bar3d-frame" points="${[backSideBottom, backSideTop].map(p).join(" ")}" fill="none" ${gridStroke}/>`;
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

    // gapWidth and gapDepth are percentages of the bar's width and depth (c:gapWidth, c:gapDepth); each category
    // has one slot along the category axis and, unless stacked, each series one slot along the depth axis.
    const halfWidth = 0.5 / (1 + chart.barGapWidthPercent / 100) / categoryCount;
    const depthSlot = stacked ? 1 : 1 / seriesCount;
    const depthThickness = depthSlot / (1 + chart.barGapDepthPercent / 100);
    const slotDepth = (series: number): number => (stacked ? 0.5 : (series + 0.5) * depthSlot);
    const barCenter = (bar: Bar): CameraPoint => project((bar.category + 0.5) / categoryCount, slotDepth(bar.series), (bar.base + bar.value) / 2);
    // Painter's order: the bar farthest from the camera first.
    const barSvg = bars
        .map(bar => ({ bar, distance: barCenter(bar).distance }))
        .sort((a, b) => b.distance - a.distance)
        .map(({ bar }) => {
            const cx = (bar.category + 0.5) / categoryCount;
            const cz = slotDepth(bar.series);
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
            const nearZ = backDepth === 1 ? z0 : z1;
            const nearX = sideX === 0 ? x1 : x0;
            const cap = chart.rotationX3D >= 0 ? high : low;
            const front = [project(x0, nearZ, low), project(x1, nearZ, low), project(x1, nearZ, high), project(x0, nearZ, high)];
            const side = [project(nearX, z0, low), project(nearX, z1, low), project(nearX, z1, high), project(nearX, z0, high)];
            const shapeClass = `bar3d-mark bar3d-${chart.bar3DShape}`;
            if (chart.bar3DShape === "pyramid" || chart.bar3DShape === "pyramidToMax") {
                const apex = project(cx, (z0 + z1) / 2, high);
                return `<g class="${shapeClass}" data-series="${bar.series}" data-category="${bar.category}" opacity="${opacity}">` + polygon("bar3d-front", [bfl, bfr, apex], frontColor) + polygon("bar3d-side", [bfr, bbr, apex], sideColor) + polygon("bar3d-back", [bbr, bbl, apex], topColor) + `</g>`;
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
                polygon("bar3d-front", front, frontColor) +
                polygon("bar3d-side", side, sideColor) +
                polygon("bar3d-top", [project(x0, z0, cap), project(x1, z0, cap), project(x1, z1, cap), project(x0, z1, cap)], topColor) +
                `</g>`
            );
        })
        .join("");

    const categoryLabels = Array.from({ length: categoryCount }, (_, index) => {
        const point = project((index + 0.5) / categoryCount, frontDepth, minimum);
        const label = labels[index] ?? String(index + 1);
        return `<text x="${n(point.x)}" y="${n(point.y + 20)}" text-anchor="middle">${escapeXml(label)}</text>`;
    }).join("");
    const seriesLabels = chart.series
        .map((series, index) => {
            const point = project(otherX, slotDepth(index), minimum);
            return `<text class="bar3d-series-label" x="${n(point.x + 7)}" y="${n(point.y + 12)}">${escapeXml(series.name)}</text>`;
        })
        .join("");
    // The legend has its own font (legendFontFace/legendFontSize/legendColor), not the axis-label font of the <g>.
    const legendFont = ` font-family="${escapeXml(chart.legendFontFace)}" font-size="${n(pointsToPixels(chart.legendFontSize))}" fill="${chart.legendColor}"`;
    const keySize = Math.round(pointsToPixels(chart.legendFontSize) * PPTX_DEFAULTS.chart.legendKeyFontRatio);
    const legend = chart.showLegend
        ? chart.series
              .map((series, index) => {
                  const itemWidth = Math.min(100, width / Math.max(2, chart.series.length + 1));
                  const x = width / 2 + (index - (chart.series.length - 1) / 2) * itemWidth;
                  const y = height - 12;
                  const color = chart.colors[index % chart.colors.length] ?? "#4472C4";
                  return `<rect x="${n(x - 22 - keySize)}" y="${n(y - keySize)}" width="${n(keySize)}" height="${n(keySize)}" fill="${color}"/>` + `<text class="bar3d-legend" x="${n(x - 17)}" y="${n(y)}"${legendFont}>${escapeXml(series.name)}</text>`;
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
