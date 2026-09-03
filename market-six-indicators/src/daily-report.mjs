import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readWithRecovery, collectAll } from "./recovery.mjs";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@LilcMarketBrief";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "1";
const REPORT_OUTPUT_FILE = process.env.REPORT_OUTPUT_FILE;

export const sources = {
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

async function pageData(browser, url, key) {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/133 Safari/537.36" });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response || !response.ok()) throw new Error(`HTTP ${response?.status() || "no response"}`);
    await page.waitForTimeout(3000);
    const text = clean(await page.locator("body").innerText({ timeout: 20000 }));
    if (text.length < 100) throw new Error(`${key} 页面未返回足够的可读内容`);

    // Investing puts the VIX quote and its change percentage in separate
    // elements. Reading the quote element directly prevents a percentage such
    // as 0.54% from ever being reported as the index level.
    if (key === "vix") {
      const quote = clean(await page.locator('[data-test="instrument-price-last"]').first().innerText({ timeout: 10000 }));
      const header = clean(await page.locator('[data-test="instrument-header-details"]').first().innerText({ timeout: 10000 }));
      if (!quote || !header) throw new Error("VIX 页面未找到主报价或实时/收盘状态字段");
      return { text, quote, header };
    }
    return { text };
  } finally { await page.close(); }
}

