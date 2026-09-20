import { useCallback, useEffect, useState } from "react";

/**
 * What the desk at "/" is showing, read from the URL.
 *
 * There is no router (see main.tsx: the path picks the view). The query names the selection, and
 * two names resolve to a screen:
 *
 *   ?brief=<briefId>    one exact report. Its event is whichever one the Brief is about, so an
 *                       exact link from the Market Desk opens that report and not the newest.
 *   ?signal=<signalId>  one event. Used while it has no published Brief.
 *
 * Both survive a reload and a direct paste, and every selection is a history entry, so Back and
 * Forward return to what was on screen. Nothing here reads or writes purchase storage, starts an
 * investigation or asks for a quote: it only says what to show.
 */
export interface DeskRoute {
  briefId: string | null;
  signalId: string | null;
}

/** an id that can safely go in a path segment; anything else is a request the API will answer 404 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clean = (v: string | null): string | null => (v !== null && ID.test(v) ? v : null);

export function readRoute(search: string = location.search): DeskRoute {
  const q = new URLSearchParams(search);
  const briefId = clean(q.get("brief"));
  // a Brief names its own event, so ?brief= wins and ?signal= is not read alongside it
  return { briefId, signalId: briefId === null ? clean(q.get("signal")) : null };
}

export function routeHref(route: DeskRoute): string {
  if (route.briefId !== null) return `/?brief=${encodeURIComponent(route.briefId)}`;
  if (route.signalId !== null) return `/?signal=${encodeURIComponent(route.signalId)}`;
  return "/";
}

/**
 * The route, kept in step with the address bar in both directions: `go` pushes a selection,
 * Back and Forward push their own through popstate.
 */
export function useDeskRoute(): { route: DeskRoute; go: (next: DeskRoute) => void } {
  const [route, setRoute] = useState<DeskRoute>(() => readRoute());

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: DeskRoute) => {
    const href = routeHref(next);
    // re-selecting what is already shown should not add a history entry to step back through
    if (href !== location.pathname + location.search) history.pushState(next, "", href);
    setRoute(next);
  }, []);

  return { route, go };
}
