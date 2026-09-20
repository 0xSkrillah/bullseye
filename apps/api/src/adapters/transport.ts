import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, type DataMode, type Sourced } from "@bullseye/domain";
import type { Db } from "../db.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * All external reads go through a transport. A transport has exactly one
 * primary mode and must label what it returns. There is no code path that
 * swaps one mode for another without changing the label.
 */
export interface SourceTransport {
  readonly primaryMode: DataMode;
  /** the instant the data should be considered "now" for freshness checks */
  now(): Date;
  http(key: string, url: string): Promise<Sourced<unknown>>;
  /** read must return a JSON-safe value */
  chain<T>(key: string, url: string, read: () => Promise<T>): Promise<Sourced<T>>;
}

export class SourceUnavailableError extends Error {
  constructor(
    readonly key: string,
    readonly url: string,
    cause: string,
  ) {
    super(`source unavailable [${key}] ${url}: ${cause}`);
  }
}

interface RecordedEntry {
  key: string;
  url: string;
  fetchedAt: string;
  sha256: string;
  body: unknown;
}

function fileFor(dir: string, key: string): string {
  return join(dir, `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
}

/**
 * How long a single source read may take before it is abandoned.
 *
 * The issuer's `price-data` endpoint answers in about 20.1 s while its market is closed — measured
 * twice on 20 September 2026, see SPONSOR_FEEDBACK SF-8 — and what it answers is
 * `{"quote": null}`, meaning no price is published. At a 20 s ceiling that answer never arrived:
 * the read was aborted, and with `allowCached` on it fell back to the last price it had, labelled
 * CACHED. A stale price is a worse answer than "there is no price", so the ceiling leaves headroom
 * over the slowest endpoint the issuer is known to have. One slow read still sits well inside the
 * investigation's 180 s latency budget, which the governor enforces separately.
 */
export const DEFAULT_SOURCE_TIMEOUT_MS = 30_000;

export interface LiveTransportOptions {
  db?: Db;
  /** serve the last good response, labelled CACHED, when the live source fails */
  allowCached: boolean;
  /** when set, every successful live response is also written here for later HISTORICAL replay */
  recordDir?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class LiveTransport implements SourceTransport {
  readonly primaryMode = "LIVE" as const;
  constructor(private readonly opts: LiveTransportOptions) {
    if (opts.recordDir) mkdirSync(opts.recordDir, { recursive: true });
  }

  now(): Date {
    return new Date();
  }

  async http(key: string, url: string): Promise<Sourced<unknown>> {
    const fetchedAt = new Date().toISOString();
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const body: unknown = JSON.parse(text);
      const hash = sha256(text);
      this.remember({ key, url, fetchedAt, sha256: hash, body });
      return { data: body, provenance: { mode: "LIVE", source: sourceName(url), url, fetchedAt, sha256: hash } };
    } catch (err) {
      return this.cachedOrThrow(key, url, err);
    }
  }

  async chain<T>(key: string, url: string, read: () => Promise<T>): Promise<Sourced<T>> {
    const fetchedAt = new Date().toISOString();
    try {
      const body = await read();
      const hash = sha256(canonicalJson(body));
      this.remember({ key, url, fetchedAt, sha256: hash, body });
      return { data: body, provenance: { mode: "LIVE", source: sourceName(url), url, fetchedAt, sha256: hash } };
    } catch (err) {
      return (await this.cachedOrThrow(key, url, err)) as Sourced<T>;
    }
  }

  private remember(entry: RecordedEntry): void {
    this.opts.db
      ?.prepare(
        "INSERT INTO snapshots (key, url, body, sha256, fetched_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET url = excluded.url, body = excluded.body, sha256 = excluded.sha256, fetched_at = excluded.fetched_at",
      )
      .run(entry.key, entry.url, JSON.stringify(entry.body), entry.sha256, entry.fetchedAt);
    if (this.opts.recordDir) writeFileSync(fileFor(this.opts.recordDir, entry.key), JSON.stringify(entry, null, 2));
  }

  private cachedOrThrow(key: string, url: string, err: unknown): Sourced<unknown> {
    const cause = err instanceof Error ? err.message : String(err);
    if (this.opts.allowCached && this.opts.db) {
      const row = this.opts.db.prepare("SELECT url, body, sha256, fetched_at FROM snapshots WHERE key = ?").get(key) as
        | { url: string; body: string; sha256: string; fetched_at: string }
        | undefined;
      if (row) {
        return {
          data: JSON.parse(row.body),
          provenance: {
            mode: "CACHED",
            source: sourceName(row.url),
            url: row.url,
            fetchedAt: row.fetched_at,
            sha256: row.sha256,
            note: `live request failed (${cause.slice(0, 160)}); serving last good response`,
          },
        };
      }
    }
    throw new SourceUnavailableError(key, url, cause);
  }
}

/** Replays a directory written by LiveTransport.recordDir. Everything it returns is HISTORICAL. */
export class RecordedTransport implements SourceTransport {
  readonly primaryMode = "HISTORICAL" as const;
  private readonly capturedAt: Date;

  constructor(private readonly dir: string) {
    const manifest = join(dir, "_manifest.json");
    if (!existsSync(manifest)) throw new Error(`recording manifest not found: ${manifest}`);
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { capturedAt: string };
    this.capturedAt = new Date(parsed.capturedAt);
  }

  now(): Date {
    return this.capturedAt;
  }

  async http(key: string, url: string): Promise<Sourced<unknown>> {
    return this.load(key, url);
  }

  async chain<T>(key: string, url: string): Promise<Sourced<T>> {
    return this.load(key, url) as Sourced<T>;
  }

  private load(key: string, url: string): Sourced<unknown> {
    const file = fileFor(this.dir, key);
    if (!existsSync(file)) throw new SourceUnavailableError(key, url, "not present in recording");
    const entry = JSON.parse(readFileSync(file, "utf8")) as RecordedEntry;
    return {
      data: entry.body,
      provenance: {
        mode: "HISTORICAL",
        source: sourceName(entry.url),
        url: entry.url,
        fetchedAt: entry.fetchedAt,
        sha256: entry.sha256,
        note: "replayed from a recording of the real source response",
      },
    };
  }
}

/** Synthetic responses for tests. Everything it returns is FIXTURE. */
export class FixtureTransport implements SourceTransport {
  readonly primaryMode = "FIXTURE" as const;
  constructor(
    private readonly responses: Record<string, unknown>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  now(): Date {
    return this.clock();
  }

  set(key: string, body: unknown): void {
    this.responses[key] = body;
  }

  remove(key: string): void {
    delete this.responses[key];
  }

  async http(key: string, url: string): Promise<Sourced<unknown>> {
    return this.load(key, url);
  }

  async chain<T>(key: string, url: string): Promise<Sourced<T>> {
    return this.load(key, url) as Sourced<T>;
  }

  private load(key: string, url: string): Sourced<unknown> {
    if (!(key in this.responses)) throw new SourceUnavailableError(key, url, "no fixture registered");
    const body = this.responses[key];
    return {
      data: body,
      provenance: {
        mode: "FIXTURE",
        source: "fixture",
        url: `fixture://${key}`,
        fetchedAt: this.clock().toISOString(),
        sha256: sha256(canonicalJson(body)),
        note: "synthetic test data",
      },
    };
  }
}

function sourceName(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
