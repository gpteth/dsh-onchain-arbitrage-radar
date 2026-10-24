import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../src/settings.js'
import { stockClock, usEquitySession } from '../src/stocks.js'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const settings = resolveSettings({})

function stubSources() {
  return {
    gateTicker: async pair => {
      if (pair !== 'NVDAX_USDT') throw new Error(`no quote for ${pair}`)
      return { venue: 'gate', pair, bid: 211.9, ask: 212, quoteVolume24h: 26_316, source: 'gate' }
    },
    usdtPerUsd: async () => ({ usdtUsd: 0.999, usdtPerUsd: 1 / 0.999, source: 'llama' }),
  }
}

test('US session states come from New York wall time', () => {
  assert.equal(usEquitySession(Date.parse('2026-10-23T14:00:00Z')).state, 'open')
  const pre = usEquitySession(Date.parse('2026-10-23T12:00:00Z'))
  assert.equal(pre.state, 'pre-market')
  assert.equal(pre.minutesUntilNextOpen, 90)
  const after = usEquitySession(Date.parse('2026-10-23T21:00:00Z'))
  assert.equal(after.state, 'after-hours')
  assert.equal(after.minutesUntilNextOpen, 3870)
  const weekend = usEquitySession(Date.parse('2026-10-24T14:00:00Z'))
  assert.equal(weekend.state, 'closed')
  assert.equal(weekend.minutesUntilNextOpen, 2850)
  assert.equal(weekend.approximate, true)
})

test('without a reference the clock returns the snapshot and asks for one', async () => {
  const result = await stockClock({ sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW })
  const row = result.rows[0]
  assert.equal(result.status, 'reference-required')
  assert.equal(row.status, 'reference-required')
  assert.equal(row.deviationBps, null)
  assert.ok(row.flags.includes('closed-window'))
  assert.ok(row.flags.includes('liquidity-thin'))
  assert.equal(result.session.state, 'closed')
})

test('a supplied reference produces a USD deviation', async () => {
  const result = await stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW,
    reference: { price: 210, source: 'manual quote', asOf: new Date(NOW).toISOString() },
  })
  const row = result.rows[0]
  assert.equal(result.status, 'ready')
  assert.equal(row.status, 'ready')
  assert.ok(Math.abs(row.deviationBps - 82.76) < 0.05, `unexpected deviation ${row.deviationBps}`)
  assert.equal(row.reference.price, 210)
  assert.ok(!row.flags.includes('deviation-above-threshold'))
})

test('a reference for another token does not leak across rows', async () => {
  const sources = {
    ...stubSources(),
    gateTicker: async pair => ({ venue: 'gate', pair, bid: 100, ask: 100.1, quoteVolume24h: 1_000_000, source: 'gate' }),
  }
  const result = await stockClock({
    sources, settings, tokens: ['NVDAX', 'TSLAX'], now: NOW,
    reference: { token: 'TSLAX', price: 99, source: 'manual', asOf: new Date(NOW).toISOString() },
  })
  const nvda = result.rows.find(row => row.token === 'NVDAX')
  const tsla = result.rows.find(row => row.token === 'TSLAX')
  assert.equal(nvda.status, 'reference-required')
  assert.equal(tsla.status, 'ready')
  assert.ok(tsla.deviationBps > 0)
})

test('an above-threshold deviation is flagged', async () => {
  const result = await stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW, thresholdBps: 50,
    reference: { price: 200, source: 'manual', asOf: new Date(NOW).toISOString() },
  })
  assert.ok(result.rows[0].flags.includes('deviation-above-threshold'))
})

test('a missing market is reported per token', async () => {
  const result = await stockClock({ sources: stubSources(), settings, tokens: ['NVDAX', 'MISSING'], now: NOW })
  const missing = result.rows.find(row => row.token === 'MISSING')
  assert.equal(missing.status, 'unavailable')
  assert.ok(result.errors.some(error => error.token === 'MISSING'))
})

test('invalid reference and token inputs are rejected', async () => {
  await assert.rejects(stockClock({ sources: stubSources(), settings, tokens: [], now: NOW }), /tokens/)
  await assert.rejects(stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW,
    reference: { price: -1, source: 'x', asOf: new Date(NOW).toISOString() },
  }), /reference.price/)
  await assert.rejects(stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW,
    reference: { price: 1, source: '', asOf: new Date(NOW).toISOString() },
  }), /reference.source/)
  await assert.rejects(stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW,
    reference: { price: 1, source: 'x', asOf: 'yesterday' },
  }), /reference.asOf/)
  await assert.rejects(stockClock({
    sources: stubSources(), settings, tokens: ['NVDAX'], now: NOW,
    reference: { price: 1, source: 'x', asOf: new Date(NOW).toISOString(), currency: 'EUR' },
  }), /reference.currency/)
})
