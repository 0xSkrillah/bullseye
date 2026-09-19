import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What an agent buyer must not lose between signing and delivery: the claim token it chose and the
 * one authorization it signed. Written before the authorization is sent, so a crash, a timeout or a
 * closed terminal leads back to the same purchase instead of to a second signature.
 *
 * The files hold a claim token and a signed authorization. They live under data/, which is
 * git-ignored, and nothing in them is ever printed.
 */
export interface PurchaseEntry {
  v: 1;
  base: string;
  briefId: string;
  /** the paid resource that was called, e.g. /api/v1/briefs/brf_… */
  path: string;
  quoteId: string | null;
  termsHash: string | null;
  payer: string;
  claim: string;
  /** header name → value, exactly as sent */
  paymentHeaders: Record<string, string>;
  orderId: string | null;
  /** SIGNED: not known to have been sent. UNKNOWN: the seller does not know the outcome. FAILED: the seller says nothing was charged. */
  state: "SIGNED" | "UNKNOWN" | "DELIVERED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

export const JOURNAL_DIR = join("data", "purchases");

const same = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

function readAll(dir: string): { file: string; entry: PurchaseEntry }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; entry: PurchaseEntry }[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), "utf8")) as PurchaseEntry;
      if (entry.v === 1 && typeof entry.claim === "string" && typeof entry.base === "string") out.push({ file: join(dir, name), entry });
    } catch {
      // a file this script did not write, or a half-written one: not a purchase it can resume
    }
  }
  return out.sort((a, b) => (a.entry.createdAt < b.entry.createdAt ? 1 : -1));
}

/** the newest purchase of this Brief, at this seller, by this payer, that may have been paid and has not been delivered */
export function findOpen(dir: string, base: string, briefId: string, payer: string): { file: string; entry: PurchaseEntry } | null {
  return readAll(dir).find(({ entry }) => same(entry.base, base) && entry.briefId === briefId && entry.payer.toLowerCase() === payer.toLowerCase() && (entry.state === "SIGNED" || entry.state === "UNKNOWN")) ?? null;
}

export function findByOrder(dir: string, orderId: string): { file: string; entry: PurchaseEntry } | null {
  return readAll(dir).find(({ entry }) => entry.orderId === orderId) ?? null;
}

/** Throws if the entry cannot be written: the caller must then not send what it signed. */
export function record(dir: string, entry: PurchaseEntry, file?: string): string {
  mkdirSync(dir, { recursive: true });
  const target = file ?? join(dir, `${entry.briefId}-${entry.createdAt.replace(/[:.]/g, "-")}.json`);
  const next = { ...entry, updatedAt: new Date().toISOString() };
  // written whole or not at all, so a crash never leaves half a claim token behind
  writeFileSync(`${target}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
  return target;
}
