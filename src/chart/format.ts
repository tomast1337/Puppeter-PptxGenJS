/**
 * Format the common numeric subset accepted by Office chart axes. More complex
 * Excel format sections remain capability errors until their semantics are
 * implemented instead of being silently passed to Intl.NumberFormat.
 */
export function isSupportedChartNumberFormat(formatCode: string): boolean {
    if (formatCode === "General") return true;
    return /^(?:[^0#;,]*)(?:#,##)?0(?:\.0+)?%?(?:[^0#;,]*)$/.test(formatCode);
}

export function formatChartNumber(value: number, formatCode: string): string {
    if (formatCode === "General") return String(value);
    const match = /^(?<prefix>[^0#;,]*)(?<group>#,##)?0(?:\.(?<fraction>0+))?(?<percent>%?)(?<suffix>[^0#;,]*)$/.exec(formatCode);
    if (!match?.groups) return String(value);
    const fractionDigits = match.groups.fraction?.length ?? 0;
    const percent = match.groups.percent === "%";
    const formatted = (percent ? value * 100 : value).toLocaleString("en-US", {
        useGrouping: Boolean(match.groups.group),
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
    return `${match.groups.prefix}${formatted}${match.groups.percent}${match.groups.suffix}`;
}
