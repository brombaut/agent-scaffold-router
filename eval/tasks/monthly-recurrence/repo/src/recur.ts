/** A monthly recurrence rule, a subset of RFC 5545 RRULE with FREQ=MONTHLY. */
export interface MonthlyRule {
  /** Every N months; default 1. */
  interval?: number;
  /** Days of the month: 1..31, or -1..-31 counted from the end (-1 = last day). */
  byMonthDay?: number[];
  /** Weekday (0 = Sunday) and which one in the month: 1..5, or -1..-5 from the end. */
  byDay?: { weekday: number; nth: number }[];
  /** Stop after this many occurrences. */
  count?: number;
  /** Last date allowed (YYYY-MM-DD), inclusive. */
  until?: string;
}

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

function candidates(rule: MonthlyRule, y: number, m: number, day: number): number[] {
  const out: number[] = [];
  for (const md of rule.byMonthDay ?? (rule.byDay ? [] : [day])) out.push(Date.UTC(y, m, md));
  for (const { weekday, nth } of rule.byDay ?? []) {
    const first = 1 + ((weekday - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7);
    const d = nth > 0 ? first + (nth - 1) * 7 : first + (4 + nth) * 7;
    out.push(Date.UTC(y, m, d));
  }
  return out;
}

/**
 * Dates (YYYY-MM-DD, UTC) matching `rule`, from `start` on, in order. Only
 * dates on or after `start` count toward `count`. With neither byMonthDay nor
 * byDay, the rule repeats on start's day of the month. At most `limit` dates.
 */
export function occurrences(rule: MonthlyRule, start: string, limit = 1000): string[] {
  const interval = rule.interval ?? 1;
  const from = parse(start);
  const until = rule.until ? parse(rule.until) : Infinity;
  const max = Math.min(rule.count ?? Infinity, limit);
  const cur = new Date(from);
  const out: string[] = [];
  let seen = 0;
  while (seen < max && cur.getTime() < until) {
    for (const t of candidates(rule, cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate())) {
      seen++;
      if (t >= from && t < until && seen <= max) out.push(fmt(t));
    }
    cur.setUTCMonth(cur.getUTCMonth() + interval);
  }
  return out;
}
