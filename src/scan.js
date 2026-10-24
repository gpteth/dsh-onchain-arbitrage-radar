import { round } from './math.js'

const BPS = 10_000
const SYMBOL_RE = /^[A-Z0-9]{2,12}$/

export function normalizeSymbols(symbols, limit = 20) {
  const list = Array.isArray(symbols) && symbols.length > 0 ? symbols : []
  const cleaned = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const symbol = item.trim().toUpperCase()
    if (SYMBOL_RE.test(symbol) && !cleaned.includes(symbol)) cleaned.push(symbol)
    if (cleaned.length >= limit) break
  }
  return cleaned
}

function direction({ buy, sell, buyFeeBps, sellFeeBps, slippageBps, conversionBufferBps, sizeQuote, buyDepthQuote, sellDepthQuote }) {
  const grossBps = (sell.price / buy.price - 1) * BPS
  const costBps = buyFeeBps + sellFeeBps + 2 * slippageBps + conversionBufferBps
  const netBps = grossBps - costBps
  const depths = [buyDepthQuote, sellDepthQuote].filter(value => value !== null)
  return {
    buyVenue: buy.venue,
    sellVenue: sell.venue,
    buyPrice: round(buy.price, 8),
    sellPrice: round(sell.price, 8),
    grossBps: round(grossBps, 2),
    costBps: round(costBps, 2),
    netBps: round(netBps, 2),
    netQuote: round(sizeQuote * netBps / BPS, 4),
    depthQuote: depths.length > 0 ? round(Math.min(...depths), 2) : null,
  }
}

