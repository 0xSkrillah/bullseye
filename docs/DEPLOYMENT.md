# Deployment and marketplace listing

How to put Bullseye on a public HTTPS address and what a marketplace that lists x402 services
(OKX AI's A2MCP listing is the one this was written against) needs from it.

**Status on 19 September 2026: deployed and selling on testnet, not listed.** The service runs on
Railway at https://bullseye-production-5d0c.up.railway.app (built from the Dockerfile, one instance, a volume at `/data`, health check on
`/api/health`, deploys from `main` when code changes; commits that touch only documents do not
redeploy). With the owner's model key and OKX credentials on the host, `/api/health` reports the
data source LIVE, synthesis ready and the rail ready on `eip155:1952`. The auto desk ran two
investigations there without an operator: the first was rejected by the gate and sold nothing,
the second published `brf_9aac63b6842fb78e` (ESx, LIVE, HIGH), and the self-test below then
returned `402` with a complete `PAYMENT-REQUIRED` header from the deployed address. **No payment
has been made through the deployed address**, and it is a testnet rail: nothing sold there is
revenue.

## What a listing needs, and where Bullseye provides it

| Requirement | Bullseye |
| --- | --- |
| One public HTTPS endpoint | `https://<your-host>/api/v1/briefs/latest`: the newest Brief on sale. Optional filter: `?symbol=QSRx`, or `{"symbol":"QSRx"}` in a POST body. |
| Answers `POST` without payment with `402` and a `PAYMENT-REQUIRED` header | `GET` and `POST` both do. The header is base64 JSON: `x402Version` 2, `resource` (`url`, `description`, `mimeType`), `accepts[0]` (`scheme` exact, `network`, `asset`, `amount` in base units, `payTo`, `maxTimeoutSeconds` 300, `extra`). `resource.url` is the address that was called. |
| Something to sell at all times | Nothing is sold that was not investigated and passed by the gate. With no Brief on sale the endpoint answers `404 nothing_for_sale` and no challenge. `AUTO_DESK=true` keeps the desk producing Briefs without an operator (below). |
| Settlement on the network the marketplace expects | `PAYMENT_RAIL=okx-testnet` (X Layer testnet, `eip155:1952`) or `okx-mainnet` (`eip155:196`). OKX's listing example shows `eip155:196`. Its documentation does not say whether a testnet endpoint is accepted. |

A buyer who was quoted Brief A at the stable address and pays after Brief B is published still
receives A: the payment is matched to the quote it was signed against, not to whatever is newest.

## Self-test

This is the check OKX's listing guide asks for. Run it against the deployed address:

```bash
curl -i -X POST https://<your-host>/api/v1/briefs/latest
```

Expected: `HTTP/1.1 402 Payment Required` and a `PAYMENT-REQUIRED` header. To read the header:

