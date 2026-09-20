import type { DataMode } from "@bullseye/domain";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { clockTime, formatCount } from "../format";
import { POLL_MS, type ChainResponse, type Feed, type RebaseChain } from "./data";
import { FeedFoot, Panel } from "./Panel";

export interface EvidenceChainProps {
  /** how many investigations exist; null while unknown. "No reads" is only said when there is no run at all. */
  investigationsOnRecord: number | null;
  focusId?: string | null;
  chain?: PollResult<Feed<ChainResponse>>;
  /** the focused run is RUNNING, so its chain is still being read; a finished run's chain is read once */
  live?: boolean;
  /** the focused run has a Brief on sale; false for a run with none or a withdrawn one; null while the run is not known */
  onSale?: boolean | null;
  withdrawn?: boolean;
}

const SLOTS = ["BEFORE", "ACTIVATION", "AFTER", "HEAD"] as const;
type Slot = (typeof SLOTS)[number];
const X = [34, 106, 178, 262] as const;
const Y = { old: 128, new: 56, other: 92 } as const;
/** the axis is broken between the third and fourth place: the head is usually thousands of blocks later */
const BREAK = [208, 228] as const;
const MODES: readonly string[] = ["LIVE", "CACHED", "HISTORICAL", "FIXTURE"];
/** the chain's name for the `network` the response carries; any other network is printed as it comes */
const NETWORK: Readonly<Record<string, string>> = { "eip155:196": "X Layer", "eip155:1952": "X Layer testnet" };

/** "1", "1.0" and "1.000" are the same multiplier; compared as decimal strings, never as floats */
const norm = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const six = (s: string) => (Number.isFinite(Number(s)) ? Number(s).toFixed(6) : s);

/** the weakest mode among the reads, so one CACHED read never hides behind a LIVE badge */
function weakest(chain: RebaseChain): DataMode | null {
  const modes = [...chain.reads.map((r) => r.mode), ...(chain.activation ? [chain.activation.mode] : [])].filter((m) => MODES.includes(m));
  return (["FIXTURE", "HISTORICAL", "CACHED", "LIVE"] as const).find((m) => modes.includes(m)) ?? null;
}

/** Slots are placed in block order, so "by block" is true even when the chain changed after the AFTER read. A slot with no data keeps its usual place. */
function place(chain: RebaseChain | null): Record<Slot, number> {
  const block = (k: Slot) => (k === "ACTIVATION" ? chain?.activation?.blockNumber : chain?.reads.find((r) => r.key === k)?.blockNumber) ?? null;
  const known = SLOTS.filter((k) => block(k) !== null).sort((a, b) => block(a)! - block(b)!);
  let i = 0;
  const order = SLOTS.map((k) => (block(k) === null ? k : known[i++]!));
  return Object.fromEntries(order.map((k, at) => [k, X[at]])) as Record<Slot, number>;
}

const across = (from: number, to: number, y: number) => (from < BREAK[0] && to > BREAK[1] ? `M${from} ${y} H${BREAK[0]} M${BREAK[1]} ${y} H${to}` : `M${from} ${y} H${to}`);

/**
 * Stage INVESTIGATION, the on-chain part, as a step chart: multiplier() read before and after the
 * effective time and at the head, and the block it changed in. Drawn from
 * GET /api/investigations/:id/chain; never parsed out of timeline prose.
 * A read is green only when it returned what its slot should: the issuer's old multiplier BEFORE,
 * the new one AFTER and at the HEAD. Anything else is a failed check: red, with the value it returned.
 * The line is drawn only where reads support it; an activation block with no agreeing reads is a marker, not a step.
 */
