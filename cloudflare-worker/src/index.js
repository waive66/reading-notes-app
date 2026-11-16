// 心笺 AI 代理 · Cloudflare Worker（原生 Fetch API，零运行时依赖）
//
// 接口与 server/（Express 版）逐条对齐：
//   GET  /health           公开，仅返回健康状态
//   GET  /api/ai/health    需要 APP_TOKEN
//   POST /api/ai/analyze   需要 APP_TOKEN
//
// 为什么不用 Express：见 README「Express 兼容性实测」，body-parser → iconv-lite
// 在 workerd 上直接抛 `require_streams is not a function`，运行时无法启动。

import { readConfig } from './config.js';
import { tokenOk } from './auth.js';
import { checkRate } from './ratelimit.js';
import { callOpenRouter, modelPolicyError } from './openrouter.js';

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-app-token,authorization',
  'access-control-max-age': '86400'
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

/** 从 Header 里取口令：优先 X-App-Token，其次 Bearer */
function extractToken(request) {
  const header = request.headers.get('x-app-token');
  if (header) return header;
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

async function readJsonBody(request) {
  const lenHeader = request.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return { ok: false, code: 413, error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` };
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, code: 413, error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` };
  }
  if (!raw) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: 400, error: '请求体必须是 JSON 对象' };
    }
    return { ok: true, body: parsed };
  } catch (e) {
    return { ok: false, code: 400, error: '请求体不是合法 JSON' };
  }
}

export default {
  async fetch(request, env, ctx) {
    const cfg = readConfig(env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ---------------- GET /health（公开） ----------------
    if (path === '/health' && request.method === 'GET') {
      return json({
        status: 'ok',
        service: 'xinjian-ai-proxy',
        runtime: 'cloudflare-worker',
        hasOpenRouterKey: !!cfg.openrouterKey,
        authRequired: !!cfg.appToken,
        allowPaidModels: cfg.allowPaid,
        limits: {
          perMinute: cfg.ratePerMin,
          perDayPerClient: cfg.ratePerDay,
          globalPerDay: cfg.globalDaily,
          maxInputChars: cfg.maxInputChars
        },
        quotaScope: cfg.quotaScope
      });
    }

    // 以下接口都要口令
    const needAuth = path === '/api/ai/health' || path === '/api/ai/analyze';
    if (!needAuth) {
      return json({ ok: false, error: '接口不存在' }, 404);
    }

    if (cfg.appToken) {
      const got = extractToken(request);
      if (!got || !tokenOk(got, cfg.appToken)) {
        return json({ ok: false, error: '访问口令无效' }, 401);
      }
    }

    // ---------------- GET /api/ai/health ----------------
    if (path === '/api/ai/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'xinjian-ai-proxy',
        runtime: 'cloudflare-worker',
        providers: { openrouter: !!cfg.openrouterKey, gemini: false, deepseek: false },
        defaultModel: cfg.defaultModel,
        authRequired: !!cfg.appToken,
        allowPaidModels: cfg.allowPaid,
        limits: {
          perMinute: cfg.ratePerMin,
          perDayPerClient: cfg.ratePerDay,
          globalPerDay: cfg.globalDaily,
          maxInputChars: cfg.maxInputChars
        },
        quotaScope: cfg.quotaScope
      });
    }

    // ---------------- POST /api/ai/analyze ----------------
    if (path === '/api/ai/analyze' && request.method === 'POST') {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.code);

      const body = parsed.body;
      const model = String(body.model || cfg.defaultModel || '');
      const mode = body.mode === 'live' ? 'live' : 'whole';
      const text = String(body.text || '').trim();

      if (!text) return json({ ok: false, error: '没有可分析的文字' }, 400);
      if (text.length > cfg.maxInputChars) {
        return json({ ok: false, error: `文字过长（上限 ${cfg.maxInputChars} 字）` }, 413);
      }

      const policyError = modelPolicyError('openrouter', model, cfg);
      if (policyError) return json({ ok: false, error: policyError }, 403);

      // 限流：先于密钥检查（与 Express 版一致），避免无 Key 时被无限刷
      const clientId = request.headers.get('cf-connecting-ip') || 'unknown';
      const gate = await checkRate(cfg, clientId);
      if (!gate.ok) {
        return json({ ok: false, error: gate.reason }, 429, {
          'retry-after': String(gate.retryAfter),
          'x-quota-scope': cfg.quotaScope
        });
      }

      if (!cfg.openrouterKey) {
        return json({ ok: false, error: '服务端未配置 OPENROUTER 的密钥，无法调用' }, 503);
      }

      const started = Date.now();
      try {
        const result = await callOpenRouter({ cfg, model, text, mode });
        if (!result.ok) {
          return json({ ok: false, error: result.error, detail: result.detail }, result.status || 502);
        }
        return json({
          ok: true,
          data: result.data,
          meta: {
            provider: 'proxy',
            providerId: 'openrouter',
            model,
            latency_ms: Date.now() - started,
            mock: false
          }
        });
      } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        // 只记录错误类型，不记录文本与密钥
        console.warn('[ai] call failed:', aborted ? 'timeout' : (err && err.name));
        return json({ ok: false, error: aborted ? '模型响应超时' : '上游调用失败' }, 504);
      }
    }

    return json({ ok: false, error: '接口不存在' }, 404);
  }
};