```bash
curl -s -D - -o /dev/null -X POST https://<your-host>/api/v1/briefs/latest | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

`404 nothing_for_sale` means the desk has not published a Brief on this database yet.
`503 payment_rail_unavailable` means the OKX credentials or `PAY_TO_ADDRESS` are missing or were
rejected; `GET /api/health` says which.

## Host

Any host that runs a container or Node 22.13+ and gives the process a persistent disk.

- **Build:** `npm ci --include=dev && npm run build`
- **Start:** `npm run start` (serves the API and the built web desk on `PORT`)
- **Disk:** mount a volume and point `DB_PATH` at it (the Dockerfile uses `/data/bullseye.sqlite`).
  Quotes, orders and payment evidence live in that file. Without a volume every redeploy forgets
  who paid.
- **One instance.** SQLite and the in-process investigation runner assume a single process.
- **Region:** the investigator calls model APIs; pick a region those providers serve.

## Environment

Set these in the host's secret store. Never commit them and never bake them into the image.

| Variable | Value |
| --- | --- |
| `PUBLIC_BASE_URL` | The public origin, for example `https://bullseye.example.com`. It is written into every quote as the resource address, so it must be exact: `https`, no trailing slash, no path. |
| `DB_PATH` | A path on the persistent volume. |
| `OPENROUTER_API_KEY` | Investigator model access. |
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | OKX developer portal credentials for the x402 facilitator. |
| `PAY_TO_ADDRESS` | The address that receives payment. Only the address; the server never holds a private key. |
| `PAYMENT_RAIL` | `okx-testnet` or `okx-mainnet`. |
| `BRIEF_PRICE_USD` | Default `3.00`. An investigation is declined as uneconomic before any spend unless the price exceeds `BUDGET_MAX_COST_USD` plus the three estimated reserves (0.60 + 0.45 by default). |
| `AUTO_DESK`, `AUTO_DESK_INTERVAL_MINUTES`, `AUTO_DESK_MAX_INVESTIGATIONS_PER_DAY` | See below. |
| `OPERATOR_TOKEN` | Optional, at least 24 characters. See "Operator routes". Never put it in a browser. |
| `VIEWER_TOKEN` | Optional, at least 24 characters; a shorter value is a configuration error. Read-only diagnostics for a wall display: sent as `Authorization: Bearer <token>` it gets the `DIAGNOSTIC` view of the desk's read routes. It starts nothing, is refused by every operator route and opens no order. See "What changes for visitors when this branch is deployed". |
| `CLIENT_IP_HEADER` | The header your host's edge sets to the client's address and overwrites if a client sends it. On Railway: `x-real-ip`. The rate limits are keyed on it. Without it they are keyed on the connection's address, which behind Railway's proxy is not the client: on 19 Sep 2026 fourteen payment attempts from one machine passed a limit of 12 that way, and a spoofed `X-Forwarded-For` made no difference either way. |
| `PAID_ROUTE_RATE_LIMIT_PER_MINUTE`, `PAYMENT_ATTEMPT_RATE_LIMIT_PER_MINUTE`, `API_RATE_LIMIT_PER_MINUTE` | Defaults 60, 12 and 600 per client address per minute: the paid resource and quote route; requests there that carry a payment (each can cost a facilitator call); every `/api` route except the health check. Over a limit: `429` with `Retry-After` and no challenge. |

Do not set `BUYER_PRIVATE_KEY` on the server. It belongs to the buyer scripts on a developer
machine.

## Operator routes

This section and the next describe `main` as deployed since 19 September 2026 (`826820d`,
Railway deployment `9840ee30`; CLAIM_LEDGER V43).

`POST /api/signals/scan` and `POST /api/signals/:id/investigate` start work that spends model
credit or calls third parties, and `GET /api/orders` lists every buyer's order with payer
addresses, transaction hashes and the desk's cost per sale. On `localhost` they are open so the
desk works in development. On any other `PUBLIC_BASE_URL` they answer `403
operator_routes_disabled` unless `OPERATOR_TOKEN` is set, and then only to
`Authorization: Bearer <token>`. `GET /api/health` reports which mode is in force as
`operatorRoutes`. The web desk does not send a token, so on a public deployment Scan and
Investigate are refused and the auto desk does that work instead.

`POST /api/orders/:id/reconcile` is no longer an operator-only route. It reads the chain and the
facilitator's record and never settles, so it is also answered to the buyer who presents the
order's claim token in `X-Bullseye-Claim`, and it is rate-limited with the paid routes. A buyer
whose payment outcome is unknown can therefore reconcile from the web desk, re-send the same
authorization, or collect from `GET /api/orders/:id/delivery` with the token.

The Dockerfile sets `NODE_ENV=production`, and a production build never treats itself as local,
so a `PUBLIC_BASE_URL` left at its localhost default cannot open these routes.

Everything a buyer needs stays open: the catalogue, previews, quotes, the paid resource, and the
buyer's own order by claim token. The desk's read routes stay open too, as a public projection.

## What changed for visitors on 19 September 2026

Until that day `GET /api/orders` and `GET /api/orders/:id` answered anyone, and the
investigation routes returned evidence summaries, on-chain figures and per-run cost to anyone.
Since then, as read back from the public address
(`artifacts/evidence/deployed-check-2026-09-19.json`):

- With neither `OPERATOR_TOKEN` nor `VIEWER_TOKEN` set, a public deployment serves the `PUBLIC`
  projection only: `GET /api/health` reports `diagnostics: "DISABLED"`. A visitor still sees that
  each step of an investigation happened, when, and whether it succeeded. Evidence summaries,
  check results, model and tool call details and per-run cost are withheld; for a run that has
  a Brief or is still running, so are the chain's block numbers, block times and multipliers, and
  the detail of any rejected draft. Quote and order ids in the activity feed become stand-ins.
