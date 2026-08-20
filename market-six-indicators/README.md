# Market Six Indicators

每天北京时间 08:00 由 GitHub Actions 运行。程序用 Chromium 直接读取以下批准来源；任一数据无法可靠读取或数值、日期、链接无法对应时，不会发送不完整日报，而是向 Telegram 发送失败原因。

- VIX — Investing.com
- VXN — FRED
- Shiller PE / CAPE — Multpl
- Nasdaq 100 PE — GuruFocus
- BTC AHR999 — ahr999.aix4u.com
- Wilshire 5000 / GDP — GuruFocus

## 首次配置

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 创建：

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 你的 Telegram Bot Token |

然后在 **Actions** 中打开 `Daily market brief`，点击 **Run workflow**。首次手动运行会向 `@LilcMarketBrief` 发送一次真实日报或明确的失败原因；这是验证机器人群权限与网页解析的必要步骤。

定时表达式使用 UTC 00:00，即北京时间 08:00。GitHub 托管调度可能产生分钟级延迟。
