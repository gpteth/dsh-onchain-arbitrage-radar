// Host half: read-only arbitrage tools, a process-local journal, and the JSON
// route that feeds the compact radar strip in the Web UI.
import { resolveSettings } from './src/settings.js'
import { createRuntime } from './src/runtime.js'
import { createSources } from './src/sources.js'
import { installTools } from './src/tools.js'
import { createPanelHandler } from './src/panel-route.js'

export const inject = ['tools']

export function apply(ctx, config) {
  const settings = resolveSettings(config)
  for (const warning of settings.warnings) ctx.logger?.warn?.(`arbitrage-radar: ${warning}`)
  const runtime = createRuntime(settings)
  const sources = createSources({ settings, runtime })
  installTools(ctx, { settings, runtime, sources })
  if (!settings.panel.enabled) return
  // The Web route is optional: in a non-Web profile the tools still work.
  ctx.inject(['webServer'], sub => {
    sub.effect(() => sub.webServer.register({
      kind: 'prefix',
      path: settings.panel.path,
      handler: createPanelHandler({ settings, runtime, sources, webServer: sub.webServer }),
    }))
  })
}
