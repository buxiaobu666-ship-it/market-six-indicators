import { chromium } from "playwright";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@LilcMarketBrief";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN GitHub Secret.");

const sources = {
  vix: "https://www.investing.com/indices/volatility-s-p-500",
  vxn: "https://fred.stlouisfed.org/series/VXNCLS",
  cape: "https://www.multpl.com/shiller-pe",
  ndxPe: "https://www.gurufocus.com/economic_indicators/6778/nasdaq-100-pe-ratio",
  ahr999: "https://ahr999.aix4u.com/",
  buffett: "https://www.gurufocus.com/economic_indicators/4602/usa-ratio-of-total-market-cap-over-gdp?search=usa"
};

const definitions = [
  { key: "vix", name: "VIX", meaning: "标普500期权隐含波动率，反映市场对未来短期波动的定价。", ranges: [[15, "低波动", "低"], [25, "常态", "中低"], [35, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "波动处于较高水平时，宜降低一次性重仓比例并分批安排资金。" },
  { key: "vxn", name: "VXN", meaning: "纳斯达克100期权隐含波动率，反映科技成长股的预期波动。", ranges: [[20, "低波动", "低"], [30, "常态", "中低"], [40, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "波动处于较高水平时，宜减少短期集中暴露并采用分批节奏。" },
  { key: "cape", name: "标普500 Shiller PE（CAPE）", meaning: "以长期实际盈利平滑后的美股大盘估值指标。", ranges: [[20, "偏低", "低"], [30, "常态", "中低"], [40, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "估值偏高时，宜降低一次性重仓比例，并提高对买入价格和分散度的要求。" },
  { key: "ndxPe", name: "纳斯达克100 PE", meaning: "纳斯达克100成分股的盈利估值水平。", ranges: [[20, "偏低", "低"], [30, "常态", "中低"], [35, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "估值偏高时，宜避免一次性集中押注成长股，采用分批配置节奏。" },
  { key: "ahr999", name: "BTC AHR999", meaning: "比特币价格相对历史定投成本和长期趋势的区间指标。", ranges: [[0.45, "偏低", "低"], [1.2, "定投区", "中低"], [3, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "指标偏高时，宜控制追涨仓位；处于较低区间时，仍宜按计划分批而非一次性投入。" },
  { key: "buffett", name: "巴菲特指标（Wilshire 5000 / GDP）", meaning: "美国股市总市值（Wilshire 5000）相对 GDP 的估值观察指标。", ranges: [[100, "偏低", "低"], [150, "常态", "中低"], [200, "偏高", "中高"], [Infinity, "极高", "高"]], advice: "整体估值偏高时，宜降低一次性权益重仓比例，并保留分批投入空间。" }
];

const clean = (s) => String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const parseNumber = (value, label) => {
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label} 的当前值无法可靠解析`);
  return n;
};
function requireMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`${label} 页面未找到可验证的当前值/日期组合`);
  return match;
}
function nearby(text, anchors, label) {
  for (const anchor of anchors) {
    const i = text.search(anchor);
    if (i >= 0) return text.slice(Math.max(0, i - 250), i + 900);
  }
  throw new Error(`${label} 页面未找到指标名称`);
}

async function pageText(browser, url, label) {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/133 Safari/537.36" });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const text = clean(await page.locator("body").innerText({ timeout: 20000 }));
    if (text.length < 100) throw new Error(`${label} 页面未返回足够的可读内容`);
    return text;
  } finally { await page.close(); }
}

function parseVix(text) {
  // Investing's visible header is: CBOE Volatility Index (VIX) ... 14.89 ... Closed·19/08.
  // Capture the first decimal price and close label together, not a nearby S&P 500 reference.
  const header = requireMatch(
    text,
    /CBOE Volatility Index\s*\(VIX\)[\s\S]{0,900}?\b(\d{1,2}\.\d{1,2})\b[\s\S]{0,120}?((?:Closed|Close)[^\s|]{0,30})/i,
    "VIX"
  );
  return { value: parseNumber(header[1], "VIX"), display: header[1], date: clean(header[2]), source: sources.vix };
}
function parseVxn(text) {
  const row = requireMatch(text, /(\d{4}-\d{2}-\d{2})\s*:\s*([0-9]+(?:\.[0-9]+)?)/, "VXN（FRED）");
  const updated = text.match(/Updated:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+[A-Z]{2,4})/i)?.[1] || row[1];
  return { value: parseNumber(row[2], "VXN"), display: row[2], date: `${row[1]}；页面更新时间：${clean(updated)}`, source: sources.vxn };
}
function parseCape(text) {
  const pair = requireMatch(text, /Current Shiller PE Ratio:\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,120}?(\d{1,2}:\d{2}\s*(?:AM|PM)\s+[A-Z]{2,4},?\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i, "CAPE");
  return { value: parseNumber(pair[1], "CAPE"), display: pair[1], date: clean(pair[2]), source: sources.cape };
}
function parseNasdaqPe(text) {
  const dated = requireMatch(text, /Nasdaq 100 PE Ratio\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\(As of\s*(\d{4}-\d{2}-\d{2})\)/i, "纳斯达克100 PE");
  return { value: parseNumber(dated[1], "纳斯达克100 PE"), display: dated[1], date: dated[2], source: sources.ndxPe };
}
function parseAhr999(text) {
  const row = requireMatch(text, /AHR999\s*[—-]\s*latest reading UTC\s*(\d{4}-\d{2}-\d{2})[\s\S]{0,120}?([0-9]+(?:\.[0-9]+)?)\s+(?:bargain|DCA|caution|bubble)\s+zone/i, "BTC AHR999");
  return { value: parseNumber(row[2], "BTC AHR999"), display: row[2], date: row[1].replaceAll("/", "-"), source: sources.ahr999 };
}
function parseBuffett(text) {
  const dated = requireMatch(text, /USA Ratio of Total Market Cap over GDP\s*:\s*([0-9]+(?:\.[0-9]+)?)%\s*\(As of\s*(\d{4}-\d{2}-\d{2})\)/i, "Wilshire 5000 / GDP");
  return { value: parseNumber(dated[1], "Wilshire 5000 / GDP"), display: `${dated[1]}%`, date: dated[2], source: sources.buffett };
}
function classification(value, ranges) {
  for (const [limit, zone, risk] of ranges) if (value < limit) return { zone, risk };
  throw new Error("参考区间配置无效");
}
function valueFrom(metric) { return metric.key === "buffett" ? `${metric.display}` : metric.display; }
function formatReport(results) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const blocks = definitions.map((definition, i) => {
    const item = results[definition.key];
    const c = classification(item.value, definition.ranges);
    const range = definition.ranges.map(([limit, zone]) => Number.isFinite(limit) ? `<${limit} ${zone}` : `其余 ${zone}`).join("；");
    return `${i + 1}. ${definition.name}\n当前值：${valueFrom(item)}\n页面数据日期/更新时间：${item.date}\n来源：${item.source}\n参考范围：${range}\n当前区间：${c.zone}｜风险等级：${c.risk}\n含义：${definition.meaning}\n建议：${definition.advice}`;
  });
  return `市场六指标日报｜${date}（北京时间）\n\n${blocks.join("\n\n")}\n\n说明：所有数值均为本次直接读取的来源页面显示值；不同网页的更新节奏不同，日期以各页面显示为准。`;
}
async function sendTelegram(text) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram 发送失败：${result.description || response.status}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const raw = {};
  const failures = [];
  for (const [key, url] of Object.entries(sources)) {
    try { raw[key] = await pageText(browser, url, key); }
    catch (error) { failures.push(`${url}：${error.message}`); }
  }
  if (!failures.length) {
    try {
      const results = {
        vix: parseVix(raw.vix),
        vxn: parseVxn(raw.vxn),
        cape: parseCape(raw.cape),
        ndxPe: parseNasdaqPe(raw.ndxPe),
        ahr999: parseAhr999(raw.ahr999),
        buffett: parseBuffett(raw.buffett)
      };
      await sendTelegram(formatReport(results));
      console.log("Validated market brief sent.");
    } catch (error) { failures.push(error.message); }
  }
  if (failures.length) {
    const notice = `【市场六指标日报未发送】\n本次未使用估算或替代数据。失败原因：\n${failures.map((x, i) => `${i + 1}. ${x}`).join("\n")}`.slice(0, 3900);
    await sendTelegram(notice);
    console.error(notice);
    process.exitCode = 1;
  }
} finally { await browser.close(); }
