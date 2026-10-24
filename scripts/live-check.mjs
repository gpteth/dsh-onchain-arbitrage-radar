// Manual live check: exercises the public data sources without the Harness.
// Node 18+ is enough. It prints a compact summary and never places orders.
import { resolveSettings } from '../src/settings.js'
import { createRuntime } from '../src/runtime.js'
import { createSources } from '../src/sources.js'
import { scanSpreads } from '../src/scan.js'
import { scanFunding } from '../src/funding.js'
import { stockClock } from '../src/stocks.js'

const settings = resolveSettings({ scan: { symbols: ['BTC', 'ETH'] }, funding: { top: 5 } })
const runtime = createRuntime(settings)
const sources = createSources({ settings, runtime })

const line = value => JSON.stringify(value)

const spread = await scanSpreads({ sources, settings })
console.log('spread scan:', line({ counts: spread.counts, best: spread.best, errors: spread.errors }))
for (const row of spread.rows) {
  console.log(`  ${row.base.padEnd(5)} ${String(row.verdict).padEnd(12)} ${row.quoteUnit} net=${row.best?.netBps ?? '-'}bps depth=${row.best?.depthQuote ?? '-'} reasons=${row.reasons.join(',') || '-'}`)
}

const funding = await scanFunding({ sources, settings, top: 5 })
console.log('funding scan:', line({ counts: funding.counts, top: funding.top, errors: funding.errors }))
for (const row of funding.rows.slice(0, 5)) {
  console.log(`  ${row.venue.padEnd(12)} ${row.symbol.padEnd(10)} ${String(row.annualizedPct).padStart(9)}%  basis=${row.basisBps ?? '-'}bps  z=${row.z ?? '-'}  ${row.flags.join(',')}`)
}

const stocks = await stockClock({ sources, settings, tokens: ['NVDAX'] })
console.log('stock clock:', line({ status: stocks.status, session: stocks.session, errors: stocks.errors }))
for (const row of stocks.rows) {
  console.log(`  ${row.token.padEnd(8)} ${row.status.padEnd(18)} mid=${row.mid} usd=${row.midUsd ?? '-'} spread=${row.spreadBps}bps vol=${row.quoteVolume24h} ${row.flags.join(',')}`)
}
