// AI 服务配置（全局，只描述「用哪个服务商」，与「哪篇日记开 AI」无关）
//
// 密钥存放策略：
//   1) 有原生 SecretStore（Android Keystore）→ 加密后存本地文件，网页侧只能拿到解密后的值
//   2) 没有（浏览器调试）→ 退化到 localStorage，并标记 insecure，界面上明确提示
//   3) 走自建后端代理时，客户端不保存任何密钥
import { PROVIDERS, getProvider, isFreeModel } from './providers';

const CFG_KEY = 'ai_cfg_v2';
const KEY_PREFIX = 'ai_key_';

export const DEFAULT_PROXY = '';

function defaults() {
  return {
    active: 'openrouter',
    mode: 'proxy', // proxy = 走后端代理（推荐）；byok = 用户自带密钥直连
    // 已部署的 Cloudflare Worker 地址（2026-11-16 验证通过）；可随时在设置页改回本地代理
    proxyBase: 'https://reading-notes-app.lgsmartine600.workers.dev',
    // 与服务端 APP_TOKEN 一致的访问口令（公网代理必须填，否则会被 401）
    appToken: '',
    paidAck: {},   // { 'provider|model': true } 用户已确认可能计费
    // 客户端等待上游的总时长（免费模型较慢，放宽到 65 秒）
    timeoutMs: 65000,
    debounceMs: 6000,    // 实时陪伴：停止输入多久后触发
    minIntervalMs: 15000, // 实时陪伴：两次调用最小间隔（防额度浪费）
    providers: {
      openrouter: { baseUrl: PROVIDERS.openrouter.baseUrl, model: PROVIDERS.openrouter.defaultModel },
      gemini: { baseUrl: PROVIDERS.gemini.baseUrl, model: PROVIDERS.gemini.defaultModel },
      deepseek: { baseUrl: PROVIDERS.deepseek.baseUrl, model: PROVIDERS.deepseek.defaultModel },
      custom: { baseUrl: '', model: '' }
    }
  };
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const base = defaults();
    return {
      ...base,
      ...parsed,
      providers: { ...base.providers, ...(parsed.providers || {}) }
    };
  } catch (e) {
    return defaults();
  }
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...(patch || {}) };
  if (patch && patch.providers) {
    next.providers = { ...loadConfig().providers, ...patch.providers };
  }
  localStorage.setItem(CFG_KEY, JSON.stringify(next));
  return next;
}

export function activeProvider() {
  const cfg = loadConfig();
  return getProvider(cfg.active);
}

export function providerConfig(id) {
  const cfg = loadConfig();
  return cfg.providers[id] || { baseUrl: getProvider(id).baseUrl, model: getProvider(id).defaultModel };
}

// ---------------------------------------------------------------- 密钥存储

export function hasSecureStore() {
  return !!(window.SecretStore && typeof window.SecretStore.save === 'function');
}

/** 当前密钥存储是否安全（原生 Keystore 才算） */
export function keyStorageInfo() {
  return hasSecureStore()
    ? { secure: true, text: '已使用 Android Keystore 加密存储' }
    : { secure: false, text: '浏览器环境：密钥仅存在本地 localStorage，未加密（仅限调试）' };
}

export function saveKey(providerId, value) {
  const alias = KEY_PREFIX + providerId;
  try {
    if (hasSecureStore()) {
      window.SecretStore.save(alias, value || '');
      localStorage.removeItem('ai_key_plain_' + providerId);
      return true;
    }
    // 调试回退：明确标记为不安全
    localStorage.setItem('ai_key_plain_' + providerId, value || '');
    return true;
  } catch (e) {
    return false;
  }
}

export function loadKey(providerId) {
  const alias = KEY_PREFIX + providerId;
  try {
    if (hasSecureStore()) {
      const v = window.SecretStore.load(alias);
      return v || '';
    }
    return localStorage.getItem('ai_key_plain_' + providerId) || '';
  } catch (e) {
    return '';
  }
}

export function clearKey(providerId) {
  const alias = KEY_PREFIX + providerId;
  try {
    if (hasSecureStore() && window.SecretStore.remove) window.SecretStore.remove(alias);
    localStorage.removeItem('ai_key_plain_' + providerId);
    return true;
  } catch (e) {
    return false;
  }
}

/** 是否有可用密钥（不同服务商各自独立，不会串用） */
export function hasKey(providerId) {
  return !!loadKey(providerId);
}

export function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '••••••';
  return k.slice(0, 4) + '••••••••' + k.slice(-4);
}

// ---------------------------------------------------------------- 费用确认

export function ackKey(providerId, model) {
  return providerId + '|' + model;
}

export function isPaidAcked(providerId, model) {
  const cfg = loadConfig();
  return !!(cfg.paidAck || {})[ackKey(providerId, model)];
}

export function setPaidAck(providerId, model, ok) {
  const cfg = loadConfig();
  const paidAck = { ...(cfg.paidAck || {}) };
  if (ok) paidAck[ackKey(providerId, model)] = true;
  else delete paidAck[ackKey(providerId, model)];
  saveConfig({ paidAck });
}

/** 当前是否处于「可调用」状态，以及原因 */
export function readiness() {
  const cfg = loadConfig();
  const p = getProvider(cfg.active);
  const pc = providerConfig(p.id);
  if (!pc.model) return { ok: false, reason: '还没有选择模型', provider: p, model: '' };
  if (cfg.mode === 'proxy') {
    if (!cfg.proxyBase) return { ok: false, reason: '未配置后端代理地址', provider: p, model: pc.model };
    return { ok: true, provider: p, model: pc.model, free: isFreeModel(p.id, pc.model) };
  }
  if (!loadKey(p.id)) return { ok: false, reason: '还没有填写 ' + p.name + ' 的 API Key', provider: p, model: pc.model };
  return { ok: true, provider: p, model: pc.model, free: isFreeModel(p.id, pc.model) };
}
