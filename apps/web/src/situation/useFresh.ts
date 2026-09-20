import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** how long something that just changed is marked as new; the CSS animation runs once inside this */
export const FRESH_MS = 2400;

/**
 * The room's only source of motion: something moves because an API answer changed it, once.
 * `news(before, now)` names what is new in this answer compared with the one before it. The first
 * answer is the state of the world, not news, so it is only remembered. So is the first answer under
 * a different `scope` (another run, another source): what it holds was already true, the room had
 * just not been looking at it. Pass a null answer while the read has not answered; a null answer
 * never touches the baseline.
 */
export function useFreshWhen<T>(answer: T | null, signature: string | null, news: (before: T, now: T) => string[], ms: number = FRESH_MS, scope: string | null = null): ReadonlySet<string> {
  const previous = useRef<{ scope: string | null; answer: T } | null>(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(new Map());

  // a layout effect, so an element is already marked on the first frame it is painted: no pop before its entrance
  useLayoutEffect(() => {
    if (answer === null) return;
    const before = previous.current;
    previous.current = { scope, answer };
    if (before === null || before.scope !== scope) return;
    const added = news(before.answer, answer);
    if (added.length === 0) return;
    const until = Date.now() + ms;
    setFresh((old) => new Map([...old, ...added.map((k) => [k, until] as const)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ms, scope]);

  useEffect(() => {
    if (fresh.size === 0) return;
    const soonest = Math.min(...fresh.values());
    const timer = setTimeout(() => setFresh((old) => new Map([...old].filter(([, until]) => until > Date.now()))), Math.max(0, soonest - Date.now()) + 16);
    return () => clearTimeout(timer);
  }, [fresh]);

  return new Set(fresh.keys());
}

/** The keys that were not there in the answer before this one, for `ms` after they appeared. */
export function useFreshKeys(keys: readonly string[] | null, ms: number = FRESH_MS, scope: string | null = null): ReadonlySet<string> {
  return useFreshWhen(keys, keys === null ? null : keys.join("\n"), (before, now) => { const had = new Set(before); return now.filter((k) => !had.has(k)); }, ms, scope);
}

/**
 * The counts that rose since the answer before this one. A fall is never news: a count taken from
 * the newest N records falls when the window moves on, and outside a full window every fall is
 * matched by a rise in the state the record moved to. A key the last answer did not have is a baseline.
 */
export function useFreshRises(counts: Readonly<Record<string, number>> | null, ms: number = FRESH_MS, scope: string | null = null): ReadonlySet<string> {
  return useFreshWhen(counts, counts === null ? null : JSON.stringify(counts), (before, now) => Object.keys(now).filter((k) => k in before && now[k]! > before[k]!), ms, scope);
}

/** `data-fresh` for an element whose key just appeared; absent otherwise, so static markup stays clean */
export const freshAttr = (fresh: ReadonlySet<string>, key: string): { "data-fresh"?: "" } => (fresh.has(key) ? { "data-fresh": "" } : {});
