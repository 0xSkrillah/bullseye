import type { BriefDraft, CheckStatus, Claim, ConsistencyCheck, EvidenceItem, EvidenceKind } from "@bullseye/domain";

/**
 * Numeric grounding: what a figure written in a draft has to be tied to before it may be published.
 *
 * In a claim, every figure written in digits binds to one of that claim's declared quantities, and
 * through it to a named evidence value with a registered unit, its sign and a bounded rounding; or it
 * is a count the gate computes itself (checks, evidence items, on-chain reads).
 *
 * Headline, rationale, unknowns, limitations and conflict descriptions declare no quantities. The
 * guarantee there is weaker: a figure is bound to a unit class, a sign and a precision of some
 * collected evidence value, not to a named metric. A headline can therefore still quote the right
 * kind of number about the wrong thing, as long as that number exists in evidence with that unit.
 *
 * Out of reach for this module: number words without a unit ("the two reads agree"), paraphrase
 * ("roughly doubled"), and names that contain digits ("x402", "v2"), which are skipped as identifiers.
 */

export type UnitClass = "MULTIPLIER" | "PERCENT" | "USD" | "RATIO" | "SECONDS" | "BLOCK" | "CHAIN_ID" | "VERSION" | "SHARES" | "TOKENS" | "COUNT";

export interface FieldSpec {
  unit: UnitClass;
  /** may be negative, and prose may carry the sign as a direction word ("60 seconds before") */
  signed?: boolean;
  /** a fraction that may also be written as a percentage: value x 100 followed by "%" */
  percentOk?: boolean;
}

const MULTIPLIER: FieldSpec = { unit: "MULTIPLIER" };
const PERCENT: FieldSpec = { unit: "PERCENT" };
const USD: FieldSpec = { unit: "USD" };
const FRACTION: FieldSpec = { unit: "RATIO", percentOk: true };
const BLOCK: FieldSpec = { unit: "BLOCK" };
const CHAIN_ID: FieldSpec = { unit: "CHAIN_ID" };
const VERSION: FieldSpec = { unit: "VERSION" };
const TOKENS: FieldSpec = { unit: "TOKENS" };

/**
 * The unit of every numeric key the toolbox writes. Owned by code: a draft cannot widen it, and a
 * numeric key that is missing here cannot support a number at all.
 */
export const VALUE_UNITS: Record<EvidenceKind, Record<string, FieldSpec>> = {
  CORPORATE_ACTION_RECORD: {
    version: VERSION,
    newestVersion: VERSION,
    supersededByVersion: VERSION,
    multiplierOld: MULTIPLIER,
    multiplierNew: MULTIPLIER,
    changePct: { unit: "PERCENT", signed: true },
    grossCashflowUsd: USD,
    netCashflowUsd: USD,
    withholdingTaxRate: FRACTION,
    withholdingTaxPct: PERCENT,
  },
  ISSUER_MULTIPLIER_STATE: { currentMultiplier: MULTIPLIER, pendingMultiplier: MULTIPLIER },
  ONCHAIN_MULTIPLIER_BEFORE: { multiplier: MULTIPLIER, blockNumber: BLOCK, offsetSeconds: { unit: "SECONDS", signed: true }, chainId: CHAIN_ID },
  ONCHAIN_MULTIPLIER_AFTER: { multiplier: MULTIPLIER, blockNumber: BLOCK, offsetSeconds: { unit: "SECONDS", signed: true }, chainId: CHAIN_ID },
  ONCHAIN_MULTIPLIER_LATEST: { multiplier: MULTIPLIER, blockNumber: BLOCK, chainId: CHAIN_ID },
  ONCHAIN_ACTIVATION_BLOCK: {
    searchFromBlock: BLOCK,
    searchToBlock: BLOCK,
    activationBlock: BLOCK,
    lastBlockWithOld: BLOCK,
    lagSecondsVsIssuerEffectiveTime: { unit: "SECONDS", signed: true },
    multiplierBefore: MULTIPLIER,
    multiplierAfter: MULTIPLIER,
    rpcReads: { unit: "COUNT" },
    chainId: CHAIN_ID,
  },
  PROOF_OF_RESERVES: { sharesHeld: { unit: "SHARES" }, surplusShares: { unit: "SHARES", signed: true }, circulatingSupply: TOKENS, coverageRatio: FRACTION },
  REFERENCE_PRICE: { quoteUsd: USD, netCashflowUsd: USD, impliedRebasePctAtCurrentPrice: PERCENT },
  TRADING_STATUS: {},
  SUPPLY: { issuerTotalSupplyAllChains: TOKENS, issuerCirculatingSupplyAllChains: TOKENS, xlayerTotalSupply: TOKENS, xlayerBlockNumber: BLOCK, chainId: CHAIN_ID },
};

