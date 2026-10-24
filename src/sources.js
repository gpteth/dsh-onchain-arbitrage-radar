import { cached } from './runtime.js'

const GATE = 'https://api.gateio.ws/api/v4'
const BITFINEX = 'https://api.bitfinex.com/v1/pubticker'
const HYPERLIQUID = 'https://api.hyperliquid.xyz/info'
const LLAMA = 'https://coins.llama.fi/prices/current/coingecko:tether'

const numberOrNull = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const sourceError = (venue, error) => new Error(`${venue}: ${error instanceof Error ? error.message : String(error)}`)

export function createSources({ settings, runtime }) {
  const timeoutMs = settings.requestTimeoutMs

  async function request(url, body) {
    const init = { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } }
    if (body !== undefined) {
      init.method = 'POST'
      init.body = JSON.stringify(body)
      init.headers['content-type'] = 'application/json'
    }
    const response = await fetch(url, init)
    if (!response.ok) {
      const url_ = new URL(url)
      throw new Error(`HTTP ${response.status} from ${url_.host}${url_.pathname}`)
    }
    return response.json()
  }

  async function gatePairs() {
    return cached(runtime, 'gate:pairs', 600_000, async () => {
      const pairs = await request(`${GATE}/spot/currency_pairs`)
      if (!Array.isArray(pairs)) throw new Error('unexpected pair directory shape')
      return new Set(pairs.map(pair => pair.id))
    })
  }

  // Prefer a real USD market when Gate lists one, so a cross-venue USD/USD
  // comparison needs no stablecoin conversion.
  async function gatePairFor(base) {
    let pairs
    try { pairs = await gatePairs() } catch { pairs = undefined }
    const usd = `${base}_USD`
    const usdt = `${base}_USDT`
    if (pairs !== undefined) {
      if (pairs.has(usd)) return { pair: usd, quote: 'USD' }
      if (pairs.has(usdt)) return { pair: usdt, quote: 'USDT' }
      return undefined
    }
    return { pair: usdt, quote: 'USDT' }
  }

  async function gateTicker(pair) {
    try {
      const data = await request(`${GATE}/spot/tickers?currency_pair=${encodeURIComponent(pair)}`)
      if (!Array.isArray(data) || data.length === 0) throw new Error(`no quote for ${pair}`)
      const item = data[0]
      const bid = Number(item.highest_bid)
      const ask = Number(item.lowest_ask)
      if (!(bid > 0) || !(ask > 0)) throw new Error(`empty book for ${pair}`)
      return {
        venue: 'gate', pair, bid, ask,
        bidSize: numberOrNull(item.highest_size),
        askSize: numberOrNull(item.lowest_size),
        last: numberOrNull(item.last),
        quoteVolume24h: Number(item.quote_volume),
        changePct: Number(item.change_percentage),
        observedAt: null,
        source: `${GATE}/spot/tickers?currency_pair=${encodeURIComponent(pair)}`,
      }
    } catch (error) {
      throw sourceError('Gate', error)
    }
  }

  async function bitfinexTicker(base) {
    const symbol = `${base.toLowerCase()}usd`
    try {
      const item = await request(`${BITFINEX}/${symbol}`)
      const bid = Number(item.bid)
      const ask = Number(item.ask)
      if (!(bid > 0) || !(ask > 0)) throw new Error(`empty book for ${symbol}`)
      const stamp = Number(item.timestamp)
      return {
        venue: 'bitfinex', pair: symbol, bid, ask,
        bidSize: null, askSize: null,
        last: numberOrNull(item.last_price),
        quoteVolume24h: null,
        changePct: null,
        observedAt: Number.isFinite(stamp) ? new Date(stamp * 1000).toISOString() : null,
        source: `${BITFINEX}/${symbol}`,
      }
    } catch (error) {
      throw sourceError('Bitfinex', error)
    }
  }

  // USDT per USD. The paper only needs one trusted reference; a missing rate
  // makes a USDT/USD comparison fail closed instead of assuming parity.
  async function usdtPerUsd() {
    const price = await cached(runtime, 'usdt:usd', 60_000, async () => {
      const data = await request(LLAMA)
      const raw = data?.coins?.['coingecko:tether']?.price
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0.9 || parsed > 1.1) throw new Error('no usable USDT/USD rate')
      return parsed
    })
    return { usdtUsd: price, usdtPerUsd: 1 / price, at: new Date().toISOString(), source: LLAMA }
  }

  async function gateFundingContracts() {
    try {
      const contracts = await request(`${GATE}/futures/usdt/contracts`)
      if (!Array.isArray(contracts)) throw new Error('unexpected contract list shape')
      // Keep non-trading rows too and flag them: silently dropping a status
      // Gate renames would make a whole venue disappear from the scan.
      return contracts
        .filter(contract => typeof contract?.name === 'string' && contract.name.endsWith('_USDT'))
        .map(contract => {
          const intervalHours = Number(contract.funding_interval) / 3600
          const apply = Number(contract.funding_next_apply)
          return {
            venue: 'gate',
            contract: contract.name,
            symbol: contract.name.split('_')[0],
            rate: Number(contract.funding_rate),
            intervalHours,
            nextFundingAt: Number.isFinite(apply) && apply > 0 ? new Date(apply * 1000).toISOString() : null,
            markPrice: Number(contract.mark_price),
            indexPrice: Number(contract.index_price),
            takerBps: Number(contract.taker_fee_rate) * 10_000,
            leverageMax: Number(contract.leverage_max),
            status: typeof contract.status === 'string' ? contract.status : null,
            preMarket: contract.is_pre_market === true,
            delisting: contract.in_delisting === true,
            source: `${GATE}/futures/usdt/contracts`,
          }
        })
        .filter(row => Number.isFinite(row.rate) && Number.isFinite(row.intervalHours) && row.intervalHours > 0)
    } catch (error) {
      throw sourceError('Gate futures', error)
    }
  }

  async function gateFundingHistory(contract, limit) {
    try {
      const rows = await request(`${GATE}/futures/usdt/funding_rate?contract=${encodeURIComponent(contract)}&limit=${limit}`)
      if (!Array.isArray(rows)) throw new Error('unexpected funding history shape')
      return rows
        .map(row => Number(row.r))
        .filter(rate => Number.isFinite(rate))
    } catch (error) {
      throw sourceError('Gate funding history', error)
    }
  }

  async function hyperliquidContexts() {
    try {
      const payload = await request(HYPERLIQUID, { type: 'metaAndAssetCtxs' })
      const meta = payload?.[0]
      const contexts = payload?.[1]
      if (!Array.isArray(meta?.universe) || !Array.isArray(contexts)) throw new Error('unexpected metaAndAssetCtxs shape')
      return meta.universe
        .map((asset, index) => ({ asset, context: contexts[index] }))
        .filter(({ asset, context }) => asset?.isDelisted !== true && context !== undefined && Number.isFinite(Number(context.funding)))
        .map(({ asset, context }) => ({
          venue: 'hyperliquid',
          contract: asset.name,
          symbol: asset.name,
          rate: Number(context.funding),
          // Hyperliquid funding is charged hourly.
          intervalHours: 1,
          nextFundingAt: null,
          markPrice: Number(context.markPx),
          indexPrice: Number(context.oraclePx),
          openInterestUsd: Number(context.openInterest) * Number(context.markPx),
          dayVolumeUsd: Number(context.dayNtlVlm),
          leverageMax: Number(asset.maxLeverage),
          preMarket: false,
          delisting: false,
          source: HYPERLIQUID,
        }))
        .filter(row => Number.isFinite(row.rate))
    } catch (error) {
      throw sourceError('Hyperliquid', error)
    }
  }

  async function hyperliquidFundingHistory(coin, startTime) {
    try {
      const rows = await request(HYPERLIQUID, { type: 'fundingHistory', coin, startTime })
      if (!Array.isArray(rows)) throw new Error('unexpected fundingHistory shape')
      return rows.map(row => Number(row.fundingRate)).filter(rate => Number.isFinite(rate))
    } catch (error) {
      throw sourceError('Hyperliquid funding history', error)
    }
  }

  return {
    gatePairFor, gateTicker, bitfinexTicker, usdtPerUsd,
    gateFundingContracts, gateFundingHistory,
    hyperliquidContexts, hyperliquidFundingHistory,
  }
}
