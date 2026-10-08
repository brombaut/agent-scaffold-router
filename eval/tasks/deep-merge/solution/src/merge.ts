type Obj = Record<string, any>;

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Recursively merges `source` into `target`. Arrays from `source` replace arrays in `target`. */
export function deepMerge(target: Obj, source: Obj): Obj {
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const s = source[key];
    const t = target[key];
    if (isObject(s) && isObject(t)) {
      deepMerge(t, s);
    } else {
      target[key] = Array.isArray(s) ? [...s] : s;
    }
  }
  return target;
}
