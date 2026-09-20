/**
 * Exact decimal arithmetic for the Market Desk.
 *
 * Every figure the desk shows is derived here, from decimal strings, by integer arithmetic on
 * BigInt at a fixed internal scale. Nothing is computed in binary floating point, because a
 * multiplier of 1.0066516577977895 and a price of 72.75 cannot both be held exactly as doubles,
 * and no figure a buyer reads may depend on which order the rounding happened in.
 *
 * Two rules the rest of the module depends on:
 *
 *   1. A value that does not parse is never repaired. `parse` throws rather than guess what
 *      "1,024.5", "1e21" or "" was supposed to mean, and every caller is a code path that would
 *      otherwise publish a number nobody can check.
 *   2. Rounding happens once, at the end, in `format`, and the caller says how many places it
 *      wants. Intermediate results keep all 36 places.
 *
 * `equalsAtChainPrecision` is the one comparison that deliberately rounds first: an on-chain
 * multiplier is an 18-decimal integer, and comparing it with the issuer's published decimal at
 * that same precision is what `apps/api/src/evidence/checks.ts` already does.
 */
import { parseUnits } from "viem";

/** places kept inside every intermediate result; wide enough that a ratio of two 18-decimal values is exact */
export const INTERNAL_PLACES = 36;
const SCALE = 10n ** BigInt(INTERNAL_PLACES);

/** the precision an on-chain multiplier is stored at */
export const CHAIN_PLACES = 18;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalError";
  }
}

/** a value scaled by 10^INTERNAL_PLACES. Opaque on purpose: arithmetic goes through this module. */
export type Decimal = bigint;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_STRING.test(value);
}

/**
 * Parses a plain decimal string. Rejects exponent notation, thousands separators, whitespace,
 * the empty string, and more than INTERNAL_PLACES decimal places: truncating a value the source
 * really sent would be a silent loss, and the caller needs to know its source is out of contract.
 */