export function fieldSpec(kind: EvidenceKind, valueKey: string): FieldSpec | undefined {
  const specs = VALUE_UNITS[kind];
  return specs && Object.hasOwn(specs, valueKey) ? specs[valueKey] : undefined;
}

/** the unit string a draft is asked to use; the first synonym of each class */
export const CANONICAL_UNIT: Record<UnitClass, string> = {
  MULTIPLIER: "multiplier",
  PERCENT: "%",
  USD: "USD",
  RATIO: "ratio",
  SECONDS: "seconds",
  BLOCK: "block",
  CHAIN_ID: "chain id",
  VERSION: "version",
  SHARES: "shares",
  TOKENS: "tokens",
  COUNT: "count",
};

const UNIT_SYNONYMS: Record<UnitClass, readonly string[]> = {
  MULTIPLIER: ["multiplier", "multipliers", "multiple", "x", "×", "factor"],
  PERCENT: ["%", "percent", "pct", "per cent", "percentage", "percentage points"],
  USD: ["usd", "$", "us$", "dollar", "dollars", "us dollar", "us dollars"],
  RATIO: ["ratio", "rate", "fraction"],
  SECONDS: ["seconds", "second", "s", "sec", "secs"],
  BLOCK: ["block", "blocks", "block number", "block height"],
  CHAIN_ID: ["chain id", "chainid", "chain", "id"],
  VERSION: ["version", "v"],
  SHARES: ["shares", "share"],
  TOKENS: ["tokens", "token", "units"],
  COUNT: ["count", "reads", "calls", "rpc reads"],
};

const UNIT_BY_SYNONYM = new Map<string, UnitClass>((Object.entries(UNIT_SYNONYMS) as [UnitClass, readonly string[]][]).flatMap(([unit, names]) => names.map((n): [string, UnitClass] => [n, unit])));

/** what a draft may write for a bare number; never accepted where the unit carries meaning */
const NO_UNIT = new Set(["", "-", "none", "n/a", "na", "number", "integer", "int", "index", "unitless", "dimensionless"]);
const BARE_CLASSES: readonly UnitClass[] = ["MULTIPLIER", "RATIO", "BLOCK", "CHAIN_ID", "VERSION", "COUNT"];

