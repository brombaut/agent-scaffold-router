/** JSON Patch (RFC 6902) with JSON Pointer paths (RFC 6901). */
export type Operation =
  | { op: "add" | "replace" | "test"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "move" | "copy"; from: string; path: string };

export class PatchError extends Error {}

type Container = Record<string, unknown> | unknown[];

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new PatchError(`invalid pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

function arrayIndex(arr: unknown[], token: string, forAdd: boolean): number {
  if (forAdd && token === "-") return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new PatchError(`invalid array index: ${token}`);
  const i = Number(token);
  if (i > arr.length || (!forAdd && i === arr.length)) throw new PatchError(`array index out of range: ${token}`);
  return i;
}

function child(parent: unknown, token: string): unknown {
  if (Array.isArray(parent)) return parent[arrayIndex(parent, token, false)];
  if (isContainer(parent) && Object.hasOwn(parent, token)) return parent[token];
  throw new PatchError(`path not found at ${token}`);
}

function get(doc: unknown, path: string): unknown {
  return parsePointer(path).reduce(child, doc);
}

function parentOf(doc: unknown, path: string): [Container, string] {
  const tokens = parsePointer(path);
  const last = tokens.pop()!;
  const parent = tokens.reduce(child, doc);
  if (!isContainer(parent)) throw new PatchError(`cannot reach ${path}`);
  return [parent, last];
}

function add(doc: unknown, path: string, value: unknown): unknown {
  if (path === "") return value;
  const [parent, key] = parentOf(doc, path);
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, true), 0, value);
  else parent[key] = value;
  return doc;
}

function remove(doc: unknown, path: string): unknown {
  if (path === "") throw new PatchError("cannot remove the document root");
  const [parent, key] = parentOf(doc, path);
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, false), 1);
  else if (Object.hasOwn(parent, key)) delete parent[key];
  else throw new PatchError(`path not found: ${path}`);
  return doc;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isContainer(a) || !isContainer(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as any)[k], (b as any)[k]));
}

function applyOne(doc: unknown, op: Operation): unknown {
  switch (op.op) {
    case "add":
      return add(doc, op.path, structuredClone(op.value));
    case "remove":
      return remove(doc, op.path);
    case "replace":
      get(doc, op.path);
      return add(op.path === "" ? doc : remove(doc, op.path), op.path, structuredClone(op.value));
    case "move": {
      if (op.path === op.from) return doc;
      if (op.path.startsWith(op.from + "/")) throw new PatchError(`cannot move ${op.from} into itself`);
      const value = get(doc, op.from);
      return add(remove(doc, op.from), op.path, value);
    }
    case "copy":
      return add(doc, op.path, structuredClone(get(doc, op.from)));
    case "test":
      if (!deepEqual(get(doc, op.path), op.value)) throw new PatchError(`test failed at ${op.path}`);
      return doc;
    default:
      throw new PatchError(`unknown op: ${(op as any).op}`);
  }
}

/**
 * Applies `patch` to `doc` and returns the result. The input is never
 * modified, and a failing operation throws a PatchError with no partial
 * changes visible.
 */
export function applyPatch<T>(doc: T, patch: Operation[]): T {
  return patch.reduce(applyOne, structuredClone(doc) as unknown) as T;
}
