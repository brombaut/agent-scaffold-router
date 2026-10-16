/**
 * Operational transformation for plain-text edits. Two sites each apply their
 * own op locally, exchange ops, and transform the remote op against the local
 * one, so both documents converge:
 *
 *   applyAll(apply(doc, a), transform(b, a)) === applyAll(apply(doc, b), transform(a, b))
 */
export type Insert = { type: "ins"; pos: number; text: string; site: number };
export type Delete = { type: "del"; pos: number; len: number };
export type Op = Insert | Delete;

export function apply(doc: string, op: Op): string {
  if (op.type === "ins") return doc.slice(0, op.pos) + op.text + doc.slice(op.pos);
  return doc.slice(0, op.pos) + doc.slice(op.pos + op.len);
}

export function applyAll(doc: string, ops: Op[]): string {
  return ops.reduce(apply, doc);
}

/**
 * Rewrites `a` so it can be applied after `b`, where both were made against
 * the same document. Concurrent inserts at the same position are ordered by
 * site id (lower site first). Text inserted inside a concurrently deleted
 * range is kept. Returns zero, one or two ops.
 */
export function transform(a: Op, b: Op): Op[] {
  if (a.type === "ins" && b.type === "ins") {
    const bFirst = b.pos < a.pos || (b.pos === a.pos && b.site < a.site);
    return [bFirst ? { ...a, pos: a.pos + b.text.length } : a];
  }
  if (a.type === "ins" && b.type === "del") {
    if (a.pos <= b.pos) return [a];
    if (a.pos >= b.pos + b.len) return [{ ...a, pos: a.pos - b.len }];
    return [{ ...a, pos: b.pos }];
  }
  if (a.type === "del" && b.type === "ins") {
    if (b.pos <= a.pos) return [{ ...a, pos: a.pos + b.text.length }];
    if (b.pos >= a.pos + a.len) return [a];
    // The insert landed inside the range: delete around it, keep the inserted text.
    const left = b.pos - a.pos;
    return [
      { type: "del", pos: a.pos, len: left },
      { type: "del", pos: a.pos + b.text.length, len: a.len - left },
    ];
  }
  const d = a as Delete;
  const e = b as Delete;
  const overlap = Math.max(0, Math.min(d.pos + d.len, e.pos + e.len) - Math.max(d.pos, e.pos));
  const len = d.len - overlap;
  if (len === 0) return [];
  const pos = d.pos <= e.pos ? d.pos : Math.max(e.pos, d.pos - e.len);
  return [{ type: "del", pos, len }];
}
