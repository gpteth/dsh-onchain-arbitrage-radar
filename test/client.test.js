import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Minimal React surface: enough to load the browser module, run its
// registration and execute the component function without a DOM.
const react = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children } }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useCallback(callback) {
    return callback
  },
}

let loads = 0
async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let spec
  globalThis.window = { __ModuleLoader__: { load(value) { spec = value } } }
  loads += 1
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#load-${loads}`)
  return spec
}

const texts = node => {
  if (node === null || node === undefined) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(texts)
  if (typeof node.type === 'function') return texts(node.type(node.props))
  return texts(node.props?.children)
}

test('client module declares the package id and registers one dock entry', async () => {
  const spec = await loadClient()
  assert.equal(spec.id, 'dsh-onchain-arbitrage-radar')
  const plugin = spec.factory(id => {
    if (id === 'react') return react
    throw new Error(`unexpected import ${id}`)
  })
  assert.deepEqual(plugin.inject, ['slots', 'locale'])

  let registration
  let locale
  const ctx = {
    effect(callback) { callback() },
    locale: { register(namespace, dictionaries) { locale = { namespace, dictionaries } } },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.composer.dock')
        callback()
      },
      register(options, Component) {
        registration = { options, Component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(registration.options.name, 'conversation.composer.dock')
  assert.equal(registration.options.id, 'arbitrage-radar')
  assert.equal(registration.options.locale, 'arbitrage-radar')
  assert.equal(locale.namespace, 'arbitrage-radar')
  assert.equal(typeof locale.dictionaries.zh.title, 'string')
  assert.equal(typeof locale.dictionaries.en.title, 'string')
})

test('the strip renders its title, metrics and control without a DOM', async () => {
  const spec = await loadClient()
  const plugin = spec.factory(() => react)
  let Component
  plugin.apply({
    effect(callback) { callback() },
    locale: { register() {} },
    slots: {
      inject(_name, callback) { callback() },
      register(_options, component) { Component = component; return () => {} },
    },
  })
  const tree = Component({ t: key => key })
  assert.equal(tree.type, 'div')
  const rendered = texts(tree)
  assert.ok(rendered.includes('title'))
  assert.ok(rendered.includes('spread'))
  assert.ok(rendered.includes('funding'))
  assert.ok(rendered.includes('stock'))
  assert.ok(rendered.includes('refresh'))
  assert.ok(rendered.includes('idle'))
})
