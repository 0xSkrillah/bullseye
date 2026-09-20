import { useEffect, useState } from "react";

/**
 * Poll an async source every `ms`; stops when `active` is false.
 *
 * `cause` is what was thrown, so a caller can tell a 404 for one record from the API being down
 * and offer the right way back. A tick that succeeds clears both.
 */
export function usePoll<T>(fn: () => Promise<T>, ms: number, active = true, deps: unknown[] = []): { data: T | null; error: string | null; cause: unknown } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cause, setCause] = useState<unknown>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try { const d = await fn(); if (!stop) { setData(d); setError(null); setCause(null); } }
      catch (e) { if (!stop) { setError(e instanceof Error ? e.message : String(e)); setCause(e); } }
    };
    void tick();
    const id = setInterval(tick, ms);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms, ...deps]);
  return { data, error, cause };
}

export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}