export function parse(value: string, what = "value"): Decimal {
  if (!isDecimalString(value)) {
    throw new DecimalError(`${what} is not a plain decimal string: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > INTERNAL_PLACES) {
    throw new DecimalError(`${what} has ${fraction.length} decimal places, more than the ${INTERNAL_PLACES} this desk carries exactly: ${value}`);
  }
  const scaled = BigInt(whole + fraction.padEnd(INTERNAL_PLACES, "0"));
  return negative ? -scaled : scaled;
}

/**
 * Parses a JSON number. The desk prefers decimal strings and most of its sources publish them,
 * but the issuer's price and multiplier endpoints publish JSON numbers, so a number has to be
 * accepted somewhere. It is accepted here, once, and only when its shortest round-trip form is a
 * plain decimal: a value that JSON.stringify renders as 1e+21 or 5e-7 is refused rather than
 * reinterpreted, and a non-finite value never becomes a figure on screen.
 */
export function fromNumber(value: number, what = "value"): Decimal {
  if (!Number.isFinite(value)) throw new DecimalError(`${what} is not a finite number: ${String(value)}`);
  const text = String(value);
  if (!DECIMAL_STRING.test(text)) {
    throw new DecimalError(`${what} is a number this desk will not read as a decimal (${text}); the source should publish a decimal string`);
  }
  return parse(text, what);
}

/** accepts either shape, so a caller can hand over whatever its source published */
export function from(value: string | number, what = "value"): Decimal {
  return typeof value === "number" ? fromNumber(value, what) : parse(value, what);
}

export const ZERO: Decimal = 0n;

export function add(a: Decimal, b: Decimal): Decimal {
  return a + b;
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return a - b;
}

export function mul(a: Decimal, b: Decimal): Decimal {
  // both operands carry the scale, so the product carries it twice; divide it out with half-up rounding
  return divideRounded(a * b, SCALE);
}

export function div(a: Decimal, b: Decimal, what = "divisor"): Decimal {
  if (b === 0n) throw new DecimalError(`cannot divide by zero (${what})`);
  return divideRounded(a * SCALE, b);
}

export function isZero(a: Decimal): boolean {
  return a === 0n;
}

export function isNegative(a: Decimal): boolean {
  return a < 0n;
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function abs(a: Decimal): Decimal {
  return a < 0n ? -a : a;
}

/** integer division, rounding halves away from zero, so -0.5 and 0.5 round to -1 and 1 alike */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const twiceRemainder = (n % d) * 2n;
  const rounded = twiceRemainder >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Renders the value at `places` decimals, rounding halves away from zero. This is the only place
 * a figure loses precision, and the figure is always rendered from the full-precision value, never
 * from an already-rounded one.
 */
export function format(value: Decimal, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > INTERNAL_PLACES) {
    throw new DecimalError(`cannot render at ${places} decimal places`);
  }
  const shift = 10n ** BigInt(INTERNAL_PLACES - places);
  const rounded = divideRounded(value, shift);
  const negative = rounded < 0n;
  const digits = (negative ? -rounded : rounded).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places) || "0";
  const fraction = places === 0 ? "" : `.${digits.slice(digits.length - places)}`;
  // a value that rounds to zero prints as zero, never as "-0"
  const text = `${whole}${fraction}`;
  return negative && /[1-9]/.test(digits) ? `-${text}` : text;
}

/** renders at `places` and then drops trailing zeros, for a figure whose scale is not fixed by a unit */
export function formatTrimmed(value: Decimal, places: number): string {
  const text = format(value, places);
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------- derived figures

/** a / b, rendered at `places`. The divisor is named so a zero says which input was missing. */
export function ratio(a: string | number, b: string | number, places = CHAIN_PLACES): string {
  return formatTrimmed(div(from(a, "numerator"), from(b, "denominator"), "denominator"), places);
}

/** b - a, keeping the sign: a fall is negative and is shown as one. */
export function signedDiff(a: string | number, b: string | number, places = CHAIN_PLACES): string {
  return formatTrimmed(sub(from(b, "later value"), from(a, "earlier value")), places);
}

/**
 * (to / from - 1) x 100, the change as a percentage of `from`.
 *
 * Note which way round this is: the percentage a value rose by is not the percentage the old value
 * sat below the new one. A multiplier moving 1 to 1.0066516577977895 is +0.66516577977895% here,
 * while a cache still holding the old balance understates the new one by 0.6607... %. The desk
 * shows both, from this one function, called in both directions.
 */
export function pctChange(from_: string | number, to: string | number, places = 12): string {
  const start = from(from_, "starting value");
  if (start === 0n) throw new DecimalError("cannot express a change as a percentage of zero");
  const hundred = parse("100");
  return formatTrimmed(mul(sub(div(from(to, "ending value"), start), parse("1")), hundred), places);
}

/** a x b, rendered at `places`; used for a balance times a price */
export function product(a: string | number, b: string | number, places = 2): string {
  return format(mul(from(a, "left"), from(b, "right")), places);
}

/**
 * Exact equality at the precision the chain stores a multiplier at. The issuer publishes a decimal
 * string and the chain an 18-decimal integer; comparing them at 18 places is the comparison that
 * means something. Values that cannot be parsed are not equal to anything.
 */
export function equalsAtChainPrecision(a: string, b: string): boolean {
  try {
    return parseUnits(a, CHAIN_PLACES) === parseUnits(b, CHAIN_PLACES);
  } catch {
    return false;
  }
}

/** the same comparison, for callers that hold either shape */
export function exactEquals(a: string | number, b: string | number): boolean {
  const text = (v: string | number) => (typeof v === "number" ? String(v) : v);
  const left = text(a);
  const right = text(b);
  if (!isDecimalString(left) || !isDecimalString(right)) return false;
  return equalsAtChainPrecision(left, right);
}
