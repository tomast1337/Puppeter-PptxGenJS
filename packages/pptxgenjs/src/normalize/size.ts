/**
 * A size option in points, checked where it enters: a finite number from 0 to `max` (PPTX_DEFAULTS.limits). A negative
 * or non-finite size reached the renderers as a negative stroke or font size (GHSA-fmx3-qwqc-h37c).
 */
export function checkedSize(value: unknown, name: string, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
        throw new RangeError(`${name} must be a number of points from 0 to ${max}, got ${typeof value === "number" ? value : JSON.stringify(value)}`);
    }
    return value;
}
