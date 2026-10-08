/** Numbers from `start` up to (not including) `end`, stepping by `step`. */
export function range(start: number, end: number, step = 1): number[] {
  if (step === 0) throw new Error("step must not be 0");
  const out: number[] = [];
  if (step > 0) {
    for (let i = start; i <= end; i += step) out.push(i);
  } else {
    for (let i = start; i >= end; i += step) out.push(i);
  }
  return out;
}
