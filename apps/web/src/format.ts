const THIN = " ";

/** Integer part grouped with thin spaces: 12884102 -> "12 884 102". */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

export function formatCount(n: number): string {
  return groupThousands(String(Math.trunc(n)));
}

/**
 * A price arrives as a decimal string from QuoteTerms. It is never rounded:
 * zeros beyond the minimum are trimmed, significant digits are kept.
 */
export function formatUsd(usd: number | string, minDecimals: number): string {
  let fixed: string;
  if (typeof usd === "string" && /^\d+(\.\d+)?$/.test(usd)) {
    const [whole = "0", frac = ""] = usd.split(".");
    let kept = frac.replace(/0+$/, "");
    if (kept.length < minDecimals) kept = kept.padEnd(minDecimals, "0");
    fixed = kept ? `${whole}.${kept}` : whole;
  } else {
    const n = Number(usd);
    if (!Number.isFinite(n)) return "—";
    fixed = n.toFixed(minDecimals);
  }
  const negative = fixed.startsWith("-");
  const [whole = "0", frac] = fixed.replace("-", "").split(".");
  const body = frac ? `${groupThousands(whole)}.${frac}` : groupThousands(whole);
  return `${negative ? "−" : ""}$${body}`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(11, 19)}Z`;
}

export function fullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)}Z`;
}

/** The screens pass the ticking clock as a Date; the props contract allows an ISO string. */
export function instantMs(at: Date | string): number {
  return typeof at === "string" ? Date.parse(at) : at.getTime();
}

export function seconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 || Number.isInteger(s) ? String(Math.round(s)) : s.toFixed(1);
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** "CORPORATE_ACTION_REBASE" -> "Corporate action · rebase" */
export function humaniseCategory(category: string): string {
  const words = category.toLowerCase().split("_");
  if (words.length < 2) return capitalise(words.join(" "));
  const tail = words.pop() as string;
  return `${capitalise(words.join(" "))} · ${tail}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function truncateMiddle(value: string, head: number, tail: number): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
