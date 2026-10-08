type Obj = Record<string, any>;

const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Recursively merges `source` into `target`. Arrays from `source` replace arrays in `target`. */
export function deepMerge(target: Obj, source: Obj): Obj {
  for (const key in source) {
    const s = source[key];
    const t = target[key];
    if ((isObject(s) || Array.isArray(s)) && (isObject(t) || Array.isArray(t))) {
      deepMerge(t, s);
    } else {
      target[key] = s;
    }
  }
  return target;
}
