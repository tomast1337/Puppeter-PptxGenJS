// One violation of each rule in eslint.config.ts, the errors tests/lint.test.ts expects. `bun run lint` skips this folder.

export function curly(value: number): number {
    if (value < 0) return -1;

    return value;
}

export function braceStyle(value: number): string {
    if (value < 0) {
        return "negative";
    }
    // A comment between `}` and `else` is the one split bun fmt keeps.
    else {
        return "positive";
    }
}

export function padding(value: number): number {
    const doubled = value * 2;
    return doubled;
}

export function forEach(values: readonly number[]): void {
    values.forEach(value => console.log(value));
}

export function reduce(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0);
}

export function chain(values: readonly number[]): number[] {
    return values.map(value => value * 2).filter(value => value > 1);
}

export function nullable(values: readonly number[]): number | undefined {
    return values[0];
}

export interface Shape {
    width: number;
}