- `GET /api/orders` answers `403 operator_routes_disabled`, or `401 operator_token_required` when
  `OPERATOR_TOKEN` is set. A single order is answered only to its claim token or to the operator.
- A wall display therefore cannot read orders or per-run cost. It needs the two aggregate routes,
  which are open to anyone and carry no order, buyer or run identifiers:
  `GET /api/commerce/summary` (orders by state and by Brief, and the newest order's path through
  the states) and `GET /api/desk/economics` (research, sales and delivery totals with every
  investigation counted once).
- To show diagnostics on a wall display, set `VIEWER_TOKEN` and give the display that token. Do
  not give it `OPERATOR_TOKEN`: a token in a browser should be one that can start nothing.
- Anything that read `GET /api/orders` or `GET /api/orders/:id` without a token stops working.
  The repository's own callers were changed: the web desk reads only this browser's order with
  its claim token, and `npm run verify-payment` and `npm run demo` read an order with the token
  the agent buyer wrote under `data/purchases/`, so they must run from the checkout that made
  the purchase.
- Claim tokens do not change. An order opened before the change is answered to the token it
  already had: the one its buyer chose, or the server's token for that order, which the buyer was
  sent in the `X-Bullseye-Claim` response header. A buyer who kept neither can no longer read
  that order without the operator; the agent buyer on `main` kept its token in memory only.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. Everything in
it is offline: recorded data, the fixture synthesiser and the fixture payment rail. It reads no
secret, calls no model and can move no funds.

| Job | Runs |
| --- | --- |
| `test` | On Node 22.x and 24.x: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. |
| `browser` | On Node 24.x: `npm ci`, `npx playwright install --with-deps chromium`, `npm run test:e2e`. Playwright traces are kept for 7 days when it fails. |

The first run, on `826820d`, passed all three jobs (GitHub Actions run `35458243392`). One run.

## The auto desk

Off by default, because every investigation it starts spends money.

With `AUTO_DESK=true` the server scans the issuer's corporate actions every
`AUTO_DESK_INTERVAL_MINUTES` (default 30, minimum 5) and investigates at most one signal per tick:

- only a signal that has **never** been investigated, so a run the gate rejected or the budget
  stopped is not retried on a timer;
- never while another investigation is running;
- never when the model provider or the payment rail is not ready: research that could not be sold
  is not bought;
- never more than `AUTO_DESK_MAX_INVESTIGATIONS_PER_DAY` (default 3) in any 24 hours.

Worst-case model spend per 24 hours is that ceiling times `BUDGET_MAX_COST_USD`: $1.80 at the
defaults. It is printed at start-up. The one live investigation on record was billed $0.071725;
that is one observation, not a forecast.

Investigations run inside the server process. One that a restart cuts off is closed as `STOPPED`
(`ERROR`) at the next start-up, with a timeline entry saying so, and is not resumed; because the
desk investigates a signal once, that signal waits for an operator.

Rebase events are not daily. When the detector finds nothing in its 96-hour window the desk stays
idle and the newest published Brief stays on sale until the issuer cancels or replaces the action
it describes, at which point it is withdrawn.

## Going to mainnet

`PAYMENT_RAIL=okx-mainnet` settles real USD₮0 on X Layer to `PAY_TO_ADDRESS`. Before switching:

1. Run the whole path on testnet on the deployed host, including `npm run verify-payment`.
2. Confirm `PAY_TO_ADDRESS` is an address you control on X Layer mainnet.
3. Understand that the first settled mainnet order is the first revenue this project has had.
   Until then every payment in this repository is a testnet payment and is not revenue.

Mainnet has not been exercised. The agent buyer refuses a mainnet challenge unless it is started
with `--allow-mainnet`, and enforces its spend limits on the terms it signs.

## Listing on OKX AI

OKX's guide registers a paid endpoint as an A2MCP service through its Onchain OS tooling: install
the tooling, sign in to an Agentic Wallet, register the service (name, description, price per call,
endpoint URL), pass the self-test above, then submit the listing for review. Follow OKX's own
current instructions for the exact prompts; they are not reproduced here. OKX's documentation, as
read on 19 September 2026, does not state whether testnet endpoints are accepted, what fees apply,
or what the review criteria are.
