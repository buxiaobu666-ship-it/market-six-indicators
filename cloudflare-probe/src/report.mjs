export const SOURCES = {
  vix: "https://www.investing.com/indices/volatility-s-p-500",
  vxn: "https://fred.stlouisfed.org/series/VXNCLS",
  cape: "https://www.multpl.com/shiller-pe",
  ndxPe: "https://chartrow.com/nasdaq-100/pe-ratio",
  ahr999: "https://ahr999.aix4u.com/",
  buffett: "https://www.longtermtrends.com/market-cap-to-gdp-the-buffett-indicator/"
};

const DEFINITIONS = [
  { key:"vix", name:"VIX（恐慌指数）", meaning:"标普500期权隐含波动率，反映市场对未来约30天波动的定价。", ranges:[[15,"低","低"],[20,"正常","中低"],[30,"偏高","高"],[Infinity,"高","极高"]], advice:"偏高时宜降低一次性重仓比例、保留现金并分批安排资金。" },
  { key:"vxn", name:"VXN（纳指100短期指标）", meaning:"纳斯达克100期权隐含波动率，反映科技成长股未来约30天的预期波动。", ranges:[[20,"低","低"],[30,"正常","中低"],[40,"偏高","高"],[Infinity,"高","极高"]], advice:"偏高时宜减少短期集中暴露，避免追涨并采用分批节奏。" },
  { key:"cape", name:"标普500 Shiller PE（CAPE）", meaning:"以过去10年经通胀调整后的平均盈利衡量标普500长期估值。", ranges:[[20,"低","低"],[25,"中低","中低"],[30,"中","中"],[35,"高","高"],[Infinity,"极高","极高"]], advice:"估值偏高时宜降低一次性重仓比例，提高对买入价格和分散度的要求。" },
  { key:"ndxPe", name:"纳斯达克100 PE", meaning:"纳斯达克100成分股总市值相对其过去12个月总盈利的估值水平。", ranges:[[20,"低","低"],[25,"中低","中低"],[33,"中","中"],[39,"高","高"],[Infinity,"极高","极高"]], advice:"估值偏高时宜避免一次性集中押注成长股，并采用分批配置节奏。" },
  { key:"ahr999", name:"BTC AHR999（定投指标）", meaning:"观察比特币价格相对历史定投成本和长期趋势所处的区间。", ranges:[[0.45,"抄底区","中"],[1.2,"定投区","中低"],[3,"偏热","高"],[Infinity,"极热","极高"]], advice:"偏热时宜控制追涨仓位；处于较低区间时仍宜按计划分批，而非一次性投入。" },
  { key:"buffett", name:"巴菲特指标（Wilshire 5000 / GDP）", meaning:"美国公开交易股票总市值相对GDP的长期整体估值指标。", ranges:[[90,"低","低"],[120,"中","中"],[150,"中高","中高"],[180,"高","高"],[Infinity,"极高","极高"]], advice:"整体估值偏高时宜降低一次性权益重仓比例，并保留分批投入空间。" }
];

export const clean = value => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

function number(value, label) {
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`${label}的当前值无法可靠解析`);
  return parsed;
}

function required(text, pattern, label) {
  const match = clean(text).match(pattern);
  if (!match) throw new Error(`${label}页面未找到可验证的“当前值＋日期”组合`);
  return match;
}

export function parseVix({ quote, header }) {
  if (!/^\d{1,2}(?:\.\d+)?$/.test(clean(quote))) throw new Error("VIX主报价不是可验证的指数数值");
  const status = clean(header).match(/(?:Real-time Data|Closed)(?:\s*[·|]\s*\d{1,2}\/\d{1,2})?(?:\s*[·|]\s*\d{1,2}:\d{2}(?::\d{2})?)?/i)?.[0];
  if (!status) throw new Error("VIX页面未找到实时/收盘日期或更新时间");
  return { value:number(quote,"VIX"), display:clean(quote), date:`网页显示：${clean(status)}`, source:SOURCES.vix };
}

export function parseVxn(text) {
  const match = required(text, /(\d{4}-\d{2}-\d{2})\s*:\s*([0-9]+(?:\.[0-9]+)?)/, "VXN");
  const updated = clean(text).match(/Updated:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+[A-Z]{2,4})/i)?.[1];
  if (!updated) throw new Error("VXN页面未找到更新时间");
  return { value:number(match[2],"VXN"), display:match[2], date:`${match[1]}；页面更新时间：${updated}`, source:SOURCES.vxn };
}

