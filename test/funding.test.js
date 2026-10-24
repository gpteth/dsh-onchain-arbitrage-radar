import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../src/settings.js'
import { scanFunding } from '../src/funding.js'

const NOW = Date.parse('2026-10-25T00:00:00Z')
const settings = resolveSettings({})
const history = [0.00001, 0.00002, 0.00003, 0.00004, 0.00002, 0.00001, 0.00003, 0.00002, 0.00004, 0.00003, 0.00002, 0.00001]

function stubSources(overrides = {}) {
  return {
    gateFundingContracts: async () => [{
      venue: 'gate', contract: 'AAA_USDT', symbol: 'AAA', rate: 0.0001, intervalHours: 8,
      nextFundingAt: '2026-10-25T08:00:00.000Z', markPrice: 101, indexPrice: 100, takerBps: 5,
      leverageMax: 20, preMarket: false, delisting: false, source: 'gate',
    }],
    hyperliquidContexts: async () => [{
      venue: 'hyperliquid', contract: 'BBB', symbol: 'BBB', rate: 0.00005, intervalHours: 1,
      nextFundingAt: null, markPrice: 100.05, indexPrice: 100, openInterestUsd: 500_000,
      dayVolumeUsd: 100_000, leverageMax: 10, preMarket: false, delisting: false, source: 'hyperliquid',
    }],
    gateFundingHistory: async () => history,
    hyperliquidFundingHistory: async () => history,
    ...overrides,
  }
}

test('funding scan annualizes both venues and orders by yearly rate', async () => {
  const result = await scanFunding({ sources: stubSources(), settings, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].symbol, 'BBB')
  assert.equal(result.rows[0].annualizedPct, 43.8)
  assert.equal(result.rows[1].annualizedPct, 10.95)
  assert.equal(result.rows[0].basisBps, 5)
  assert.equal(result.rows[1].basisBps, 100)
  assert.equal(result.top.symbol, 'BBB')
  assert.deepEqual(result.bestByVenue.map(row => row.venue).sort(), ['gate', 'hyperliquid'])
})

test('funding flags thin depth, unknown open interest and the watch line', async () => {
  const result = await scanFunding({ sources: stubSources(), settings, now: NOW })
  const hl = result.rows[0]
  const gate = result.rows[1]
  assert.ok(hl.flags.includes('thin-open-interest'))
  assert.ok(hl.flags.includes('thin-volume'))
  assert.ok(hl.flags.includes('above-watch-line'))
  assert.ok(gate.flags.includes('open-interest-unknown'))
  assert.ok(!gate.flags.includes('above-watch-line'))
  assert.equal(typeof gate.z, 'number')
  assert.equal(typeof hl.z, 'number')
})

test('funding scan filters by symbol and top', async () => {
  const bySymbol = await scanFunding({ sources: stubSources(), settings, symbols: ['AAA'], now: NOW })
  assert.deepEqual(bySymbol.rows.map(row => row.symbol), ['AAA'])
  const top = await scanFunding({ sources: stubSources(), settings, top: 1, now: NOW })
  assert.equal(top.rows.length, 1)
  assert.equal(top.rows[0].symbol, 'BBB')
})

test('a failing venue is reported without losing the other one', async () => {
  const sources = stubSources({ hyperliquidContexts: async () => { throw new Error('Hyperliquid: HTTP 429') } })
  const result = await scanFunding({ sources, settings, now: NOW })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].venue, 'gate')
  assert.ok(result.errors.some(error => error.source === 'hyperliquid'))
})

test('a non-trading Gate contract is kept and flagged instead of dropped', async () => {
  const sources = stubSources({
    gateFundingContracts: async () => [{
      venue: 'gate', contract: 'CCC_USDT', symbol: 'CCC', rate: 0.0003, intervalHours: 8,
      nextFundingAt: null, markPrice: 1, indexPrice: 1, takerBps: 5, leverageMax: 10,
      status: 'closed', preMarket: false, delisting: false, source: 'gate',
    }],
  })
  const result = await scanFunding({ sources, settings, now: NOW })
  const ccc = result.rows.find(row => row.symbol === 'CCC')
  assert.ok(ccc !== undefined)
  assert.ok(ccc.flags.includes('inactive-contract'))
})

test('invalid venue selection is rejected', async () => {
  await assert.rejects(scanFunding({ sources: stubSources(), settings, venues: ['kraken'], now: NOW }), /venues/)
})