function unitClassesOf(unit: string): UnitClass[] {
  const whole = unit.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const exact = UNIT_BY_SYNONYM.get(whole);
  if (exact) return [exact];
  // "USD per share" is a USD amount: what follows "per" or "/" is the denominator
  const head = whole.split(/\s+per\s+|\//)[0]!.trim();
  const headClass = UNIT_BY_SYNONYM.get(head);
  if (headClass) return [headClass];
  return [...new Set(head.split(" ").flatMap((w) => UNIT_BY_SYNONYM.get(w) ?? []))];
}

export function normaliseUnit(unit: string): UnitClass | null {
  return unitClassesOf(unit)[0] ?? null;
}

/**
 * Whether a quantity's free-text unit names the registered unit of its evidence value. Lenient on
 * wording because nothing binds through this string: text is always bound through the registry.
 */
export function unitAccepted(unit: string, spec: FieldSpec): boolean {
  const accepted: UnitClass[] = spec.percentOk ? [spec.unit, "PERCENT"] : [spec.unit];
  if (NO_UNIT.has(unit.trim().toLowerCase())) return BARE_CLASSES.includes(spec.unit);
  return unitClassesOf(unit).some((c) => accepted.includes(c));
}

/** Generated from the registry so the writing prompt cannot drift from what the gate accepts. Carries key names only, never values. */
export function unitGuide(): string {
  const byUnit = new Map<UnitClass, Set<string>>();
  const fractions = new Set<string>();
  for (const specs of Object.values(VALUE_UNITS)) {
    for (const [key, spec] of Object.entries(specs)) {
      byUnit.set(spec.unit, (byUnit.get(spec.unit) ?? new Set()).add(key));
      if (spec.percentOk) fractions.add(key);
    }
  }
  const lines = [...byUnit].map(([unit, keys]) => `- "${CANONICAL_UNIT[unit]}": ${[...keys].join(", ")}`);
  if (fractions.size > 0) lines.push(`- ${[...fractions].join(", ")} hold a fraction; in text such a value may instead be written as its percentage form followed by "%".`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// tokens

export type SurfaceMarker = "NONE" | "PERCENT" | "USD" | "BPS" | "SCALED" | "UNREADABLE";

export interface NumberToken {
  raw: string;
  /** signed value as written */
  value: number;
  decimals: number;
  /** offset of `raw` in the text it was taken from */
  index: number;
  /** the unit sign or word written against the figure */
  marker: SurfaceMarker;
  negative: boolean;
  /** the written digits without sign, separators or decimal point */
  digits: string;
}

const blank = (m: string) => " ".repeat(m.length);
const ISO_STAMP = /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?\b/g;
// the seconds, a fraction and a trailing Z belong to the time: left behind they would read as stray figures
const TIME_OF_DAY = /\b\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?Z?(?!\w)/g;
// a minus sign is a hyphen-minus, U+2212, or a hyphen or dash that typography puts in its place (U+2010 to U+2013, U+FE63, U+FF0D)
const SIGNED = /^[-−‐‑‒–﹣－]/;
// a figure starts where no word or decimal point runs into it, or directly after a currency code ("USD10")
const NUMBER = /(?:(?<![\w.])|(?<=\busd))[-−‐‑‒–﹣－]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)/gi;

function markerAt(before: string, after: string): { marker: SurfaceMarker; signBeforeCurrency: boolean } {
  const found = new Set<SurfaceMarker>();
  const currency = /([-−‐‑‒–﹣－]\s?)?(?:US\$|\$|\bUSD)\s?$/i.exec(before);
  if (currency || /^\s?(?:USD|US\s+dollars?|dollars?)\b/i.test(after)) found.add("USD");
  if (/^\s?(?:%|(?:percent|per\s+cent|pct|percentage\s+points?)\b)/i.test(after)) found.add("PERCENT");
  if (/^\s?(?:bps|bp|basis\s+points?)\b/i.test(after)) found.add("BPS");
  if (/^(?:[kmb]|mm|bn|\s?(?:thousand|million|billion|trillion))\b/i.test(after)) found.add("SCALED");
  const marker = found.size === 0 ? "NONE" : found.size === 1 ? [...found][0]! : "UNREADABLE";
  return { marker, signBeforeCurrency: Boolean(currency?.[1]) };
}

/**
 * Every figure written in digits, with where it stands and the unit written against it. Evidence and
 * check ids, addresses and names such as "x402" are not figures; timestamps are returned separately.
 */
export function extractNumberTokens(text: string): { numbers: NumberToken[]; timestamps: string[] } {
  const timestamps: string[] = [];
  const keep = (m: string) => {
    timestamps.push(m);
    return blank(m);
  };
  // blanked in place so that offsets still point into the original text
  let scrubbed = text
    .replace(/\b(EV|CHK)-[A-Z0-9-]+\b/g, blank)
    .replace(/\b0x[0-9a-fA-F]+\b/g, blank)
    .replace(ISO_STAMP, keep)
    .replace(TIME_OF_DAY, keep)
    // identifiers such as "x402" or "v2" are names, not quantities; "USD10" is an amount, and nothing that carries a unit is a name
    .replace(/\b(?!usd\d)[A-Za-z]+\d+[A-Za-z0-9]*(?:\.\d+)*(?!\.\d)\b(?!\s?(?:%|percent|per\s+cent|pct|usd|dollars?|bps|basis))/gi, blank);

  const numbers: NumberToken[] = [];
  for (const m of scrubbed.matchAll(NUMBER)) {
    const raw = m[0];
    const plain = raw.replace(SIGNED, "").replace(/,/g, "");
    const magnitude = Number(plain);
    if (!Number.isFinite(magnitude)) continue;
    const [whole = "", fraction = ""] = plain.split(".");
    const { marker, signBeforeCurrency } = markerAt(text.slice(0, m.index), text.slice(m.index + raw.length));
    const negative = SIGNED.test(raw) || signBeforeCurrency;
    numbers.push({ raw, value: negative ? -magnitude : magnitude, decimals: fraction.length, index: m.index, marker, negative, digits: `${whole || "0"}${fraction}` });
  }
  // a digit the pattern above stepped over ("1.2.3") must not pass by being invisible
  for (const n of numbers) scrubbed = scrubbed.slice(0, n.index) + blank(n.raw) + scrubbed.slice(n.index + n.raw.length);
  for (const m of scrubbed.matchAll(/\d+/g)) numbers.push({ raw: m[0], value: Number(m[0]), decimals: 0, index: m.index, marker: "UNREADABLE", negative: false, digits: m[0] });
  numbers.sort((a, b) => a.index - b.index);
  return { numbers, timestamps };
}

// ---------------------------------------------------------------------------------------------
// the words around a figure

interface Word {
  raw: string;
  /** lower-cased, punctuation trimmed */
  whole: string;
  /** `whole` split on hyphens and slashes */
  parts: string[];
}

const trimPunctuation = (w: string) => w.replace(/^[^a-z0-9%$×]+|[^a-z0-9%×]+$/g, "");
const endsClause = (w: Word) => /[,;:)]$/.test(w.raw);

/** the sentence a figure stands in, as words, and the position of the figure's own word */
function sentenceWords(text: string, index: number): { words: Word[]; at: number } {
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(/[.!?;](?=\s|$)/g)) {
    if (m.index < index) from = m.index + 1;
    else {
      to = m.index;
      break;
    }
  }
  const words: Word[] = [];
  let at = -1;
  for (const m of text.slice(from, to).matchAll(/\S+/g)) {
    const start = from + m.index;
    const own = index >= start && index < start + m[0].length;
    if (own) at = words.length;
    // for the figure's own word keep only what is glued to it: "60s", "1.0025x", "60-second"
    const source = own ? m[0].toLowerCase().replace(/[\d.,]+/g, " ") : m[0].toLowerCase();
    words.push({ raw: m[0], whole: trimPunctuation(source.trim()), parts: source.split(/[\s\-/–—]+/).map(trimPunctuation).filter((p) => p.length > 0) });
  }
  return { words, at };
}

