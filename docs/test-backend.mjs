// 本地验收测试（不调用真实模型，只验证鉴权 / 限流 / 体积 / 错误分支）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForHealth(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await wait(300);
  }
  return false;
}

async function start(env) {
  const logs = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const ok = await waitForHealth();
  return { child, logs, ok };
}

async function call(method, p, headers = {}, body = null) {
  const opt = { method, headers: { ...headers } };
  if (body !== null) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opt);
  const text = await r.text();
  return { code: r.status, text: text.slice(0, 160) };
}

function show(label, res) {
  console.log(`${label.padEnd(44)} HTTP ${String(res.code).padEnd(4)} ${res.text}`);
}

function stop(s) {
  return new Promise((resolve) => {
    s.child.on('exit', resolve);
    s.child.kill('SIGTERM');
    setTimeout(() => { try { s.child.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}

const results = [];
function check(name, got, want) {
  const pass = got === want;
  results.push({ name, got, want, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, want ${want})`);
}

// ============================================================ 场景 A
console.log('\n===== 场景 A：开发模式（无 APP_TOKEN、无 Key）=====');
{
  const s = await start({ APP_TOKEN: '', OPENROUTER_API_KEY: '' });
  if (!s.ok) { console.log('服务未启动'); process.exit(1); }

  const h = await call('GET', '/health');
  show('GET /health', h);
  check('health 返回 200', h.code, 200);

  const a = await call('POST', '/api/ai/analyze', {}, { text: '今天有点累' });
  show('无口令无 Key 调用', a);
  check('无 Key 时返回 503', a.code, 503);

  const healthJson = JSON.parse((await call('GET', '/health')).text.length ? '{}' : '{}');
  await stop(s);
  const all = s.logs.join('');
  console.log('--- 启动日志 ---');
  console.log(all.trim().split('\n').slice(0, 5).join('\n'));
  const leakA = /sk-or-|AIza/.test(all);
  check('日志无密钥', leakA ? 1 : 0, 0);
}

// ============================================================ 场景 B
console.log('\n===== 场景 B：生产模式（APP_TOKEN=testtoken123，无 Key）=====');
{
  const TOKEN = 'testtoken123';
  const s = await start({ APP_TOKEN: TOKEN, OPENROUTER_API_KEY: '' });
  if (!s.ok) { console.log('服务未启动'); process.exit(1); }

  const h = await call('GET', '/health');
  show('GET /health', h);
  check('health 200', h.code, 200);
  const hJson = await (await fetch(BASE + '/health')).json();
  check('顶层 /health 不暴露内部配置', Object.keys(hJson).sort().join(','), 'node,service,startedAt,status,uptime');
  const aiHealthAnon = await call('GET', '/api/ai/health');
  check('未带口令访问 /api/ai/health → 401', aiHealthAnon.code, 401);
  const aiHealth = await fetch(BASE + '/api/ai/health', { headers: { 'X-App-Token': TOKEN } });
  const aiHealthJson = await aiHealth.json();
  check('/api/ai/health 带口令 → 200 且要求口令', aiHealth.status === 200 && aiHealthJson.authRequired === true ? 1 : 0, 1);

  check('不带口令 → 401', (await call('POST', '/api/ai/analyze', {}, { text: '累' })).code, 401);
  check('错误口令 → 401', (await call('POST', '/api/ai/analyze', { 'X-App-Token': 'wrong' }, { text: '累' })).code, 401);
  check('正确口令无 Key → 503', (await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN }, { text: '累' })).code, 503);

  const paid = await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN },
    { model: 'anthropic/claude-fable-5.2', text: '累' });
  show('收费模型', paid);
  check('收费模型 → 403', paid.code, 403);

  const long = await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN }, { text: '累'.repeat(5000) });
  show('超长文本', long);
  check('超长文本 → 413', long.code, 413);

  check('空文本 → 400', (await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN }, { text: '' })).code, 400);
  check('非法 provider → 400', (await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN }, { provider: 'foo', text: '累' })).code, 400);

  // 限流：连续 12 次（上限 10/分钟）
  const codes = [];
  for (let i = 0; i < 12; i++) {
    codes.push((await call('POST', '/api/ai/analyze', { 'X-App-Token': TOKEN }, { text: '今天有点累' })).code);
  }
  console.log('限流 12 次状态码: ' + codes.join(','));
  check('第 12 次触发 429', codes[codes.length - 1], 429);

  await stop(s);
  const all = s.logs.join('');
  const leak = all.includes(TOKEN) || /sk-or-|AIza[0-9A-Za-z_-]{10,}/.test(all) || all.includes('Bearer ');
  check('日志不含口令/密钥', leak ? 1 : 0, 0);
  console.log('--- 启动日志 ---');
  console.log(all.trim().split('\n').slice(0, 6).join('\n'));
}

// ============================================================ 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  failed.forEach((f) => console.log(`  FAIL: ${f.name} got=${f.got} want=${f.want}`));
  process.exit(1);
}
console.log('全部通过');
