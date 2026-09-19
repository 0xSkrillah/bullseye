# Deployment and marketplace listing

How to put Bullseye on a public HTTPS address and what a marketplace that lists x402 services
(OKX AI's A2MCP listing is the one this was written against) needs from it.

**Status on 19 September 2026: not deployed and not listed.** Everything below has been run on
localhost only. The Dockerfile has not been built; the build and start commands it wraps have.

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

Do not set `BUYER_PRIVATE_KEY` on the server. It belongs to the buyer scripts on a developer
machine.

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
