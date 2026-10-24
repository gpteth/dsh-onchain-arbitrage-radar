import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../src/settings.js'
import { createRuntime } from '../src/runtime.js'
import { scanSpreads } from '../src/scan.js'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const settings = resolveSettings({})

function stubSources({ gateQuote = 'USD', gateBid = 100, gateAsk = 100.1, gateAskSize = 50, bitfinexBid = 101, bitfinexAsk = 101.1, bitfinexAt = NOW, rate = 0.999 } = {}) {
  return {
    gatePairFor: async base => ({ pair: `${base}_${gateQuote}`, quote: gateQuote }),
    gateTicker: async pair => ({
      venue: 'gate', pair, bid: gateBid, ask: gateAsk, bidSize: 50, askSize: gateAskSize,
      quoteVolume24h: 5_000_000, source: 'gate', observedAt: null,
    }),
    bitfinexTicker: async () => ({
      venue: 'bitfinex', pair: 'btcusd', bid: bitfinexBid, ask: bitfinexAsk,
      quoteVolume24h: null, source: 'bitfinex', observedAt: new Date(bitfinexAt).toISOString(),
    }),
    usdtPerUsd: async () => ({ usdtUsd: rate, usdtPerUsd: 1 / rate, source: 'llama', at: new Date(NOW).toISOString() }),
  }
}

const scan = (sources, extra = {}) => scanSpreads({
  sources, settings, symbols: ['BTC'], sizeQuote: 1000, slippageBps: 5, now: NOW, ...extra,
})

test('a wide USD/USD spread nets above the go line and records depth', async () => {
  const result = await scan(stubSources())
  const row = result.rows[0]
  assert.equal(result.ok, true)
  assert.equal(row.quoteUnit, 'USD')
  assert.equal(row.conversion, null)
  assert.equal(row.best.buyVenue, 'gate')
  assert.equal(row.best.sellVenue, 'bitfinex')
  assert.ok(row.best.grossBps > 85 && row.best.grossBps < 95)
  assert.equal(row.best.costBps, 50)
  assert.ok(row.best.netBps > 35)
  assert.equal(row.best.depthQuote, 5005)
  assert.equal(row.verdict, 'go')
  assert.equal(row.orderBookNote !== null, true)
  assert.equal(result.counts.go, 1)
})

test('a USDT quoted Gate market is converted and charges the conversion buffer', async () => {
  const result = await scan(stubSources({ gateQuote: 'USDT', bitfinexBid: 100.6, bitfinexAsk: 100.7 }))
  const row = result.rows[0]
  assert.equal(row.quoteUnit, 'USDT')
  assert.equal(row.conversion.usdtUsd, 0.999)
  assert.equal(row.conversion.bufferBps, 5)
  assert.equal(row.best.costBps, 55)
  assert.equal(row.verdict, 'watch')
})

test('a missing conversion rate blocks the verdict even when the spread looks rich', async () => {
  const sources = { ...stubSources({ gateQuote: 'USDT' }), usdtPerUsd: async () => { throw new Error('rate down') } }
  const result = await scan(sources)
  const row = result.rows[0]
  assert.ok(row.reasons.includes('conversion-rate-unavailable'))
  assert.equal(row.verdict, 'no-go')
  assert.equal(row.conversion.bufferBps, settings.transfer.usdtFallbackBufferBps)
  assert.ok(result.errors.some(error => error.source === 'usdt-rate'))
})

test('a stale Bitfinex quote blocks the verdict', async () => {
  const result = await scan(stubSources({ bitfinexAt: NOW - 60_000 }))
  const row = result.rows[0]
  assert.ok(row.reasons.includes('stale-bitfinex-quote'))
  assert.equal(row.verdict, 'no-go')
})

test('a future Bitfinex timestamp clamps the age to zero and says so', async () => {
  const result = await scan(stubSources({ bitfinexAt: NOW + 3000 }))
  const row = result.rows[0]
  assert.equal(row.ageSeconds, 0)
  assert.ok(row.notes.some(note => note.includes('ahead of the local clock')))
})

test('top-of-book depth below the requested size blocks the verdict', async () => {
  const result = await scan(stubSources({ gateAskSize: 1 }))
  const row = result.rows[0]
  assert.ok(row.reasons.includes('shallow-top-of-book'))
  assert.equal(row.best.depthQuote, 100.1)
  assert.equal(row.verdict, 'no-go')
})

test('an unavailable venue produces an unavailable row instead of throwing', async () => {
  const sources = {
    gatePairFor: async base => ({ pair: `${base}_USD`, quote: 'USD' }),
    gateTicker: async () => { throw new Error('Gate: HTTP 502') },
    bitfinexTicker: async () => ({ venue: 'bitfinex', pair: 'btcusd', bid: 100, ask: 101, observedAt: new Date(NOW).toISOString(), source: 'bitfinex' }),
    usdtPerUsd: async () => ({ usdtUsd: 1 }),
  }
  const result = await scan(sources)
  assert.equal(result.rows[0].verdict, 'unavailable')
  assert.ok(result.rows[0].reasons.includes('gate-unavailable'))
  assert.ok(result.errors.some(error => error.source === 'gate'))
})

test('a market absent on Gate is reported, not guessed', async () => {
  const sources = { ...stubSources(), gatePairFor: async () => undefined }
  const result = await scan(sources)
  assert.equal(result.rows[0].verdict, 'unavailable')
  assert.deepEqual(result.rows[0].reasons, ['gate-market-missing'])
})

test('invalid inputs are rejected', async () => {
  await assert.rejects(scan(stubSources(), { symbols: [] }), /No usable symbol/)
  await assert.rejects(scan(stubSources(), { sizeQuote: 0 }), /sizeQuote/)
})
