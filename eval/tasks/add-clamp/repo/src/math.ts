/**
 * Restricts `value` to the range [min, max]. If min > max, the bounds are
 * swapped. NaN is returned unchanged.
 */
export function clamp(value: number, min: number, max: number): number {
  throw new Error("not implemented");
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
