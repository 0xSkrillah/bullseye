/**
 * Offline fallback: replays the recorded real source responses (HISTORICAL),
 * with the fixture synthesiser and the fixture payment rail. Needs no keys and
 * no network. Every screen and every Brief it produces is labelled accordingly,
 * and nothing it does counts as a payment.
 */
process.env.DATA_SOURCE ??= "recorded";
process.env.SYNTHESIS_PROVIDER ??= "fixture";
process.env.PAYMENT_RAIL ??= "fixture";
process.env.ALLOW_FIXTURE_PUBLICATION ??= "true";
process.env.DB_PATH ??= ":memory:";
// receives nothing: the fixture rail never touches a chain
process.env.PAY_TO_ADDRESS ??= "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

await import("./main.js");

export {};
