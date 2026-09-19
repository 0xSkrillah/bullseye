import { describe, expect, it } from "vitest";
import type { Quote } from "@bullseye/domain";
import type { OrderRow, PaidReply } from "../lib/api";
import type { Signer } from "../lib/pay";
import { browserStore, Checkout, type CheckoutHttp, type PurchaseStore } from "../checkout/purchase";

const BRIEF = "brf_0123456789abcdef";
const NOW = new Date("2026-09-19T12:00:00.000Z");

function quote(id = "quo_aaaaaaaaaaaaaaaa", expiresAt = "2026-09-19T12:10:00.000Z"): Quote {
  return {
    id,
    termsHash: "b".repeat(64),
    terms: {
      briefId: BRIEF, briefContentHash: "a".repeat(64), priceUsd: "3.00", amount: "3000000", asset: `0x${"1".repeat(40)}`, assetName: "USDT0", assetDecimals: 6, network: "eip155:1952",
      payTo: `0x${"2".repeat(40)}`, scheme: "exact", maxTimeoutSeconds: 300, extra: {}, rail: "OKX_X402_TESTNET", resource: `http://localhost:4402/api/v1/briefs/${BRIEF}`, issuedAt: "2026-09-19T12:00:00.000Z", expiresAt,
    },
  };
}

type Mode = "ok" | "unknown" | "insufficient" | "wrong_content";

/** The seller as the browser sees it: one order per authorization, settled at most once, answered only to the claim it was opened with. */
class FakeSeller implements CheckoutHttp {
  mode: Mode = "ok";
  chainConfirms = false;
  /** the next answer to a paid request is processed and then lost on the way back */
  dropNextReply = false;
  settles = 0;
  paidRequests = 0;
  readonly orders = new Map<string, { id: string; claim: string | undefined; state: "PAYMENT_UNKNOWN" | "PAID" | "DELIVERED" | "PAYMENT_FAILED" }>();

  private reply(status: number, body: unknown, orderId: string | null = null, challenge: string | null = null): PaidReply {
    return { status, body, orderId, challenge, claim: null, retryAfterSeconds: null };
  }

  private envelope(orderId: string) {
    const q = quote();
    return { schema: "bullseye.delivery/v1", orderId, state: "DELIVERED", quote: { id: q.id, termsHash: q.termsHash, terms: q.terms }, payment: null, brief: { contentHash: this.mode === "wrong_content" ? "f".repeat(64) : "a".repeat(64) } };
  }

  async paidBrief(_briefId: string, _quoteId: string, signature?: string, claim?: string): Promise<PaidReply> {
    if (!signature) return this.reply(402, { bullseye: {} }, null, "challenge-for-the-quote");
    this.paidRequests += 1;
    let order = this.orders.get(signature);
    if (!order) {
      if (this.mode === "insufficient") return this.reply(402, { error: "payment invalid: insufficient_funds" }, null, "challenge");
      this.settles += 1;
      order = { id: `ord_${String(this.orders.size + 1).padStart(16, "0")}`, claim, state: this.mode === "unknown" ? "PAYMENT_UNKNOWN" : "PAID" };
      this.orders.set(signature, order);
    } else if (order.claim !== claim) return this.reply(403, { error: "claim_token_required" });
    if (this.dropNextReply) {
      this.dropNextReply = false;
      if (order.state === "PAID") order.state = "DELIVERED";
      throw new TypeError("Failed to fetch");
    }
    return this.answer(order);
  }

  private answer(order: { id: string; state: string }): PaidReply {
    if (order.state === "PAYMENT_UNKNOWN") {
      if (!this.chainConfirms) return this.reply(503, { error: "payment_outcome_unknown", orderId: order.id }, order.id);
      order.state = "PAID";
    }
    order.state = "DELIVERED";
    return this.reply(200, this.envelope(order.id), order.id);
  }

