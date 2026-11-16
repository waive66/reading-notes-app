// OpenRouter 调用：模型策略、请求构造、响应解析。
// 与 server/routes/ai.js 的行为保持一致（同样的提示词、同样的 JSON 结构、同样的错误文案）。

const SYSTEM_PROMPT = `你是一位认真阅读用户日记、理解其经历并提供陪伴的中文助手。请遵守：
1. 先准确理解用户表达的感受，再回应；不要否定或贬低用户的情绪。
2. 回应要针对日记中出现的具体事件或细节，不要写成通用安慰模板。
3. 不使用「不要难过」「一切都会好起来」这类空泛话术，不强迫用户积极乐观。
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

export function isFreeModel(provider, model) {
  if (provider !== 'openrouter') return false;
  return model === 'openrouter/free' || (typeof model === 'string' && model.endsWith(':free'));
}

/** 返回 null 表示允许，否则返回拒绝原因（文案与 Node 版一致） */
export function modelPolicyError(provider, model, cfg) {
  if (!cfg.allowedProviders.includes(provider)) {
    return `该服务商未在本服务端开放（当前允许：${cfg.allowedProviders.join(', ')}）`;
  }
  if (cfg.allowedModels.length && !cfg.allowedModels.includes(model)) {
    return '该模型不在允许列表中';
  }
  if (provider === 'openrouter' && !isFreeModel(provider, model) && !cfg.allowPaid) {
    return '该模型不是免费模型，已被服务端拒绝（如需使用请由管理员设置 ALLOW_PAID_MODELS=true）';
  }
  return null;
}

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

export async function callOpenRouter({ cfg, model, text, mode }) {
  const url = cfg.openrouterBase.replace(/\/+$/, '') + '/chat/completions';

  let signal;
  try {
    signal = AbortSignal.timeout(cfg.timeoutMs);
  } catch (e) {
    // 老运行时兜底
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    signal = ctrl.signal;
  }

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.openrouterKey}`,
      'http-referer': cfg.referer,
      'x-title': 'XinJian Diary'
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(text, mode) }
      ]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let msg = `模型服务返回 ${resp.status}`;
    if (resp.status === 401) msg = '模型服务鉴权失败（服务端密钥可能失效）';
    if (resp.status === 402) msg = '账户额度不足（免费额度可能已用完）';
    if (resp.status === 429) msg = '模型服务限流，请稍后再试';
    if (resp.status === 404) msg = '模型不存在或已下线';
    return { ok: false, error: msg, detail: String(errText).slice(0, 200), status: 502 };
  }

  const data = await resp.json().catch(() => null);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  const parsed = extractJson(content);
  if (!parsed) {
    return { ok: false, error: '模型返回格式无法解析', status: 502 };
  }
  return { ok: true, data: normalize(parsed, content) };
}
