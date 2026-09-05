import test from "node:test";
import assert from "node:assert/strict";
import { readWithRecovery, collectAll, isTransient, withDeadline } from "../src/recovery.mjs";
import { sources, parseVix, parseVxn, parseCape, parseNasdaqPe, parseAhr999, parseBuffett, formatReport } from "../src/daily-report.mjs";

// Synthetic fixtures, not live market data.
test("suspended network rebuilds browser and retries same operation", async () => {
  let calls = 0, resets = 0;
  const result = await readWithRecovery(async () => {
    if (++calls < 3) throw new Error("page.goto: net::ERR_NETWORK_IO_SUSPENDED");
    return "verified";
  }, { reset: async () => { resets++; }, sleep: async () => {}, warn: () => {} });
  assert.equal(result, "verified");
  assert.equal(calls, 3);
  assert.equal(resets, 2);
});
test("transient failure stops after three attempts", async () => {
  let calls = 0;
  const error = await readWithRecovery(async () => {
    calls++; throw new Error("net::ERR_NETWORK_CHANGED");
  }, { reset: async () => {}, sleep: async () => {}, warn: () => {} }).catch(error => error);
  assert.match(error.message, /NETWORK_CHANGED/);
  assert.equal(error.code, "NETWORK_UNAVAILABLE");
  assert.equal(calls, 3);
});
test("a stuck source is bounded by a hard deadline", async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 5, "source read"), /source read timeout/);
});
test("access denial and data errors are not transient", async () => {
  for (const message of ["HTTP 403", "value/date pair not found", "HTTP 404"]) {
    assert.equal(isTransient(new Error(message)), false);
  }
  assert.equal(isTransient(new Error("HTTP 503")), true);
  assert.equal(isTransient(new Error("browserType.launch: Timeout 45000ms exceeded")), true);
});
test("one invalid metric prevents a partial result and still checks other metrics", async () => {
  const read = [];
  await assert.rejects(collectAll({ a: "https://a/", b: "https://b/" }, async (_, key) => { read.push(key); }, {
    a: () => { throw new Error("unverified"); },
    b: () => ({ value: 1, display: "1", date: "2026-09-02", source: "https://b/" })
  }), /https:\/\/a\/：unverified/);
  assert.deepEqual(read, ["a", "b"]);
});
test("network outage fails fast instead of spending the whole job on every page", async () => {
  const read = [];
  await assert.rejects(collectAll({ a: "https://a/", b: "https://b/" }, async (_, key) => {
    read.push(key);
    const error = new Error("net::ERR_INTERNET_DISCONNECTED");
    error.code = "NETWORK_UNAVAILABLE";
    throw error;
  }, { a: () => {}, b: () => {} }), /INTERNET_DISCONNECTED/);
  assert.deepEqual(read, ["a"]);
});
test("source mismatch fails validation", async () => {
  await assert.rejects(collectAll({ a: "https://a/" }, async () => {}, {
    a: () => ({ value: 1, date: "2026-09-02", source: "https://substitute/" })
  }), /校验失败/);
});
test("VIX reads quote rather than change percentage", () => {
  assert.equal(parseVix({ quote: "16.50", header: "16.50 +0.54% Real-time Data · 04:47:01" }).value, 16.5);
  assert.throws(() => parseVix({ quote: "+0.54%", header: "Real-time Data · 04:47:01" }));
});
test("FRED observation and update date remain distinct", () => {
  const item = parseVxn("Observations 2026-09-01: 22.00 Updated: Sep 2, 2026 8:37 AM CDT 2026-08-31: 21.00");
  assert.equal(item.value, 22);
  assert.match(item.date, /^2026-09-01；.*Sep 2, 2026/);
});
test("CAPE value stays paired with displayed timestamp", () => {
  const item = parseCape("Current Shiller PE Ratio: 40.00 +0.19 (0.45%) 4:00 PM EDT, Wed Sep 2");
  assert.equal(item.value, 40);
  assert.match(item.date, /Wed Sep 2/);
});
test("Nasdaq headline latest pair takes precedence over older stats", () => {
  const item = parseNasdaqPe("Nasdaq 100 PE Ratio : 28.00 (As of 2026-09-02) Last Value 27.00 Latest Period 2026-09-01");
  assert.equal(item.value, 28);
  assert.equal(item.date, "2026-09-02");
});
test("AHR999 latest headline stays paired with its date", () => {
  const item = parseAhr999("AHR999 — latest reading UTC 2026-09-02 0.5000 DCA zone 0.45 – 1.20");
  assert.equal(item.value, 0.5);
  assert.equal(item.date, "2026-09-02");
});
test("Buffett percent parsed without recalculation", () => {
  const item = parseBuffett("USA Ratio of Total Market Cap over GDP : 235.0% (As of 2026-09-01)");
  assert.equal(item.display, "235.0%");
  assert.equal(item.date, "2026-09-01");
});
test("report requires six metrics and preserves approved links and source labels", () => {
  assert.throws(() => formatReport({}), /六项/);
  const fixtures = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, { value: 22, display: "22", date: "2026-09-01", source }]));
  const text = formatReport(fixtures);
  for (const source of Object.values(sources)) assert.ok(text.includes(source));
  assert.match(text, /aix4u 独立计算版/);
  assert.match(text, /15≤值<25/);
  assert.ok(text.length < 4096, `Telegram single-message limit exceeded: ${text.length}`);
});
