import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../src/settings.js'
import { createRuntime } from '../src/runtime.js'
import { installTools } from '../src/tools.js'

function harness(sources = {}) {
  const settings = resolveSettings({})
  const runtime = createRuntime(settings)
  const tools = new Map()
  const ctx = { tools: { register: definition => tools.set(definition.name, definition) } }
  installTools(ctx, { settings, runtime, sources })
  return { tools, runtime, settings }
}

const lossless = value => {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
  return value
}

test('every tool registers a name, description, schema and output render', () => {
  const { tools } = harness()
  for (const name of ['arb_spread_scan', 'arb_cost_model', 'arb_guard_check', 'arb_funding_scan', 'arb_stock_clock', 'arb_research', 'arb_records']) {
    const definition = tools.get(name)
    assert.ok(definition !== undefined, `${name} is missing`)
    assert.equal(definition.name, name)
    assert.ok(definition.description.length > 60)
    assert.equal(definition.parameters.type, 'object')
    assert.equal(definition.output.schema.type, 'object')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('arb_research returns lossless JSON for hits, misses and topic ids', async () => {
  const { tools } = harness()
  const research = tools.get('arb_research')
  const hit = lossless(await research.execute({ query: 'funding' }))
  assert.equal(hit.ok, true)
  assert.ok(hit.topics.length > 0)
  const miss = lossless(await research.execute({ query: 'zzzz-unknown' }))
  assert.equal(miss.count, 0)
  assert.equal(typeof miss.note, 'string')
  const byId = lossless(await research.execute({ topicId: 'net-edge' }))
  assert.equal(byId.topics[0].id, 'net-edge')
  const failure = await research.execute({ query: '' })
  assert.equal(failure.ok, false)
  assert.match(failure.error, /query or topicId/)
})

test('arb_cost_model and arb_guard_check respond through the tool wrapper', async () => {
  const { tools, runtime } = harness()
  const cost = lossless(await tools.get('arb_cost_model').execute({
    grossSpreadBps: 80, notionalQuote: 10_000,
    fees: { buyBps: 20, sellBps: 20 }, fixedCosts: { gasQuote: 3 },
  }))
  assert.equal(cost.ok, true)
  assert.equal(cost.verdict, 'go')
  const guard = lossless(await tools.get('arb_guard_check').execute({
    mode: 'spot-spread', bankrollQuote: 10_000, maxLossQuote: 100,
    notionalQuote: 5000, expectedNetBps: 40, dataKind: 'observed',
  }))
  assert.equal(guard.ok, true)
  assert.equal(guard.pass, true)
  const records = lossless(await tools.get('arb_records').execute({ limit: 5 }))
  assert.equal(records.total, 2)
  assert.deepEqual(records.counts.cost, 1)
  assert.equal(runtime.journal.counts().guard, 1)
})

test('arb_records validates its limit and passes kind through', async () => {
  const { tools } = harness()
  const records = tools.get('arb_records')
  const failure = await records.execute({ limit: 500 })
  assert.equal(failure.ok, false)
  const page = await records.execute({ kind: 'scan', limit: 3 })
  assert.equal(page.ok, true)
  assert.equal(page.total, 0)
})