export function parseVix(data) {
  if (!/^\d{1,2}(?:\.\d+)?$/.test(data.quote)) {
    throw new Error("VIX 主报价字段不是可验证的指数数值");
  }
  const status = data.header.match(/(?:Real-time Data|Closed(?:\s*[·|]\s*\d{1,2}\/\d{1,2})?)(?:\s*[·|]\s*\d{1,2}:\d{2}(?::\d{2})?)?/i)?.[0];
  if (!status) throw new Error("VIX 页面未找到实时/收盘更新时间");
  return { value: parseNumber(data.quote, "VIX"), display: data.quote, date: `网页显示：${clean(status)}`, source: sources.vix };
}
export function parseVxn(text) {
  const row = requireMatch(text, /(\d{4}-\d{2}-\d{2})\s*:\s*([0-9]+(?:\.[0-9]+)?)/, "VXN（FRED）");
  const updated = text.match(/Updated:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s+[A-Z]{2,4})/i)?.[1] || row[1];
  return { value: parseNumber(row[2], "VXN"), display: row[2], date: `${row[1]}；页面更新时间：${clean(updated)}`, source: sources.vxn };
}
export function parseCape(text) {
  const pair = requireMatch(text, /Current Shiller PE Ratio:\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,120}?(\d{1,2}:\d{2}\s*(?:AM|PM)\s+[A-Z]{2,4},?\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})/i, "CAPE");
  return { value: parseNumber(pair[1], "CAPE"), display: pair[1], date: clean(pair[2]), source: sources.cape };
}
export function parseNasdaqPe(text) {
  const dated =
    text.match(/Nasdaq 100 PE Ratio(?:\s*:\s*|\s+was\s+|\s+is\s+)([0-9]+(?:\.[0-9]+)?)[\s\S]{0,240}?(?:\(?As of\s*)?(\d{4}-\d{2}-\d{2})/i) ||
    text.match(/Last Value\s*([0-9]+(?:\.[0-9]+)?)[\s\S]{0,360}?Latest Period\s*(\d{4}-\d{2}-\d{2})/i);
  if (!dated) throw new Error("纳斯达克100 PE 页面未找到可验证的当前值/日期组合");
  return { value: parseNumber(dated[1], "纳斯达克100 PE"), display: dated[1], date: dated[2], source: sources.ndxPe };
}
export function parseAhr999(text) {
  const row = requireMatch(text, /AHR999\s*[—-]\s*latest reading UTC\s*(\d{4}-\d{2}-\d{2})[\s\S]{0,120}?([0-9]+(?:\.[0-9]+)?)\s+(?:bargain|DCA|caution|bubble)\s+zone/i, "BTC AHR999");
  return { value: parseNumber(row[2], "BTC AHR999"), display: row[2], date: row[1].replaceAll("/", "-"), source: sources.ahr999 };
}
export function parseBuffett(text) {
  const dated = requireMatch(text, /USA Ratio of Total Market Cap over GDP\s*:\s*([0-9]+(?:\.[0-9]+)?)%\s*\(As of\s*(\d{4}-\d{2}-\d{2})\)/i, "Wilshire 5000 / GDP");
  return { value: parseNumber(dated[1], "Wilshire 5000 / GDP"), display: `${dated[1]}%`, date: dated[2], source: sources.buffett };
}
function classification(value, ranges) {
  for (const [limit, zone, risk] of ranges) if (value < limit) return { zone, risk };
  throw new Error("参考区间配置无效");
}
function valueFrom(metric) { return metric.key === "buffett" ? `${metric.display}` : metric.display; }
export function formatReport(results) {
  if (definitions.some(({ key }) => !results[key])) throw new Error("六项数据未齐全，禁止生成日报");
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date());
  const blocks = definitions.map((definition, i) => {
    const item = results[definition.key];
    const c = classification(item.value, definition.ranges);
    const range = definition.ranges.map(([limit, zone], index, rows) => `${index === 0 ? `<${limit}` : Number.isFinite(limit) ? `${rows[index - 1][0]}≤值<${limit}` : `≥${rows[index - 1][0]}`} ${zone}`).join("；");
    return `${i + 1}. ${definition.name}\n当前值：${valueFrom(item)}\n页面数据日期/更新时间：${item.date}\n来源：${item.source}\n参考范围：${range}\n当前区间：${c.zone}｜风险等级：${c.risk}\n含义：${definition.meaning}\n建议：${definition.advice}`;
  });
  return `市场六指标日报｜${date}（北京时间生成）\n\n${blocks.join("\n\n")}\n\n来源口径：沿用已批准的来源。VXN 为 FRED 发布的 CBOE 收盘序列；AHR999 为 aix4u 独立计算版，不是 CoinGlass；巴菲特指标为 GuruFocus 版，不是 LongtermTrends。\n说明：数值由本次网页读取，数据日期以各项标注为准，不等同于生成日期。风险分档为参考规则，不是网站评级；低波动或低估值不等于低投资风险，不构成买卖指令。`;
}
async function sendTelegram(text) {
  // The self-hosted Mac runner can read the source pages but cannot reliably
  // reach Telegram. Persist the validated text for a GitHub-hosted send job.
  if (REPORT_OUTPUT_FILE) {
    await writeFile(REPORT_OUTPUT_FILE, text, "utf8");
    console.log(`Telegram message written to ${REPORT_OUTPUT_FILE}.`);
    return;
  }
  if (DRY_RUN) {
    console.log("DRY RUN — Telegram 未发送。\n" + text);
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram 发送失败：${result.description || response.status}`);
}

export async function main() {
  if (!TOKEN && !DRY_RUN && !REPORT_OUTPUT_FILE) throw new Error("Missing TELEGRAM_BOT_TOKEN GitHub Secret.");
  let browser;
  let guard;
  // Scoped to this job, not a permanent power-setting change. Does not prevent
  // shutdown, a flat battery, or forced/clamshell sleep.
  if (process.platform === "darwin") {
    guard = spawn("/usr/bin/caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
    guard.on("error", () => console.warn("Task sleep guard unavailable."));
  }
  const reset = async () => {
    const old = browser;
    browser = undefined;
    if (old) await old.close().catch(() => {});
  };
  const getBrowser = async () => {
    if (!browser) browser = await chromium.launch({
      headless: true,
      timeout: 45000,
      ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {})
    });
    return browser;
  };
  try {
    let message;
    try {
      const results = await collectAll(sources, (url, key) => readWithRecovery(
        async () => pageData(await getBrowser(), url, key), { reset, key }
      ), {
        vix: parseVix,
        vxn: data => parseVxn(data.text),
        cape: data => parseCape(data.text),
        ndxPe: data => parseNasdaqPe(data.text),
        ahr999: data => parseAhr999(data.text),
        buffett: data => parseBuffett(data.text)
      });
      message = formatReport(results);
      if (process.env.REPORT_AUDIT_FILE) await writeFile(process.env.REPORT_AUDIT_FILE, JSON.stringify(results, null, 2), "utf8");
      console.log("All six sources validated; report ready for delivery.");
    } catch (error) {
      message = `【市场六指标日报未发送】\n沿用已批准来源，未以估算或缺项拼接日报。取数或校验失败：\n${error.message}`.slice(0, 3900);
      console.error(message);
      process.exitCode = 1;
    }
    // Keep delivery outside collection's catch: a delivery failure must never
    // produce a second send attempt disguised as a data-failure notification.
    await sendTelegram(message);
  } finally {
    await reset();
    guard?.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
