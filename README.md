# On-chain Arbitrage Radar

A read-only arbitrage research plugin for DeepSeek Harness. It reads public
market data, turns it into cost-adjusted numbers, and refuses to pretend that a
screen spread is a trade.

It never holds keys, never signs, and never places an order.

## What it gives you

| Tool | What it answers |
|---|---|
| `arb_spread_scan` | Is there a live Gate ↔ Bitfinex spot spread, and what is left after both taker fees, further slippage, conversion and depth? |
| `arb_cost_model` | Given a gross spread and explicit costs, what is the net profit, break-even spread and minimum effective size? |
| `arb_guard_check` | Does the plan respect the loss cap, leverage cap, minimum edge, quote age and observed-data rule? |
| `arb_funding_scan` | Which perpetuals pay the most annualized funding, and which of those are thin, crowded or delisting? |
| `arb_stock_clock` | How far is a Gate tokenized stock from its underlying reference, and is the US session open? |
| `arb_research` | What does the research method say about this structure? |
| `arb_records` | What did this Host process scan and reject recently? |

A compact **radar strip** below the composer shows the latest spread, funding
and tokenized-stock numbers and can trigger one spread scan.

## Data sources

All calls are public and keyless:

- **Gate.io** — spot tickers, USD and USDT markets, USDT perpetual funding.
- **Bitfinex** — public spot ticker (USD).
- **Hyperliquid** — perpetual contexts and funding history.
- **DeFiLlama coins** — USDT/USD rate when a Gate market is USDT-quoted while
  Bitfinex quotes USD.

The Host process must be able to reach these hosts. On a restricted network a
source simply reports `unavailable`; the remaining sources still answer.

## Install

```sh
dsh plugin install https://github.com/gpteth/dsh-onchain-arbitrage-radar
```

A local checkout works too: `dsh plugin install /absolute/path/to/dsh-onchain-arbitrage-radar`.
In the running Harness, install it from Settings → Plugins (or have the agent
call `plugin_manager` → `install_bundle`), then check the plugin appears in
Settings → Plugins. The row is inserted by `cordis.patch.yml`; the browser strip
is discovered from the package's `dsh.client` manifest and `./client` export.

## Configure

Every field is optional; defaults live in `src/settings.js`. Edit the row config
in `cordis.patch.yml` or the profile patch:

```yaml
- id: arbitrage-radar
  config:
    thresholds:
      goBps: 40              # net bps needed for a "go"
      maxQuoteAgeSeconds: 20 # older Bitfinex quotes are rejected
      stockDeviationBps: 150
      minOiUsd: 1000000      # Hyperliquid open interest floor
      minDayVolumeUsd: 500000
      fundingWatchPct: 30    # annualized funding that gets a flag
    venues:
      gate: { takerBps: 20 }
      bitfinex: { takerBps: 20 }
    scan:
      symbols: [BTC, ETH, SOL]
      sizeQuote: 1000
      slippageBps: 5
    funding:
      venues: [gate, hyperliquid]
      top: 15
      historyPoints: 60
      historyCandidates: 3
    stocks:
      tokens: [NVDAX, TSLAX, COINX]
    transfer:
      conversionBufferBps: 5
      usdtFallbackBufferBps: 15
    risk:
      maxLossFraction: 0.02
      maxLeverage: 1
      minNetBps: 30
      maxQuoteAgeSeconds: 60
    panel:
      path: /arb-radar
      enabled: true
      throttleMs: 5000
    requestTimeoutMs: 8000
    maxRecords: 200
```

Unusable values fall back to their defaults and are logged; they never stop the
plugin from activating.

## Panel route

The strip reads and writes two same-origin JSON routes on the Host web server:

- `GET /arb-radar/summary` — latest scan/funding/stock snapshots and journal counts.
- `POST /arb-radar/scan` — run one spread scan with the configured defaults.
- `GET /arb-radar/health` — liveness and journal counts.

Scans are throttled, cross-origin requests are refused, and only public market
data plus process-local records are returned.

## What version 1 does not do

- No wallets, signing, orders, transfers, keys or credentials.
- No DEX/AMM pool quotes: the cross-venue scope is Gate ↔ Bitfinex. The
  on-chain angle is the tokenized-stock clock and the funding/basis work.
- No full order book: depth is top-of-book only, and Bitfinex's public ticker
  exposes no size at all.
- No server timestamp on Gate spot tickers; the fetch time is recorded instead.
- No US holiday calendar or early-close modeling.
- No durable journal: records last for the Host process. The session log is the
  authoritative record.
- No P&L claim. A `go` verdict is a scenario for review, not a fill.

## Research basis

The method — net edge over gross spread, minimum effective size, funding as
insurance rather than rent, the tokenized-stock clock, evidence and risk gates —
was informed by the public study vault at
<https://github.com/gpteth/onchain-arbitrage-colearn>. That repository carries no
license, so this plugin is an original implementation: no code, notes or scripts
were copied, and none of its files are executed. Its market data is read live
from the venues listed above.

## Develop and verify

```sh
node --test test/*.test.js     # pure logic, stubbed sources, route, client module
node scripts/live-check.mjs    # real public endpoints; prints a compact summary
```

The tests cover the arithmetic, spread verdicts (including stale quotes, thin
depth and USDT conversion), funding flags, the US session clock, reference
matching, the HTTP route and the browser module's registration. Live behavior
depends on the network described above.
