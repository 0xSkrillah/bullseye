/** Shared helpers for the command-line scripts. */

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/**
 * Reads a private key from the environment without ever echoing it.
 * Accepts 64 hex characters with or without the 0x prefix, and tolerates quotes and whitespace.
 */
export function readPrivateKey(name: string): `0x${string}` {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new ScriptError(`BLOCKED: ${name} is not set. Put a throwaway X Layer TESTNET key in .env (64 hex characters, with or without 0x).`, 2);
  }
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
  const hex = cleaned.startsWith("0x") || cleaned.startsWith("0X") ? cleaned.slice(2) : cleaned;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new ScriptError(`BLOCKED: ${name} is set but is not a private key: expected 64 hex characters (optionally prefixed with 0x), got ${hex.length} characters${/^[0-9a-fA-F]*$/.test(hex) ? "" : " including non-hex characters"}. The value was not printed.`, 2);
  }
  return `0x${hex}`;
}

/** fetch that turns "nothing is listening" into a sentence instead of a stack trace */
export async function api(base: string, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, init);
  } catch (err) {
    const code = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
    const refused = code?.code === "ECONNREFUSED" || code?.errors?.some((e) => e.code === "ECONNREFUSED");
    if (refused) {
      throw new ScriptError(`The Bullseye API is not running at ${base}. Start it in another terminal and leave it running:\n\n    npm run dev            (live)\n    npm run start:offline  (recorded data, no keys)\n\nthen run this command again.`, 2);
    }
    throw err;
  }
}

/** Top-level-await scripts call this once: known failures print one message instead of a stack trace. */
export function friendlyErrors(): void {
  process.on("uncaughtException", (err) => {
    if (err instanceof ScriptError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(err);
    process.exit(1);
  });
}
