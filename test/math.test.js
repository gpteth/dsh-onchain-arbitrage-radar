import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annualizedPct, basisBps, costModel, fundingStats, guardCheck, round } from '../src/math.js'

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`)
}

const risk = { maxLossFraction: 0.02, maxLeverage: 1, minNetBps: 30, maxQuoteAgeSeconds: 60 }

test('cost model subtracts every explicit cost and reports the break-even spread', () => {
  const result = costModel({
    grossSpreadBps: 80,
    notionalQuote: 10_000,
    fees: { buyBps: 20, sellBps: 20 },
    slippage: { buyBps: 5, sellBps: 5 },
    fixedCosts: { gasQuote: 2, withdrawalQuote: 0.5 },
    bufferBps: 10,
  })
  assert.equal(result.verdict, 'go')
  close(result.grossQuote, 80)
  close(result.costs.totalQuote, 62.5)
  close(result.netBps, 17.5)
  close(result.breakEvenGrossBps, 62.5)
  close(result.minEffectiveNotionalQuote, 1250)
  assert.equal(result.costMultiple, round(62.5 / 80, 3))
})

test('cost model reports a negative edge instead of clamping at zero', () => {
  const result = costModel({
    grossSpreadBps: 30,
    notionalQuote: 1000,
    fees: { buyBps: 20, sellBps: 20 },
    slippage: { buyBps: 5, sellBps: 5 },
  })
  assert.equal(result.verdict, 'no-go')
  assert.ok(result.reasons.includes('negative-net'))
  assert.equal(result.minEffectiveNotionalQuote, null)
})

test('cost model flags a size below the minimum effective size', () => {
  const result = costModel({
    grossSpreadBps: 70,
    notionalQuote: 1000,
    fees: { buyBps: 30, sellBps: 30 },
    fixedCosts: { gasQuote: 10 },
  })
  assert.ok(result.reasons.includes('size-below-minimum'))
  close(result.minEffectiveNotionalQuote, 10_000)
})

test('cost model applies a minimum net threshold', () => {
  const result = costModel({
    grossSpreadBps: 60,
    notionalQuote: 5000,
    fees: { buyBps: 20, sellBps: 20 },
    minNetBps: 25,
  })
  assert.equal(result.verdict, 'watch')
  assert.ok(result.reasons.includes('below-minimum-net'))
})

test('cost model rejects non-finite and negative inputs', () => {
  assert.throws(() => costModel({ grossSpreadBps: 10, notionalQuote: Number.NaN }), /notionalQuote/)
  assert.throws(() => costModel({ grossSpreadBps: 10, notionalQuote: 100, fees: { buyBps: -1 } }), /fees.buyBps/)
})

test('guard check passes a conservative plan and blocks an oversized loss', () => {
  const pass = guardCheck({
    mode: 'spot-spread', bankrollQuote: 10_000, maxLossQuote: 150, notionalQuote: 8000,
    expectedNetBps: 45, dataKind: 'observed', leverage: 1, quoteAgeSeconds: 12,
  }, risk)
  assert.equal(pass.pass, true)
  assert.deepEqual(pass.blocking, [])

  const blocked = guardCheck({
    mode: 'funding', bankrollQuote: 10_000, maxLossQuote: 500, notionalQuote: 25_000,
    expectedNetBps: 20, dataKind: 'synthetic', leverage: 3, quoteAgeSeconds: 120,
  }, risk)
  assert.equal(blocked.pass, false)
  assert.deepEqual(blocked.blocking.sort(), ['edge', 'evidence', 'leverage', 'max-loss', 'notional-vs-equity', 'quote-age'])
  assert.ok(blocked.warnings.length > 0)
  assert.match(blocked.reminder, /price the basis move/)
})

test('guard check rejects an unknown mode', () => {
  assert.throws(() => guardCheck({
    mode: 'yield', bankrollQuote: 100, maxLossQuote: 1, notionalQuote: 1,
    expectedNetBps: 100, dataKind: 'observed',
  }, risk), /mode/)
})

test('funding helpers annualize per interval and compute a z-score', () => {
  close(annualizedPct(0.00005, 8), 5.475)
  close(annualizedPct(0.00001, 1), 8.76)
  const values = Array.from({ length: 30 }, (_, index) => 0.00001 + (index % 5) * 0.000002)
  const stats = fundingStats(values, 0.00005)
  assert.equal(stats.points, 30)
  assert.ok(stats.z > 3)
  assert.equal(fundingStats([0.1], 0.1), null)
  close(basisBps(101, 100), 100)
})
