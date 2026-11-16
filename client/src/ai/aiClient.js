// AI 调用入口：根据全局配置决定走「后端代理」还是「自带密钥直连」，
// 未配置时退回 Mock。页面只调 analyze()，不关心服务商差异。
import { loadConfig, providerConfig, loadKey, readiness, isPaidAcked } from './aiConfig';
import {
  getProvider, buildChatRequest, extractText, classifyError,
  needsPaidAck, isFreeModel
} from './providers';
import { SYSTEM_PROMPT, buildUserPrompt, parseModelJson, normalizeResult } from './prompt';

const EMOTION_RULES = [
  { k: ['难过', '失落', '失败', '沮丧', '委屈', '想哭'], e: '失落', s: ['委屈', '自我怀疑'] },
  { k: ['不在意', '失望', '落差', '没人在意'], e: '失落', s: ['失望', '不被重视'] },
  { k: ['累', '疲惫', '忙', '撑不住', '好困'], e: '疲惫', s: ['耗尽感', '压力'] },
  { k: ['焦虑', '担心', '害怕', '紧张', '慌'], e: '焦虑', s: ['不安', '失控感'] },
  { k: ['生气', '愤怒', '气死', '讨厌'], e: '愤怒', s: ['被冒犯', '不被尊重'] },
  { k: ['开心', '高兴', '幸福', '喜欢', '美好', '日落', '笑'], e: '喜悦', s: ['满足', '珍惜'] },
  { k: ['孤独', '没人', '一个人', '不被理解'], e: '孤独', s: ['不被理解', '疏离'] }
];

function mockAnalyze(text) {
  let primary = '平静';
  let secondary = [];
  for (const rule of EMOTION_RULES) {
    if (rule.k.some((k) => text.indexOf(k) >= 0)) {
      primary = rule.e;
      secondary = rule.s;
      break;
    }
  }
  const firstLine = (text.split(/\n/)[0] || '').slice(0, 40);
  return {
    primary_emotion: primary,
    secondary_emotions: secondary,
    understanding: '你这段文字主要在说「' + firstLine + '…」。',
    reply: '这里本应是模型针对你写到的具体经历给出的回应。在设置里配好 AI 服务后，这段会被替换为真实生成的内容。',
    suggestion: '演示用建议：真实接入后，这里会给出温和、不过度说教的引导。',
    crisis: false,
    mock: true
  };
}

export function isMockMode() {
  return !readiness().ok;
}

/** 供设置页展示：当前到底会走哪条路 */
export function describeRoute() {
  const cfg = loadConfig();
  const r = readiness();
  if (!r.ok) return { kind: 'mock', text: '未配置 · 使用模拟数据' };
  if (cfg.mode === 'proxy') return { kind: 'proxy', text: '后端代理 · ' + r.provider.name };
  return { kind: 'byok', text: '自带密钥 · ' + r.provider.name };
}

async function callProxy({ provider, model, text, mode, proxyBase, timeoutMs, cfg }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.appToken) headers['X-App-Token'] = cfg.appToken;
    const res = await fetch(proxyBase.replace(/\/$/, '') + '/api/ai/analyze', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ provider, model, mode, text })
    });
    const body = await res.json().catch(() => null);
    clearTimeout(timer);
    if (res.status === 401) {
      return { ok: false, error: '访问口令无效：请到「设置 → AI 服务设置」填写与服务端一致的访问口令' };
    }
    if (!res.ok || !body || body.ok === false) {
      return { ok: false, error: (body && (body.error || body.message)) || classifyError(res.status, body, getProvider(provider).name) };
    }
    return { ok: true, data: body.data, meta: Object.assign({ provider: 'proxy', providerId: provider, model }, body.meta || {}, { latency_ms: Date.now() - started, mock: false }) };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return { ok: false, error: aborted ? '请求超时，请稍后重试' : '网络异常，无法连接后端代理' };
  }
}

async function callDirect({ providerId, text, mode, timeoutMs }) {
  const pc = providerConfig(providerId);
  const apiKey = loadKey(providerId);
  const req = buildChatRequest({
    provider: providerId,
    baseUrl: pc.baseUrl,
    apiKey,
    model: pc.model,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(text, mode)
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      return { ok: false, error: classifyError(res.status, json, getProvider(providerId).name) };
    }
    const out = extractText(providerId, json);
    const parsed = parseModelJson(out);
    if (!parsed) return { ok: false, error: '模型返回格式无法解析，可换一个模型再试' };
    return {
      ok: true,
      data: normalizeResult(parsed, out),
      meta: { provider: 'direct', providerId, model: pc.model, latency_ms: Date.now() - started, mock: false }
    };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    return { ok: false, error: aborted ? '请求超时' : '网络异常：' + (err.message || '') };
  }
}

/**
 * @param {{text:string, mode:'whole'|'live', diaryId:string}} params
 */
export async function analyze(params) {
  const text = (params.text || '').trim();
  if (!text) return { ok: false, error: '没有可分析的文字' };

  const cfg = loadConfig();
  const ready = readiness();

  // 未配置 → Mock
  if (!ready.ok) {
    await new Promise((r) => setTimeout(r, 600));
    return {
      ok: true,
      data: mockAnalyze(text),
      meta: { provider: 'mock', providerId: 'mock', model: 'mock', latency_ms: 600, mock: true }
    };
  }

  // 费用闸门：非明确免费的模型必须先在设置页确认
  if (needsPaidAck(ready.provider.id, ready.model) && !isPaidAcked(ready.provider.id, ready.model)) {
    return {
      ok: false,
      error: '当前模型可能产生费用，请先在「AI 服务设置」中确认后再使用',
      needAck: true
    };
  }

  const timeoutMs = cfg.timeoutMs || 30000;
  if (cfg.mode === 'proxy') {
    return callProxy({
      provider: ready.provider.id,
      model: ready.model,
      text,
      mode: params.mode,
      proxyBase: cfg.proxyBase,
      timeoutMs,
      cfg
    });
  }
  return callDirect({ providerId: ready.provider.id, text, mode: params.mode, timeoutMs });
}

export { isFreeModel };
