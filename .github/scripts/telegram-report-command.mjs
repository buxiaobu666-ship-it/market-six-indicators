import { readFile, writeFile } from "node:fs/promises";

const token = process.env.TELEGRAM_BOT_TOKEN;
const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const allowedGroupUsername = "lilcmarketbrief";
const stateFile = ".github/telegram-command-state.json";

if (!token || !githubToken || !repository) throw new Error("Telegram 或 GitHub 认证环境变量缺失。");

async function telegram(method, body = undefined) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} 失败：${result.description || response.status}`);
  return result.result;
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubToken}`,
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`GitHub API ${path} 失败：${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function hasActiveDailyRun() {
  const data = await github(`/repos/${repository}/actions/workflows/daily-market-brief.yml/runs?per_page=20`);
  return data.workflow_runs.some((run) => run.status === "queued" || run.status === "in_progress");
}

async function queueDailyReport() {
  if (await hasActiveDailyRun()) return false;
  await github(`/repos/${repository}/actions/workflows/daily-market-brief.yml/dispatches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: "main" })
  });
  return true;
}

function isReportCommand(message) {
  return /^\/report(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(message.text || "");
}

function isAllowedGroup(message) {
  return String(message.chat?.username || "").toLowerCase() === allowedGroupUsername;
}

const state = JSON.parse(await readFile(stateFile, "utf8"));
const updates = await telegram("getUpdates", {
  offset: Number(state.offset || 0),
  timeout: 0,
  allowed_updates: ["message"]
});

const nextOffset = updates.reduce((value, update) => Math.max(value, update.update_id + 1), Number(state.offset || 0));

// On its first run, establish a cursor but do not replay old commands.
if (!state.initialized) {
  await writeFile(stateFile, `${JSON.stringify({ initialized: true, offset: nextOffset }, null, 2)}\n`);
  console.log("Telegram command cursor initialized.");
  process.exit(0);
}

for (const update of updates) {
  const message = update.message;
  if (!message || !isReportCommand(message) || !isAllowedGroup(message)) continue;
  const started = await queueDailyReport();
  const reply = started
    ? "已收到 /report：已创建取数任务。运行器在线且网络正常时开始读取，六项校验通过后发送完整日报；离线或休眠时需等待恢复，无法保证立即完成。"
    : "已有一份日报任务正在运行或排队，本次不重复创建；完成后会自动发送。";
  await telegram("sendMessage", { chat_id: message.chat.id, text: reply, disable_web_page_preview: true });
}

if (nextOffset !== Number(state.offset || 0)) {
  await writeFile(stateFile, `${JSON.stringify({ initialized: true, offset: nextOffset }, null, 2)}\n`);
}
