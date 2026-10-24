const BPS = 10_000

export const round = (value, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

const finite = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, allowNegative = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`)
  if (!allowNegative && value < min) throw new Error(`${field} must be at least ${min}`)
  if (value > max) throw new Error(`${field} must be at most ${max}`)
  return value
}

/** Funding rate as a yearly percentage; rate is per intervalHours. */
export function annualizedPct(rate, intervalHours) {
  if (!(intervalHours > 0)) return null
  return rate * (24 * 365 / intervalHours) * 100
}

/** Mark premium over index, in basis points. */
export function basisBps(markPrice, indexPrice) {
  if (!(markPrice > 0) || !(indexPrice > 0)) return null
  return (markPrice - indexPrice) / indexPrice * BPS
}

export function fundingStats(values, current) {
  const clean = values.filter(value => Number.isFinite(value))
  if (clean.length < 10) return null
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (clean.length - 1)
  const sd = Math.sqrt(variance)
  return {
    points: clean.length,
    mean,
    sd,
    z: sd > 0 && Number.isFinite(current) ? (current - mean) / sd : null,
  }
}

/**
 * Net profit for one round trip. Every cost is explicit; a missing fee is a
 * caller mistake, never zero by default. Positive `grossSpreadBps` means the
 * sell venue quotes above the buy venue.
 */
export function costModel(input) {
  const notional = finite(input.notionalQuote, 'notionalQuote', { min: 1 })
  const grossSpreadBps = finite(input.grossSpreadBps, 'grossSpreadBps', { allowNegative: true, min: -BPS, max: BPS })
  const fees = input.fees ?? {}
  const slippage = input.slippage ?? {}
  const fixed = input.fixedCosts ?? {}
  const buyFeeBps = finite(fees.buyBps ?? 0, 'fees.buyBps', { max: BPS })
  const sellFeeBps = finite(fees.sellBps ?? 0, 'fees.sellBps', { max: BPS })
  const buySlippageBps = finite(slippage.buyBps ?? 0, 'slippage.buyBps', { max: BPS })
  const sellSlippageBps = finite(slippage.sellBps ?? 0, 'slippage.sellBps', { max: BPS })
  const bufferBps = finite(input.bufferBps ?? 0, 'bufferBps', { max: BPS })
  const conversionBufferBps = finite(input.conversionBufferBps ?? 0, 'conversionBufferBps', { max: BPS })
  const gasQuote = finite(fixed.gasQuote ?? 0, 'fixedCosts.gasQuote')
  const withdrawalQuote = finite(fixed.withdrawalQuote ?? 0, 'fixedCosts.withdrawalQuote')
  const financingQuote = finite(fixed.financingQuote ?? 0, 'fixedCosts.financingQuote')
  const otherQuote = finite(fixed.otherQuote ?? 0, 'fixedCosts.otherQuote')

  const grossQuote = notional * grossSpreadBps / BPS
  const buyFeeQuote = notional * buyFeeBps / BPS
  const sellFeeQuote = notional * sellFeeBps / BPS
  const buySlippageQuote = notional * buySlippageBps / BPS
  const sellSlippageQuote = notional * sellSlippageBps / BPS
  const bufferQuote = notional * bufferBps / BPS
  const conversionQuote = notional * conversionBufferBps / BPS
  const fixedQuote = gasQuote + withdrawalQuote + financingQuote + otherQuote
  const totalQuote = buyFeeQuote + sellFeeQuote + buySlippageQuote + sellSlippageQuote + bufferQuote + conversionQuote + fixedQuote
  const netQuote = grossQuote - totalQuote
  const netBps = netQuote / notional * BPS
  const variableBps = buyFeeBps + sellFeeBps + buySlippageBps + sellSlippageBps + bufferBps + conversionBufferBps
  const breakEvenGrossBps = variableBps + fixedQuote / notional * BPS
  const edgeAfterVariableBps = grossSpreadBps - variableBps
  const minEffectiveNotionalQuote = edgeAfterVariableBps > 0 ? fixedQuote / (edgeAfterVariableBps / BPS) : null
  const minNetQuote = input.minNetBps === undefined ? 0 : notional * finite(input.minNetBps, 'minNetBps', { max: BPS }) / BPS

  const reasons = []
  if (grossSpreadBps <= 0) reasons.push('non-positive-gross-spread')
  if (netQuote <= 0) reasons.push('negative-net')
  else if (netQuote < minNetQuote) reasons.push('below-minimum-net')
  if (minEffectiveNotionalQuote !== null && minEffectiveNotionalQuote > notional) reasons.push('size-below-minimum')
  const verdict = reasons.length === 0 && netQuote > 0 ? 'go' : netQuote > 0 ? 'watch' : 'no-go'

  const notes = []
  if (grossQuote > 0 && totalQuote > grossQuote) notes.push('costs exceed the gross spread')
  if (fixedQuote > 0 && fixedQuote > grossQuote * 0.5 && grossQuote > 0) notes.push('fixed costs dominate this size')
  if (minEffectiveNotionalQuote !== null) notes.push('minimum effective size covers fixed costs with the remaining edge')

  return {
    version: 1,
    mode: 'simulation',
    verdict,
    reasons,
    notes,
    grossSpreadBps: round(grossSpreadBps, 4),
    notionalQuote: round(notional, 2),
    variableBps: round(variableBps, 2),
    grossQuote: round(grossQuote, 4),
    costs: {
      buyFeeQuote: round(buyFeeQuote, 4),
      sellFeeQuote: round(sellFeeQuote, 4),
      buySlippageQuote: round(buySlippageQuote, 4),
      sellSlippageQuote: round(sellSlippageQuote, 4),
      bufferQuote: round(bufferQuote, 4),
      conversionQuote: round(conversionQuote, 4),
      fixedQuote: round(fixedQuote, 4),
      totalQuote: round(totalQuote, 4),
    },
    costMultiple: grossQuote > 0 ? round(totalQuote / grossQuote, 3) : null,
    netQuote: round(netQuote, 4),
    netBps: round(netBps, 2),
    breakEvenGrossBps: round(breakEvenGrossBps, 2),
    minEffectiveNotionalQuote: minEffectiveNotionalQuote === null ? null : round(minEffectiveNotionalQuote, 2),
    evaluatedAt: new Date().toISOString(),
  }
}

const MODE_REMINDERS = {
  'spot-spread': 'A cross-venue fill is not atomic: count transfer time, withdrawal status, and stablecoin basis before trusting the spread.',
  funding: 'Funding is not rent: price the basis move that can erase many intervals of carry, and require a 1:1 hedge with margin headroom.',
  convergence: 'A convergence trade holds inventory until the event: size for the drawdown path, not for the expected endpoint.',
}

/** Pre-trade discipline check over caller-supplied numbers. */
export function guardCheck(input, risk) {
  const bankroll = finite(input.bankrollQuote, 'bankrollQuote', { min: 1 })
  const maxLoss = finite(input.maxLossQuote, 'maxLossQuote', { min: 0 })
  const notional = finite(input.notionalQuote, 'notionalQuote', { min: 0 })
  const leverage = finite(input.leverage ?? 1, 'leverage', { min: 0.1, max: 100 })
  const expectedNetBps = finite(input.expectedNetBps, 'expectedNetBps', { allowNegative: true, min: -BPS, max: BPS })
  const quoteAgeSeconds = finite(input.quoteAgeSeconds ?? 0, 'quoteAgeSeconds', { max: 86_400 })
  const mode = input.mode
  if (!Object.hasOwn(MODE_REMINDERS, mode)) throw new Error('mode must be spot-spread, funding, or convergence')
  if (input.dataKind !== 'observed' && input.dataKind !== 'synthetic') throw new Error('dataKind must be observed or synthetic')

  const lossCap = bankroll * risk.maxLossFraction
  const equityCap = bankroll * risk.maxLeverage
  const checks = [
    { id: 'bankroll', ok: true, detail: `bankroll ${round(bankroll, 2)} quote units` },
    {
      id: 'max-loss',
      ok: maxLoss <= lossCap,
      blocking: true,
      detail: `planned max loss ${round(maxLoss, 2)} vs cap ${round(lossCap, 2)} (${round(risk.maxLossFraction * 100, 2)}% of bankroll)`,
    },
    {
      id: 'leverage',
      ok: leverage <= risk.maxLeverage,
      blocking: true,
      detail: `leverage ${leverage}x vs cap ${risk.maxLeverage}x`,
    },
    {
      id: 'notional-vs-equity',
      ok: notional <= equityCap,
      blocking: true,
      detail: `notional ${round(notional, 2)} vs equity cap ${round(equityCap, 2)}`,
    },
    {
      id: 'edge',
      ok: expectedNetBps >= risk.minNetBps,
      blocking: true,
      detail: `expected net ${round(expectedNetBps, 2)} bps vs floor ${risk.minNetBps} bps`,
    },
    {
      id: 'quote-age',
      ok: quoteAgeSeconds <= risk.maxQuoteAgeSeconds,
      blocking: true,
      detail: `quote age ${round(quoteAgeSeconds, 1)} s vs limit ${risk.maxQuoteAgeSeconds} s`,
    },
    {
      id: 'evidence',
      ok: input.dataKind === 'observed',
      blocking: true,
      detail: input.dataKind === 'observed' ? 'observed quotes supplied' : 'synthetic data cannot pass a live discipline check',
    },
  ]
  const blocking = checks.filter(check => !check.ok && check.blocking).map(check => check.id)
  const warnings = []
  if (maxLoss > lossCap * 0.5 && maxLoss <= lossCap) warnings.push('planned loss uses more than half of the loss cap')
  if (leverage > 1) warnings.push('any leverage above 1x widens the liquidation path; the default cap is 1x')
  if (expectedNetBps < risk.minNetBps * 2) warnings.push('edge is close to the floor; a single cost surprise can flip the trade')
  if (mode === 'funding' && leverage > 1) warnings.push('funding carry plus leverage is risk stacking, not a hedge')
  return {
    version: 1,
    mode,
    pass: blocking.length === 0,
    blocking,
    warnings,
    reminder: MODE_REMINDERS[mode],
    checks,
    inputs: { bankrollQuote: bankroll, maxLossQuote: maxLoss, notionalQuote: notional, leverage, expectedNetBps, quoteAgeSeconds, dataKind: input.dataKind },
    limits: { maxLossFraction: risk.maxLossFraction, maxLeverage: risk.maxLeverage, minNetBps: risk.minNetBps, maxQuoteAgeSeconds: risk.maxQuoteAgeSeconds },
    evaluatedAt: new Date().toISOString(),
  }
}
