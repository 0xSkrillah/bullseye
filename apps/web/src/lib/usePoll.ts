import { useEffect, useRef, useState } from "react";

export interface PollOptions<T = unknown> {
  /** stop asking while the tab is hidden; ask once as soon as it is shown again */
  pauseWhenHidden?: boolean;
  /** after a failure wait twice as long before the next try, up to this many ms; the first success resets it */
  backoffMaxMs?: number;
  /** the wait before the next request, chosen from the answer just received; undefined keeps `ms`. It never restarts the loop. */
  paceFor?: (data: T) => number | undefined;
  /** what the poll is about (an id). When it changes, the last answer, error and time are dropped: they belong to the previous one. */
  resetKey?: unknown;
}

export interface PollResult<T> {
  data: T | null;
  error: string | null;
  /**
   * What was thrown, so a caller can tell a 404 for one record from the API being down and offer
   * the right way back. A tick that succeeds clears it along with `error`.
   *
   * `usePoll` always supplies it; it is optional so that a hand-written result — a test double, a
   * panel standing in for a feed it did not ask for — does not have to carry an error it never had.
   */
  cause?: unknown;
  /** when `data` last arrived, in ms since the epoch; null until the first answer */
  updatedAt: number | null;
}

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Poll an async source every `ms`; stops when `active` is false.
 *
 * Without `options` this is a plain interval. With them, the next request is only scheduled once
 * the last one has answered, so slow answers never pile up.
 */
export function usePoll<T>(fn: () => Promise<T>, ms: number, active = true, deps: unknown[] = [], options?: PollOptions<T>): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cause, setCause] = useState<unknown>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const pauseWhenHidden = options?.pauseWhenHidden ?? false;
  const backoffMaxMs = options?.backoffMaxMs ?? 0;
  const paced = options !== undefined;
  const paceFor = useRef(options?.paceFor);
  paceFor.current = options?.paceFor;
  const resetKey = options?.resetKey;
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current !== resetKey) { lastKey.current = resetKey; setData(null); setError(null); setCause(null); setUpdatedAt(null); }
  }, [resetKey]);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let next: number | undefined;
    const ask = async (): Promise<boolean> => {
      try { const d = await fn(); if (!stop) { setData(d); setError(null); setCause(null); setUpdatedAt(Date.now()); next = paceFor.current?.(d); } return true; }
      catch (e) { if (!stop) { setError(e instanceof Error ? e.message : String(e)); setCause(e); } return false; }
    };
    if (!paced) {
      void ask();
      const id = setInterval(ask, ms);
      return () => { stop = true; clearInterval(id); };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = ms;
    let asking = false;
    const tick = async () => {
      timer = undefined;
      if (stop || asking) return;
      if (pauseWhenHidden && isHidden()) return; // the visibility listener restarts the loop
      asking = true;
      const ok = await ask();
      asking = false;
      wait = ok || backoffMaxMs <= 0 ? next ?? ms : Math.min(backoffMaxMs, wait * 2);
      if (!stop) timer = setTimeout(tick, wait);
    };
    const onVisible = () => { if (!isHidden() && timer === undefined && !asking) void tick(); };
    if (pauseWhenHidden) document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stop = true;
      if (timer !== undefined) clearTimeout(timer);
      if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms, paced, pauseWhenHidden, backoffMaxMs, ...deps]);
  return { data, error, cause, updatedAt };
}

export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}
