import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brief, Quote } from "@bullseye/domain";
import { api, type DeliveryEnvelope, type Health, type OrderRow, type SignalRow } from "./lib/api";
import { payForBrief } from "./lib/pay";
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
  const [challenge, setChallenge] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [delivered, setDelivered] = useState<Brief | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const health = usePoll<Health>(() => api.health(), 15_000).data;
  const signals = usePoll(() => api.signals(), 5_000);
  const rows: SignalRow[] = signals.data?.signals ?? [];
  const locked = rows.find((r) => r.signal.id === lockedId) ?? null;
  const invId = locked?.investigation?.id ?? null;
  const inv = usePoll(() => api.investigation(invId!), 2_000, invId !== null, [invId]).data;
  const briefId = inv?.investigation.briefId ?? locked?.investigation?.briefId ?? null;
  const preview = usePoll(() => api.briefPreview(briefId!), 10_000, briefId !== null, [briefId]).data;
  const orders = usePoll(() => api.orders(), 3_000, briefId !== null, [briefId]).data;
  const order: OrderRow | null = useMemo(() => orders?.orders.filter((o) => o.order.terms.briefId === briefId).sort((a, b) => b.order.updatedAt.localeCompare(a.order.updatedAt))[0] ?? null, [orders, briefId]);

  // scan once on boot so the feed has something to show; the API is idempotent about it
  useEffect(() => { api.scan().catch(() => undefined); }, []);

  const lock = useCallback((id: string) => {
    setLockedId(id); setQuote(null); setChallenge(null); setDelivered(null);
    const row = rows.find((r) => r.signal.id === id);
    if (row && !row.investigation) api.investigate(id).then(() => signals).catch((e) => setBanner(`Investigation could not start: ${String(e)}`));
  }, [rows, signals]);

  // the radar locks the newest event that has (or can have) an investigation
  const radarLock = useCallback(() => {
    if (lockedId || rows.length === 0) return;
    const newest = [...rows].sort((a, b) => b.signal.detectedAt.localeCompare(a.signal.detectedAt))[0]!;
    lock(newest.signal.id);
  }, [rows, lockedId, lock]);

  const requestQuote = useCallback(async () => {
    if (!briefId) return;
    try { setQuote(await api.quote(briefId)); setBanner(null); }
    catch (e) { setBanner(`Quote unavailable: ${e instanceof Error ? e.message : String(e)}`); }
  }, [briefId]);

  const pay = useCallback(async () => {
    if (!quote) return;
    setPaying(true);
    try {
      const out = await payForBrief(quote);
      if (out.kind === "delivered") { const env = out.body as DeliveryEnvelope; setDelivered(env.brief); setChallenge(null); }
      else if (out.kind === "challenged") setChallenge(out.challenge);
      else setBanner(out.detail);
    } finally { setPaying(false); }
  }, [quote]);

  const reconcile = useCallback((id: string) => { api.reconcile(id).catch((e) => setBanner(`Reconcile failed: ${String(e)}`)); }, []);

  const work = !locked ? (
    <>
      <span className="be-stage">Investigation</span>
      <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>Lock an event in the Feed to start. Bullseye investigates within a budget, passes a deterministic gate, and only then offers a Brief.</span>
    </>
  ) : briefId && preview ? (
    <BriefScreen preview={preview.preview} brief={delivered} quote={quote} now={now} paying={paying} onRequestQuote={requestQuote} onPay={pay} onViewEvidence={() => setLockedId(lockedId)} />
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
