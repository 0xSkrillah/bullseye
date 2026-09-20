import { useRef } from "react";
import type { BriefPreview, DataMode } from "@bullseye/domain";
import type { SignalRow } from "../lib/api";
import { usePoll, useNow, type PollResult } from "../lib/usePoll";
import { POLL_MS, POLL_OPTIONS, RECHECK_MS, SETTLED_MS, room, type ActivityResponse, type ChainResponse, type CommerceSummary, type DeskEconomics, type DeskStatus, type Feed, type InvestigationListResponse, type RoomHealth, type RoomInvestigation } from "./data";
import { pickFocus } from "./model";

/** how many runs the gate matrix shows side by side */
export const GATE_COLUMNS = 3;

export interface RoomData {
  now: Date;
  health: PollResult<RoomHealth>;
  signals: PollResult<{ dataMode: DataMode; signals: SignalRow[] }>;
  briefs: PollResult<{ briefs: BriefPreview[] }>;
  commerce: PollResult<Feed<CommerceSummary>>;
  economics: PollResult<Feed<DeskEconomics>>;
  deskStatus: PollResult<Feed<DeskStatus>>;
  activity: PollResult<Feed<ActivityResponse>>;
  investigations: PollResult<Feed<InvestigationListResponse>>;
  /** the investigation worth watching: the RUNNING one, else the newest; null when none exists */
  focusId: string | null;
  /** polled every 3 s while RUNNING; a finished one is read once */
  focus: PollResult<RoomInvestigation>;
  chain: PollResult<Feed<ChainResponse>>;
  /** the newest runs the gate has judged, oldest first. A finished run is read once and kept by id, whichever column it moves to. */
  judged: RoomInvestigation[];
  /** how many judged runs the list names for the matrix; more than `judged.length` while some are still being read, or could not be; null until that count is known */
  judgedExpected: number | null;
  judgedError: string | null;
}

/** A route that is not there yet is asked again once a minute instead of at its normal pace. The pace is taken from the answer, so finding a route missing costs one request, not two. */
function useOptional<T>(fn: () => Promise<Feed<T>>, ms: number, active = true, deps: unknown[] = [], resetKey?: unknown): PollResult<Feed<T>> {
  return usePoll(fn, ms, active, deps, { ...POLL_OPTIONS, paceFor: (d) => (d.state === "unavailable" ? RECHECK_MS : undefined), resetKey });
}

/** One slot of the gate matrix: a finished run, read once. Inactive when the slot is empty, is the focused run, or is already in hand. */
function useJudged(id: string | null, active: boolean): { data: RoomInvestigation | null; error: string | null } {
  const poll = usePoll(() => room.investigation(id!), SETTLED_MS, active && id !== null, [id], { ...POLL_OPTIONS, resetKey: id });
  return { data: poll.data && poll.data.investigation.id === id ? poll.data : null, error: active && id !== null ? poll.error : null };
}

