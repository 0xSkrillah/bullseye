/**
 * Canonical JSON: object keys sorted, no whitespace, undefined dropped.
 * Only JSON-safe values are accepted so that a value hashes the same before
 * and after a storage round trip. Numbers must be finite; bigint, Date and
 * other non-JSON values are rejected rather than coerced.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return value;
    case "object": {
      if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalise(v)));
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error("canonicalJson: only plain objects are supported");
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v !== undefined) out[key] = normalise(v);
      }
      return out;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}
