// Original research notes distilled for this plugin. The external study vault
// is a reference only: no text or script from it is copied or executed here.
export const TOPICS = [
  {
    id: 'net-edge',
    title: '净收益才是收益',
    tags: ['net', 'gross', 'cost', '净收益', '成本'],
    summary: '屏幕价差是毛收益。只有扣掉双边费用、滑点、gas/桥费、提币费和缓冲后仍为正，才是可研究的边。',
    body: '毛价差 = 卖出价 ÷ 买入价 − 1。净收益 = 毛价差 − 双边手续费 − 双边额外滑点 − 固定成本 − 安全缓冲。固定成本在小仓位上占比极高，常见现象是毛利为正、净利为负：成本是毛利的数倍时，仓位再大也救不回来，只会把亏损放大。',
    apply: '先用 arb_cost_model 跑出成本明细与盈亏平衡点差，再决定是否值得继续核对深度与到账时间。',
  },
  {
    id: 'minimum-size',
    title: '最小有效规模',
    tags: ['size', 'fixed-cost', '规模', '固定成本'],
    summary: '固定成本不随规模变化，所以存在一个最小有效规模；低于它，边再厚也是替交易所和桥打工。',
    body: '把固定成本除以「毛价差率 − 变动成本率」，得到覆盖固定成本所需的最小名义金额。低于这个规模，理论收益被 gas、提币费、桥费吃掉。反过来说，规模变大后边际成本主要是滑点与深度，容量曲线比收益率更重要。',
    apply: '成本模型会返回 minEffectiveNotionalQuote；实际下单前再核对深度，不要用计算值直接构造数量。',
  },
  {
    id: 'execution-vs-paper',
    title: '模拟与实盘必须分开记录',
    tags: ['paper', 'simulation', 'backtest', '模拟', '回测', '实盘'],
    summary: '计算器输出的是情景，不是成交。把模拟收益写成真实收益，是这类研究最常见的自欺。',
    body: '模拟回答「如果按这个价、这个规模成交，净收益是多少」；实盘还要回答「有没有对手盘、能不能原子完成、到账要多久、会不会被抢跑」。两者混在一起，就会把假设当证据。研究记录里应标注数据种类、时间戳、来源，以及未解决的风险。',
    apply: '任何结论都注明 observed / synthetic；模拟候选只能进入复核，不进入收益统计。',
  },
  {
    id: 'spread-not-executable',
    title: '屏幕价差 ≠ 可执行价差',
    tags: ['depth', 'slippage', 'executable', '深度', '滑点'],
    summary: '盘口只有最优一档时，价差说明不了能成交多少。深度和报价新鲜度决定价差是否可执行。',
    body: '跨所价差要成立，需要两个场所同时存在可成交的对手盘。常见陷阱：一边是幽灵挂单或极薄一档；报价时间差超过几十秒；两边计价资产并不相同（USD 与 USDT）；提币被暂停。任何一项成立，价差就只是显示。',
    apply: '扫描结果里查看 depthQuote、ageSeconds、conversion 与 reasons；出现 shallow / stale / conversion-rate-unavailable 时按不可执行处理。',
  },
  {
    id: 'funding-carry',
    title: '资金费率是卖保险不是收租',
    tags: ['funding', 'carry', 'basis', '资金费率', '基差'],
    summary: '费率是慢变量，价差是快变量。一次插针可以吞掉很多个结算周期的正费率。',
    body: '利润 = 费率收入 − 价差恶化 − 手续费 − 滑点。正费率看起来在发工资，但浅所单边拉升、统一保证金账户、强平距离都可能把几个月的 carry 一次拿走。年化越高，越要优先看深度、未平仓量和限制开仓公告，而不是继续加杠杆。',
    apply: '看 arb_funding_scan 的 basisBps、z 分数与深度标记；年化高 + 深度薄 + 尖峰 z 通常是诱饵。',
  },
  {
    id: 'funding-modes',
    title: '套费率与套收敛是两种交易',
    tags: ['funding', 'convergence', 'mode', '收敛', '模式'],
    summary: '套费率赌横盘，套收敛赌极端价差回归。混在一起叫「中性」，实际是风险叠加。',
    body: '套费率：收确定的保费，扛不确定的赔付，要求价差稳定、杠杆极低。套收敛：已经出现极端价差，赌它回归，风险是对方继续拉或提币关闭。两者的止损、仓位、时间窗口都不同。把两种模式写进同一个「中性套利」标签，会在错误的时候加仓。',
    apply: '用 arb_guard_check 的 mode 区分两种交易，并各自设置单笔最大亏损。',
  },
  {
    id: 'tokenized-stock-clock',
    title: '币股时钟差：闭市漂移，开盘收敛',
    tags: ['tokenized-stock', 'clock', 'premium', '币股', '时钟差', '溢价'],
    summary: '代币化股票与真实股票交易时间不同。闭市期间现货价冻结，代币价格会漂移，开盘后才有收敛动力。',
    body: '常见结构是「代币相对标的溢价或折价 + 开盘后回归」。但代币不是股票：发行方条款、赎回闸门、转账限制都可能让溢价长期存在；流动性常常只有几万美元，属于玩具仓。可行做法是把它当成事件窗口研究，而不是常驻价差。',
    apply: '用 arb_stock_clock 看 session 状态、深度与偏离；参考价必须写明来源和时间，缺失时不要猜。',
  },
  {
    id: 'cross-chain-cost',
    title: '跨链套利：成本在时间不在费率',
    tags: ['cross-chain', 'bridge', 'latency', '跨链', '桥'],
    summary: '跨链报价的显性费率只是成本的一部分，资金在桥上停留的时间里，价差可能已经消失。',
    body: '跨链搬砖要同时承担：源链 gas、桥费、目标链 gas、提币/到账时间、以及停留期间的价差反向移动。很多报价试验显示费率随金额变化不大，但时长会随路线剧变；「快 6 秒」本身也有价值。跨链门槛下移时，先确认是渠道费降低，还是你换了集成方参数。',
    apply: '把桥费、两端 gas 与时间风险全部写进成本模型；时间风险用缓冲基点而不是零处理。',
  },
  {
    id: 'atomic-mev',
    title: '原子套利拼的是排序权，不是资金',
    tags: ['mev', 'atomic', 'latency', '原子套利', '排序'],
    summary: '同链原子套利的竞争对手是专业搜索者与打包者，个人资金的边际优势很小。',
    body: '原子路径要求同一区块内完成借款、兑换、还款，失败即回滚。门槛在于延迟、私有交易通道、竞价策略和合约工程，而不是本金。研究价值在于理解清算与错误挂单这类「别人的失误」，而不是自己下场和机器人抢同一个机会。',
    apply: '把原子套利当作观察方向；用清算/异常挂单雷达做发现，不把研究结论当成可执行方案。',
  },
  {
    id: 'liquidation',
    title: '清算套利：速度与资本的双重门槛',
    tags: ['liquidation', 'aave', 'mev', '清算', '闪贷'],
    summary: '清算机会公开可见，竞争在区块内完成；单笔利润常被 gas 与竞价吃掉。',
    body: '清算机器人通常在一笔交易里完成闪贷、偿还债务、接收抵押品与还款，利润薄、频次高。观察要点：抵押品深度、清算阈值、健康度分布、以及是否已有批量清算者覆盖。对个人研究者，更有价值的是把清算事件当作方向性信号，而不是直接参与竞价。',
    apply: '把清算数据当事件源研究；不要用现货价差工具去估算清算收益。',
  },
  {
    id: 'sentinel-design',
    title: '哨兵设计：默认静默，连续确认',
    tags: ['monitor', 'sentinel', 'alert', '监控', '哨兵', '告警'],
    summary: '监控的价值在于「有事才响」。每小时推一次一切正常，人很快会关掉通知。',
    body: '原则：只读发现，人扣扳机；同一信号连续两次确认再报，避免毛刺；阈值按事件窗口设，不按无聊期设；基础设施先报——交易所 API 或 RPC 挂了，后面的「无信号」没有意义。每条告警都应带来源、时间、口径，方便复核。',
    apply: '本插件只给调用时的快照；要做持续监控，用宿主的时间调度定期调用扫描工具并比较前后两次结果。',
  },
  {
    id: 'five-questions',
    title: '进场前五问',
    tags: ['checklist', 'before-trade', 'questions', '五问', '检查'],
    summary: '口径、成本、返佣、样本状态、最小规模。五问不过，不进下一步。',
    body: '一问口径：数字是毛利还是净利，含不含返佣。二问成本：双边费用、滑点、固定成本是否全部显式。三问返佣：收益是否依赖邀请返佣或临时补贴。四问样本：常态数据还是事件窗口，样本多长。五问规模：最小有效规模是多少，当前规模是否在容量内。任何一问答不上来，结论就只能写成待验证。',
    apply: '在 arb_guard_check 的结果之外，用这五问写研究记录，而不是只写一个「可以」。',
  },
  {
    id: 'risk-rules',
    title: '风控：单笔最大亏损与杠杆上限',
    tags: ['risk', 'drawdown', 'leverage', '风控', '杠杆', '回撤'],
    summary: '套利是概率游戏，敞口控制比胜率重要。先定义亏光也不影响生活的金额，再谈收益。',
    body: '单笔最大亏损建议按总资金的小比例硬性封顶，杠杆默认 1x。任何「中性」策略在统一保证金账户、浅所插针、提币暂停面前都可能单边裸奔。回测胜率是慢变量统计，不能用来给快变量的路径加杠杆。亏损记录同样要留，失败分类比成功故事更有信息量。',
    apply: '把 bankroll 与 maxLoss 传入 arb_guard_check；不通过就不要构造交易计划。',
  },
  {
    id: 'evidence',
    title: '证据标准：来源、时间、可复现',
    tags: ['evidence', 'source', 'timestamp', '证据', '来源', '时间'],
    summary: '没有来源与 UTC 时间的数字不是证据。研究记录要能被另一个人复现。',
    body: '一条可用的证据至少包含：公开来源 URL、UTC 观测时间、资产与计价单位的精确定义、数量级与深度、以及获取方式。链上结论附 tx hash，报价结论附接口与参数。模拟、回测、实盘要分开标注。做不到这些，结论只能算假设。',
    apply: '扫描结果自带来源 URL 与时间；写研究笔记时原样保留，不要只留一个数字。',
  },
  {
    id: 'research-loop',
    title: '从观察到回测到纸面交易',
    tags: ['workflow', 'backtest', 'paper-trading', '流程', '回测'],
    summary: '观察 → 假设 → 数据 → 回测 → 纸面 → 小仓实盘，每一阶段有明确的退出条件。',
    body: '观察阶段只收集事实与异常；假设阶段写清「为什么可能有钱」，包括向谁收钱、他为什么愿意付；数据阶段固定口径与来源；回测阶段至少包含成本与失败样本；纸面阶段记录每一次假设成交与拒绝原因；只有前四步都稳定，才谈小仓验证。公开策略通常已经滞后，能不能复现成本结构比找到新策略更重要。',
    apply: '用 arb_records 回看本进程内的扫描与护栏记录，把拒绝原因当作下一轮研究的输入。',
  },
  {
    id: 'stablecoin-basis',
    title: 'USD 与 USDT 不是同一个计价资产',
    tags: ['stablecoin', 'usdt', 'usd', 'basis', '稳定币'],
    summary: '跨所价差若一边标 USDT、一边标 USD，价差里混着稳定币基差，必须显式换算并留缓冲。',
    body: 'USDT/USD 会脱锚，幅度通常很小但在压力时放大。把两边当成同一资产，会把基差算成套利空间。正确做法是用可信来源换算，并把换算成本、到账时间与脱锚风险计入缓冲；换算来源不可用时，应当直接拒绝结论而不是假设 1:1。',
    apply: '本插件优先使用 Gate 的真实 USD 市场；必须换算时会显示 conversion 与 bufferBps，来源不可用时判定为不可执行。',
  },
]

const FIELD_WEIGHT = { title: 6, tags: 4, summary: 2, body: 1, apply: 1 }

export function topicById(id) {
  return TOPICS.find(topic => topic.id === String(id).toLowerCase())
}

export function searchTopics(query, limit = 3) {
  const text = String(query ?? '').trim().toLowerCase()
  if (text === '') return []
  const terms = [...new Set(text.split(/[\s,;，；、]+/u).filter(Boolean))]
  const scored = []
  for (const topic of TOPICS) {
    const fields = {
      title: topic.title.toLowerCase(),
      tags: topic.tags.join(' ').toLowerCase(),
      summary: topic.summary.toLowerCase(),
      body: topic.body.toLowerCase(),
      apply: topic.apply.toLowerCase(),
    }
    let score = 0
    for (const term of terms) {
      for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
        if (fields[field].includes(term)) score += weight * (field === 'title' || field === 'tags' ? 2 : 1)
      }
    }
    if (score > 0) scored.push({ topic, score })
  }
  scored.sort((left, right) => right.score - left.score)
  return scored.slice(0, Math.min(Math.max(limit, 1), 10)).map(entry => ({ ...entry.topic, score: entry.score }))
}
