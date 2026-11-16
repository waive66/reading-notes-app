// AI 代理路由：客户端不持有密钥，所有模型调用都在服务端完成。
// 支持 OpenRouter / Google Gemini / DeepSeek，各用各的环境变量密钥，互不串用。
//
// 安全要点（公网部署时必须关注）：
//   1. APP_TOKEN 访问口令：Railway 域名是公开的，不加口令任何人都能消耗你的免费额度
//   2. 每 IP 限流 + 全局每日上限，防止被刷爆
//   3. 模型白名单，只允许免费模型
//   4. 请求体大小与文本长度双重限制
//   5. 任何日志/响应里都不出现密钥
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const GEMINI_BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

const ALLOW_PAID = process.env.ALLOW_PAID_MODELS === 'true';
const MAX_INPUT_CHARS = Number(process.env.AI_MAX_INPUT_CHARS || 4000);
const MAX_REQ_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 10);
const MAX_REQ_PER_DAY = Number(process.env.AI_RATE_PER_DAY || 200);
const GLOBAL_DAILY = Number(process.env.AI_GLOBAL_DAILY || 300);
const APP_TOKEN = process.env.APP_TOKEN || '';

const ALLOWED_MODELS = (process.env.ALLOWED_MODELS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_PROVIDERS = (process.env.ALLOWED_PROVIDERS || 'openrouter')
  .split(',').map((s) => s.trim()).filter(Boolean);

const PROVIDER_KEYS = {
  openrouter: () => process.env.OPENROUTER_API_KEY || '',
  gemini: () => process.env.GEMINI_API_KEY || '',
  deepseek: () => process.env.DEEPSEEK_API_KEY || ''
};

const PROVIDER_BASE = {
  openrouter: OPENROUTER_BASE,
  gemini: GEMINI_BASE,
  deepseek: DEEPSEEK_BASE
};

const DEFAULT_MODEL = {
  openrouter: process.env.AI_MODEL || 'openrouter/free',
  gemini: process.env.GEMINI_MODEL || '',
  deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
};

// ---------------------------------------------------------------- 限流

const ipBuckets = new Map();
let globalCounter = { day: '', count: 0 };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function allowRequest(ip) {
  const now = Date.now();
  const day = today();

  if (globalCounter.day !== day) globalCounter = { day, count: 0 };
  if (globalCounter.count >= GLOBAL_DAILY) {
    return { ok: false, reason: '服务今日调用总量已达上限，请明天再试', retryAfter: 3600 };
  }

  let b = ipBuckets.get(ip);
  if (!b || b.day !== day) {
    b = { day, minute: [], count: 0 };
    ipBuckets.set(ip, b);
  }
  b.minute = b.minute.filter((t) => now - t < 60 * 1000);
  if (b.minute.length >= MAX_REQ_PER_MIN) {
    return { ok: false, reason: '请求过于频繁，请稍后再试', retryAfter: 60 };
  }
  if (b.count >= MAX_REQ_PER_DAY) {
    return { ok: false, reason: '今日调用次数已达上限，请明天再试', retryAfter: 3600 };
  }

  b.minute.push(now);
  b.count += 1;
  globalCounter.count += 1;
  return { ok: true };
}

// ---------------------------------------------------------------- 鉴权

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 访问口令校验。
 * 未设置 APP_TOKEN 时不校验（仅用于本地开发）；公网部署必须设置。
 */
function requireAppToken(req, res, next) {
  if (!APP_TOKEN) return next();
  const fromHeader = req.get('X-App-Token') || '';
  const fromAuth = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const got = fromHeader || fromAuth;
  if (!got || !safeEqual(got, APP_TOKEN)) {
    return res.status(401).json({ ok: false, error: '访问口令无效' });
  }
  next();
}

// ---------------------------------------------------------------- 模型策略

function isFreeModel(provider, model) {
  if (provider !== 'openrouter') return false;
  return model === 'openrouter/free' || (typeof model === 'string' && model.endsWith(':free'));
}

/** 返回 null 表示允许，否则返回拒绝原因 */
function modelPolicyError(provider, model) {
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return `该服务商未在本服务端开放（当前允许：${ALLOWED_PROVIDERS.join(', ')}）`;
  }
  if (ALLOWED_MODELS.length && !ALLOWED_MODELS.includes(model)) {
    return '该模型不在允许列表中';
  }
  if (provider === 'openrouter' && !isFreeModel(provider, model) && !ALLOW_PAID) {
    return '该模型不是免费模型，已被服务端拒绝（如需使用请由管理员设置 ALLOW_PAID_MODELS=true）';
  }
  return null;
}

// ---------------------------------------------------------------- 提示词

const SYSTEM_PROMPT = `你是一位认真阅读用户日记、理解其经历并提供陪伴的中文助手。请遵守：
1. 先准确理解用户表达的感受，再回应；不要否定或贬低用户的情绪。
2. 回应要针对日记中出现的具体事件或细节，不要写成通用安慰模板。
3. 不使用「不要难过」「一切都会好起来的」这类空泛话术，不强迫用户积极乐观。
4. 可以给出温和、具体、可执行的小建议，但不要说教、不要长篇大论。
5. 情绪判断只作为辅助描述，绝不做心理疾病诊断，不使用「抑郁症」「焦虑症」等诊断性表述。
6. 如果文字中出现自伤、自杀、伤害他人等严重危机信号，crisis 置为 true，reply 中温和地建议立即联系身边可信任的人或拨打心理援助热线（如全国 12356 心理援助热线），并明确表示这不能替代专业帮助。
7. 只输出一个 JSON 对象，不要输出 Markdown 代码块或多余说明。

JSON 结构：
{
  "primary_emotion": "主要情绪，2-6 个字",
  "secondary_emotions": ["辅助情绪", "最多 3 个"],
  "understanding": "用 1-2 句概括你理解的用户经历与感受",
  "reply": "针对具体经历的回应，3-6 句，像朋友一样真诚",
  "suggestion": "一句温和的建议，可以是空的",
  "crisis": false
}`;

