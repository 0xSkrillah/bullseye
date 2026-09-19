import { useCallback, useEffect, useState } from "react";
import type { Quote } from "@bullseye/domain";
import { api, type Health, type OrderRow, type SignalRow } from "./lib/api";
import { usePurchase } from "./checkout/usePurchase";
import { CheckoutNotice, purchaseIsOpen } from "./components/CheckoutNotice";
import { useNow, usePoll } from "./lib/usePoll";
import { Desk } from "./layout/Desk";
import { Feed } from "./screens/Feed";
import { Investigation } from "./screens/Investigation";
import { BriefScreen } from "./screens/Brief";
import { Console } from "./screens/Console";
import { Money } from "./primitives/Money";

/**
 * One story, left to right: SIGNAL → INVESTIGATE → VERIFIED INTELLIGENCE → PURCHASE → DELIVERY.
 * State lives in the API; this component only decides which stage the working area shows.
 */
export function App() {
  const now = useNow();
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const health = usePoll<Health>(() => api.health(), 15_000).data;
  const signals = usePoll(() => api.signals(), 5_000);
  const rows: SignalRow[] = signals.data?.signals ?? [];
  const locked = rows.find((r) => r.signal.id === lockedId) ?? null;
  const invId = locked?.investigation?.id ?? null;
  const inv = usePoll(() => api.investigation(invId!), 2_000, invId !== null, [invId]).data;
  const briefId = inv?.investigation.briefId ?? locked?.investigation?.briefId ?? null;
  const preview = usePoll(() => api.briefPreview(briefId!), 10_000, briefId !== null, [briefId]).data;
  // scan, investigate and reconcile start paid work; off localhost they answer 401/403 and the auto desk runs them instead
  const operator = health?.operatorRoutes === "OPEN_ON_LOCALHOST";

  // this browser's own purchase of the Brief: its record, its order (read with its claim token) and what it was delivered
  const purchase = usePurchase(briefId);
  const delivered = purchase.brief;
  const challenge = purchase.issue?.kind === "NO_WALLET" ? purchase.issue.challenge : null;
  // the console shows this browser's order and no one else's: there is no list of other buyers' orders for it to pick from
  const order: OrderRow | null = purchase.order;

  // scan once on boot so the feed has something to show; the API is idempotent about it
  useEffect(() => { if (operator) api.scan().catch(() => undefined); }, [operator]);

  const lock = useCallback((id: string) => {
    setLockedId(id); setQuote(null);
    const row = rows.find((r) => r.signal.id === id);
    if (operator && row && !row.investigation) api.investigate(id).then(() => signals).catch((e) => setBanner(`Investigation could not start: ${String(e)}`));
  }, [rows, signals, operator]);

  // a card locked before /api/health answered: start its investigation once the desk learns it is the operator.
  // Only `operator` is a dependency: `rows` changes on every poll and would start paid work again and again.
  useEffect(() => {
    if (!operator || !lockedId) return;
    const row = rows.find((r) => r.signal.id === lockedId);
    if (row && !row.investigation) api.investigate(lockedId).catch((e) => setBanner(`Investigation could not start: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator]);

  // the radar locks the newest event; a visitor's desk only locks one the auto desk has already investigated
  const radarLock = useCallback(() => {
    if (lockedId || !health) return;
    const newest = [...rows].filter((r) => operator || r.investigation).sort((a, b) => b.signal.detectedAt.localeCompare(a.signal.detectedAt))[0];
    if (newest) lock(newest.signal.id);
  }, [rows, lockedId, lock, operator, health]);

  const requestQuote = useCallback(async () => {
    if (!briefId) return;
    try { setQuote(await api.quote(briefId)); setBanner(null); }
    catch (e) { setBanner(`Quote unavailable: ${e instanceof Error ? e.message : String(e)}`); }
  }, [briefId]);

  const pay = useCallback(() => { if (quote) void purchase.pay(quote); }, [quote, purchase.pay]);

  // the buyer reconciles their own order with their claim token; it reads the chain and never settles
  const reconcile = useCallback(() => { void purchase.reconcile(); }, [purchase.reconcile]);

  const startOver = useCallback(() => { purchase.startOver(); setQuote(null); }, [purchase.startOver]);
  const notice = <CheckoutNotice record={purchase.record} issue={purchase.issue} busy={purchase.busy} durable={purchase.durable} autoChecks={purchase.autoChecks} origin={location.origin} onResume={() => void purchase.resume()} onReconcile={() => void purchase.reconcile()} onStartOver={startOver} onDismiss={purchase.dismiss} />;

  const work = !locked ? (
    <>
      <span className="be-stage">Investigation</span>
      <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>Lock an event in the Feed to start. Bullseye investigates within a budget, passes a deterministic gate, and only then offers a Brief.</span>
    </>
  ) : health && !operator && !locked.investigation ? (
    <>
      <span className="be-stage">Investigation</span>
      <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>Not investigated yet. Starting an investigation is an operator action; the auto desk runs it on the public deployment.</span>
    </>
  ) : briefId && preview ? (
    <BriefScreen preview={preview.preview} signal={preview.signal} withdrawn={preview.withdrawn ?? null} gate={inv?.investigation.gate ?? null} brief={delivered} envelope={purchase.envelope} quote={quote} now={now} paying={purchase.busy} purchaseOpen={purchaseIsOpen(purchase.record)} notice={notice} onRequestQuote={requestQuote} onPay={pay} />
  ) : (
    <Investigation signal={locked.signal} data={inv} brief={delivered} now={now} />
  );

  const strip = (
    <>
      <div className="be-panel" style={{ padding: 12 }}><span className="be-stage">Price</span><br />{health ? <Money usd={health.priceUsd} basis="PRICE" rail={health.paymentRail.rail} /> : "—"}</div>
      <div className="be-panel" style={{ padding: 12 }}><span className="be-stage">Measured cost</span><br />{order ? <Money usd={order.receipt.measuredTotalUsd} basis="MEASURED" /> : "—"}</div>
      <div className="be-panel" style={{ padding: 12 }}><span className="be-stage">Est. contribution</span><br />{order ? <Money usd={order.receipt.estimatedContributionUsd} basis="ESTIMATED" decimals={2} /> : "—"}</div>
      <div className="be-panel" style={{ padding: 12 }}><span className="be-stage">Order</span><br /><span className="mono" style={{ fontSize: 13 }}>{order?.order.state ?? "none"}</span></div>
    </>
  );

  return (
    <>
      {(banner || signals.error) && (
        <div className="be be-banner" style={{ margin: "24px 24px 0" }}>
          <span>{banner ?? `API unreachable: ${signals.error}. Start apps/api on :4402.`}</span>
          <button className="be-btn" type="button" onClick={() => { setBanner(null); location.reload(); }}>Retry</button>
        </div>
      )}
      <Desk
        feed={<Feed rows={rows} lockedId={lockedId} listening={signals.data === null} onLock={lock} onRadarLock={radarLock} />}
        work={work}
        console={<Console health={health} order={order} gate={inv?.investigation.gate ?? null} briefId={briefId} challenge={challenge} onReconcile={reconcile} />}
        strip={strip}
      />
    </>
  );
}
