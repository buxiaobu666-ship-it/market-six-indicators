import { setTimeout as delay } from "node:timers/promises";

// Retry transport failures only; never turn a denied page or invalid data into
// a successful report. Each retry must use a newly launched task-owned browser.
export function isTransient(error) {
  return /ERR_(?:NETWORK_IO_SUSPENDED|NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|TIMED_OUT|NAME_NOT_RESOLVED)|(?:page\.goto|browserType\.launch): Timeout|HTTP (?:408|429|5\d\d)\b|browser has been closed/i.test(String(error?.message || error));
}

export async function readWithRecovery(operation, {
  reset, attempts = 3, sleep = delay, warn = console.warn, key = "source"
}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isTransient(error) || attempt === attempts) throw error;
      warn(`[${key}] transient failure, rebuilding browser; retry ${attempt + 1}/${attempt}: ${String(error.message).split("\n")[0]}`);
      await reset();
      await sleep(attempt * 5000);
    }
  }
}

export async function collectAll(sourceMap, read, parsers) {
  const results = {};
  const failures = [];
  for (const [key, url] of Object.entries(sourceMap)) {
    try {
      const raw = await read(url, key);
      const item = parsers[key](raw);
      if (!Number.isFinite(item.value) || item.value <= 0 || !item.date || item.source !== url) {
        throw new Error("数值、日期、来源校验失败");
      }
      results[key] = { ...item, fetchedAt: new Date().toISOString() };
      console.log(`[${key}] verified: ${item.display} | ${item.date} | ${url}`);
    } catch (error) {
      failures.push(`${url}：${String(error.message).split("\n")[0]}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return results;
}
