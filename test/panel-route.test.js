import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { resolveSettings } from '../src/settings.js'
import { createRuntime } from '../src/runtime.js'
import { createPanelHandler } from '../src/panel-route.js'

function stubSources() {
  const now = Date.now()
  return {
    gatePairFor: async base => ({ pair: `${base}_USD`, quote: 'USD' }),
    gateTicker: async pair => ({
      venue: 'gate', pair, bid: 100, ask: 100.1, bidSize: 50, askSize: 50,
      quoteVolume24h: 5_000_000, source: 'gate', observedAt: null,
    }),
    bitfinexTicker: async () => ({
      venue: 'bitfinex', pair: 'btcusd', bid: 101, ask: 101.1,
      quoteVolume24h: null, source: 'bitfinex', observedAt: new Date(now).toISOString(),
    }),
    usdtPerUsd: async () => ({ usdtUsd: 1, usdtPerUsd: 1, source: 'stub' }),
  }
}

async function withServer(config, run) {
  const settings = resolveSettings({ panel: { throttleMs: 0 }, ...config })
  const runtime = createRuntime(settings)
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  handler = createPanelHandler({ settings, runtime, sources: stubSources(), webServer: { getOrigin: () => origin } })
  try {
    await run({ origin, runtime })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('summary is empty before any scan and carries the config', async () => {
  await withServer({}, async ({ origin }) => {
    const response = await fetch(`${origin}/arb-radar/summary`)
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.equal(json.ok, true)
    assert.equal(json.updatedAt, null)
    assert.equal(json.scan, null)
    assert.equal(json.journal.total, 0)
    assert.equal(json.config.goBps, 30)
  })
})

test('a panel scan runs the host scan and shows up in the summary', async () => {
  await withServer({}, async ({ origin, runtime }) => {
    const response = await fetch(`${origin}/arb-radar/scan`, {
      method: 'POST', body: JSON.stringify({ symbols: ['BTC'] }),
    })
    assert.equal(response.status, 200)
    const json = await response.json()
    assert.equal(json.scan.best.base, 'BTC')
    assert.equal(json.scan.counts.go, 1)
    assert.equal(json.updatedAt, json.scan.at)
    assert.equal(runtime.journal.counts().scan, 1)

    const summary = await (await fetch(`${origin}/arb-radar/summary`)).json()
    assert.equal(summary.scan.counts.go, 1)
    assert.equal(summary.scan.rows[0].netBps, json.scan.best.netBps)
  })
})

test('panel scans are throttled', async () => {
  await withServer({ panel: { throttleMs: 60_000 } }, async ({ origin }) => {
    assert.equal((await fetch(`${origin}/arb-radar/scan`, { method: 'POST', body: '{}' })).status, 200)
    const second = await fetch(`${origin}/arb-radar/scan`, { method: 'POST', body: '{}' })
    assert.equal(second.status, 429)
    const json = await second.json()
    assert.equal(json.ok, false)
    assert.ok(json.retryAfterMs > 0)
  })
})

test('cross-origin scans are refused', async () => {
  await withServer({}, async ({ origin }) => {
    const response = await fetch(`${origin}/arb-radar/scan`, {
      method: 'POST', body: '{}', headers: { origin: 'http://evil.test' },
    })
    assert.equal(response.status, 403)
  })
})

test('invalid bodies and methods are refused', async () => {
  await withServer({}, async ({ origin }) => {
    assert.equal((await fetch(`${origin}/arb-radar/scan`, { method: 'GET' })).status, 405)
    assert.equal((await fetch(`${origin}/arb-radar/summary`, { method: 'POST', body: '{}' })).status, 405)
    assert.equal((await fetch(`${origin}/arb-radar/scan`, { method: 'POST', body: '{' })).status, 400)
    assert.equal((await fetch(`${origin}/arb-radar/scan`, {
      method: 'POST', body: JSON.stringify({ symbols: 'BTC' }),
    })).status, 400)
    assert.equal((await fetch(`${origin}/arb-radar/scan`, {
      method: 'POST', body: JSON.stringify({ sizeQuote: -5 }),
    })).status, 400)
  })
})

test('health and unknown routes answer predictably', async () => {
  await withServer({}, async ({ origin }) => {
    const health = await (await fetch(`${origin}/arb-radar/health`)).json()
    assert.equal(health.ok, true)
    assert.equal(health.path, '/arb-radar')
    assert.equal((await fetch(`${origin}/arb-radar/nope`)).status, 404)
  })
})