const DIRECTION_WINDOW = 6;
/**
 * Words of time say which side of an instant an offset or lag lies on; words of size say which way a
 * change or a surplus goes. Each kind is read only against its own kind of value: "the prior
 * multiplier" says nothing about a percentage, "a lower block" nothing about an offset. "up" and
 * "down" are left out as too common as particles ("down to the record").
 */
export const DIRECTION_WORDS = {
  TIME: { negative: ["before", "earlier", "prior", "ahead"], positive: ["after", "later"] },
  SIZE: {
    negative: ["decrease", "decreased", "decline", "declined", "fell", "fall", "drop", "dropped", "lower", "reduction", "reduced", "negative", "deficit", "shortfall"],
    positive: ["increase", "increased", "rose", "rise", "higher", "gain", "positive", "surplus"],
  },
} as const;

const directionKind = (unit: UnitClass): keyof typeof DIRECTION_WORDS => (unit === "SECONDS" ? "TIME" : "SIZE");
const quoted = (words: readonly string[]) => words.map((w) => `"${w}"`).join(", ");

/** Generated from the word lists the gate reads, so the writing prompt cannot drift from them. One line, no figures. */
export function directionGuide(): string {
  const { TIME, SIZE } = DIRECTION_WORDS;
  return `Direction words within six words of a signed figure, in the same sentence, are read as its sign, and the nearer word decides. For an offset or lag in seconds: ${quoted(TIME.negative)} say negative and ${quoted(TIME.positive)} say positive. For a percentage change or a share surplus: ${quoted(SIZE.negative)} say negative and ${quoted(SIZE.positive)} say positive. Keep the words that say negative away from a positive value, and the words that say positive away from a negative one.`;
}

interface Direction {
  negative: number | null;
  positive: number | null;
  /** the nearest word of each kind that was read, for the rejection reason */
  negativeWord: string | null;
  positiveWord: string | null;
}

const NO_DIRECTION: Direction = { negative: null, positive: null, negativeWord: null, positiveWord: null };

function directionNear(words: Word[], at: number, unit: UnitClass): Direction {
  const d: Direction = { ...NO_DIRECTION };
  const { negative, positive } = DIRECTION_WORDS[directionKind(unit)];
  for (let i = Math.max(0, at - DIRECTION_WINDOW); i <= Math.min(words.length - 1, at + DIRECTION_WINDOW); i++) {
    const distance = Math.abs(i - at);
    for (const p of words[i]!.parts) {
      if ((negative as readonly string[]).includes(p) && (d.negative === null || distance < d.negative)) [d.negative, d.negativeWord] = [distance, p];
      if ((positive as readonly string[]).includes(p) && (d.positive === null || distance < d.positive)) [d.positive, d.positiveWord] = [distance, p];
    }
  }
  return d;
}

/** words that say what a bare figure measures; free text has no declared quantity to say it */
const CONTEXT_WORDS: Record<UnitClass, readonly string[]> = {
  MULTIPLIER: ["multiplier", "multipliers", "multiple", "factor", "x", "×"],
  PERCENT: [],
  USD: [],
  RATIO: ["ratio", "rate", "fraction", "coverage"],
  SECONDS: ["s", "sec", "secs", "second", "seconds"],
  BLOCK: ["block", "blocks", "height"],
  CHAIN_ID: ["chain", "chainid", "network"],
  VERSION: ["version", "versions", "revision"],
  SHARES: ["share", "shares"],
  TOKENS: ["token", "tokens", "supply", "units"],
  COUNT: ["read", "reads", "call", "calls", "rpc"],
};

