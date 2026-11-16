// Cloudflare Worker 验收测试
// 用 wrangler dev 起真实 workerd 运行时（本地，不需要 Cloudflare 账号），跑全部接口用例。
//
// 运行：node test/worker.test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status) return true;
    } catch (e) { /* not up */ }
    await wait(500);
  }
  return false;
}

async function startWorker(vars) {
  const logs = [];
  const args = ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'];
  for (const [k, v] of Object.entries(vars)) {
    args.push('--var', `${k}:${v}`);
  }
  const child = spawn('npx', args, {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const up = await waitUp();
  return { child, logs, up };
}

async function stopWorker(w) {
  return new Promise((resolve) => {
    const done = () => resolve();
    w.child.on('exit', done);
    // wrangler 会 fork workerd，用 tree-kill 思路：Windows 上直接 taskkill
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(w.child.pid), '/T', '/F']);
      } else {
        w.child.kill('SIGTERM');
      }
    } catch (e) { /* ignore */ }
    setTimeout(done, 4000);
  });
}

async function call(method, p, headers = {}, body = null) {
  const opt = { method, headers: { ...headers } };
  if (body !== null) {
    opt.headers['content-type'] = 'application/json';
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opt);
  const text = await r.text();
  return { code: r.status, text };
}

const results = [];
function check(name, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got, want, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function show(label, res) {
  console.log(`      ${label} -> HTTP ${res.code} ${res.text.slice(0, 120)}`);
}

// ============================================================ A：未设口令、无 Key
console.log('\n===== 场景 A：未设 APP_TOKEN、无 OPENROUTER_API_KEY =====');
{
  const w = await startWorker({});
  if (!w.up) { console.log('Worker 未启动，日志：\n' + w.logs.join('').slice(-2000)); process.exit(1); }

  const h = await call('GET', '/health');
  show('GET /health', h);
  check('/health 200', h.code, 200);
  const hj = JSON.parse(h.text);
  check('/health 声明 runtime', hj.runtime, 'cloudflare-worker');
  check('/health 不泄露密钥', /sk-or-/.test(h.text) ? 1 : 0, 0);

  const a = await call('POST', '/api/ai/analyze', {}, { text: '今天有点累' });
  show('无口令无 Key analyze', a);
  check('无 Key → 503', a.code, 503);

  await stopWorker(w);
  const all = w.logs.join('');
  check('日志无密钥', /sk-or-|Bearer [A-Za-z0-9]/.test(all) ? 1 : 0, 0);
}

// ============================================================ B：有口令、无 Key
console.log('\n===== 场景 B：APP_TOKEN=testtoken123、无 Key =====');
{
  const TOKEN = 'testtoken123';
  const w = await startWorker({ APP_TOKEN: TOKEN });
  if (!w.up) { console.log('Worker 未启动'); process.exit(1); }

  const h = await call('GET', '/health');
  const hj = JSON.parse(h.text);
  check('/health 200', h.code, 200);
  check('/health authRequired=true', hj.authRequired, true);

  const anon = await call('GET', '/api/ai/health');
  show('匿名 /api/ai/health', anon);
  check('匿名 ai/health → 401', anon.code, 401);

  const wrong = await call('GET', '/api/ai/health', { 'x-app-token': 'wrong' });
  check('错误口令 ai/health → 401', wrong.code, 401);

  const ok = await call('GET', '/api/ai/health', { 'x-app-token': TOKEN });
  show('带口令 /api/ai/health', ok);
  check('正确口令 ai/health → 200', ok.code, 200);

  const noToken = await call('POST', '/api/ai/analyze', {}, { text: '累' });
  check('analyze 无口令 → 401', noToken.code, 401);

  const noKey = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, { text: '累' });
  show('带口令无 Key', noKey);
  check('有口令无 Key → 503', noKey.code, 503);

  const paid = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN },
    { model: 'anthropic/claude-fable-5.2', text: '累' });
  show('非白名单模型', paid);
  check('非白名单模型 → 403', paid.code, 403);

  const long = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, { text: '累'.repeat(5000) });
  show('超长文本', long);
  check('超长文本 → 413', long.code, 413);

  const big = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, 'x'.repeat(70 * 1024));
  show('超大请求体', big);
  check('超大请求体 → 413', big.code, 413);

  const empty = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, { text: '' });
  check('空文本 → 400', empty.code, 400);

  const badJson = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, 'not-json');
  check('非法 JSON → 400', badJson.code, 400);

  // 限流：连续 12 次
  const codes = [];
  for (let i = 0; i < 12; i++) {
    codes.push((await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN }, { text: '今天有点累' })).code);
  }
  console.log('      限流 12 次: ' + codes.join(','));
  check('第 11 次触发 429', codes[10], 429);

  await stopWorker(w);
  const all = w.logs.join('');
  check('日志不含口令', all.includes(TOKEN) ? 1 : 0, 0);
}

// ============================================================ C：有 Key（假）→ 上游失败
console.log('\n===== 场景 C：APP_TOKEN + 假 Key（验证上游失败处理，会真实请求 openrouter.ai）=====');
{
  const TOKEN = 'testtoken123';
  const w = await startWorker({ APP_TOKEN: TOKEN, OPENROUTER_API_KEY: 'sk-or-v1-invalid-test-key-000' });
  if (!w.up) { console.log('Worker 未启动'); process.exit(1); }

  const r = await call('POST', '/api/ai/analyze', { 'x-app-token': TOKEN },
    { model: 'openrouter/free', mode: 'whole', text: '今天有点累' });
  show('假 Key 调用', r);
  check('上游鉴权失败 → 502', r.code, 502);
  check('错误信息可读', /鉴权失败|额度不足|限流|模型/.test(r.text) ? 1 : 0, 1);

  await stopWorker(w);
  const all = w.logs.join('');
  check('日志无完整密钥', all.includes('sk-or-v1-invalid-test-key-000') ? 1 : 0, 0);
}

// ============================================================ 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  failed.forEach((f) => console.log(`  FAIL: ${f.name} got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`));
  process.exit(1);
}
console.log('全部通过');
