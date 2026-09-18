# Evaluation

## What is tested automatically

`npm test` (Vitest, no network, no keys):

| Suite | What it proves |
| --- | --- |
| `detector.test.ts` | Reproducible output; required SignalEvent fields; versioned identity; ignores unchanged, future, out-of-window and non-X-Layer actions; weakest-mode labelling. |
| `gate.test.ts` | One passing case and a rejecting case for each rule: missing mandatory evidence, stale evidence, advice, unevidenced number, unevidenced timestamp, wrong quantity, unknown evidence id, undisclosed failed check, confidence above cap, fixture inputs, incomplete investigation, malformed draft. The gate is deterministic. |
| `investigation.test.ts` | Signal → published, hash-verified Brief; fixture output is not published unless allowed; no re-investigation; adverse synthesiser behaviours are blocked; tool-call, model-call and cost ceilings stop the run; uneconomic work is declined before spend; a missing model is reported, not substituted. |
| `ledger.test.ts` | Transition table; quote hash survives storage; tampering is detected; one authorization per order; expired quotes refused; illegal transitions leave the order untouched; state survives a restart. |
| `checkout.test.ts` | The OKX client SDK parses Bullseye's challenge, signs it and is served; state walk; replay and concurrent retries settle once; timeout and dropped connection become PAYMENT_UNKNOWN and reconcile without a second settle; explicit failure; invalid signature; immutable quotes; no challenge when the rail cannot settle; economics separation. |
| `transport.test.ts` | LIVE / CACHED / HISTORICAL / FIXTURE labelling; no silent fallback; schema mismatch is an error; the 18 Sep 2026 recording replays and reproduces the on-chain agreement. |
| `apps/web/test/brand.test.ts` | The five brand rules from the design system: estimates never green, badges carry their word, the PAYMENT_UNKNOWN sentence and no pay-again, no total spanning measured and estimated, a price is green only when paid and chain-verified. |
| `apps/web/src/__tests__` | Component contracts, and the wallet signer: nothing is signed when the 402 challenge differs from the quote on screen; one authorization per quote. |

`npm run test:e2e` (Playwright) runs three browser tests against the offline configuration: a draft
with an unevidenced number is held and never offered for sale; the golden path from recorded event
to delivered Brief and receipt, checking that the page renders the delivered JSON and that the
order is bound to the terms hash the buyer saw; and an unknown payment that delivers nothing,
reconciles, and completes with exactly one wallet signature.

`npm run spike` is the live check. It is not part of `npm test` because it needs the network.

## The gate's number rule, precisely

Identifiers (`EV-…`, `CHK-…`, `0x…`, names like `x402`) are ignored. ISO timestamps, dates and
clock times must appear in the cited evidence. Every other number must equal some numeric value
in the cited evidence, its magnitude, or its ×100 percentage form, at the precision written.
Integers from 0 to 12 without a decimal point are treated as prose. Claims are checked against
the evidence they cite; headline, rationale, unknowns, conflicts and limitations are checked
against all evidence. The rule is blunt by design: a false rejection costs one revision, a false
acceptance publishes an unsupported number.

## What is not evaluated

- **Brief quality with the live model.** No live-model Brief has been produced yet, so there is
  no quality evaluation, no rejection-rate figure and no measured cost. Once a key is available:
  run the investigator over every signal in `artifacts/recorded/`, record gate pass rate,
  revision rate, cost and latency per Brief, and have a domain reader grade usefulness blind.
- **Detector recall.** The detector's precision is checked against the chain; nothing measures
  events it misses.
- **Advice filter recall.** The patterns are tested for the phrases they name, not against a corpus.
- **Latency from event to detection.** Not measured; "real-time" is not claimed.
