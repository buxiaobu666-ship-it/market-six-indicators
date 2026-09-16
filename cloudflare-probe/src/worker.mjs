import { launch } from "@cloudflare/playwright";
import { SOURCES, PARSERS, beijingDay, failureMessage, formatReport, clean, isCompleteResults } from "./report.mjs";

const CHAT_ID = "@LilcMarketBrief";
const DELIVERY_SCHEDULE = ["08:00"];
const PREFETCH_CRON = "57 23 * * *"; // 07:57 Beijing: collect and validate before the 08:00 send.
const DELIVERY_CRON = "0 0 * * *"; // 08:00 Beijing: send only the validated snapshot.
const PREFETCH_MAX_AGE_MS = 10 * 60 * 1000;
const SOURCE_ATTEMPTS = 2;
const TELEGRAM_ATTEMPTS = 3;
const COLLECTION_DEADLINE_MS = 70_000;

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readPage(browser, key, url) {
  const page = await browser.newPage();
  try {
    const response = await page.goto(url, { waitUntil:"domcontentloaded", timeout:12000 });
    if (!response?.ok()) {
      const title = await page.title().catch(() => "");
      throw new Error(`HTTP ${response?.status() || "无响应"}${title ? `（${title}）` : ""}`);
    }
    await page.waitForTimeout(1000);
    const text = clean(await page.locator("body").innerText({ timeout:8000 }));
    if (text.length < 100) throw new Error("页面正文过短，无法校验");
    if (key === "vix") {
      const quote = clean(await page.locator('[data-test="instrument-price-last"]').first().innerText({ timeout:6000 }));
      const header = clean(await page.locator('[data-test="instrument-header-details"]').first().innerText({ timeout:6000 }));
      return { text, quote, header };
    }
    return { text };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function collectSix(env) {
  const browser = await launch(env.BROWSER);
  const results = {};
  const errors = [];
  const startedAt = Date.now();
  try {
    for (const [key, url] of Object.entries(SOURCES)) {
      let lastError;
      for (let attempt = 1; attempt <= SOURCE_ATTEMPTS; attempt += 1) {
        if (Date.now() - startedAt >= COLLECTION_DEADLINE_MS) {
          lastError = new Error("本轮六项读取达到70秒总限时，等待下一备用时段重试");
          break;
        }
        try {
          const raw = await readPage(browser, key, url);
          const parsed = PARSERS[key](raw);
          if (parsed.source !== url || !parsed.date || !Number.isFinite(parsed.value)) throw new Error("数值、日期和来源未形成完整校验记录");
          results[key] = parsed;
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < SOURCE_ATTEMPTS) await pause(1500);
        }
      }
      if (lastError) errors.push(`${url}：${clean(lastError.message)}（已尝试${SOURCE_ATTEMPTS}次）`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return results;
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Cloudflare尚未配置TELEGRAM_BOT_TOKEN");
  let lastError;
  for (let attempt = 1; attempt <= TELEGRAM_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({ chat_id:CHAT_ID, text, disable_web_page_preview:true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.description || `HTTP ${response.status}`);
      return payload.result?.message_id;
    } catch (error) {
      lastError = error;
      if (attempt < TELEGRAM_ATTEMPTS) await pause(attempt * 1500);
    }
  }
  throw new Error(`Telegram发送失败：${clean(lastError?.message)}（已尝试${TELEGRAM_ATTEMPTS}次）`);
}

function prefetchKey(day) {
  return `prefetch:${day}`;
}

function offsetDay(day, offset) {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + offset));
  return shifted.toISOString().slice(0, 10);
}

function isMonday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
}

function previousMonthFirst(day) {
  const [year, month] = day.split("-").map(Number);
  const priorYear = month === 1 ? year - 1 : year;
  const priorMonth = month === 1 ? 12 : month - 1;
  return `${priorYear}-${String(priorMonth).padStart(2, "0")}-01`;
}

async function sentResults(env, day) {
  const record = await env.REPORT_STATE.get(`delivery:${day}`, "json");
  return record?.status === "sent" && isCompleteResults(record.results) ? record.results : undefined;
}

async function previousSuccessfulResults(env, day) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const results = await sentResults(env, offsetDay(day, -offset));
    if (results) return results;
  }
  return undefined;
}

function daysBetween(startDay, endDay) {
  const days = [];
  for (let day = startDay; day <= endDay; day = offsetDay(day, 1)) days.push(day);
  return days;
}

function changedReadings(readings) {
  return readings.filter((reading, index) => {
    if (index === 0) return true;
    const prior = readings[index - 1];
    return reading.item.display !== prior.item.display || reading.item.date !== prior.item.date;
  });
}

