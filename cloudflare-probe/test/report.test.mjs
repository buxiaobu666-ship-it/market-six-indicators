import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseVix, parseVxn, parseCape, parseNasdaqPe, parseAhr999, parseBuffett, formatReport, failureMessage } from "../src/report.mjs";

test("parses each current value together with its displayed date", () => {
  assert.equal(parseVix({quote:"14.53", header:"14.53 +1.47% Closed · 04/09"}).value, 14.53);
  assert.equal(parseVxn("Observations 2026-09-03: 20.16 Updated: Sep 4, 2026 8:37 AM CDT").date, "2026-09-03；页面更新时间：Sep 4, 2026 8:37 AM CDT");
  assert.equal(parseCape("Current Shiller PE Ratio: 41.41 -0.16 4:00 PM EDT, Fri Sep 4").value, 41.41);
  assert.equal(parseNasdaqPe("Nasdaq-100 P/E ratio: 31.5 The Nasdaq-100 trades at 31.5× trailing 12-month earnings (as of market close, Sep 4, 2026)").date, "Sep 4, 2026");
  assert.equal(parseAhr999("AHR999 — LATEST READING UTC 2026-09-05 0.5267 DCA ZONE").value, 0.5267);
  assert.equal(parseBuffett("CURRENT DATA TOTAL US STOCK MARKET VALUE $77.11T ANNUALIZED GDP $32.49T BUFFETT INDICATOR 237.4% The total value is 237.4% of GDP. As of September 4, 2026").display, "237.4%");
});

test("rejects missing date/value pairs", () => {
  assert.throws(() => parseNasdaqPe("Nasdaq-100 P/E ratio: 31.5"), /当前值＋日期/);
  assert.throws(() => parseBuffett("BUFFETT INDICATOR 237.4%"), /当前值＋日期/);
});

test("formats six complete sections with approved links and labels", () => {
  const results = Object.fromEntries(Object.entries(SOURCES).map(([key,source]) => [key,{value:key === "ahr999" ? 0.5 : 22,display:key === "buffett" ? "22%" : key === "ahr999" ? "0.5" : "22",date:"2026-09-04",source}]));
  const report = formatReport(results, new Date("2026-09-05T00:00:00Z"));
  for (const source of Object.values(SOURCES)) assert.ok(report.includes(source));
  assert.match(report, /VIX（恐慌指数）/);
  assert.match(report, /VXN（纳指100短期指标）/);
  assert.match(report, /BTC AHR999（定投指标）/);
  assert.ok(report.length < 4096);
});

test("never formats a partial report", () => {
  assert.throws(() => formatReport({}), /六项数据未齐全/);
  assert.match(failureMessage(new Error("HTTP 403")), /没有拼接残缺日报/);
});
