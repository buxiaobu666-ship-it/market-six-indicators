import { mkdir, readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { clockAt, nextAction, deliveryText } from './cloud-scheduler.mjs';
import { sources } from './daily-report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.STATE_DIR || '/data';
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID || '@LilcMarketBrief';
if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in the cloud service secrets.');
if (process.env.CLOUD_SEND_ENABLED !== '1') throw new Error('Cloud delivery is disabled until all six sources pass deployment validation.');
await mkdir(stateDir, { recursive: true });
const statePath = join(stateDir, 'daily-state.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = {}; }
let collecting = false;
let lastTick = Date.now();
let saveQueue = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state, null, 2);
  saveQueue = saveQueue.then(async () => {
    await writeFile(`${statePath}.tmp`, snapshot, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  });
  return saveQueue;
}

async function collect(day) {
  collecting = true;
  state.lastAttempt = Date.now();
  // A failed refresh must not silently fall back to an earlier snapshot.
  state.candidate = null;
  await save();
  let temp;
  try {
    temp = await mkdtemp(join(stateDir, 'reading-'));
    const messagePath = join(temp, 'message.txt');
    const auditPath = join(temp, 'audit.json');
    await new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, ['src/daily-report.mjs'], {
        cwd: root,
        detached: true,
        env: { ...process.env, TELEGRAM_BOT_TOKEN: '', DRY_RUN: '1', REPORT_OUTPUT_FILE: messagePath, REPORT_AUDIT_FILE: auditPath },
        stdio: ['ignore', 'inherit', 'inherit']
      });
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }, 110000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        code === 0 ? resolveRun() : reject(new Error(signal ? '取数超时，已终止本次浏览器。' : `取数校验失败（退出码 ${code}）。`));
      });
    });
    const audit = JSON.parse(await readFile(auditPath, 'utf8'));
    for (const [key, source] of Object.entries(sources)) {
      if (!Number.isFinite(audit[key]?.value) || !audit[key]?.date || audit[key]?.source !== source) throw new Error(`${key} 数值、日期、来源不匹配。`);
    }
    const text = await readFile(messagePath, 'utf8');
    if (!text.startsWith('市场六指标日报｜') || text.includes('【市场六指标日报未发送】')) throw new Error('日报文本校验失败。');
    if (state.day === day && !state.delivery) {
      state.candidate = { day, checkedAt: Date.now(), text, audit };
      state.error = null;
      await save();
    }
  } catch (error) {
    let detail = error.message;
    if (temp) {
      try { detail = (await readFile(join(temp, 'message.txt'), 'utf8')).slice(0, 2200); } catch {}
    }
    if (state.day === day && !state.delivery) { state.error = detail; await save(); }
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    collecting = false;
  }
}

async function deliver() {
  const payload = deliveryText(new Date(), state);
  // Persist the attempt before sending. After an ambiguous network failure or
  // restart, never blindly resend a possibly delivered Telegram message.
  state.delivery = { status: 'pending', kind: payload.kind, startedAt: Date.now() };
  await save();
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: payload.text, disable_web_page_preview: true })
    });
    const receipt = await response.json();
    if (!response.ok || !receipt.ok || receipt.result?.text !== payload.text || !Number.isInteger(receipt.result?.message_id)) {
      throw new Error(`Telegram did not confirm delivery (HTTP ${response.status}).`);
    }
    state.delivery = { ...state.delivery, status: 'sent', messageId: receipt.result.message_id, finishedAt: Date.now() };
    console.log(JSON.stringify({ day: state.day, ...state.delivery }));
  } catch (error) {
    state.delivery.status = 'uncertain';
    console.error(error.message);
  }
  await save();
}

const server = createServer((request, response) => {
  const healthy = Date.now() - lastTick < 45000 && !['uncertain', 'pending'].includes(state.delivery?.status) &&
    !(state.delivery?.status === 'sent' && state.delivery?.kind === 'failure');
  response.writeHead(request.url === '/health' ? (healthy ? 200 : 503) : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ healthy, schedule: '08:00 Asia/Shanghai', day: state.day, collecting, delivery: state.delivery }));
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
console.log('Cloud scheduler started: prepare 07:50, refresh 07:57, deliver 08:00 Asia/Shanghai.');
while (true) {
  lastTick = Date.now();
  const action = nextAction(new Date(), state, collecting);
  if (action === 'reset') { state = { day: clockAt(new Date()).day }; await save(); }
  if (action === 'collect') void collect(state.day).catch(error => { console.error(error.message); process.exit(1); });
  if (action === 'deliver') await deliver();
  await delay(1000);
}
