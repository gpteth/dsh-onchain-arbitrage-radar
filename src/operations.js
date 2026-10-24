import { scanSpreads } from './scan.js'

/** One spread scan, shared by the tool and the panel route so both journal it once. */
export async function runSpreadScan({ sources, settings, runtime, args = {} }) {
  const result = await scanSpreads({ sources, settings, symbols: args.symbols, sizeQuote: args.sizeQuote, slippageBps: args.slippageBps })
  runtime.latest.scan = result
  runtime.journal.add('scan', {
    at: result.at, counts: result.counts, best: result.best,
    sizeQuote: result.sizeQuote, errors: result.errors.length,
  })
  return result
}
