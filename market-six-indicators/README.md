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

## 断网与休眠恢复

取数任务在 macOS 上运行时临时阻止空闲休眠（任务结束即释放，不修改系统永久设置）。
每个来源最多尝试三次；遇到网络挂起、网络切换、连接超时或临时服务器错误时关闭本任务的浏览器并重新启动，间隔 5 秒、10 秒重试。权限拒绝、无效数值或缺失日期仍阻止完整日报。

防空闲休眠不能解决合盖强制休眠、关机、耗尽电池或断网。当前架构仍需本机运行器恢复在线才能取数，GitHub 调度也不保证 08:00 准点启动。

`npm test` 运行模拟网络故障与六项解析测试；`DRY_RUN=1 npm run report` 只校验，不发 Telegram。
生产运行保存每项数值、网页日期、来源、抓取时刻到审核附件；发送步骤核对 Telegram 返回的正文和消息 ID 后才判定发送成功。
