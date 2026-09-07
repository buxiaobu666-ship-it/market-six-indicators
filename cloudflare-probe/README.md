# Cloudflare 免费云端取数验证

此程序仅测试当前已批准六个来源在 Cloudflare Browser Run 中的网页访问，不发送 Telegram，不创建定时任务。

使用 Workers Free；Browser Run 免费额度为每天10分钟。首次部署前确认账号处于免费计划。

1. 登录 Cloudflare 后，在此目录执行 npm ci 和 npx wrangler login。
2. 执行 npm run deploy；再用 npx wrangler secret put PROBE_KEY 设置随机测试密钥（不要粘贴到聊天）。
3. 使用带 Authorization: Bearer 的 POST 请求运行一次测试，保存状态、页面片段和时间。
4. 逐项核对六个当前值、日期和网页来源；任何403、验证码或无法核对均不能启用正式日报。
5. 全部通过后，再接入免费的定时触发、持久化去重和 Telegram Secrets。

未配置 PROBE_KEY 时，所有请求均拒绝。没有公开任意URL抓取入口，无法用于访问六个来源之外的URL。
