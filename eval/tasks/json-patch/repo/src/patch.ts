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
    .map((t) => t.replace(/~0/g, "~").replace(/~1/g, "/"));
}

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

function child(parent: unknown, token: string): unknown {
  if (isContainer(parent) && token in parent) return (parent as any)[token];
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
  (parent as any)[key] = value;
  return doc;
}

function remove(doc: unknown, path: string): unknown {
  if (path === "") throw new PatchError("cannot remove the document root");
  const [parent, key] = parentOf(doc, path);
  if (!(key in parent)) throw new PatchError(`path not found: ${path}`);
  delete (parent as any)[key];
  return doc;
}

function applyOne(doc: unknown, op: Operation): unknown {
  switch (op.op) {
    case "add":
      return add(doc, op.path, op.value);
    case "remove":
      return remove(doc, op.path);
    case "replace":
      get(doc, op.path);
      return add(doc, op.path, op.value);
    case "move": {
      const value = get(doc, op.from);
      return add(remove(doc, op.from), op.path, value);
    }
    case "copy":
      return add(doc, op.path, get(doc, op.from));
    case "test":
      if (get(doc, op.path) !== op.value) throw new PatchError(`test failed at ${op.path}`);
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
  return patch.reduce(applyOne, doc as unknown) as T;
}
