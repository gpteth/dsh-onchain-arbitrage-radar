import { randomUUID } from 'node:crypto'

const KINDS = new Set(['scan', 'guard', 'funding', 'stock', 'cost'])

export function createJournal(limit) {
  const records = []
  return {
    add(kind, payload) {
      if (!KINDS.has(kind)) throw new Error(`unknown journal kind ${kind}`)
      const record = { id: randomUUID(), kind, at: new Date().toISOString(), ...payload }
      records.push(record)
      if (records.length > limit) records.splice(0, records.length - limit)
      return record
    },
    list({ kind, limit } = {}) {
      const rows = kind === undefined ? records : records.filter(record => record.kind === kind)
      return { total: rows.length, records: rows.slice(-limit).reverse() }
    },
    counts() {
      const counts = { total: records.length }
      for (const kind of KINDS) counts[kind] = records.filter(record => record.kind === kind).length
      return counts
    },
  }
}

export function createRuntime(settings) {
  return {
    settings,
    journal: createJournal(settings.maxRecords),
    cache: new Map(),
    latest: { scan: null, funding: null, stocks: null },
    lastPanelScanAt: 0,
  }
}

// Short-lived memo for slow reference data (pair directories, stablecoin rate).
// Quote data itself is never cached: a stale price is the failure this plugin
// exists to avoid.
export async function cached(runtime, key, ttlMs, load, now = Date.now()) {
  const hit = runtime.cache.get(key)
  if (hit !== undefined && now - hit.at < ttlMs) return hit.value
  const value = await load()
  runtime.cache.set(key, { at: now, value })
  return value
}

export function clearCache(runtime) {
  runtime.cache.clear()
}
