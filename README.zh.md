# 链上套利雷达

DeepSeek Harness 的只读套利研究插件。它读取公开行情，把价格换算成扣完成本的数字，并且拒绝把屏幕价差当成一笔成交。

不持有密钥、不签名、不下单。

## 提供什么

| 工具 | 回答的问题 |
|---|---|
| `arb_spread_scan` | Gate ↔ Bitfinex 现货是否存在实时价差？扣掉双边手续费、额外滑点、换算缓冲与深度后还剩多少？ |
| `arb_cost_model` | 给定毛价差与显式成本，净收益、盈亏平衡点差、最小有效规模是多少？ |
| `arb_guard_check` | 这笔计划是否满足单笔亏损上限、杠杆上限、最低边际、报价时效与「观测数据」要求？ |
| `arb_funding_scan` | 哪些永续合约的年化资金费率最高？其中哪些深度薄、拥挤或即将下架？ |
| `arb_stock_clock` | Gate 代币化股票相对标的参考价偏离多少？美股当前是否开市？ |
| `arb_research` | 研究方法对这个结构怎么说？ |
| `arb_records` | 这个 Host 进程最近扫描了什么、拒绝了什么？ |

输入框下方有一条紧凑的**雷达条**，显示最新价差、费率与币股偏离，并可触发一次价差扫描。

## 数据来源

全部为公开、无需 Key 的接口：

- **Gate.io** — 现货 tickers、USD 与 USDT 市场、USDT 永续资金费率。
- **Bitfinex** — 公开现货 ticker（USD）。
- **Hyperliquid** — 永续上下文与资金费率历史。
- **DeFiLlama coins** — Gate 一边标 USDT、Bitfinex 一边标 USD 时，用 USDT/USD 汇率换算。

Host 进程需要能访问这些域名。受限网络下单个来源会返回 `unavailable`，其余来源照常工作。

## 安装

```sh
dsh plugin install https://github.com/gpteth/dsh-onchain-arbitrage-radar
```

本地目录也可以：`dsh plugin install /绝对路径/dsh-onchain-arbitrage-radar`。在运行中的 Harness 里，从「设置 → 插件」安装（或让 Agent 调 `plugin_manager` 的 `install_bundle`），然后确认插件出现。Host 行由 `cordis.patch.yml` 插入；浏览器雷达条由包的 `dsh.client` 清单与 `./client` 导出发现。

## 配置

所有字段都可省略，默认值在 `src/settings.js`。在 `cordis.patch.yml` 或 profile patch 里改对应行：

```yaml
- id: arbitrage-radar
  config:
    thresholds:
      goBps: 40              # 净价差达到多少算 go
      maxQuoteAgeSeconds: 20 # 超过则拒绝 Bitfinex 报价
      stockDeviationBps: 150
      minOiUsd: 1000000      # Hyperliquid 未平仓量下限
      minDayVolumeUsd: 500000
      fundingWatchPct: 30    # 年化费率告警线
    venues:
      gate: { takerBps: 20 }
      bitfinex: { takerBps: 20 }
    scan:
      symbols: [BTC, ETH, SOL]
      sizeQuote: 1000
      slippageBps: 5
    funding:
      venues: [gate, hyperliquid]
      top: 15
      historyPoints: 60
      historyCandidates: 3
    stocks:
      tokens: [NVDAX, TSLAX, COINX]
    transfer:
      conversionBufferBps: 5
      usdtFallbackBufferBps: 15
    risk:
      maxLossFraction: 0.02
      maxLeverage: 1
      minNetBps: 30
      maxQuoteAgeSeconds: 60
    panel:
      path: /arb-radar
      enabled: true
      throttleMs: 5000
    requestTimeoutMs: 8000
    maxRecords: 200
```

不合法的值会回退到默认值并写入日志，不会阻止插件激活。

## 面板路由

雷达条读写同一来源的两个 JSON 路由：

- `GET /arb-radar/summary` — 最新扫描/费率/币股快照与日志计数。
- `POST /arb-radar/scan` — 用配置默认值跑一次价差扫描。
- `GET /arb-radar/health` — 存活状态与日志计数。

扫描有节流，跨源请求被拒绝，只返回公开行情与本进程内的记录。

## 第一版不做什么

- 不碰钱包、签名、下单、转账、密钥或凭证。
- 不做 DEX/AMM 池报价：跨所范围是 Gate ↔ Bitfinex。链上角度体现在币股时钟与费率/基差研究。
- 不做完整订单簿：深度只有最优一档，而 Bitfinex 公开 ticker 不暴露挂单量。
- Gate 现货 ticker 没有服务端时间戳，记录的是抓取时间。
- 不建模美股节假日与提前收盘。
- 日志不持久：只存在于 Host 进程内。Session 日志才是权威记录。
- 不承诺收益。`go` 只是待复核的情景，不是成交。

## 研究来源

方法论——净收益而非毛价差、最小有效规模、费率是卖保险不是收租、币股时钟差、证据与风控闸门——参考了公开共学仓库
<https://github.com/gpteth/onchain-arbitrage-colearn>。该仓库没有 License，因此本插件是独立实现：没有复制其代码、笔记或脚本，也不执行其中任何文件。行情一律从上面列出的交易所实时读取。

## 开发与验证

```sh
node --test test/*.test.js     # 纯逻辑、打桩数据源、路由、客户端模块
node scripts/live-check.mjs    # 真实公开接口，打印紧凑摘要
```

测试覆盖算术、价差判定（含过期报价、薄深度、USDT 换算）、费率标记、美股时段、参考价匹配、HTTP 路由与浏览器模块注册。实盘行为取决于上述网络条件。
