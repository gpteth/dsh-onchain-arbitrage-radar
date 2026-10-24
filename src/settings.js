// Plugin config: the row config is plain YAML, so every field is optional and
// an unusable value falls back to the default instead of failing activation.
const DEFAULTS = {
  thresholds: {
    goBps: 30,
    minNetQuote: 1,
    maxQuoteAgeSeconds: 20,
    stockDeviationBps: 150,
    minOiUsd: 1_000_000,
    minDayVolumeUsd: 500_000,
    fundingWatchPct: 30,
  },
  venues: {
    gate: { takerBps: 20 },
    bitfinex: { takerBps: 20 },
  },
  scan: {
    symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'LTC', 'DOT'],
    sizeQuote: 1000,
    slippageBps: 5,
  },
  funding: {
    venues: ['gate', 'hyperliquid'],
    top: 15,
    historyPoints: 60,
    historyCandidates: 3,
    minAnnualizedPct: 0,
  },
  stocks: {
    tokens: ['NVDAX', 'TSLAX', 'COINX', 'SPYX', 'QQQX', 'AMZNX', 'MSTRX', 'CRCLX'],
  },
  transfer: {
    conversionBufferBps: 5,
    usdtFallbackBufferBps: 15,
  },
  risk: {
    maxLossFraction: 0.02,
    maxLeverage: 1,
    minNetBps: 30,
    maxQuoteAgeSeconds: 60,
  },
  requestTimeoutMs: 8000,
  panel: {
    path: '/arb-radar',
    enabled: true,
    throttleMs: 5000,
  },
  maxRecords: 200,
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fits = (value, fallback) => {
  if (Array.isArray(fallback)) return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim() !== '')
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (typeof fallback === 'boolean') return typeof value === 'boolean'
  if (typeof fallback === 'string') return typeof value === 'string' && value.trim() !== ''
  return false
}

function merge(defaults, input, warnings, path) {
  const output = {}
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = isPlainObject(input) ? input[key] : undefined
    const field = path === '' ? key : `${path}.${key}`
    if (isPlainObject(fallback)) {
      output[key] = merge(fallback, value, warnings, field)
      continue
    }
    if (value === undefined) {
      output[key] = fallback
      continue
    }
    if (fits(value, fallback)) {
      output[key] = Array.isArray(value) ? value.map(item => item.trim().toUpperCase()) : value
    } else {
      warnings.push(`config.${field}: ignored an unusable value and kept the default`)
      output[key] = fallback
    }
  }
  return output
}

function clamp(settings, path, min, max) {
  const parts = path.split('.')
  const last = parts.pop()
  const target = parts.reduce((node, key) => node[key], settings)
  target[last] = Math.min(max, Math.max(min, target[last]))
}

export function resolveSettings(config) {
  const warnings = []
  const settings = merge(DEFAULTS, isPlainObject(config) ? config : {}, warnings, '')
  clamp(settings, 'thresholds.goBps', 0, 10_000)
  clamp(settings, 'thresholds.maxQuoteAgeSeconds', 1, 300)
  clamp(settings, 'thresholds.stockDeviationBps', 1, 100_000)
  clamp(settings, 'thresholds.fundingWatchPct', 0, 100_000)
  clamp(settings, 'venues.gate.takerBps', 0, 1_000)
  clamp(settings, 'venues.bitfinex.takerBps', 0, 1_000)
  clamp(settings, 'scan.sizeQuote', 1, 1_000_000_000)
  clamp(settings, 'scan.slippageBps', 0, 1_000)
  clamp(settings, 'funding.top', 1, 100)
  clamp(settings, 'funding.historyPoints', 10, 500)
  clamp(settings, 'funding.historyCandidates', 0, 10)
  clamp(settings, 'transfer.conversionBufferBps', 0, 1_000)
  clamp(settings, 'risk.maxLossFraction', 0.0001, 1)
  clamp(settings, 'risk.maxLeverage', 0.1, 100)
  clamp(settings, 'requestTimeoutMs', 500, 60_000)
  clamp(settings, 'panel.throttleMs', 0, 600_000)
  clamp(settings, 'maxRecords', 10, 5_000)
  settings.funding.venues = settings.funding.venues.map(venue => venue.toLowerCase()).filter(venue => venue === 'gate' || venue === 'hyperliquid')
  if (settings.funding.venues.length === 0) {
    settings.funding.venues = DEFAULTS.funding.venues.slice()
    warnings.push('config.funding.venues: kept the default because no supported venue was left')
  }
  if (!settings.panel.path.startsWith('/')) settings.panel.path = `/${settings.panel.path}`
  settings.panel.path = settings.panel.path.replace(/\/+$/, '')
  settings.warnings = warnings
  return settings
}

export { DEFAULTS }
