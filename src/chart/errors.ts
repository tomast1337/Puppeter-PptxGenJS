export type UnsupportedChartReason = "chart-type" | "chart-combination" | "chart-option";

export interface UnsupportedChartDetails {
    reason: UnsupportedChartReason;
    chartTypes?: readonly string[];
    unsupportedOptions?: readonly string[];
}

export class UnsupportedChartError extends Error {
    readonly code = "UNSUPPORTED_CHART";
    readonly reason: UnsupportedChartReason;
    readonly chartTypes: readonly string[];
    readonly unsupportedOptions: readonly string[];

    constructor(details: UnsupportedChartDetails) {
        const chartTypes = [...(details.chartTypes ?? [])];
        const unsupportedOptions = [...(details.unsupportedOptions ?? [])];
        const subject = details.reason === "chart-option" ? `chart option(s): ${unsupportedOptions.join(", ")}` : `chart type(s): ${chartTypes.join(", ")}`;
        super(`Unsupported ${subject}`);
        this.name = "UnsupportedChartError";
        this.reason = details.reason;
        this.chartTypes = Object.freeze(chartTypes);
        this.unsupportedOptions = Object.freeze(unsupportedOptions);
    }
}
