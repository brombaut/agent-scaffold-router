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
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Days in month `m` of year `y` that match the rule, sorted, without duplicates. Days that don't exist are skipped. */
function matchingDays(rule: MonthlyRule, y: number, m: number, startDay: number): number[] {
  const n = daysIn(y, m);
  const days = new Set<number>();
  for (const md of rule.byMonthDay ?? (rule.byDay ? [] : [startDay])) {
    const d = md > 0 ? md : n + md + 1;
    if (d >= 1 && d <= n) days.add(d);
  }
  for (const { weekday, nth } of rule.byDay ?? []) {
    const first = 1 + ((weekday - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7);
    const all: number[] = [];
    for (let d = first; d <= n; d += 7) all.push(d);
    const d = nth > 0 ? all[nth - 1] : all[all.length + nth];
    if (d !== undefined) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
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
  const s = new Date(from);
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  const out: string[] = [];
  // ponytail: give up after 100 years so rules that never match (e.g. only the 30th of February) terminate
  for (let scanned = 0; scanned < 1200 && out.length < max; scanned++) {
    if (Date.UTC(y, m, 1) > until) break;
    for (const d of matchingDays(rule, y, m, s.getUTCDate())) {
      const t = Date.UTC(y, m, d);
      if (t < from) continue;
      if (t > until || out.length >= max) return out;
      out.push(fmt(t));
    }
    m += interval;
    y += Math.floor(m / 12);
    m %= 12;
  }
  return out;
}
