// The bench environment, named once for scripts/bench.ts and scripts/bench-renderers.ts.

/** Runs per measurement. Each bench has its own default: a Puppeteer deck takes far longer than a warm WASM or PDFKit render. */
export const BENCH_RUNS_DEFAULT = { puppeteer: 5, rendererWarm: 20 } as const;

/** `BENCH_RUNS` when set, else the bench's default. */
export function benchRuns(bench: keyof typeof BENCH_RUNS_DEFAULT): number {
    const value = process.env.BENCH_RUNS;

    if (value === undefined) {
        return BENCH_RUNS_DEFAULT[bench];
    }

    const runs = Number(value);

    if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`BENCH_RUNS must be a positive integer, got "${value}"`);
    }

    return runs;
}