export async function scanSpreads({ sources, settings, symbols, sizeQuote, slippageBps, now = Date.now() }) {
  const bases = normalizeSymbols(symbols ?? settings.scan.symbols)
  if (bases.length === 0) throw new Error('No usable symbol was supplied; pass base assets such as BTC or ETH.')
  const size = sizeQuote ?? settings.scan.sizeQuote
  if (!(Number.isFinite(size) && size > 0)) throw new Error('sizeQuote must be a positive number')
  const slippage = slippageBps ?? settings.scan.slippageBps
  if (!(Number.isFinite(slippage) && slippage >= 0)) throw new Error('slippageBps must be a non-negative number')

  const errors = []
  let rate = null
  let rateTried = false
  const rateFor = async () => {
    if (!rateTried) {
      rateTried = true
      try { rate = await sources.usdtPerUsd() } catch (error) { errors.push({ source: 'usdt-rate', message: error.message }) }
    }
    return rate
  }

  const fetchedAt = new Date(now).toISOString()
  const rows = []
  await Promise.all(bases.map(async base => {
    let gateQuote
    try {
      gateQuote = await sources.gatePairFor(base)
    } catch (error) {
      errors.push({ source: 'gate-pairs', message: error.message })
    }
    if (gateQuote === undefined) {
      rows.push({ base, verdict: 'unavailable', reasons: ['gate-market-missing'], fetchedAt })
      return
    }
    const [gateResult, bitfinexResult] = await Promise.allSettled([
      sources.gateTicker(gateQuote.pair),
      sources.bitfinexTicker(base),
    ])
    if (gateResult.status === 'rejected') errors.push({ source: 'gate', message: gateResult.reason.message })
    if (bitfinexResult.status === 'rejected') errors.push({ source: 'bitfinex', message: bitfinexResult.reason.message })
    if (gateResult.status === 'rejected' || bitfinexResult.status === 'rejected') {
      rows.push({
        base,
        pair: { gate: gateQuote.pair, bitfinex: `${base.toLowerCase()}usd` },
        verdict: 'unavailable',
        reasons: [...(gateResult.status === 'rejected' ? ['gate-unavailable'] : []), ...(bitfinexResult.status === 'rejected' ? ['bitfinex-unavailable'] : [])],
        fetchedAt,
      })
      return
    }

    const gate = gateResult.value
    const bitfinex = bitfinexResult.value
    const conversion = gateQuote.quote === 'USDT'
    const rateNow = conversion ? await rateFor() : null
    const usdtPerUsd = rateNow?.usdtPerUsd ?? null
    const convert = price => (conversion && usdtPerUsd !== null ? price / rateNow.usdtUsd : price)
    const conversionBufferBps = conversion ? (rateNow === null ? settings.transfer.usdtFallbackBufferBps : settings.transfer.conversionBufferBps) : 0
    const quoteUnit = conversion ? 'USDT' : 'USD'

    const gateSide = {
      venue: 'gate',
      bid: gate.bid,
      ask: gate.ask,
      bidDepth: gate.bidSize === null ? null : gate.bidSize * gate.bid,
      askDepth: gate.askSize === null ? null : gate.askSize * gate.ask,
    }
    const bitfinexSide = {
      venue: 'bitfinex',
      bid: convert(bitfinex.bid),
      ask: convert(bitfinex.ask),
      bidDepth: null,
      askDepth: null,
    }
    const fee = venue => settings.venues[venue].takerBps
    const common = { slippageBps: slippage, conversionBufferBps, sizeQuote: size }
    const forward = direction({
      ...common,
      buy: { venue: 'gate', price: gateSide.ask },
      sell: { venue: 'bitfinex', price: bitfinexSide.bid },
      buyFeeBps: fee('gate'), sellFeeBps: fee('bitfinex'),
      buyDepthQuote: gateSide.askDepth, sellDepthQuote: null,
    })
    const reverse = direction({
      ...common,
      buy: { venue: 'bitfinex', price: bitfinexSide.ask },
      sell: { venue: 'gate', price: gateSide.bid },
      buyFeeBps: fee('bitfinex'), sellFeeBps: fee('gate'),
      buyDepthQuote: null, sellDepthQuote: gateSide.bidDepth,
    })
    const best = forward.netBps >= reverse.netBps ? forward : reverse
    const other = best === forward ? reverse : forward

    const rawAge = bitfinex.observedAt === null ? null : (now - Date.parse(bitfinex.observedAt)) / 1000
    const ageSeconds = rawAge === null ? null : Math.max(0, round(rawAge, 1))
    const notes = ['Gate spot tickers carry no server timestamp; the fetch time is recorded instead.', 'Bitfinex public ticker exposes no top-of-book size; depth there is unverified.']
    if (rawAge !== null && rawAge < -1) notes.push('Bitfinex timestamp is ahead of the local clock; quote age is clamped to 0.')
    const reasons = []
    if (conversion && rateNow === null) reasons.push('conversion-rate-unavailable')
    if (ageSeconds !== null && ageSeconds > settings.thresholds.maxQuoteAgeSeconds) reasons.push('stale-bitfinex-quote')
    if (best.depthQuote !== null && best.depthQuote < size) reasons.push('shallow-top-of-book')
    if (best.netBps < 0) reasons.push('negative-net')
    else if (best.netBps < settings.thresholds.goBps) reasons.push('below-go-threshold')
    const blocking = reasons.some(reason => ['conversion-rate-unavailable', 'stale-bitfinex-quote', 'shallow-top-of-book'].includes(reason))
    const verdict = blocking ? 'no-go' : best.netBps >= settings.thresholds.goBps ? 'go' : best.netBps > 0 ? 'watch' : 'no-go'

    rows.push({
      base,
      quoteUnit,
      pair: { gate: gateQuote.pair, bitfinex: bitfinex.pair },
      sizeQuote: size,
      slippageBps: slippage,
      conversion: conversion
        ? { usdtUsd: rateNow === null ? null : round(rateNow.usdtUsd, 6), bufferBps: conversionBufferBps, source: rateNow?.source ?? null }
        : null,
      best,
      other: { buyVenue: other.buyVenue, sellVenue: other.sellVenue, netBps: other.netBps },
      ageSeconds: ageSeconds === null ? null : round(ageSeconds, 1),
      verdict,
      reasons,
      notes,
      quotes: {
        gate: { bid: gate.bid, ask: gate.ask, bidSizeBase: gate.bidSize, askSizeBase: gate.askSize, quoteVolume24h: gate.quoteVolume24h, observedAt: fetchedAt, source: gate.source },
        bitfinex: { bid: round(bitfinex.bid, 8), ask: round(bitfinex.ask, 8), quoteVolume24h: bitfinex.quoteVolume24h, observedAt: bitfinex.observedAt, source: bitfinex.source },
      },
      orderBookNote: verdict === 'go' ? 'Top-of-book only: confirm full-depth prices before treating this as executable.' : null,
      fetchedAt,
    })
  }))

  rows.sort((left, right) => (right.best?.netBps ?? -Infinity) - (left.best?.netBps ?? -Infinity))
  const counts = { go: 0, watch: 0, 'no-go': 0, unavailable: 0 }
  for (const row of rows) counts[row.verdict] += 1
  const bestRow = rows.find(row => row.best !== undefined) ?? null
  return {
    ok: true,
    at: fetchedAt,
    mode: 'read-only',
    basis: 'Gate spot versus Bitfinex spot; USDT-quoted Gate markets are converted with a DeFiLlama USDT/USD rate',
    sizeQuote: size,
    slippageBps: slippage,
    thresholds: { goBps: settings.thresholds.goBps, maxQuoteAgeSeconds: settings.thresholds.maxQuoteAgeSeconds },
    counts,
    best: bestRow === null ? null : { base: bestRow.base, ...bestRow.best, verdict: bestRow.verdict, reasons: bestRow.reasons },
    rows,
    errors,
    notes: ['Quotes are public and read at call time; nobody verified that either venue would fill this size.', 'A go verdict is a scenario for review, not a realized profit.'],
  }
}
