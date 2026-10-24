import { costModel, guardCheck } from './math.js'
import { runSpreadScan } from './operations.js'
import { scanFunding } from './funding.js'
import { stockClock } from './stocks.js'
import { searchTopics, topicById, TOPICS } from './knowledge.js'

const output = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const params = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const arrayOf = (description, items = { type: 'string' }) => ({ type: 'array', items, description })

export function installTools(ctx, { settings, runtime, sources }) {

  const register = definition => {
    ctx.tools.register({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output,
      async execute(args) {
        try {
          return { ok: true, ...(await definition.run(args ?? {})) }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  }

  register({
    name: 'arb_spread_scan',
    description: 'Read-only cross-venue spot scan (Gate versus Bitfinex) for the same base asset. USDT-quoted Gate markets are converted with a DeFiLlama USDT/USD rate; both taker fees, a further-slippage budget and a conversion buffer are subtracted. Returns gross and net basis points, top-of-book depth, quote age and a go/watch/no-go verdict per symbol. Top-of-book only: it does not verify that either venue would fill the size, and it never places orders.',
    parameters: params({
      symbols: arrayOf('Base assets such as BTC or ETH; defaults to the configured list. Gate must list the market and Bitfinex must quote it in USD.'),
      sizeQuote: { type: 'number', description: 'Notional to evaluate in the comparison quote unit (USD, or USDT when Gate is USDT-quoted). Default from config, 1000.' },
      slippageBps: { type: 'number', description: 'Further adverse-move budget per leg in basis points, on top of the quoted top-of-book price. Default 5.' },
    }),
    async run(args) {
      return await runSpreadScan({ sources, settings, runtime, args })
    },
  })

  register({
    name: 'arb_cost_model',
    description: 'Pure cost model for one round trip: turns a caller-supplied gross spread in basis points into net profit using explicit buy and sell fees, further slippage, safety buffer, conversion buffer and fixed costs (gas, withdrawal, financing, other). Returns cost lines, break-even spread, minimum effective size, cost multiple and a go/watch/no-go verdict. No network access; any cost you omit is treated as zero, so pass every cost explicitly.',
    parameters: params({
      grossSpreadBps: { type: 'number', description: 'Screen spread in basis points; positive means the sell leg quotes above the buy leg.' },
      notionalQuote: { type: 'number', description: 'Round-trip notional in the quote asset. Every fixed cost must use the same unit.' },
      fees: {
        type: 'object', additionalProperties: false,
        properties: {
          buyBps: { type: 'number', description: 'Buy-venue taker fee in basis points.' },
          sellBps: { type: 'number', description: 'Sell-venue taker fee in basis points.' },
        },
      },
      slippage: {
        type: 'object', additionalProperties: false,
        properties: {
          buyBps: { type: 'number', description: 'Further adverse buy move in basis points; exclude price impact already in the quote.' },
          sellBps: { type: 'number', description: 'Further adverse sell move in basis points.' },
        },
      },
      fixedCosts: {
        type: 'object', additionalProperties: false,
        properties: {
          gasQuote: { type: 'number', description: 'Total gas for both legs, in the quote asset.' },
          withdrawalQuote: { type: 'number', description: 'Withdrawal or bridge fee in the quote asset.' },
          financingQuote: { type: 'number', description: 'Financing or funding cost while capital is tied up, in the quote asset.' },
          otherQuote: { type: 'number', description: 'Any other fixed cost in the quote asset; pass 0 explicitly when none.' },
        },
      },
      bufferBps: { type: 'number', description: 'Safety buffer in basis points of notional.' },
      conversionBufferBps: { type: 'number', description: 'Buffer for stablecoin conversion or transfer basis, in basis points.' },
      minNetBps: { type: 'number', description: 'Minimum net basis points to count as a go; below it a positive result is a watch.' },
    }, ['grossSpreadBps', 'notionalQuote']),
    async run(args) {
      const result = costModel(args)
      runtime.journal.add('cost', {
        at: result.evaluatedAt, verdict: result.verdict, netBps: result.netBps,
        netQuote: result.netQuote, notionalQuote: result.notionalQuote, reasons: result.reasons,
      })
      return result
    },
  })

  register({
    name: 'arb_guard_check',
    description: 'Pre-trade discipline gate for a research plan: loss cap against bankroll, leverage cap, notional versus equity, minimum expected net edge, quote age, and observed versus synthetic evidence. Returns pass, blocking checks, warnings and the reminder for the chosen mode, and records the attempt in the process-local journal. It checks caller-supplied numbers only; it does not verify prices or fills.',
    parameters: params({
      mode: { type: 'string', enum: ['spot-spread', 'funding', 'convergence'], description: 'What the plan is betting on: a cross-venue spread, funding carry, or a spread converging after an event.' },
      bankrollQuote: { type: 'number', description: 'Total capital assigned to this research in the quote asset.' },
      maxLossQuote: { type: 'number', description: 'Worst case loss accepted for this plan, in the quote asset.' },
      notionalQuote: { type: 'number', description: 'Planned notional in the quote asset.' },
      expectedNetBps: { type: 'number', description: 'Expected net edge in basis points after all costs.' },
      dataKind: { type: 'string', enum: ['observed', 'synthetic'], description: 'Whether the plan rests on observed quotes or on a synthetic example.' },
      leverage: { type: 'number', description: 'Planned leverage; default 1.' },
      quoteAgeSeconds: { type: 'number', description: 'Age of the newest quote behind the plan, in seconds.' },
    }, ['mode', 'bankrollQuote', 'maxLossQuote', 'notionalQuote', 'expectedNetBps', 'dataKind']),
    async run(args) {
      const result = guardCheck(args, settings.risk)
      runtime.journal.add('guard', {
        at: result.evaluatedAt, mode: result.mode, pass: result.pass,
        blocking: result.blocking, expectedNetBps: result.inputs.expectedNetBps,
      })
      return result
    },
  })

  register({
    name: 'arb_funding_scan',
    description: 'Read-only funding scan across Gate USDT perpetuals and Hyperliquid perpetuals: per-interval and annualized rate, mark/index basis, open interest and 24h volume where the venue exposes them, and a z-score against recent funding history for the top candidates. Flags thin depth, extreme z, pre-market and delisting contracts. An annualized rate is not realized profit: a spot hedge, basis monitoring and margin headroom are separate problems.',
    parameters: params({
      venues: arrayOf('Venues to scan: gate, hyperliquid. Defaults to the configured list.', { type: 'string', enum: ['gate', 'hyperliquid'] }),
      symbols: arrayOf('Limit to these base symbols, such as BTC or ETH. The default scans the whole venue list.'),
      top: { type: 'number', description: 'Keep the top N rows by annualized rate; default from config, 15.' },
      minAnnualizedPct: { type: 'number', description: 'Drop rows below this absolute annualized percentage; default 0.' },
    }),
    async run(args) {
      const result = await scanFunding({
        sources, settings, venues: args.venues, symbols: args.symbols,
        top: args.top, minAnnualizedPct: args.minAnnualizedPct,
      })
      runtime.latest.funding = result
      runtime.journal.add('funding', {
        at: result.at, counts: result.counts, top: result.top, errors: result.errors.length,
      })
      return result
    },
  })

  register({
    name: 'arb_stock_clock',
    description: 'Compare Gate tokenized-stock quotes such as NVDAX_USDT with a caller-supplied underlying reference price, and report the US regular-session state plus minutes to the next open. Without a reference it returns the token snapshot, the session and a reference-required status instead of guessing a stock price. Read-only; issuer terms, redemption gates and exchange holidays are not modeled.',
    parameters: params({
      tokens: arrayOf('Gate tokenized-stock symbols such as NVDAX (the X suffix is the tokenized share). Defaults to the configured list.'),
      reference: {
        type: 'object', additionalProperties: false,
        properties: {
          token: { type: 'string', description: 'Which token or underlying this reference prices, such as NVDAX or NVDA. Omit only when a single token is requested.' },
          price: { type: 'number', description: 'Underlying price in USD from the cited source.' },
          source: { type: 'string', description: 'Where the price came from, with a URL or provider name.' },
          asOf: { type: 'string', description: 'ISO timestamp of the price observation.' },
          currency: { type: 'string', description: 'Only USD is accepted.' },
        },
        required: ['price', 'source', 'asOf'],
      },
      thresholdBps: { type: 'number', description: 'Deviation that counts as noteworthy, in basis points; default from config, 150.' },
    }),
    async run(args) {
      const result = await stockClock({
        sources, settings, tokens: args.tokens, reference: args.reference, thresholdBps: args.thresholdBps,
      })
      runtime.latest.stocks = result
      runtime.journal.add('stock', {
        at: result.at, status: result.status, session: result.session.state,
        deviating: result.rows.filter(row => row.flags?.includes('deviation-above-threshold')).length,
        errors: result.errors.length,
      })
      return result
    },
  })

  register({
    name: 'arb_research',
    description: 'Search the bundled original research notes on on-chain arbitrage: net edge, minimum effective size, paper versus live, spread executability, funding carry and its two modes, tokenized-stock clock, cross-chain cost, atomic/MEV, liquidation, sentinel design, the five questions, risk rules, evidence standards, stablecoin basis and the research loop. Returns matching topics with the body and how to apply them, or one exact topic by id. This is method, not market data.',
    parameters: params({
      query: { type: 'string', description: 'Keywords, Chinese or English, such as funding, 滑点, minimum size, 币股, evidence.' },
      topicId: { type: 'string', description: 'Exact topic id from a previous result, such as net-edge or funding-carry.' },
      limit: { type: 'number', description: 'Number of topics to return, 1 to 10; default 3.' },
    }),
    async run(args) {
      if (args.topicId !== undefined) {
        const topic = topicById(args.topicId)
        if (topic === undefined) throw new Error(`Unknown topic id. Known ids: ${TOPICS.map(entry => entry.id).join(', ')}`)
        return { query: null, topicId: topic.id, topics: [topic] }
      }
      if (typeof args.query !== 'string' || args.query.trim() === '') throw new Error('Pass query or topicId.')
      const topics = searchTopics(args.query, args.limit ?? 3)
      const payload = { query: args.query, count: topics.length, topics }
      if (topics.length === 0) payload.note = 'No topic matched; try a broader keyword, or read one topic by id.'
      return payload
    },
  })

  register({
    name: 'arb_records',
    description: 'Read the process-local journal of this plugin\'s scans, cost models, funding scans, stock snapshots and guard checks, newest first. Records hold verdicts, rejection reasons and the numbers the caller supplied. Not durable across Host restarts, and the session log stays the authoritative record.',
    parameters: params({
      kind: { type: 'string', enum: ['scan', 'guard', 'funding', 'stock', 'cost'], description: 'Only records of this kind.' },
      limit: { type: 'number', description: 'Number of records, 1 to 50; default 10.' },
    }),
    async run(args) {
      const limit = args.limit ?? 10
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be an integer from 1 to 50')
      const page = runtime.journal.list({ kind: args.kind, limit })
      return { ...page, counts: runtime.journal.counts(), capacity: settings.maxRecords, durable: false }
    },
  })
}
