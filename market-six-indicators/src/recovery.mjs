import { setTimeout as delay } from "node:timers/promises";

// Retry transport failures only; never turn a denied page or invalid data into
// a successful report. Each retry must use a newly launched task-owned browser.
export function isTransient(error) {
  return /ERR_(?:NETWORK_IO_SUSPENDED|NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_TIMED_OUT|TIMED_OUT|NAME_NOT_RESOLVED)|(?:page\.goto|browserType\.launch): Timeout|source read timeout|HTTP (?:408|429|5\d\d)\b|browser has been closed/i.test(String(error?.message || error));
}

export async function withDeadline(operation, timeoutMs, label = "operation") {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readWithRecovery(operation, {
  reset, attempts = 3, sleep = delay, warn = console.warn, key = "source"
}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isTransient(error)) throw error;
      if (attempt === attempts) {
        error.code = "NETWORK_UNAVAILABLE";
        throw error;
      }
      warn(`[${key}] transient failure, rebuilding browser; retry ${attempt + 1}/${attempts}: ${String(error.message).split("\n")[0]}`);
      await reset();
      await sleep(attempt * 10000);
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
      // The remaining pages cannot succeed while the browser network is down.
      // Stop early so the failure notice can still be uploaded after recovery.
      if (error.code === "NETWORK_UNAVAILABLE") break;
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return results;
}
