import { round } from './math.js'

const BPS = 10_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Regular-session state in New York time. Exchange holidays and early closes
 * are not modeled; callers treat the result as approximate.
 */
export function usEquitySession(now = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(now))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]))
  const weekdayIndex = WEEKDAYS.indexOf(parts.weekday)
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  const businessDay = weekdayIndex >= 1 && weekdayIndex <= 5
  let state = 'closed'
  if (businessDay && minutes >= 240 && minutes < 570) state = 'pre-market'
  else if (businessDay && minutes >= 570 && minutes < 960) state = 'open'
  else if (businessDay && minutes >= 960 && minutes < 1200) state = 'after-hours'

  let minutesUntilNextOpen
  if (businessDay && minutes < 570) {
    minutesUntilNextOpen = 570 - minutes
  } else {
    let days = 0
    for (;;) {
      days += 1
      const index = (weekdayIndex + days) % 7
      if (index >= 1 && index <= 5) break
    }
    minutesUntilNextOpen = days * 1440 - minutes + 570
  }
  return {
    state,
    etWeekday: parts.weekday,
    etTime: `${parts.hour}:${parts.minute}`,
    businessDay,
    minutesUntilNextOpen,
    approximate: true,
    holidayNote: 'US market holidays and early closes are not modeled.',
  }
}

function normalizeTokens(tokens) {
  if (!Array.isArray(tokens)) return []
  const out = []
  for (const item of tokens) {
    if (typeof item !== 'string') continue
    const token = item.trim().toUpperCase().replace(/_USDT$/, '')
    if (/^[A-Z0-9]{2,12}$/.test(token) && !out.includes(token)) out.push(token)
  }
  return out
}

function matchReference(reference, token, underlying, single) {
  if (reference === undefined) return undefined
  if (reference.token === undefined) return single ? reference : undefined
  return reference.token === token || reference.token === underlying ? reference : undefined
}

export async function stockClock({ sources, settings, tokens, reference, thresholdBps, now = Date.now() }) {
  const list = normalizeTokens(tokens ?? settings.stocks.tokens)
  if (list.length === 0) throw new Error('tokens must name at least one Gate tokenized-stock market, such as NVDAX')
  const threshold = thresholdBps ?? settings.thresholds.stockDeviationBps
  if (!(Number.isFinite(threshold) && threshold > 0)) throw new Error('thresholdBps must be a positive number')

  let parsedReference
  if (reference !== undefined) {
    if (typeof reference !== 'object' || reference === null) throw new Error('reference must be an object')
    if (!(Number.isFinite(reference.price) && reference.price > 0)) throw new Error('reference.price must be a positive number')
    if (typeof reference.source !== 'string' || reference.source.trim() === '') throw new Error('reference.source must name where the price came from')
    const asOf = String(reference.asOf ?? '')
    if (!Number.isFinite(Date.parse(asOf))) throw new Error('reference.asOf must be an ISO timestamp')
    if (reference.currency !== undefined && String(reference.currency).toUpperCase() !== 'USD') throw new Error('reference.currency must be USD')
    parsedReference = {
      token: reference.token === undefined ? undefined : String(reference.token).toUpperCase().replace(/_USDT$/, ''),
      price: reference.price,
      source: reference.source.trim(),
      asOf: new Date(asOf).toISOString(),
      currency: 'USD',
      ageHours: round((now - Date.parse(asOf)) / 3_600_000, 1),
    }
  }

  let rate = null
  let rateError
  try { rate = await sources.usdtPerUsd() } catch (error) { rateError = error.message }

  const session = usEquitySession(now)
  const errors = []
  const rows = await Promise.all(list.map(async token => {
    const pair = `${token}_USDT`
    const underlying = token.endsWith('X') ? token.slice(0, -1) : token
    try {
      const quote = await sources.gateTicker(pair)
      const mid = (quote.bid + quote.ask) / 2
      const spreadBps = (quote.ask - quote.bid) / mid * BPS
      const midUsd = rate === null ? null : mid * rate.usdtUsd
      const matched = parsedReference === undefined ? undefined : matchReference(parsedReference, token, underlying, list.length === 1)
      const deviationBps = matched === undefined || midUsd === null ? null : (midUsd - matched.price) / matched.price * BPS
      const flags = []
      if (matched === undefined) flags.push('reference-required')
      else {
        if (matched.ageHours > 24) flags.push('reference-stale')
        if (deviationBps !== null && Math.abs(deviationBps) >= threshold) flags.push('deviation-above-threshold')
      }
      if (session.state !== 'open') flags.push('closed-window')
      if (quote.quoteVolume24h !== null && quote.quoteVolume24h < settings.thresholds.minDayVolumeUsd) flags.push('liquidity-thin')
      if (spreadBps > 50) flags.push('wide-book')
      return {
        token,
        pair,
        underlying,
        bid: quote.bid,
        ask: quote.ask,
        mid: round(mid, 6),
        spreadBps: round(spreadBps, 2),
        quoteVolume24h: Number.isFinite(quote.quoteVolume24h) ? round(quote.quoteVolume24h, 2) : null,
        usdtUsd: rate === null ? null : round(rate.usdtUsd, 6),
        midUsd: midUsd === null ? null : round(midUsd, 6),
        reference: matched === undefined ? null : { price: matched.price, source: matched.source, asOf: matched.asOf, ageHours: matched.ageHours },
        deviationBps: deviationBps === null ? null : round(deviationBps, 2),
        status: matched === undefined ? 'reference-required' : 'ready',
        flags,
        source: quote.source,
      }
    } catch (error) {
      errors.push({ token, message: error.message })
      return { token, pair, underlying, status: 'unavailable', flags: ['market-unavailable'], error: error.message }
    }
  }))

  rows.sort((left, right) => Math.abs(right.deviationBps ?? -1) - Math.abs(left.deviationBps ?? -1))
  return {
    ok: true,
    at: new Date(now).toISOString(),
    mode: 'read-only',
    thresholdBps: threshold,
    session,
    usdtUsd: rate === null ? null : round(rate.usdtUsd, 6),
    status: parsedReference === undefined ? 'reference-required' : 'ready',
    hypothesis: session.state === 'open'
      ? 'Spot is live: compare with the current underlying print, not a stale one.'
      : 'Spot is closed or thin: token quotes can drift away from the underlying. The tradable window is the convergence after the next open, and it is an event, not a standing edge.',
    notes: [
      'A tokenized stock is not the share: issuer terms, redemption gates and transfer limits can keep a premium in place.',
      rateError === undefined ? 'Token prices were converted with the DeFiLlama USDT/USD rate.' : `USDT/USD rate unavailable (${rateError}); USD deviation is blocked.`,
      session.holidayNote,
    ],
    rows,
    errors,
  }
}