function buildUserPrompt(text, mode) {
  const hint = mode === 'live'
    ? '下面是用户刚刚新写或修改的片段（不是整篇日记），请只针对这段内容回应。'
    : '下面是用户这篇日记的完整文字，请结合上下文整体回应。';
  return `${hint}\n\n---\n${text}\n---`;
}

function extractJson(content) {
  if (!content) return null;
  let s = String(content).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function normalize(obj, raw) {
  const arr = Array.isArray(obj && obj.secondary_emotions)
    ? obj.secondary_emotions.filter((x) => typeof x === 'string').slice(0, 3)
    : [];
  return {
    primary_emotion: (obj && obj.primary_emotion) || '未识别',
    secondary_emotions: arr,
    understanding: (obj && obj.understanding) || '',
    reply: (obj && obj.reply) || String(raw || '').slice(0, 500),
    suggestion: (obj && obj.suggestion) || '',
    crisis: !!(obj && obj.crisis),
    mock: false
  };
}

// ---------------------------------------------------------------- 请求构造

function buildRequest({ provider, model, text, mode, apiKey }) {
  const base = PROVIDER_BASE[provider];
  if (provider === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text, mode) }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
      }
    };
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_REFERER || 'https://xinjian.local';
    headers['X-Title'] = 'XinJian Diary';
  }
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model,
      temperature: 0.7,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(text, mode) }
      ]
    }
  };
}

function extractText(provider, data) {
  if (provider === 'gemini') {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return (parts || []).map((x) => x.text || '').join('');
  }
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

// ---------------------------------------------------------------- 路由

// AI 子服务的自检：需要口令，避免匿名者探测服务端配置
// （Railway 的 healthcheck 走的是 index.js 里的 /health，不需要口令）
router.get('/health', requireAppToken, (req, res) => {
  const providers = {};
  Object.keys(PROVIDER_KEYS).forEach((p) => { providers[p] = !!PROVIDER_KEYS[p](); });
  res.status(200).json({
    ok: true,
    service: 'xinjian-ai-proxy',
    uptime: Math.round(process.uptime()),
    providers,
    defaultModel: DEFAULT_MODEL.openrouter,
    authRequired: !!APP_TOKEN,
    allowPaidModels: ALLOW_PAID,
    limits: {
      perMinute: MAX_REQ_PER_MIN,
      perDayPerIp: MAX_REQ_PER_DAY,
      globalPerDay: GLOBAL_DAILY,
      maxInputChars: MAX_INPUT_CHARS
    }
  });
});

router.post('/analyze', requireAppToken, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const provider = (req.body && req.body.provider) || 'openrouter';
  if (!PROVIDER_KEYS[provider]) {
    return res.status(400).json({ ok: false, error: '不支持的服务商' });
  }
  const model = (req.body && req.body.model) || DEFAULT_MODEL[provider];
  const mode = req.body && req.body.mode === 'live' ? 'live' : 'whole';
  const text = String((req.body && req.body.text) || '').trim();

  if (!text) return res.status(400).json({ ok: false, error: '没有可分析的文字' });
  if (text.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ ok: false, error: `文字过长（上限 ${MAX_INPUT_CHARS} 字）` });
  }

  const policyError = modelPolicyError(provider, model);
  if (policyError) return res.status(403).json({ ok: false, error: policyError });

  // 先限流再检查密钥：即使服务端没配 Key，也不能让人无限刷这个端点
  const gate = allowRequest(ip);
  if (!gate.ok) {
    res.set('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ ok: false, error: gate.reason });
  }

  const apiKey = PROVIDER_KEYS[provider]();
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: `服务端未配置 ${provider.toUpperCase()} 的密钥，无法调用`
    });
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 25000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const spec = buildRequest({ provider, model, text, mode, apiKey });
    const resp = await fetch(spec.url, {
      method: 'POST',
      signal: controller.signal,
      headers: spec.headers,
      body: JSON.stringify(spec.body)
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      let msg = `模型服务返回 ${resp.status}`;
      if (resp.status === 401) msg = '模型服务鉴权失败（服务端密钥可能失效）';
      if (resp.status === 402) msg = '账户额度不足（免费额度可能已用完）';
      if (resp.status === 429) msg = '模型服务限流，请稍后再试';
      if (resp.status === 404) msg = '模型不存在或已下线';
      // 只回传上游错误摘要，不回传任何请求头
      return res.status(502).json({ ok: false, error: msg, detail: String(errText).slice(0, 200) });
    }

    const data = await resp.json();
    const content = extractText(provider, data);
    const parsed = extractJson(content);
    if (!parsed) {
      return res.status(502).json({ ok: false, error: '模型返回格式无法解析' });
    }

    res.json({
      ok: true,
      data: normalize(parsed, content),
      meta: {
        provider: 'proxy',
        providerId: provider,
        model,
        latency_ms: Date.now() - started,
        mock: false
      }
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    // 只记录错误类型，不记录请求内容与密钥
    console.warn('[ai] call failed:', aborted ? 'timeout' : (err && err.name));
    res.status(504).json({ ok: false, error: aborted ? '模型响应超时' : '上游调用失败' });
  }
});

module.exports = router;
