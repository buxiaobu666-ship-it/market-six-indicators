# 云端每日08:00版本

状态：部署包已准备；尚未在常驻云服务器启用。GitHub托管Linux和macOS已实测，GuruFocus两个网页均返回403，必须先在最终服务器确认全部六项可读。

本服务运行在常驻Linux容器，每日北京时间07:50预取、07:57刷新、08:00提交Telegram发送请求。不依赖Mac、Codex或GitHub定时排队。发送时间仍受云主机和Telegram网络可用性影响。

需要：一台可运行Docker的常在线服务器或Railway常驻服务；持久磁盘挂载到/data；只运行一个实例；不启用闲置休眠。凭据只填入部署平台Secret，不写进代码或聊天。

## 部署

Docker构建上下文设为market-six-indicators目录。容器启动命令已经在Dockerfile中配置。

环境变量：
- TELEGRAM_BOT_TOKEN：现有机器人Token。
- TELEGRAM_CHAT_ID：@LilcMarketBrief。
- STATE_DIR：/data（必须挂载持久磁盘，用于重启后去重）。
- CLOUD_SEND_ENABLED：先不设；正式验收后设为1。
- PORT：8080或部署平台自动提供的端口。

首次在目标服务器用同一容器运行取数检查（命令覆盖为node src/daily-report.mjs，设置DRY_RUN=1，REPORT_OUTPUT_FILE=/data/preflight.txt，REPORT_AUDIT_FILE=/data/preflight-audit.json）。必须退出码为0且六项数值、日期、来源匹配。403不能通过更改校验规则忽略，也不能先承诺成功后购买服务器。

检查成功后恢复默认启动命令，正式服务不能残留DRY_RUN、REPORT_OUTPUT_FILE、REPORT_AUDIT_FILE。设置CLOUD_SEND_ENABLED=1。健康检查路径为/health；启动后查看schedule为08:00 Asia/Shanghai。

## 切换验收

1. 最终云服务器上的六项取数全部通过。
2. Telegram一次真实发送回执成功，核对群名和完整正文。
3. 启用常驻服务的08:00推送；关闭旧Daily market brief的定时触发，防止重复。
4. 如保留/report，则将其改为调用新云服务；旧命令不能继续创建Mac运行器任务。
5. 检查持久磁盘和单实例设置。当天发送记录含messageId，重启不会盲目重复发送。

08:00尚无有效完整报告时，只发送具体失败说明，禁止使用昨天的日报或缺项拼接。发送结果不确定时记为uncertain并通过健康检查报错，避免盲目重发。部署后需要接入平台告警处理这种异常。