  async delivery(orderId: string, claim: string): Promise<PaidReply> {
    const order = [...this.orders.values()].find((o) => o.id === orderId);
    if (!order || order.claim !== claim) return this.reply(403, { error: "claim_token_required" });
    return this.answer(order);
  }

  async reconcile(orderId: string, claim: string): Promise<OrderRow> {
    const order = [...this.orders.values()].find((o) => o.id === orderId);
    if (!order || order.claim !== claim) throw new Error("api 403");
    if (order.state === "PAYMENT_UNKNOWN" && this.chainConfirms) order.state = "PAID";
    return { order: { state: order.state } } as unknown as OrderRow;
  }
}

function wallet() {
  let n = 0;
  const signer: Signer = { sign: async () => `signature-${++n}` };
  return { signer, signatures: () => n };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
}

const desk = (seller: FakeSeller, store: PurchaseStore, signer: Signer | undefined) => new Checkout({ http: seller, store, signer: () => signer, now: () => NOW });

describe("a browser purchase", () => {
  it("chooses its claim token before signing, sends it with the payment, and ends DELIVERED with the order id", async () => {
    const seller = new FakeSeller();
    const w = wallet();
    const out = await desk(seller, browserStore(memoryStorage()), w.signer).pay(quote());
    expect(out.issue).toBeNull();
    expect(out.record).toMatchObject({ status: "DELIVERED", orderId: "ord_0000000000000001", paymentSignature: "signature-1" });
    expect(out.record!.claim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...seller.orders.values()][0]!.claim).toBe(out.record!.claim);
    expect(out.envelope?.orderId).toBe("ord_0000000000000001");
  });

  it("keeps two browsers buying the same Brief apart: own claim, own order, and neither can collect the other's", async () => {
    const seller = new FakeSeller();
    const a = await desk(seller, browserStore(memoryStorage()), wallet().signer).pay(quote());
    const bWallet: Signer = { sign: async () => "signature-of-b" };
    const b = await desk(seller, browserStore(memoryStorage()), bWallet).pay(quote());
    expect(a.record!.orderId).not.toBe(b.record!.orderId);
    expect(a.record!.claim).not.toBe(b.record!.claim);
    expect((await seller.delivery(b.record!.orderId!, a.record!.claim)).status).toBe(403);
    expect(seller.settles).toBe(2);
  });

  it("signs once and pays once when Pay is pressed twice", async () => {
    const seller = new FakeSeller();
    const w = wallet();
    const c = desk(seller, browserStore(memoryStorage()), w.signer);
    const [first, second] = await Promise.all([c.pay(quote()), c.pay(quote())]);
    expect(second).toBe(first);
    expect(w.signatures()).toBe(1);
    expect(seller.paidRequests).toBe(1);
    expect(seller.settles).toBe(1);
  });

  it("recovers the same order and Brief when the first paid response is lost, without a second signature", async () => {
    const seller = new FakeSeller();
    seller.dropNextReply = true;
    const w = wallet();
    const c = desk(seller, browserStore(memoryStorage()), w.signer);
    const lost = await c.pay(quote());
    expect(lost.issue?.kind).toBe("NO_ANSWER");
    expect(lost.record).toMatchObject({ status: "SUBMITTED", orderId: null, paymentSignature: "signature-1" });

    // pressing Pay again, even on a brand-new quote, resumes the purchase that is already out there
    const again = await c.pay(quote("quo_bbbbbbbbbbbbbbbb"));
    expect(again.record).toMatchObject({ status: "DELIVERED", orderId: "ord_0000000000000001" });
    expect(again.envelope).not.toBeNull();
    expect(w.signatures()).toBe(1);
    expect(seller.settles).toBe(1);
  });

  it("retrieves a delivered Brief after a reload with the claim token alone: no wallet, no signature, no payment", async () => {
    const seller = new FakeSeller();
    const storage = memoryStorage();
    await desk(seller, browserStore(storage), wallet().signer).pay(quote());

    const reloaded = desk(seller, browserStore(storage), undefined);
    const back = await reloaded.resume(BRIEF);
    expect(back.issue).toBeNull();
    expect(back.record?.status).toBe("DELIVERED");
    expect(back.envelope?.orderId).toBe("ord_0000000000000001");
    expect(seller.paidRequests).toBe(1);
    expect(seller.settles).toBe(1);
  });

  it("does not sign again because storage refused the write", async () => {
    const seller = new FakeSeller();
    seller.dropNextReply = true;
    const w = wallet();
    const broken = { getItem: () => null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); }, removeItem: () => undefined };
    const c = desk(seller, browserStore(broken), w.signer);
    expect((await c.pay(quote())).issue?.kind).toBe("NO_ANSWER");
    expect(c.durable).toBe(false);
    const again = await c.pay(quote());
    expect(again.record?.status).toBe("DELIVERED");
    expect(w.signatures()).toBe(1);
    expect(seller.settles).toBe(1);
  });

  it("leaves an unknown outcome unknown until the chain answers, and never offers the wallet a second authorization", async () => {
    const seller = new FakeSeller();
    seller.mode = "unknown";
    const w = wallet();
    const c = desk(seller, browserStore(memoryStorage()), w.signer);
    const unknown = await c.pay(quote());
    expect(unknown.issue?.kind).toBe("OUTCOME_UNKNOWN");
    expect(unknown.record).toMatchObject({ status: "UNKNOWN", orderId: "ord_0000000000000001" });
    expect(unknown.envelope).toBeNull();

    expect((await c.reconcile(BRIEF)).record?.status).toBe("UNKNOWN");
    expect((await c.pay(quote("quo_cccccccccccccccc"))).record?.status).toBe("UNKNOWN");
    expect(c.forget(BRIEF)).toBe(false);

    seller.chainConfirms = true;
    const settled = await c.reconcile(BRIEF);
    expect(settled.record?.status).toBe("DELIVERED");
    expect(settled.envelope?.orderId).toBe("ord_0000000000000001");
    expect(w.signatures()).toBe(1);
    expect(seller.settles).toBe(1);
  });

  it("is refused with a wrong claim token, and says so without signing anything", async () => {
    const seller = new FakeSeller();
    const storage = memoryStorage();
    const bought = await desk(seller, browserStore(storage), wallet().signer).pay(quote());
    const tampered = browserStore(storage);
    tampered.put({ ...bought.record!, claim: "x".repeat(43) });
    const w = wallet();
    const out = await desk(seller, tampered, w.signer).resume(BRIEF);
    expect(out.issue?.kind).toBe("CLAIM_REFUSED");
    expect(out.envelope).toBeNull();
    expect(w.signatures()).toBe(0);
  });
});