export function EvidenceChain({ investigationsOnRecord, focusId = null, chain, live = false, onSale = null, withdrawn = false }: EvidenceChainProps) {
  const feed = chain?.data ?? null;
  const mine = feed?.state === "ok" && feed.data.investigationId === focusId ? feed.data.chain : null;
  const none = investigationsOnRecord === 0;
  const level = (m: string) => (mine && norm(m) === norm(mine.issuer.multiplierOld) ? "old" : mine && norm(m) === norm(mine.issuer.multiplierNew) ? "new" : "other");
  const agrees = (key: "BEFORE" | "AFTER" | "HEAD", m: string) => mine !== null && norm(m) === norm(key === "BEFORE" ? mine.issuer.multiplierOld : mine.issuer.multiplierNew);
  // a public visitor gets the slots and their modes but no block, value or time: those are what the Brief sells
  const withheld = mine?.withheld === true;
  // why: only a Brief on sale sells them. A run still going has no Brief yet and may never have one.
  const [why, whySaid] = withdrawn ? ["WITHHELD · BRIEF WITHDRAWN", "the blocks and values are withheld; the Brief was withdrawn"]
    : live ? ["WITHHELD WHILE THE RUN MAY STILL PUBLISH", "the blocks and values are withheld while the run may still publish"]
    : onSale ? ["BLOCKS AND VALUES ARE SOLD IN THE BRIEF", "the blocks and values are sold in the Brief"]
    : ["BLOCKS AND VALUES WITHHELD", "the blocks and values are withheld"];
  const reads = (mine?.reads ?? []).flatMap((r) => (r.blockNumber !== null && r.multiplier !== null ? [{ ...r, blockNumber: r.blockNumber, multiplier: r.multiplier }] : []));
  const mode = mine ? weakest(mine) : null;
  const xs = place(mine);

  const act = mine?.activation ?? null;
  const actBlock = act?.blockNumber ?? null;
  const stepX = act ? xs.ACTIVATION : null;
  const before = actBlock !== null ? reads.filter((r) => r.blockNumber < actBlock) : [];
  const after = actBlock !== null ? reads.filter((r) => r.blockNumber >= actBlock).sort((a, b) => a.blockNumber - b.blockNumber) : [];
  const oldHeld = before.length > 0 && before.every((r) => level(r.multiplier) === "old");
  const firstOff = after.findIndex((r) => level(r.multiplier) !== "new");
  const held = firstOff === -1 ? after : after.slice(0, firstOff);
  const newEndX = held.length > 0 ? xs[held[held.length - 1]!.key] : null;
  const path = stepX === null ? "" : [oldHeld ? across(4, stepX, Y.old) : "", newEndX !== null ? across(stepX, newEndX, Y.new) : "", oldHeld && newEndX !== null ? `M${stepX} ${Y.old} V${Y.new}` : ""].join(" ").trim();

  const message = mine ? null : chain?.error && focusId ? { cls: "tick is-bad", text: "✕ no answer" } : feed?.state === "unavailable" ? { cls: "tick", text: "not available yet" } : none ? { cls: "display", text: "NO ON-CHAIN READS" } : null;

  return (
    <Panel
      stage="Evidence chain"
      className="room-chain"
      meta={mode ? <ProvenanceBadge kind={mode} /> : undefined}
      foot={focusId ? <FeedFoot route="…/:id/chain" everyMs={POLL_MS.runningChain} pace={live ? undefined : "read once"} updatedAt={chain?.updatedAt ?? null} error={chain?.error ?? null} unavailable={feed?.state === "unavailable"} /> : undefined}
    >
      <span className="room-line">{mine ? `multiplier() of ${mine.symbol} on ${NETWORK[mine.network] ?? mine.network}, by block` : "multiplier(), by block"}</span>
      <svg
        className="room-svg room-stepchart"
        viewBox="0 0 300 220"
        role="img"
        aria-label={
          mine
            ? withheld
              ? `Evidence chain for ${mine.symbol}: issuer says ${six(mine.issuer.multiplierOld)} to ${six(mine.issuer.multiplierNew)}; ${mine.reads.length} on-chain reads collected${act ? ", activation block found" : ""}; ${whySaid}`
              : `Evidence chain for ${mine.symbol}: issuer says ${six(mine.issuer.multiplierOld)} to ${six(mine.issuer.multiplierNew)}; ${reads.map((r) => `${r.key} read ${six(r.multiplier)} at block ${r.blockNumber}${agrees(r.key, r.multiplier) ? "" : " (does not match the issuer)"}`).join("; ")}; ${actBlock !== null ? `changed in block ${actBlock}` : mine.activationSearched ? "no change found on chain" : "activation block not searched yet"}`
            : none ? "Evidence chain: no on-chain reads on record" : "Evidence chain"
        }
      >
        <line className="axis" x1="0" y1="164" x2="300" y2="164" />
        {message && <text className={message.cls} x="150" y="64" textAnchor="middle">{message.text}</text>}
        {mine && (
          <>
            <text className="tick" x="4" y={Y.old + 20}>{six(mine.issuer.multiplierOld)}</text>
            <text className="tick is-ink" x="296" y={Y.new - 12} textAnchor="end">{six(mine.issuer.multiplierNew)}</text>
            {path && <path className="step" d={path} />}
            {stepX !== null ? <line className="ceiling" x1={stepX} y1="20" x2={stepX} y2="164" /> : <text className="tick is-warn" x="150" y="28" textAnchor="middle">{mine.activationSearched ? "NO CHANGE FOUND ON CHAIN" : "ACTIVATION BLOCK NOT SEARCHED YET"}</text>}
            {withheld && <text className="tick is-ink" x="150" y="98" textAnchor="middle">{why}</text>}
            {/* height in this chart is the multiplier's value: a read whose value is withheld sits on the axis, on neither level */}
            {withheld && mine.reads.map((r) => <rect key={r.key} className="slot is-collected" x={xs[r.key] - 4} y="160" width="8" height="8" />)}
            <path className="break" d={`M${BREAK[0] + 2} 148 l6 16 M${BREAK[0] + 12} 148 l6 16`} />
            {reads.map((r) => {
              const l = level(r.multiplier), ok = agrees(r.key, r.multiplier);
              return (
                <g key={r.key}>
                  <circle className={ok ? "read" : "read is-bad"} cx={xs[r.key]} cy={Y[l]} r="5" />
                  {!ok && <text className="tick is-bad" x={xs[r.key]} y={Y[l] + 18} textAnchor="middle">✕ {six(r.multiplier)}</text>}
                </g>
              );
            })}
          </>
        )}
        {SLOTS.map((k) => {
          const read = k === "ACTIVATION" ? act : mine?.reads.find((r) => r.key === k) ?? null;
          return (
            <g key={k}>
              {!mine && <circle className="slot" cx={xs[k]} cy="112" r="4" />}
              <text className={read ? "lane is-ink" : "lane"} x={xs[k]} y="182" textAnchor="middle">{k}</text>
              <text className="tick" x={xs[k]} y="198" textAnchor="middle">{read && read.blockNumber !== null ? formatCount(read.blockNumber) : read ? read.mode : "—"}</text>
              {read?.blockTime && <text className="tick" x={xs[k]} y="212" textAnchor="middle">{clockTime(read.blockTime)}</text>}
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}
