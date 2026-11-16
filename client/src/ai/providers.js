// AI 服务商目录与适配器。
// 关键设计：不同服务商的接口形状不同，不能用同一套 body 硬套。
//   kind = 'openai'  → OpenAI Chat Completions 兼容（OpenRouter / DeepSeek / 自定义）
//   kind = 'gemini'  → Google Gemini generateContent（body 与鉴权方式都不同）
//
// 说明：模型 ID 一律可在设置页修改；这里列出的只是「预填建议值」，
// 免费模型目录会变，不做永久可用性承诺。

export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    // openrouter/free = Free Models Router（自动挑选一个免费模型），官方 FAQ 明确支持
    defaultModel: 'openrouter/free',
    keyHint: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    keyPattern: /^sk-or-/,
    note: '聚合多家模型，带 :free 后缀的为免费模型。免费模型有每分钟/每天调用上限。',
    models: [
      'openrouter/free',
      'baidu/ernie-5.5-flash-preview:free',
      'inclusionai/ling-3.2-flash:free',
      'thinkingmachines/inkling-2-small:free',
      'nvidia/nemotron-3.5-super-vl:free',
      'particle-ai/particle-1:free',
      'recursive/flint-v1.0:free',
      'liquid/lfm-3-1.7b:free'
    ]
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: '',
    keyHint: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPattern: /^AIza/,
    note: '模型名需要点「拉取模型」从你的 Key 里读出来，避免写死过期型号。免费额度以 Google 官方为准。',
    models: []
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPattern: /^sk-/,
    note: '注意：DeepSeek 网页版免费聊天 ≠ API 免费。API 按 token 计费，请自行确认余额。',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  custom: {
    id: 'custom',
    name: '自定义接口',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    keyHint: '按服务商要求填写',
    keyUrl: '',
    keyPattern: null,
    note: '只支持 OpenAI Chat Completions 兼容接口（POST /chat/completions）。',
    models: []
  }
};

export const PROVIDER_ORDER = ['openrouter', 'gemini', 'deepseek', 'custom'];

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.openrouter;
}

/** 是否为「明确免费」的模型：只有 OpenRouter 的 :free 后缀可以确定 */
export function isFreeModel(providerId, model) {
  if (!model) return false;
  if (providerId === 'openrouter') return model === 'openrouter/free' || model.endsWith(':free');
  return false;
}

/**
 * 是否需要用户显式确认「可能产生费用」。
 * OpenRouter 明确免费模型 → 不需要；其余一律需要确认。
 */
export function needsPaidAck(providerId, model) {
  if (providerId === 'openrouter' && isFreeModel(providerId, model)) return false;
  return true;
}

/** 免费属性标签 */
export function costLabel(providerId, model) {
  if (!model) return { text: '未选择模型', free: false };
  if (providerId === 'openrouter') {
    if (model === 'openrouter/free') return { text: '免费模型路由器', free: true };
    return model.endsWith(':free')
      ? { text: '免费模型（:free）', free: true }
      : { text: '非免费模型，可能计费', free: false };
  }
  if (providerId === 'gemini') {
    return /flash|nano/i.test(model)
      ? { text: '免费额度内（以 Google 为准）', free: true }
      : { text: '可能计费，请确认额度', free: false };
  }
  if (providerId === 'deepseek') {
    return { text: '按 token 计费', free: false };
  }
  return { text: '资费未知，请自行确认', free: false };
}

// ---------------------------------------------------------------- 请求构造

function trimBase(u) {
  return (u || '').replace(/\/+$/, '');
}

/** 构造「对话」请求（供情绪分析使用） */
export function buildChatRequest({ provider, baseUrl, apiKey, model, system, user }) {
  const p = getProvider(provider);
  const base = trimBase(baseUrl || p.baseUrl);

  if (p.kind === 'gemini') {
    // Gemini: POST {base}/models/{model}:generateContent?key=...
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    return {
      url,
      headers: { 'Content-Type': 'application/json' },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
      }
    };
  }

  // OpenAI 兼容
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://xinjian.local';
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
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }
  };
}

/** 从各家响应里取出正文文本 */
export function extractText(provider, json) {
  const p = getProvider(provider);
  try {
    if (p.kind === 'gemini') {
      const parts = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
      return (parts || []).map((x) => x.text || '').join('');
    }
    return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------- 连通性测试

const TEST_PROMPT = '请只回复两个字：收到';
const TEST_SYSTEM = '你是一个接口连通性测试助手，请用中文回答，不要展开。';

/** 把未捕获的异常归类成用户能看懂的原因 */
export function classifyError(status, body, providerName) {
  const detail = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 401 || status === 403) return 'API Key 无效或无权限，请检查密钥是否填写正确、是否已过期';
  if (status === 402) return '账户额度不足，请到服务商后台充值或改用免费模型';
  if (status === 404) return '接口地址或模型不存在，请检查 Base URL 与模型 ID';
  if (status === 429) return '请求次数超限（触发免费额度或频率限制），请稍后再试';
  if (status >= 500) return `${providerName} 服务端异常（${status}），请稍后重试`;
  if (status === 0) return '网络异常，无法连接到该服务商';
  return `调用失败（HTTP ${status}）${detail ? '：' + detail.slice(0, 120) : ''}`;
}

export async function testConnection({ provider, baseUrl, apiKey, model, timeoutMs }) {
  const p = getProvider(provider);
  if (!apiKey) return { ok: false, error: '还没有填写 API Key' };
  if (!model) return { ok: false, error: '还没有选择模型' };
  if (!(baseUrl || p.baseUrl)) return { ok: false, error: '还没有填写 Base URL' };

  const req = buildChatRequest({
    provider, baseUrl, apiKey, model,
    system: TEST_SYSTEM,
    user: TEST_PROMPT
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  const started = Date.now();
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: classifyError(res.status, json, p.name) };
    }
    const textOut = extractText(provider, json);
    if (!textOut) {
      return { ok: false, status: res.status, error: '接口连通，但返回内容为空，可能是模型名不对' };
    }
    return {
      ok: true,
      latency: Date.now() - started,
      sample: textOut.slice(0, 40),
      chinese: /[\u4e00-\u9fa5]/.test(textOut)
    };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? '连接超时（可能网络不通或需要代理）' : '网络异常：' + (err.message || '未知错误') };
  }
}

/** 拉取该服务商可用模型列表（Gemini / OpenAI 兼容都支持） */
export async function listModels({ provider, baseUrl, apiKey }) {
  const p = getProvider(provider);
  const base = trimBase(baseUrl || p.baseUrl);
  if (!apiKey) return { ok: false, error: '需要先填写 API Key' };
  const url = p.kind === 'gemini'
    ? `${base}/models?key=${encodeURIComponent(apiKey)}`
    : `${base}/models`;
  try {
    const res = await fetch(url, {
      headers: p.kind === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` }
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: classifyError(res.status, json, p.name) };
    let ids = [];
    if (p.kind === 'gemini') {
      ids = (json.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    } else {
      ids = (json.data || []).map((m) => m.id).filter(Boolean);
    }
    return { ok: true, models: ids };
  } catch (e) {
    return { ok: false, error: '网络异常：' + (e.message || '未知错误') };
  }
}