describe("a purchase that charges nothing says so", () => {
  it("a declined signature, a wallet on the wrong network and a terms mismatch each leave nothing signed and nothing sent", async () => {
    for (const [thrown, kind] of [
      [Object.assign(new Error("Signature declined in the wallet."), { name: "WalletError", code: "DECLINED" }), "WALLET_DECLINED"],
      [Object.assign(new Error("The wallet did not switch to chain id 1952."), { name: "WalletError", code: "NETWORK_NOT_SWITCHED" }), "WRONG_NETWORK"],
      [Object.assign(new Error("The wallet has no network with chain id 1952."), { name: "WalletError", code: "NETWORK_MISSING" }), "WRONG_NETWORK"],
      [Object.assign(new Error("The wallet could not sign as 0xabc."), { name: "WalletError", code: "SIGN_FAILED" }), "WALLET_ERROR"],
      [Object.assign(new Error("The payment requirements differ from the quoted terms."), { name: "QuoteMismatchError" }), "QUOTE_MISMATCH"],
    ] as const) {
      const seller = new FakeSeller();
      const out = await desk(seller, browserStore(memoryStorage()), { sign: async () => { throw thrown; } }).pay(quote());
      expect(out.issue?.kind, kind).toBe(kind);
      expect(out.record).toMatchObject({ status: "INTENT", paymentSignature: null });
      expect(seller.paidRequests).toBe(0);
    }
  });

  it("lets the buyer be asked again after declining, because nothing was signed", async () => {
    const seller = new FakeSeller();
    let declined = false;
    const signer: Signer = { sign: async () => { if (!declined) { declined = true; throw Object.assign(new Error("declined"), { name: "WalletError", code: "DECLINED" }); } return "signature-after-decline"; } };
    const c = desk(seller, browserStore(memoryStorage()), signer);
    const first = await c.pay(quote());
    const second = await c.pay(quote());
    expect(first.issue?.kind).toBe("WALLET_DECLINED");
    expect(second.record?.status).toBe("DELIVERED");
    expect(second.record?.claim).toBe(first.record?.claim);
  });

  it("without a wallet hands back the challenge for an agent buyer and signs nothing", async () => {
    const seller = new FakeSeller();
    const out = await desk(seller, browserStore(memoryStorage()), undefined).pay(quote());
    expect(out.issue).toEqual({ kind: "NO_WALLET", challenge: "challenge-for-the-quote" });
    expect(out.record?.status).toBe("INTENT");
    expect(seller.paidRequests).toBe(0);
  });

  it("does not ask for a challenge on a quote that has already expired", async () => {
    const seller = new FakeSeller();
    const w = wallet();
    const out = await desk(seller, browserStore(memoryStorage()), w.signer).pay(quote("quo_dddddddddddddddd", "2026-09-19T11:59:59.000Z"));
    expect(out.issue?.kind).toBe("QUOTE_EXPIRED");
    expect(w.signatures()).toBe(0);
  });

  it("names insufficient funds, marks the purchase failed, and only then allows a new authorization", async () => {
    const seller = new FakeSeller();
    seller.mode = "insufficient";
    const w = wallet();
    const c = desk(seller, browserStore(memoryStorage()), w.signer);
    const out = await c.pay(quote());
    expect(out.issue?.kind).toBe("INSUFFICIENT_FUNDS");
    expect(out.record?.status).toBe("FAILED");
    expect(seller.settles).toBe(0);

    seller.mode = "ok";
    const retry = await c.pay(quote("quo_eeeeeeeeeeeeeeee"));
    expect(retry.record).toMatchObject({ status: "DELIVERED", paymentSignature: "signature-2" });
    expect(seller.settles).toBe(1);
  });

  it("does not show a delivery whose content hash is not the one that was quoted", async () => {
    const seller = new FakeSeller();
    seller.mode = "wrong_content";
    const out = await desk(seller, browserStore(memoryStorage()), wallet().signer).pay(quote());
    expect(out.issue?.kind).toBe("CONTENT_MISMATCH");
    expect(out.envelope).toBeNull();
    expect(out.record?.status).toBe("PAID");
  });
});

describe("what the browser keeps", () => {
  it("is the order id, the immutable quote, the claim token and the signed authorization, and no key", async () => {
    const storage = memoryStorage();
    const out = await desk(new FakeSeller(), browserStore(storage), wallet().signer).pay(quote());
    const kept = JSON.parse(storage.getItem(`bullseye.purchase.v1:${BRIEF}`)!);
    expect(kept).toMatchObject({ v: 1, briefId: BRIEF, orderId: out.record!.orderId, claim: out.record!.claim, paymentSignature: "signature-1", quote: { id: "quo_aaaaaaaaaaaaaaaa", termsHash: "b".repeat(64) } });
    expect(JSON.stringify(kept)).not.toMatch(/privateKey|mnemonic|seed/i);
    expect(storage.size()).toBe(1);
  });
});