function contextNear(words: Word[], at: number, unit: UnitClass): boolean {
  const wanted = CONTEXT_WORDS[unit];
  for (let i = Math.max(0, at - DIRECTION_WINDOW); i <= Math.min(words.length - 1, at + DIRECTION_WINDOW); i++) {
    if (words[i]!.parts.some((p) => wanted.includes(p))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// counts the gate computes itself

type CountNoun = "CHECK" | "EVIDENCE" | "READ" | "UNKNOWN" | "CONFLICT" | "LIMITATION";

const COUNT_NOUNS = new Map<string, CountNoun>([
  ["check", "CHECK"],
  ["checks", "CHECK"],
  ["evidence", "EVIDENCE"],
  ["item", "EVIDENCE"],
  ["items", "EVIDENCE"],
  ["source", "EVIDENCE"],
  ["sources", "EVIDENCE"],
  ["record", "EVIDENCE"],
  ["records", "EVIDENCE"],
  ["read", "READ"],
  ["reads", "READ"],
  ["unknown", "UNKNOWN"],
  ["unknowns", "UNKNOWN"],
  ["conflict", "CONFLICT"],
  ["conflicts", "CONFLICT"],
  ["limitation", "LIMITATION"],
  ["limitations", "LIMITATION"],
]);
const STATUS_WORDS = new Map<string, CheckStatus>([
  ["pass", "PASS"],
  ["passed", "PASS"],
  ["passing", "PASS"],
  ["fail", "FAIL"],
  ["failed", "FAIL"],
  ["failing", "FAIL"],
  ["unknown", "UNKNOWN"],
]);
const COUNT_WINDOW = 4;
/** a figure followed by one of these belongs to what came before it, not to a count noun further on */
const WINDOW_STOPS = new Set([
  // not "of": "5 of 5 checks passed" counts checks twice
  ...["in", "at", "on", "from", "by", "per", "for", "with", "to", "than", "and", "or", "but", "across", "until", "while", "when", "as", "is", "was"],
  ...(Object.entries(UNIT_SYNONYMS) as [UnitClass, readonly string[]][]).flatMap(([unit, names]) => (unit === "COUNT" ? [] : names.filter((n) => !n.includes(" ")))),
]);

/** "version", "block", "chain": a figure directly after one of these is that value, whatever noun follows */
const NAMES_A_VALUE = new Set((Object.entries(CONTEXT_WORDS) as [UnitClass, readonly string[]][]).flatMap(([unit, names]) => (unit === "COUNT" ? [] : names)));

const nounOf = (w: Word) => w.parts.map((p) => COUNT_NOUNS.get(p)).find((n) => n !== undefined);
const statusOf = (w: Word) => w.parts.map((p) => STATUS_WORDS.get(p)).find((s) => s !== undefined);

/** "5 of 5 consistency checks passed", "3 evidence items", "0 failed": the noun a whole number counts, if any */
function countContext(words: Word[], at: number): { noun: CountNoun; status: CheckStatus | null } | null {
  if (endsClause(words[at]!)) return null;
  // "version 2 of the record": the declared version, not a count of records
  const before = at > 0 ? words[at - 1]! : null;
  if (before && !endsClause(before) && before.parts.some((p) => NAMES_A_VALUE.has(p))) return null;
  let status: CheckStatus | null = null;
  for (let k = 1; k <= COUNT_WINDOW && at + k < words.length; k++) {
    const w = words[at + k]!;
    if (w.raw.startsWith("(")) break;
    const noun = nounOf(w);
    status ??= statusOf(w) ?? null;
    if (noun) {
      const next = words[at + k + 1];
      // "evidence items", "unknown checks": the noun is the last word of the phrase
      if (next && !endsClause(w) && nounOf(next)) continue;
      if (noun !== "CHECK") return { noun, status: null };
      for (let j = 1; j <= 2 && status === null && !endsClause(words[at + k + j - 1]!) && at + k + j < words.length; j++) status = statusOf(words[at + k + j]!) ?? null;
      return { noun, status };
    }
    // whole words only: "on-chain reads" must not stop at "on"
    if (WINDOW_STOPS.has(w.whole) || endsClause(w)) break;
  }
  // "5 checks passed and 0 failed": the noun was given earlier in the sentence
  return status !== null && words.some((w) => nounOf(w) === "CHECK") ? { noun: "CHECK", status } : null;
}

// ---------------------------------------------------------------------------------------------
// binding a figure to a value

interface Candidate {
  /** evidenceId.valueKey */
  label: string;
  value: number;
  spec: FieldSpec;
}

type Closeness = "EXACT" | "ROUNDED" | "NONE";

function decimalOf(n: number): { digits: bigint; exp: number } | null {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(Math.abs(n)));
  if (!m) return null;
  const fraction = m[2] ?? "";
  return { digits: BigInt(m[1]! + fraction), exp: Number(m[3] ?? 0) - fraction.length };
}

/**
 * Whether the written digits are the value's magnitude, exactly or correctly rounded at the decimals
 * written. Works on the value's shortest decimal form, the one a reader of the evidence sees, so the
 * percentage form of a fraction is a shift of the decimal point and carries no float noise.
 */
function closeness(token: NumberToken, value: number, shift: number): Closeness {
  const v = decimalOf(value);
  if (!v) return "NONE";
  const written = BigInt(token.digits);
  const e = v.exp + shift + token.decimals;
  if (Math.abs(e) > 60) return "NONE";
  if (e >= 0) return written === v.digits * 10n ** BigInt(e) ? "EXACT" : "NONE";
  const p = 10n ** BigInt(-e);
  const q = v.digits / p;
  const r = v.digits % p;
  if (r === 0n) return written === q ? "EXACT" : "NONE";
  // an exact half may be written either way
  const rounded = 2n * r < p ? [q] : 2n * r > p ? [q + 1n] : [q, q + 1n];
  return rounded.includes(written) ? "ROUNDED" : "NONE";
}

function unitFits(marker: SurfaceMarker, spec: FieldSpec, shift: number): boolean {
  if (shift !== 0) return marker === "PERCENT";
  if (marker === "PERCENT") return spec.unit === "PERCENT";
  if (marker === "USD") return spec.unit === "USD";
  return marker === "NONE" && spec.unit !== "PERCENT" && spec.unit !== "USD";
}

/** Signed values are compared, never magnitudes. Only a `signed` field may carry its sign in words. */
function signFits(token: NumberToken, value: number, spec: FieldSpec, direction: Direction): boolean {
  if (value === 0) return !token.negative;
  if (token.negative) return value < 0;
  if (!spec.signed) return value > 0;
  const { negative, positive } = direction;
  if (value < 0) return negative !== null && (positive === null || negative <= positive);
  return !(negative !== null && (positive === null || negative < positive));
}

/** "1" for 1.0033 and "0.3%" for 0.329761 are correct roundings that say something else */
function tooCoarse(token: NumberToken, spec: FieldSpec, how: Closeness): boolean {
  if (how !== "ROUNDED") return false;
  if (token.digits.replace(/^0+/, "").length < 2) return true;
  // a multiplier that moved must not be rounded back onto 1, however many zeros are written
  return spec.unit === "MULTIPLIER" && BigInt(token.digits) === 10n ** BigInt(token.decimals);
}

type Outcome = "NONE" | "UNIT" | "CONTEXT" | "SIGN" | "COARSE" | "BOUND";
const OUTCOME_RANK: Record<Outcome, number> = { NONE: 0, UNIT: 1, CONTEXT: 2, SIGN: 3, COARSE: 4, BOUND: 5 };

interface Surroundings {
  /** by unit, because which words count depends on what the value measures */
  direction: (unit: UnitClass) => Direction;
  /** set for free text, where a bare figure needs a word beside it that says what it measures */
  needsContext: ((unit: UnitClass) => boolean) | null;
}

function bind(token: NumberToken, c: Candidate, around: Surroundings): Outcome {
  let best: Outcome = "NONE";
  for (const shift of c.spec.percentOk ? [0, 2] : [0]) {
    const how = closeness(token, c.value, shift);
    if (how === "NONE") continue;
    const outcome: Outcome = !unitFits(token.marker, c.spec, shift)
      ? "UNIT"
      : token.marker === "NONE" && around.needsContext && !around.needsContext(c.spec.unit)
        ? "CONTEXT"
        : !signFits(token, c.value, c.spec, around.direction(c.spec.unit))
          ? "SIGN"
          : tooCoarse(token, c.spec, how)
            ? "COARSE"
            : "BOUND";
    if (OUTCOME_RANK[outcome] > OUTCOME_RANK[best]) best = outcome;
  }
  return best;
}

const WRITTEN_AS: Record<SurfaceMarker, string> = { NONE: "a bare number", PERCENT: "a percentage", USD: "a USD amount", BPS: "basis points", SCALED: "a scaled figure", UNREADABLE: "an unreadable figure" };

function reasonFor(outcome: Outcome, token: NumberToken, c: Candidate | null, inClaim: boolean, around: Surroundings): string {
  if (!c || outcome === "NONE") return inClaim ? "no declared quantity of this claim has this value; declare it in quantities or remove it" : "no evidence value equals it; remove it or use an evidence value";
  const unit = c.spec.unit;
  const direction = around.direction(unit);
  switch (outcome) {
    case "UNIT":
      return unit === "PERCENT"
        ? `unit mismatch: ${c.label} is a percentage, write it with "%"`
        : unit === "USD"
          ? `unit mismatch: ${c.label} is a USD amount, write "USD" after it or "$" before it`
          : `unit mismatch: ${c.label} is ${unit}, written as ${WRITTEN_AS[token.marker]}${c.spec.percentOk && token.marker !== "PERCENT" ? '; only its percentage form may carry "%"' : ""}`;
    case "CONTEXT":
      return `unit mismatch: ${c.label} is ${unit}, but no word beside the figure says so (for example "${CANONICAL_UNIT[unit]}")`;
    case "SIGN": {
      // the word that was read is named, so that the one revision can move or replace it
      const said = (word: string | null) => (word ? `, but "${word}" near the figure says the opposite` : "");
      return c.value < 0
        ? `sign mismatch: ${c.label} is ${c.value}${c.spec.signed ? said(direction.positiveWord) : ""}; keep the minus sign${c.spec.signed ? ` or put ${directionKind(unit) === "TIME" ? '"before" or "earlier"' : '"lower" or "fell"'} beside the figure` : ""}`
        : token.negative
          ? `sign mismatch: ${c.label} is ${c.value}, not negative`
          : `sign mismatch: ${c.label} is ${c.value}${said(direction.negativeWord)}`;
    }
    case "COARSE":
      return `precision too coarse: ${c.label} is ${c.value}; keep at least two significant digits${unit === "MULTIPLIER" ? " and do not round a changed multiplier to 1" : ""}`;
    default:
      return "bound";
  }
}

// ---------------------------------------------------------------------------------------------
// timestamps

const ISO_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** observedAt, fetchedAt and every string value that is an ISO datetime, without the trailing Z */
function evidenceStamps(items: EvidenceItem[]): string[] {
  const out = new Set<string>();
  for (const e of items) {
    for (const s of [e.observedAt, e.provenance.fetchedAt, ...Object.values(e.values).filter((v): v is string => typeof v === "string")]) {
      if (!ISO_VALUE.test(s) || Number.isNaN(Date.parse(s))) continue;
      out.add(new Date(s).toISOString().replace(/Z$/, ""));
      if (s.endsWith("Z")) out.add(s.replace(/Z$/, ""));
    }
  }
  return [...out];
}

/** equal at the precision written: a prefix that stops where a component stops, never a substring */
const stopsOnComponent = (full: string, written: string) => full === written || (full.startsWith(written) && (full[written.length] === ":" || full[written.length] === "."));

function stampIsEvidenced(written: string, stamps: string[]): boolean {
  if (written.includes("T")) {
    const w = written.replace(/Z$/, "");
    return stamps.some((s) => stopsOnComponent(s, w));
  }
  if (written.includes("-")) return stamps.some((s) => s.slice(0, 10) === written);
  const bare = written.replace(/Z$/, "");
  const w = bare.padStart(bare.indexOf(":") === 1 ? bare.length + 1 : bare.length, "0");
  return stamps.some((s) => stopsOnComponent(s.slice(11), w));
}

// ---------------------------------------------------------------------------------------------
// spelled-out figures

const NUMBER_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|double|triple)";
/**
 * "twelve percent", "two hundred dollars", "half a percent". A figure in words cannot be tied to
 * evidence, so with a unit it is refused. Number words without a unit ("one of the reads") are left
 * alone: refusing them would refuse ordinary prose.
 */
const SPELLED_FIGURE = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+(?:and\\s+)?${NUMBER_WORD})*(?:\\s+an?)?\\s*(?:%|(?:percent|per\\s+cent|percentage\\s+points?|basis\\s+points?|bps|(?:us\\s+)?dollars?|usd)\\b)`, "gi");

// ---------------------------------------------------------------------------------------------
// the binder

export interface GroundingInput {
  draft: BriefDraft;
  evidence: EvidenceItem[];
  checks: ConsistencyCheck[];
}

function candidatesFrom(items: EvidenceItem[]): Candidate[] {
  return items.flatMap((e) =>
    Object.entries(e.values).flatMap(([key, v]): Candidate[] => {
      const spec = fieldSpec(e.kind, key);
      return typeof v === "number" && spec ? [{ label: `${e.id}.${key}`, value: v, spec }] : [];
    }),
  );
}

/**
 * Every figure, timestamp and spelled-out figure in the draft that is not tied to evidence, each as
 * `where: "token" (reason)` so that the one permitted revision knows what to repair. Pure.
 */
export function ungroundedFigures(input: GroundingInput): string[] {
  const { draft, evidence, checks } = input;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const problems: string[] = [];

  const derived = (noun: CountNoun, status: CheckStatus | null, claim: Claim | null, countValues: number[]): number[] => {
    const tally = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
    switch (noun) {
      case "CHECK":
        return status ? [checks.length, tally(status)] : [checks.length, tally("PASS"), tally("FAIL"), tally("UNKNOWN")];
      case "EVIDENCE":
        return [evidence.length, ...(claim ? [new Set(claim.evidenceIds).size] : []), ...[...new Set(evidence.map((e) => e.provenance.mode))].map((m) => evidence.filter((e) => e.provenance.mode === m).length)];
      case "READ":
        // rpcReads is the one evidence value that is itself a count of reads
        return [evidence.filter((e) => e.kind.startsWith("ONCHAIN_MULTIPLIER_")).length, ...countValues];
      case "UNKNOWN":
        return [draft.unknowns.length];
      case "CONFLICT":
        return [draft.conflicts.length];
      case "LIMITATION":
        return [draft.limitations.length];
    }
  };

  const check = (where: string, text: string, candidates: Candidate[], stampItems: EvidenceItem[], claim: Claim | null) => {
    const { numbers, timestamps } = extractNumberTokens(text);
    for (const token of numbers) {
      const fail = (reason: string) => problems.push(`${where}: "${token.raw}" (${reason})`);
      if (token.marker === "BPS") fail("no evidence value is in basis points");
      else if (token.marker === "SCALED") fail("scaled figures cannot be checked; write the evidence value in full");
      else if (token.marker === "UNREADABLE") fail("not readable as one plain figure with one unit");
      else {
        const { words, at } = sentenceWords(text, token.index);
        const counted = at >= 0 && token.marker === "NONE" && !token.negative && token.decimals === 0 ? countContext(words, at) : null;
        if (counted) {
          const allowed = derived(counted.noun, counted.status, claim, candidates.filter((c) => c.spec.unit === "COUNT").map((c) => c.value));
          if (!allowed.includes(token.value)) fail(`not the derived count: the gate counts ${[...new Set(allowed)].join(" or ")} here`);
          continue;
        }
        const around: Surroundings = { direction: (unit) => (at >= 0 ? directionNear(words, at, unit) : NO_DIRECTION), needsContext: claim ? null : (unit) => at >= 0 && contextNear(words, at, unit) };
        let best: Outcome = "NONE";
        let nearest: Candidate | null = null;
        for (const c of candidates) {
          const outcome = bind(token, c, around);
          if (OUTCOME_RANK[outcome] > OUTCOME_RANK[best]) [best, nearest] = [outcome, c];
          if (best === "BOUND") break;
        }
        if (best !== "BOUND") fail(reasonFor(best, token, nearest, claim !== null, around));
      }
    }
    const stamps = evidenceStamps(stampItems);
    for (const ts of timestamps) if (!stampIsEvidenced(ts, stamps)) problems.push(`${where}: "${ts}" (timestamp is not in ${claim ? "the cited evidence" : "the evidence"} at the precision written)`);
    for (const m of text.matchAll(SPELLED_FIGURE)) problems.push(`${where}: "${m[0]}" (write figures as digits taken from evidence)`);
  };

  const sections: [string, Claim[]][] = [
    ["whatHappened", draft.whatHappened],
    ["whyItMayMatter", draft.whyItMayMatter],
    ["onchainObservations", draft.onchainObservations],
  ];
  for (const [section, claims] of sections) {
    for (const claim of claims) {
      const cited = claim.evidenceIds.map((id) => byId.get(id)).filter((e): e is EvidenceItem => e !== undefined);
      // a quantity is a binding only when it names a registered numeric value of an item this claim cites
      const declared = claim.quantities.flatMap((q): Candidate[] => {
        const item = claim.evidenceIds.includes(q.evidenceId) ? byId.get(q.evidenceId) : undefined;
        const value = item?.values[q.valueKey];
        const spec = item ? fieldSpec(item.kind, q.valueKey) : undefined;
        return typeof value === "number" && spec ? [{ label: `${q.evidenceId}.${q.valueKey}`, value, spec }] : [];
      });
      check(section, claim.text, declared, cited, claim);
    }
  }

  const all = candidatesFrom(evidence);
  check("headline", draft.headline, all, evidence, null);
  check("confidence.rationale", draft.confidence.rationale, all, evidence, null);
  draft.unknowns.forEach((t, i) => check(`unknowns[${i}]`, t, all, evidence, null));
  draft.limitations.forEach((t, i) => check(`limitations[${i}]`, t, all, evidence, null));
  draft.conflicts.forEach((c, i) => {
    // a conflict is about one check, so prefer the values that check compared
    const ids = checks.find((k) => k.id === c.checkId)?.evidenceIds ?? [];
    const scoped = ids.map((id) => byId.get(id)).filter((e): e is EvidenceItem => e !== undefined);
    check(`conflicts[${i}]`, c.description, scoped.length > 0 ? candidatesFrom(scoped) : all, evidence, null);
  });
  return problems;
}
