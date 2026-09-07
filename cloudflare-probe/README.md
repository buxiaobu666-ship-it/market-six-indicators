# Cloudflare 免费版市场六指标日报

正式版运行在 Cloudflare Workers + Browser Rendering 免费额度内，不依赖个人电脑开机。

- Cron：`0 0 * * *`，即北京时间每天 08:00。
- 六项必须全部取得当前值、页面日期和批准后的原始链接；任何一项失败都不拼接日报。
- 成功时向 `@LilcMarketBrief` 发送完整日报；失败时只发送明确的校验失败通知。
- `REPORT_STATE` 用于同一天去重；手动 `/run` 入口需要 `RUN_KEY`，健康检查为 `/health`。
- `TELEGRAM_BOT_TOKEN`、`RUN_KEY` 必须使用 Cloudflare Secret 保存，禁止写入仓库。

当前批准来源：Investing VIX、FRED VXN、Multpl CAPE、ChartRow Nasdaq-100 trailing P/E、aix4u AHR999、LongtermTrends Wilshire 5000/GDP。
