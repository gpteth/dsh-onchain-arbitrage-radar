// Browser half: a compact radar strip below the composer. It reads the Host
// summary route and asks the Host to run a spread scan; it never scans itself.
window.__ModuleLoader__.load({
  id: 'dsh-onchain-arbitrage-radar',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'arbitrage-radar'
    const PATH = '/arb-radar'
    const en = {
      title: 'Arbitrage radar',
      refresh: 'Scan',
      scanning: 'Scanning…',
      idle: 'No scan yet — press Scan, or ask the agent to call arb_spread_scan.',
      readOnly: 'read-only',
      spread: 'best net spread',
      funding: 'funding, annualized',
      stock: 'tokenized-stock skew',
      updated: 'updated',
      sessionOpen: 'US session open',
      sessionClosed: 'US session closed',
      sessionPre: 'US pre-market',
      sessionAfter: 'US after-hours',
      error: 'Request failed',
      empty: '—',
    }
    const zh = {
      title: '套利雷达',
      refresh: '扫描',
      scanning: '扫描中…',
      idle: '还没有结果——点「扫描」，或让 Agent 调用 arb_spread_scan。',
      readOnly: '只读',
      spread: '最优净价差',
      funding: '费率年化',
      stock: '币股偏离',
      updated: '更新于',
      sessionOpen: '美股盘中',
      sessionClosed: '美股休市',
      sessionPre: '美股盘前',
      sessionAfter: '美股盘后',
      error: '请求失败',
      empty: '—',
    }

    const TONE = {
      success: '--dsw-alias-state-success-primary',
      warn: '--dsw-alias-state-warn-primary',
      error: '--dsw-alias-state-error-primary',
      idle: '--dsw-alias-state-idle-primary',
      primary: '--dsw-alias-label-primary',
    }

    function RadarIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true, style: { flex: 'none' } },
        h('circle', { cx: 12, cy: 12, r: 9.5, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.4, opacity: 0.35 }),
        h('circle', { cx: 12, cy: 12, r: 5.5, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.4, opacity: 0.6 }),
        h('path', { d: 'M12 12 V2.5', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { cx: 16.4, cy: 8.6, r: 1.9, fill: 'var(--dsw-alias-state-warn-primary)' }),
      )
    }

    function Metric({ label, value, tone }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
        h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', letterSpacing: 0.2 } }, label),
        h('span', {
          style: {
            fontSize: 12, fontWeight: 600, color: `var(${TONE[tone] ?? TONE.primary})`,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260,
          },
        }, value),
      )
    }

    const bps = value => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)} bps`
    const pct = value => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%/yr`

    function sessionLabel(session, t) {
      if (session === undefined || session === null) return null
      const key = session.state === 'open' ? 'sessionOpen'
        : session.state === 'pre-market' ? 'sessionPre'
          : session.state === 'after-hours' ? 'sessionAfter'
            : 'sessionClosed'
      const minutes = session.state === 'open' ? 0 : session.minutesUntilNextOpen
      return minutes > 0 ? `${t(key)} · ${Math.round(minutes / 60)}h` : t(key)
    }

    function RadarStrip(props) {
      const t = typeof props.t === 'function' ? props.t : key => (zh[key] ?? en[key] ?? key)
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch(`${PATH}/summary`, { cache: 'no-store' })
          .then(response => response.json())
          .then(json => { if (alive) json.ok ? setData(json) : setError(json.error ?? t('error')) })
          .catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
        return () => { alive = false }
      }, [])

      async function scan() {
        setBusy(true)
        setError(null)
        try {
          const response = await fetch(`${PATH}/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            cache: 'no-store',
          })
          const json = await response.json()
          if (!response.ok || json.ok !== true) throw new Error(json.error ?? `HTTP ${response.status}`)
          setData(json)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }

      const best = data?.scan?.best ?? null
      const funding = data?.funding?.top ?? null
      const stock = data?.stocks?.rows?.find(row => row.deviationBps !== null) ?? data?.stocks?.rows?.[0] ?? null
      const spreadTone = best === null ? 'idle' : best.verdict === 'go' ? 'success' : best.verdict === 'watch' ? 'warn' : 'idle'
      const spreadValue = best === null ? t('empty') : `${best.base} ${bps(best.netBps)} · ${best.buyVenue}→${best.sellVenue}`
      const fundingValue = funding === null ? t('empty') : `${funding.symbol} ${pct(funding.annualizedPct)}`
      const stockValue = stock === null
        ? (sessionLabel(data?.stocks?.session, t) ?? t('empty'))
        : stock.deviationBps === null
          ? `${stock.token} ${t('empty')}`
          : `${stock.token} ${bps(stock.deviationBps)}`

      return h('div', {
        style: {
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
          margin: '4px 0 0', padding: '6px 10px', width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
          fontSize: 12, lineHeight: 1.3,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
        h(RadarIcon),
        h('span', { style: { fontWeight: 600 } }, t('title')),
        h('span', {
          style: {
            fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
            color: 'var(--dsw-alias-label-secondary)',
            border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 4, padding: '0 4px',
          },
        }, t('readOnly')),
        h('span', {
          title: data?.updatedAt ?? '',
          style: {
            width: 6, height: 6, borderRadius: 3, flex: 'none',
            background: `var(${TONE[error === null ? (data?.updatedAt === null ? 'idle' : 'success') : 'error']})`,
          },
        }),
      ),
      h(Metric, { label: t('spread'), value: spreadValue, tone: spreadTone }),
      h(Metric, { label: t('funding'), value: fundingValue, tone: funding === null ? 'idle' : funding.flags?.includes('above-watch-line') ? 'warn' : 'primary' }),
      h(Metric, { label: t('stock'), value: stockValue, tone: stock?.flags?.includes('deviation-above-threshold') ? 'warn' : 'primary' }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' } },
        error === null ? null : h('span', {
          style: { color: 'var(--dsw-alias-state-error-primary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          role: 'status',
        }, `${t('error')}: ${error}`),
        data === null || data.updatedAt === null ? null : h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10 } },
          `${t('updated')} ${new Date(data.updatedAt).toLocaleTimeString()}`),
        h('button', {
          type: 'button',
          onClick: scan,
          disabled: busy,
          'aria-label': t('refresh'),
          style: {
            fontSize: 11, padding: '3px 9px', borderRadius: 6, flex: 'none',
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            cursor: busy ? 'default' : 'pointer',
          },
        }, busy ? t('scanning') : t('refresh')),
      ),
      data === null && error === null ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, width: '100%' } }, t('idle')) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'arbitrage-radar',
          order: 40,
          locale: NS,
        }, RadarStrip))
      },
    }
  },
})
