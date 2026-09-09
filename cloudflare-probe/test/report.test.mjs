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

test("puts the three core figures directly below the conclusion", () => {
  const results = {
    vix:{value:15.3,display:"15.30",date:"2026-09-07",source:SOURCES.vix},
    vxn:{value:20.16,display:"20.16",date:"2026-09-03",source:SOURCES.vxn},
    cape:{value:41.41,display:"41.41",date:"2026-09-04",source:SOURCES.cape},
    ndxPe:{value:31.5,display:"31.5",date:"2026-09-04",source:SOURCES.ndxPe},
    ahr999:{value:0.5325,display:"0.5325",date:"2026-09-06（UTC）",source:SOURCES.ahr999},
    buffett:{value:237.4,display:"237.4%",date:"2026-09-04",source:SOURCES.buffett}
  };
  const report = formatReport(results, new Date("2026-09-08T00:00:00Z"));
  assert.match(report, /标普500：🟡 等待启动｜CAPE 41\.41/);
  assert.match(report, /纳指100：🟡 等待启动｜PE 31\.5/);
  assert.match(report, /BTC：🟢 继续定投｜AHR999 0\.5325/);
  for (const [value,status] of [[0.449,"🟢 继续定投，可分批加仓"],[0.45,"🟢 继续定投"],[1.2,"🟢 继续定投"],[1.201,"🟡 暂停新增，检查持仓比例"]]) {
    const updated = formatReport({...results, ahr999:{...results.ahr999,value,display:String(value)}});
    assert.ok(updated.includes(`BTC：${status}｜AHR999 ${value}`));
    assert.ok(updated.includes(`当前行动：${status}`));
    assert.ok(updated.includes("已开始定投（2026年7月起）"));
    assert.ok(updated.length < 4096);
  }
  for (const [value, status] of [[30.01,"🟡 等待启动"],[30,"🟢 可开始定投"],[25.01,"🟢 可开始定投"],[25,"🟢 可开始定投｜已进入加仓参考区"],[20,"🟢 可开始定投｜已进入加仓参考区"]]) {
    results.cape = {...results.cape, value, display:String(value)};
    const updated = formatReport(results);
    assert.ok(updated.includes(`标普500：${status}｜CAPE ${value}`));
    assert.ok(updated.includes("纳指100：🟡 等待启动｜PE 31.5"));
    assert.ok(!updated.includes("美元"));
    assert.ok(updated.length < 4096);
  }
});

test("never formats a partial report", () => {
  assert.throws(() => formatReport({}), /六项数据未齐全/);
  assert.match(failureMessage(new Error("HTTP 403")), /没有拼接残缺日报/);
});