/** Every read the room makes, in one place, so the request budget in data.ts can be checked against it. */
export function useRoomData(): RoomData {
  const now = useNow();
  const health = usePoll(() => room.health(), POLL_MS.health, true, [], POLL_OPTIONS);
  const signals = usePoll(() => room.signals(), POLL_MS.signals, true, [], POLL_OPTIONS);
  const briefs = usePoll(() => room.briefs(), POLL_MS.briefs, true, [], POLL_OPTIONS);
  // which order and totals routes this server has is read off its health check, so a missing one is never requested
  const modern = health.data ? health.data.diagnostics !== undefined : null;
  const orders = usePoll(() => room.commerce(modern === true), POLL_MS.commerce, modern !== null, [modern], POLL_OPTIONS);
  const totals = useOptional(() => room.economics(), POLL_MS.economics, modern === true);
  // until the health check answers, these two reads have not started: its failure is theirs, not an endless "Fetching…"
  const unasked = modern === null && health.error !== null ? { data: null, error: health.error, updatedAt: null } : null;
  const commerce: PollResult<Feed<CommerceSummary>> = unasked ?? orders;
  const economics: PollResult<Feed<DeskEconomics>> = unasked ?? (modern === false ? { data: { state: "unavailable" }, error: null, updatedAt: null } : totals);
  const deskStatus = useOptional(() => room.deskStatus(), POLL_MS.deskStatus);
  const activity = useOptional(() => room.activity(), POLL_MS.activity);
  const investigations = useOptional(() => room.investigations(), POLL_MS.investigations);

  const listed = investigations.data?.state === "ok" ? investigations.data.data.investigations : null;
  const rows = signals.data?.signals ?? null;
  // wait for the list route to answer (or fail, or turn out not to exist) before falling back to the signals:
  // otherwise the room reads one run, then drops it a second later for the one the list names
  const listSettled = investigations.data !== null || investigations.error !== null;
  const focusId = listSettled ? pickFocus(listed, rows) : null;
  // RUNNING is read from the lists the room already polls, so a finished run costs one request, not one every 3 s
  const running = focusId !== null && ((listed?.find((i) => i.id === focusId)?.status ?? rows?.find((r) => r.investigation?.id === focusId)?.investigation?.status) === "RUNNING");
  // A finished run is read once: after its first good answer the poll stops, as the panel feet say ("read once"). The run and its
  // chain are remembered by id, so the next render turns the poll off; a failed read keeps trying until one succeeds.
  const done = useRef(new Set<string>());
  const chainDone = useRef(new Set<string>());
  // keyed by the run: an error or a time from the last focus is never shown under the next one
  const focus = usePoll(() => room.investigation(focusId!), running ? POLL_MS.runningInvestigation : SETTLED_MS, focusId !== null && (running || !done.current.has(focusId)), [focusId, running], { ...POLL_OPTIONS, resetKey: focusId });
  const chain = useOptional(() => room.chain(focusId!), running ? POLL_MS.runningChain : SETTLED_MS, focusId !== null && (running || !chainDone.current.has(focusId)), [focusId, running], focusId);
  if (!running && focusId !== null && focus.data?.investigation.id === focusId && focus.data.investigation.status !== "RUNNING") done.current.add(focusId);
  if (!running && focusId !== null && chain.data?.state === "ok" && chain.data.data.investigationId === focusId) chainDone.current.add(focusId);

  // the gate matrix: the newest runs that have a gate result. A fixed number of slots, because hooks cannot be called in a loop of unknown length.
  const judgedIds = (listed ?? []).filter((i) => i.gate !== null).slice(0, GATE_COLUMNS).map((i) => i.id);
  // A finished run does not change, so it is kept by id: when a new run pushes the others one column along, nothing is read again and no column goes blank.
  const kept = useRef(new Map<string, RoomInvestigation>());
  const keep = (r: RoomInvestigation | null) => { if (r && r.investigation.status !== "RUNNING" && r.investigation.gate !== null) kept.current.set(r.investigation.id, r); };
  const mine = focus.data && focus.data.investigation.id === focusId ? focus.data : null;
  keep(mine);
  const slot = (n: number) => judgedIds[n] ?? null;
  const wanted = (n: number) => slot(n) !== focusId && !kept.current.has(slot(n) ?? "");
  const a = useJudged(slot(0), wanted(0));
  const b = useJudged(slot(1), wanted(1));
  const c = useJudged(slot(2), wanted(2));
  for (const s of [a, b, c]) keep(s.data);
  for (const id of [...kept.current.keys()]) if (id !== focusId && !judgedIds.includes(id)) kept.current.delete(id);
  const judged = judgedIds
    .map((id) => kept.current.get(id) ?? (id === focusId ? mine : null))
    .filter((x): x is RoomInvestigation => x !== null && x.investigation.gate !== null)
    .reverse();
  // an older server has no list: the focused run is the only one the room knows to have a gate
  const fallback = listed === null && mine && mine.investigation.gate ? [mine] : null;

  const judgedError = a.error ?? b.error ?? c.error ?? (judgedIds.includes(focusId ?? "") ? focus.error : null);

  // The count is known once the list has answered; without a list, once there is no run to read or the focused run is in hand.
  // A failed read is not "known": the column it would have brought must not look new when the read succeeds later.
  const expectedKnown = listed !== null || (listSettled && rows !== null && (focusId === null || mine !== null));

  return { now, health, signals, briefs, commerce, economics, deskStatus, activity, investigations, focusId, focus, chain, judged: fallback ?? judged, judgedExpected: !expectedKnown ? null : fallback ? fallback.length : judgedIds.length, judgedError };
}
