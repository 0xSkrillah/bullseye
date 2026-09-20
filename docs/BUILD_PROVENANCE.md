# Build provenance

What was built, when, from what, and how to check it. Written for the OKX Dev Day 2026 review
team ("Judges assess only the work completed during the official build period").

## Build period and prior work

- Official build period: 17–25 September 2026. Submission deadline 25 September 2026, 23:59 UTC.
- This repository was initialised on **18 September 2026**. The commit history is the record of
  the work; nothing in it predates the build period.
- **Prior work: none.** Before 18 September the project consisted of planning documents only
  (a product dossier and an implementation brief, the latter kept in
  [IMPLEMENTATION_BRIEF.md](IMPLEMENTATION_BRIEF.md)). No code, schemas, prompts or designs were
  carried in from an earlier project.
- Team: one person (solo entry).

## What was built during the period

| Area | Where |
| --- | --- |
| Domain schemas, order state machine, canonical hashing | `packages/domain` |
| xStocks and X Layer adapters with LIVE / CACHED / HISTORICAL / FIXTURE transports | `apps/api/src/adapters` |
| Deterministic rebase detector | `apps/api/src/signals` |
| Evidence tools and consistency checks | `apps/api/src/evidence` |
| Budget governor, investigator, prompts, model providers (OpenRouter, Anthropic), provider factory and test double | `apps/api/src/research` |
| Publication gate | `apps/api/src/gate` |
| Order ledger, x402 checkout, payment rail adapter, reconciliation | `apps/api/src/commerce` |
| Delivery economics | `apps/api/src/economics` |
| Design system (tokens, component contracts, screens, UI copy) | `docs/design-system` |
| Web app | `apps/web` |
| Spike (`spike.ts`), recorder (`record.ts`), agent buyer (`buy-brief.ts`) and its spend guard (`spend-guard.ts`), payment verifier (`verify-payment.ts`), demo driver (`run-demo.ts`), wallet check (`wallet-check.ts`), model check (`model-check.ts`) | `scripts` |
| Tests | `apps/api/test`, `apps/web/test`, `apps/web/src/__tests__`, `tests/e2e` |

## Third-party code

All third-party code is installed from npm and pinned in `package-lock.json`; none is vendored
or copied into the source tree.

| Package | Use | Licence |
| --- | --- | --- |
| `@okxweb3/x402-core` 0.1.0, `@okxweb3/x402-evm` 0.2.1, `@okxweb3/x402-express` 0.1.1, `@okxweb3/x402-fetch` 0.1.0 | x402 seller and buyer SDK | Apache-2.0 |
| `viem` | X Layer reads, EIP-712 verification | MIT |
| `@anthropic-ai/sdk` | Optional alternative model provider for the investigator (`SYNTHESIS_PROVIDER=anthropic`); not the default | MIT |
| `express`, `zod`, `react`, `react-dom`, `vite`, `vitest`, `@playwright/test`, `tsx`, `typescript`, `supertest` | Server, validation, UI, tooling | MIT / Apache-2.0 |
| IBM Plex Sans, IBM Plex Mono (Google Fonts) | Typography | SIL OFL 1.1 |

SQLite access uses Node's built-in `node:sqlite`; there are no native add-ons.

## Data

- **xStocks public API v2** (`https://api.xstocks.fi/api/v2`, no authentication). Issuer-reported
  corporate actions, multipliers, proof of reserves, prices, supply and trading status.
- **X Layer mainnet public RPC** (`https://rpc.xlayer.tech`). Contract reads of xStock tokens.
- **OpenRouter API** (`https://openrouter.ai/api/v1`). The default model provider for the
  investigator (`SYNTHESIS_PROVIDER=openrouter`). A hosted service called over HTTPS with `fetch`
  from `apps/api/src/research/openrouter.ts`; no OpenRouter SDK is vendored or installed.
- **OKX x402 facilitator**. The hosted payment service that verifies and settles x402 payments,
  called through the `@okxweb3` packages listed above.
- **X Layer testnet public RPC** (`https://testrpc.xlayer.tech`, chain 1952). Read with `viem` to
  confirm a settlement's token transfer on-chain (payment reconciliation, `npm run verify-payment`) and
  to read the buyer's testnet balances (`npm run wallet`).
- `artifacts/recorded/xstocks-2026-09-18/` holds xStocks API response bodies and the decoded results of
  X Layer RPC reads (block lookups, `multiplier()`, `totalSupply()`), captured by `scripts/record.ts` on
  18 September 2026, each with its URL, fetch time and sha256.
  They are replayed only under the HISTORICAL label.
- `apps/api/src/adapters/fixtures.ts` is synthetic test data about an invented asset (`FIXx`). It
  is served only under the FIXTURE label and is never mixed with real data.

## Tooling

Development used AI coding tools, as stated in the team's registration answers. All code in this
repository was run and tested as described in the README, and the team is responsible for it and
can explain it. At runtime, the only AI component is the investigator's model call
(`apps/api/src/research/model.ts`); schemas, budgets, checks, the publication gate and payment
state are ordinary deterministic code.

### Design guidance

Checked rather than assumed, because "no designs were carried in" is a claim about designs as well
as code. The interface was developed against written guidance authored **for this repository during
the build period**: a project-local frontend skill (`.claude/skills/bullseye-frontend`) holding an
audit and review method, and design briefs in `private/` for the desk and the Situation Room. They
are instructions and acceptance criteria — a method for reviewing screens — not imported components,
a purchased template or a third-party design system. They are git-ignored and ship with nothing.

The design system that the screens actually use (`docs/design-system`: tokens, component contracts,
screens and UI copy) was authored during the period and is in the history. The typefaces are the
only visual assets from outside, and they are open-licence: IBM Plex Sans and IBM Plex Mono on the
desk, Share Tech Mono and VT323 on the Situation Room.

Using npm libraries and written guidance does not make this a pre-existing project. Carrying in code
or designs would have, and none was.

## How to verify this document

```bash
git log --reverse --format='%ad %h %s' --date=iso   # first commit is dated 18 Sep 2026
npm ci && npm test                                   # the tests referenced above
npm run spike                                        # live checks against xStocks, X Layer and OKX
```

Integration status and known gaps are in [CLAIM_LEDGER.md](CLAIM_LEDGER.md).