export function parseCape(text) {
  const match = required(text, /Current Shiller PE Ratio:\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,120}?(\d{1,2}:\d{2}\s*(?:AM|PM)\s+[A-Z]{2,4},?\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i, "CAPE");
  return { value:number(match[1],"CAPE"), display:match[1], date:clean(match[2]), source:SOURCES.cape };
}

export function parseNasdaqPe(text) {
  const match = required(text, /Nasdaq-100 P\/E ratio:\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,220}?as of market close,\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})/i, "纳斯达克100 PE");
  return { value:number(match[1],"纳斯达克100 PE"), display:match[1], date:match[2], source:SOURCES.ndxPe };
}

export function parseAhr999(text) {
  const match = required(text, /AHR999\s*[—-]\s*LATEST READING UTC\s*(\d{4}-\d{2}-\d{2})[\s\S]{0,120}?([0-9]+(?:\.[0-9]+)?)\s+(?:BARGAIN|DCA|CAUTION|BUBBLE)\s+ZONE/i, "BTC AHR999");
  return { value:number(match[2],"BTC AHR999"), display:match[2], date:`${match[1]}（UTC）`, source:SOURCES.ahr999 };
}

export function parseBuffett(text) {
  const match = required(text, /CURRENT DATA[\s\S]{0,300}?BUFFETT INDICATOR\s*([0-9]+(?:\.[0-9]+)?)%[\s\S]{0,260}?As of\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i, "巴菲特指标");
  return { value:number(match[1],"巴菲特指标"), display:`${match[1]}%`, date:match[2], source:SOURCES.buffett };
}

function classify(value, ranges) {
  for (const [limit, zone, risk] of ranges) if (value < limit) return { zone, risk };
  throw new Error("参考区间配置无效");
}

function rangeText(ranges) {
  return ranges.map(([limit, zone], index) => {
    const lower = index === 0 ? "" : ranges[index - 1][0];
    return index === 0 ? `<${limit} ${zone}` : Number.isFinite(limit) ? `${lower}–${limit} ${zone}` : `≥${lower} ${zone}`;
  }).join("；");
}

export function beijingDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
}

export function formatReport(results, now = new Date()) {
  if (DEFINITIONS.some(({key}) => !results[key])) throw new Error("六项数据未齐全，禁止生成日报");
  const generated = new Intl.DateTimeFormat("zh-CN", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(now);
  const sections = DEFINITIONS.map((definition, index) => {
    const item = results[definition.key];
    if (item.source !== SOURCES[definition.key]) throw new Error(`${definition.name}来源校验失败`);
    const current = classify(item.value, definition.ranges);
    return `${index + 1}. ${definition.name}\n当前值：${item.display}\n数据日期/更新时间：${item.date}\n参考范围：${rangeText(definition.ranges)}\n当前区间：${current.zone}\n风险等级：${current.risk}\n代表含义：${definition.meaning}\n适合行为：${definition.advice}\n原始网页：${item.source}`;
  });
  const report = `【市场六指标日报】${generated}（北京时间）\n\n${sections.join("\n\n")}\n\n说明：每项数值均由本次页面直接读取，并与页面日期及原始链接配对校验；风险分档为固定参考规则，不是网站评级，也不构成买卖指令。`;
  if (report.length > 4096) throw new Error(`日报长度${report.length}超过Telegram单条消息限制`);
  return report;
}

export function failureMessage(error, now = new Date()) {
  const generated = new Intl.DateTimeFormat("zh-CN", { timeZone:"Asia/Shanghai", dateStyle:"short", timeStyle:"short", hour12:false }).format(now);
  return `【市场六指标日报未发送】${generated}（北京时间）\n六项数据未全部通过“数值＋日期＋来源网页”校验，因此没有拼接残缺日报，也没有使用估算值。\n失败原因：${clean(error?.message || error)}`.slice(0,3900);
}

export const PARSERS = { vix:parseVix, vxn:data=>parseVxn(data.text), cape:data=>parseCape(data.text), ndxPe:data=>parseNasdaqPe(data.text), ahr999:data=>parseAhr999(data.text), buffett:data=>parseBuffett(data.text) };
