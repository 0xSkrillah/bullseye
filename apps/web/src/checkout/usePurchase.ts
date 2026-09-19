import { useCallback, useEffect, useRef, useState } from "react";
import type { Brief, Quote } from "@bullseye/domain";
import { api, type DeliveryEnvelope, type OrderRow } from "../lib/api";
import { browserStore, Checkout, type CheckoutIssue, type CheckoutResult, type PurchaseRecord } from "./purchase";

/** one per page: the in-flight guard and the memory fallback have to be shared by every component that pays */
export const checkout = new Checkout({ http: api, store: browserStore(), signer: () => window.bullseyeSigner });

/** an unknown outcome is re-checked on its own this many times, this far apart, and then waits for the buyer */
export const AUTO_CHECKS = { max: 6, everyMs: 10_000 } as const;

const SETTLED_ORDER_STATES = ["DELIVERED", "PAYMENT_FAILED"];

export interface PurchaseView {
  record: PurchaseRecord | null;
  envelope: DeliveryEnvelope | null;
  brief: Brief | null;
  /** this buyer's own order, read with their claim token; never anyone else's */
  order: OrderRow | null;
  issue: CheckoutIssue | null;
  busy: boolean;
  /** false when this browser is not keeping the purchase record across reloads */
  durable: boolean;
  autoChecks: number;
  pay(quote: Quote): Promise<void>;
  resume(): Promise<void>;
  reconcile(): Promise<void>;
  /** only for a purchase that charged nothing */
  startOver(): void;
  dismiss(): void;
}

export function usePurchase(briefId: string | null, c: Checkout = checkout): PurchaseView {
  const [record, setRecord] = useState<PurchaseRecord | null>(null);
  const [envelope, setEnvelope] = useState<DeliveryEnvelope | null>(null);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [issue, setIssue] = useState<CheckoutIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [durable, setDurable] = useState(true);
  const [autoChecks, setAutoChecks] = useState(0);
  const current = useRef(briefId);
  current.current = briefId;

  const apply = useCallback(
    (forBrief: string, r: CheckoutResult) => {
      // an answer for a Brief the buyer has since left is kept in storage by the controller, and not shown here
      if (current.current !== forBrief) return;
      setRecord(r.record);
      if (r.envelope) setEnvelope(r.envelope);
      setIssue(r.issue);
      setDurable(c.durable);
    },
    [c],
  );

  const run = useCallback(
    async (forBrief: string | null, action: () => Promise<CheckoutResult>) => {
      if (!forBrief) return;
      setBusy(true);
      try {
        apply(forBrief, await action());
      } catch (err) {
        // the controller turns every expected failure into an issue; this is the net under it
        if (current.current === forBrief) setIssue({ kind: "UNEXPECTED", status: 0, detail: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const pay = useCallback((quote: Quote) => run(quote.terms.briefId, () => c.pay(quote)), [c, run]);
  const resume = useCallback(() => { setAutoChecks(0); return run(briefId, () => c.resume(briefId!)); }, [c, run, briefId]);
  const reconcile = useCallback(() => run(briefId, () => c.reconcile(briefId!)), [c, run, briefId]);
  const startOver = useCallback(() => {
    if (briefId && c.forget(briefId)) { setRecord(null); setIssue(null); setOrder(null); }
  }, [c, briefId]);

  // a Brief this browser already bought, or was buying: collect it with the claim token. Nothing here signs or sends an authorization.
  useEffect(() => {
    setEnvelope(null); setOrder(null); setIssue(null); setAutoChecks(0);
    const held = briefId ? c.record(briefId) : null;
    setRecord(held);
    if (briefId && held?.orderId && held.status !== "FAILED") void run(briefId, () => c.resume(briefId));
  }, [briefId, c, run]);

  // unknown stays unknown until the chain says otherwise: a bounded number of reads, then the buyer decides when to look again
  const waiting = record?.status === "UNKNOWN" || issue?.kind === "IN_PROGRESS";
  useEffect(() => {
    if (!briefId || !waiting || busy || autoChecks >= AUTO_CHECKS.max) return;
    const id = setTimeout(() => {
      setAutoChecks((n) => n + 1);
      void run(briefId, () => (record?.orderId ? c.reconcile(briefId) : c.resume(briefId)));
    }, AUTO_CHECKS.everyMs);
    return () => clearTimeout(id);
  }, [briefId, waiting, busy, autoChecks, record?.orderId, c, run]);

  // the buyer's own order and receipt, for the console
  const orderId = record?.orderId ?? null;
  const claim = record?.claim ?? null;
  const status = record?.status ?? null;
  useEffect(() => {
    if (!orderId || !claim) { setOrder(null); return; }
    let stop = false;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const row = await api.order(orderId, claim).catch(() => null);
      if (stop) return;
      if (row) { setOrder(row); misses = 0; } else misses += 1;
      // a settled order is read once; a read that keeps failing is given up on rather than hammered
      if (row ? !SETTLED_ORDER_STATES.includes(row.order.state) : misses < 20) timer = setTimeout(tick, row ? 3_000 : 10_000);
    };
    void tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [orderId, claim, status]);

  return { record, envelope, brief: envelope?.brief ?? null, order, issue, busy, durable, autoChecks, pay, resume, reconcile, startOver, dismiss: () => setIssue(null) };
}
