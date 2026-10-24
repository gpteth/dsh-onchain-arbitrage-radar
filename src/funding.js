import { annualizedPct, basisBps, fundingStats, round } from './math.js'
import { normalizeSymbols } from './scan.js'

const flagsFor = (row, settings) => {
  const flags = []
  if (row.rate < 0) flags.push('negative-rate')
  if (Math.abs(row.annualizedPct) >= settings.thresholds.fundingWatchPct) flags.push('above-watch-line')
  if (row.openInterestUsd !== null && row.openInterestUsd < settings.thresholds.minOiUsd) flags.push('thin-open-interest')
  if (row.openInterestUsd === null) flags.push('open-interest-unknown')
  if (row.dayVolumeUsd !== null && row.dayVolumeUsd < settings.thresholds.minDayVolumeUsd) flags.push('thin-volume')
  if (row.z !== null && Math.abs(row.z) >= 3) flags.push('extreme-z')
  if (row.preMarket) flags.push('pre-market')
  if (row.delisting) flags.push('delisting')
  if (row.status !== null && row.status !== undefined && row.status !== 'trading' && row.status !== 'open') flags.push('inactive-contract')
  return flags
}

export async function scanFunding({ sources, settings, venues, symbols, top, minAnnualizedPct, now = Date.now() }) {
  const wanted = Array.isArray(venues) && venues.length > 0
    ? venues.map(venue => String(venue).toLowerCase()).filter(venue => venue === 'gate' || venue === 'hyperliquid')
    : settings.funding.venues
  if (wanted.length === 0) throw new Error('venues must include gate or hyperliquid')
  const bases = symbols === undefined ? null : normalizeSymbols(symbols)
  const limit = top ?? settings.funding.top
  const floor = minAnnualizedPct ?? settings.funding.minAnnualizedPct
  const errors = []
  const rows = []

  await Promise.all(wanted.map(async venue => {
    try {
      const source = venue === 'gate' ? await sources.gateFundingContracts() : await sources.hyperliquidContexts()
      for (const item of source) {
        if (bases !== null && !bases.includes(item.symbol)) continue
        const annualized = annualizedPct(item.rate, item.intervalHours)
        if (annualized === null) continue
        if (Math.abs(annualized) < floor) continue
        rows.push({
          venue: item.venue,
          symbol: item.symbol,
          contract: item.contract,
          ratePct: round(item.rate * 100, 6),
          intervalHours: item.intervalHours,
          annualizedPct: round(annualized, 2),
          basisBps: item.indexPrice === undefined ? null : (() => {
            const basis = basisBps(item.markPrice, item.indexPrice)
            return basis === null ? null : round(basis, 2)
          })(),
          markPrice: Number.isFinite(item.markPrice) ? item.markPrice : null,
          indexPrice: Number.isFinite(item.indexPrice) ? item.indexPrice : null,
          openInterestUsd: item.openInterestUsd === undefined || !Number.isFinite(item.openInterestUsd) ? null : round(item.openInterestUsd, 0),
          dayVolumeUsd: item.dayVolumeUsd === undefined || !Number.isFinite(item.dayVolumeUsd) ? null : round(item.dayVolumeUsd, 0),
          nextFundingAt: item.nextFundingAt ?? null,
          leverageMax: Number.isFinite(item.leverageMax) ? item.leverageMax : null,
          status: item.status ?? null,
          preMarket: item.preMarket === true,
          delisting: item.delisting === true,
          z: null,
          historyPoints: null,
          source: item.source,
        })
      }
    } catch (error) {
      errors.push({ source: venue, message: error.message })
    }
  }))

  rows.sort((left, right) => right.annualizedPct - left.annualizedPct)
  const bestByVenue = []
  for (const venue of wanted) {
    const row = rows.find(candidate => candidate.venue === venue)
    if (row !== undefined) {
      bestByVenue.push({ venue: row.venue, symbol: row.symbol, annualizedPct: row.annualizedPct, basisBps: row.basisBps })
    }
  }
  const kept = rows.slice(0, limit)
  const candidateCount = Math.min(settings.funding.historyCandidates, kept.length)
  await Promise.all(kept.slice(0, candidateCount).map(async row => {
    try {
      const values = row.venue === 'gate'
        ? await sources.gateFundingHistory(row.contract, settings.funding.historyPoints)
        : await sources.hyperliquidFundingHistory(row.symbol, now - settings.funding.historyPoints * 3_600_000)
      values.sort((left, right) => left - right)
      const stats = fundingStats(values, row.ratePct / 100)
      if (stats !== null) {
        row.z = stats.z === null ? null : round(stats.z, 2)
        row.historyPoints = stats.points
      }
      row.flags = flagsFor({ ...row, z: row.z }, settings)
    } catch (error) {
      errors.push({ source: `${row.venue}-history:${row.symbol}`, message: error.message })
      row.flags = flagsFor({ ...row, z: null }, settings)
    }
  }))
  for (const row of kept) row.flags ??= flagsFor({ ...row, z: row.z }, settings)

  const topRow = kept[0] ?? null
  return {
    ok: true,
    at: new Date(now).toISOString(),
    mode: 'read-only',
    venues: wanted,
    note: 'Funding is a slow variable and a spread can be a fast one; an annualized rate is not realized profit and needs a spot hedge, basis monitoring and margin headroom.',
    basis: 'Gate USDT perpetuals (funding every funding_interval) and Hyperliquid perpetuals (hourly funding)',
    counts: {
      scanned: rows.length,
      returned: kept.length,
      aboveWatchLine: kept.filter(row => row.flags.includes('above-watch-line')).length,
      withExtremeZ: kept.filter(row => row.flags.includes('extreme-z')).length,
    },
    bestByVenue,
    top: topRow === null ? null : { venue: topRow.venue, symbol: topRow.symbol, annualizedPct: topRow.annualizedPct, basisBps: topRow.basisBps, flags: topRow.flags },
    rows: kept,
    errors,
  }
}

