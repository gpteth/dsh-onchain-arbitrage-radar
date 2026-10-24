import { runSpreadScan } from './operations.js'

const BODY_LIMIT = 64 * 1024

function send(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('request body must be JSON')
  }
}

export function compactSummary({ settings, runtime }) {
  const { scan, funding, stocks } = runtime.latest
  const times = [scan?.at, funding?.at, stocks?.at].filter(Boolean).sort()
  return {
    ok: true,
    path: settings.panel.path,
    updatedAt: times.length > 0 ? times.at(-1) : null,
    journal: runtime.journal.counts(),
    config: {
      goBps: settings.thresholds.goBps,
      maxQuoteAgeSeconds: settings.thresholds.maxQuoteAgeSeconds,
      symbols: settings.scan.symbols,
      sizeQuote: settings.scan.sizeQuote,
      fundingVenues: settings.funding.venues,
      stockTokens: settings.stocks.tokens,
    },
    scan: scan === null ? null : {
      at: scan.at,
      counts: scan.counts,
      best: scan.best,
      rows: scan.rows.slice(0, 6).map(row => ({
        base: row.base,
        verdict: row.verdict,
        netBps: row.best?.netBps ?? null,
        buyVenue: row.best?.buyVenue ?? null,
        sellVenue: row.best?.sellVenue ?? null,
        reasons: row.reasons ?? [],
      })),
      errors: scan.errors.slice(0, 3),
    },
    funding: funding === null ? null : {
      at: funding.at,
      counts: funding.counts,
      top: funding.top,
      bestByVenue: funding.bestByVenue ?? [],
      rows: funding.rows.slice(0, 6).map(row => ({
        venue: row.venue, symbol: row.symbol, annualizedPct: row.annualizedPct,
        basisBps: row.basisBps, flags: row.flags,
      })),
    },
    stocks: stocks === null ? null : {
      at: stocks.at,
      status: stocks.status,
      session: stocks.session,
      rows: stocks.rows.slice(0, 6).map(row => ({
        token: row.token, mid: row.mid, deviationBps: row.deviationBps,
        status: row.status, flags: row.flags,
      })),
    },
    warnings: settings.warnings,
  }
}

export function createPanelHandler({ settings, runtime, sources, webServer }) {
  const base = settings.panel.path
  const origin = (() => {
    try { return webServer.getOrigin() } catch { return undefined }
  })()

  return async function handler(req, res) {
    try {
      const header = req.headers.origin
      if (header !== undefined && (origin === undefined || header !== origin)) {
        send(res, 403, { ok: false, error: 'cross-origin request refused' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === `${base}/summary`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          send(res, 405, { ok: false, error: 'summary accepts GET' })
          return
        }
        send(res, 200, compactSummary({ settings, runtime }))
        return
      }
      if (url.pathname === `${base}/scan`) {
        if (req.method !== 'POST') {
          send(res, 405, { ok: false, error: 'scan accepts POST' })
          return
        }
        const wait = settings.panel.throttleMs - (Date.now() - runtime.lastPanelScanAt)
        if (wait > 0) {
          send(res, 429, { ok: false, error: `scan throttled; retry in ${wait} ms`, retryAfterMs: wait })
          return
        }
        let body
        try { body = await readJson(req) } catch (error) {
          send(res, 400, { ok: false, error: error.message })
          return
        }
        if (body.symbols !== undefined && (!Array.isArray(body.symbols) || body.symbols.some(item => typeof item !== 'string'))) {
          send(res, 400, { ok: false, error: 'symbols must be an array of strings' })
          return
        }
        if (body.sizeQuote !== undefined && !(typeof body.sizeQuote === 'number' && Number.isFinite(body.sizeQuote) && body.sizeQuote > 0)) {
          send(res, 400, { ok: false, error: 'sizeQuote must be a positive number' })
          return
        }
        runtime.lastPanelScanAt = Date.now()
        try {
          await runSpreadScan({ sources, settings, runtime, args: { symbols: body.symbols, sizeQuote: body.sizeQuote } })
        } catch (error) {
          send(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }
        send(res, 200, compactSummary({ settings, runtime }))
        return
      }
      if (url.pathname === `${base}/health`) {
        send(res, 200, { ok: true, path: base, at: new Date().toISOString(), journal: runtime.journal.counts() })
        return
      }
      send(res, 404, { ok: false, error: 'unknown arbitrage radar route' })
    } catch (error) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
