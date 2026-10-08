/**
 * Restricts `value` to the range [min, max]. If min > max, the bounds are
 * swapped. NaN is returned unchanged.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return value;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