async function periodStatistics(env, startDay, endDay, currentResults) {
  const days = daysBetween(startDay, endDay);
  const snapshots = await Promise.all(days.map(async day => ({
    day,
    results:day === endDay ? currentResults : await sentResults(env, day)
  })));
  const complete = snapshots.filter(({results}) => isCompleteResults(results));
  if (complete.length < 2) return undefined;
  const items = {};
  for (const key of Object.keys(SOURCES)) {
    const readings = changedReadings(complete.map(({day, results}) => ({day, item:results[key]})));
    if (!readings.length) continue;
    const low = readings.reduce((best, reading) => reading.item.value < best.item.value ? reading : best);
    const high = readings.reduce((best, reading) => reading.item.value > best.item.value ? reading : best);
    items[key] = { start:readings[0].item, end:readings.at(-1).item, low:low.item, high:high.item };
  }
  return Object.keys(items).length ? { startDay, endDay, items } : undefined;
}

async function reportComparisons(env, day, currentResults) {
  const comparisons = { previous:await previousSuccessfulResults(env, day) };
  if (isMonday(day)) comparisons.weekly = await periodStatistics(env, offsetDay(day, -7), day, currentResults);
  if (day.endsWith("-01")) comparisons.monthly = await periodStatistics(env, previousMonthFirst(day), day, currentResults);
  return comparisons;
}

async function prepare(env) {
  const day = beijingDay();
  const key = prefetchKey(day);
  const collectedAt = new Date().toISOString();
  try {
    const results = await collectSix(env);
    if (!isCompleteResults(results)) throw new Error("预取结果未形成六项完整校验记录");
    await env.REPORT_STATE.put(key, JSON.stringify({ status:"ready", collectedAt, results }), { expirationTtl:86400 });
    return { ok:true, day, collectedAt };
  } catch (error) {
    await env.REPORT_STATE.put(key, JSON.stringify({ status:"failed", collectedAt, error:clean(error.message) }), { expirationTtl:86400 });
    throw error;
  }
}

async function readPrefetchedResults(env, day) {
  const prepared = await env.REPORT_STATE.get(prefetchKey(day), "json");
  const age = Date.now() - Date.parse(prepared?.collectedAt || "");
  if (prepared?.status !== "ready" || !Number.isFinite(age) || age < 0 || age > PREFETCH_MAX_AGE_MS || !isCompleteResults(prepared.results)) {
    throw new Error("08:00前的六项数据预取或校验失败；为避免延迟发送，本次不补发完整日报");
  }
  return prepared.results;
}

async function execute(env, {force=false, notifyFailure=true, usePrefetch=false} = {}) {
  const day = beijingDay();
  const key = `delivery:${day}`;
  const previous = await env.REPORT_STATE.get(key, "json");
  if (!force && previous?.status === "sent") return { ok:true, duplicate:true, day, messageId:previous.messageId };
  if (!force && previous?.status === "running" && Date.now() - Date.parse(previous.startedAt) < 7 * 60 * 1000) {
    return { ok:true, duplicate:true, running:true, day };
  }
  const attempt = Number(previous?.attempt || 0) + 1;
  await env.REPORT_STATE.put(key, JSON.stringify({ status:"running", attempt, startedAt:new Date().toISOString() }), { expirationTtl:604800 });
  try {
    const results = usePrefetch ? await readPrefetchedResults(env, day) : await collectSix(env);
    const messageId = await sendTelegram(env, formatReport(results, new Date(), await reportComparisons(env, day, results)));
    await env.REPORT_STATE.put(key, JSON.stringify({ status:"sent", attempt, messageId, sentAt:new Date().toISOString(), results }), { expirationTtl:3888000 });
    return { ok:true, day, attempt, messageId, results };
  } catch (caught) {
    let error = caught;
    let failureNoticeId;
    if (notifyFailure) {
      try { failureNoticeId = await sendTelegram(env, failureMessage(error)); }
      catch (sendError) { error = new Error(`${error.message}\n${sendError.message}`); }
    }
    await env.REPORT_STATE.put(key, JSON.stringify({ status:"failed", attempt, error:clean(error.message), failureNoticeId, failedAt:new Date().toISOString() }), { expirationTtl:604800 });
    if (notifyFailure) throw error;
    return { ok:false, day, attempt, retryScheduled:true, error:clean(error.message) };
  }
}

function authorized(request, env) {
  return Boolean(env.RUN_KEY) && request.headers.get("authorization") === `Bearer ${env.RUN_KEY}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok:true, service:"market-six-daily-report", schedule:DELIVERY_SCHEDULE.map(time => `${time} Beijing`), telegram:Boolean(env.TELEGRAM_BOT_TOKEN) });
    }
    if (request.method !== "POST" || !["/run", "/validate"].includes(url.pathname)) return new Response("Not found", {status:404});
    if (!authorized(request, env)) return new Response("Unauthorized", {status:401});
    try {
      if (url.pathname === "/validate") {
        const results = await collectSix(env);
        return Response.json({ok:true, results, report:formatReport(results)});
      }
      return Response.json(await execute(env, {
        force:url.searchParams.get("force") === "1",
        notifyFailure:url.searchParams.get("notify_failure") !== "0"
      }));
    }
    catch (error) { return Response.json({ok:false, error:clean(error.message)}, {status:500}); }
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === PREFETCH_CRON) {
      ctx.waitUntil(prepare(env));
      return;
    }
    if (controller.cron === DELIVERY_CRON) {
      ctx.waitUntil(execute(env, {notifyFailure:true, usePrefetch:true}));
    }
  }
};
