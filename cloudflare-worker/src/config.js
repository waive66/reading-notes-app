// 从 Worker env 读取配置（不是 process.env）
// Secret（OPENROUTER_API_KEY / APP_TOKEN）通过 `wrangler secret put` 注入；
// 普通变量写在 wrangler.jsonc 的 vars 里。

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readConfig(env) {
  env = env || {};

  const hasKv = !!(env.DAILY_KV && typeof env.DAILY_KV.get === 'function');
  const hasLimiter = !!(env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function');

  // quotaScope 会原样出现在响应头，避免把进程内计数冒充成全局准确计数
  let quotaScope = 'isolate';
  if (hasKv) quotaScope = 'kv-approximate';
  if (hasLimiter) quotaScope = 'binding+isolate';

  return {
    openrouterKey: env.OPENROUTER_API_KEY || '',
    appToken: env.APP_TOKEN || '',
    openrouterBase: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    referer: env.APP_REFERER || 'https://xinjian.local',

    defaultModel: env.AI_MODEL || 'openrouter/free',
    allowedModels: list(env.ALLOWED_MODELS),
    allowedProviders: list(env.ALLOWED_PROVIDERS || 'openrouter'),
    allowPaid: String(env.ALLOW_PAID_MODELS || 'false') === 'true',

    maxInputChars: num(env.AI_MAX_INPUT_CHARS, 4000),
    ratePerMin: num(env.AI_RATE_PER_MIN, 10),
    ratePerDay: num(env.AI_RATE_PER_DAY, 200),
    globalDaily: num(env.AI_GLOBAL_DAILY, 300),
    timeoutMs: num(env.AI_TIMEOUT_MS, 25000),

    hasKv,
    hasLimiter,
    quotaScope,

    // 绑定（可能不存在）
    kv: hasKv ? env.DAILY_KV : null,
    limiter: hasLimiter ? env.RATE_LIMITER : null
  };
}
