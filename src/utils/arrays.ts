/**
 * Runtime-checked array access for places where configuration guarantees a value.
 * Keeping the check centralized prevents silent `undefined` propagation when data
 * changes while still allowing `noUncheckedIndexedAccess` to stay enabled.
 */
export function atOrThrow<T>(values: readonly T[], index: number, label = 'array'): T {
    const value = values[index];
    if (value === undefined) {
        throw new RangeError(`${label} index ${index} is out of bounds (length ${values.length})`);
    }
    return value;
}
export function cyclicAt<T>(values: readonly T[], index: number, label = 'array'): T {
    if (values.length === 0) {
        throw new RangeError(`${label} must not be empty`);
    }
    const normalized = ((Math.trunc(index) % values.length) + values.length) % values.length;
    return atOrThrow(values, normalized, label);
}
export function firstOrThrow<T>(values: readonly T[], label = 'array'): T {
    return atOrThrow(values, 0, label);
}
export function lastOrThrow<T>(values: readonly T[], label = 'array'): T {
    return atOrThrow(values, values.length - 1, label);
}
