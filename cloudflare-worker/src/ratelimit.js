// 限流：三层降级，任何一层都如实标注作用域，绝不把进程内计数说成全局准确值。
//
//   1. RATE_LIMITER（Cloudflare Rate Limiting 绑定）—— 若在 wrangler.jsonc 里绑定则使用
//   2. DAILY_KV（KV）—— 可选，跨 isolate 的"近似"全局日计数（最终一致，可能漂移）
//   3. 进程内 Map —— 每个 isolate 各自计数，仅作最后兜底
//
// 响应头 X-Quota-Scope 会告诉调用方当前实际生效的是哪一种。
// 注意：本文件所有内部判定一律返回 boolean，避免把对象当布尔用。

const minuteBuckets = new Map(); // clientId -> number[]（最近一分钟时间戳）
const dayCounters = new Map();   // `d:<day>:<clientId>` -> number
let globalCounter = { day: '', count: 0 };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** true = 放行 */
function isolateMinuteOk(cfg, clientId) {
  const now = Date.now();
  const arr = (minuteBuckets.get(clientId) || []).filter((t) => now - t < 60_000);
  if (arr.length >= cfg.ratePerMin) {
    minuteBuckets.set(clientId, arr);
    return false;
  }
  arr.push(now);
  minuteBuckets.set(clientId, arr);
  if (minuteBuckets.size > 5000) minuteBuckets.clear();
  return true;
}

/** true = 放行 */
function isolateDayOk(cfg, clientId) {
  const key = 'd:' + todayKey() + ':' + clientId;
  const count = dayCounters.get(key) || 0;
  if (count >= cfg.ratePerDay) return false;
  dayCounters.set(key, count + 1);
  if (dayCounters.size > 5000) dayCounters.clear();
  return true;
}

/** true = 放行 */
function isolateGlobalOk(cfg) {
  const day = todayKey();
  if (globalCounter.day !== day) globalCounter = { day, count: 0 };
  if (globalCounter.count >= cfg.globalDaily) return false;
  globalCounter.count += 1;
  return true;
}

/** true = 放行（KV 近似计数，非原子） */
async function kvGlobalOk(cfg) {
  const day = todayKey();
  const key = 'global:' + day;
  try {
    const raw = await cfg.kv.get(key);
    const count = Number(raw || 0);
    if (count >= cfg.globalDaily) return false;
    await cfg.kv.put(key, String(count + 1), { expirationTtl: 172800 });
    return true;
  } catch (e) {
    // KV 异常不阻断服务，退回进程内判断
    return isolateGlobalOk(cfg);
  }
}

export async function checkRate(cfg, clientId) {
  // 1) Cloudflare 限流绑定（若已配置）
  if (cfg.hasLimiter) {
    try {
      const res = await cfg.limiter.limit({ key: clientId });
      if (!res || res.success !== true) {
        return { ok: false, reason: '请求过于频繁，请稍后再试', retryAfter: 60 };
      }
    } catch (e) {
      // 绑定异常不阻断，继续走本地兜底
    }
  }

  // 2) 每客户端每分钟
  if (!isolateMinuteOk(cfg, clientId)) {
    return { ok: false, reason: '请求过于频繁，请稍后再试', retryAfter: 60 };
  }

  // 3) 每客户端每天
  if (!isolateDayOk(cfg, clientId)) {
    return { ok: false, reason: '今日调用次数已达上限，请明天再试', retryAfter: 3600 };
  }

  // 4) 全站每天
  if (cfg.hasKv) {
    if (!(await kvGlobalOk(cfg))) {
      return { ok: false, reason: '服务今日调用总量已达上限，请明天再试', retryAfter: 3600 };
    }
  } else if (!isolateGlobalOk(cfg)) {
    return { ok: false, reason: '服务今日调用总量已达上限，请明天再试', retryAfter: 3600 };
  }

  return { ok: true };
}

/** 仅供单元测试使用 */
export function __resetForTests() {
  minuteBuckets.clear();
  dayCounters.clear();
  globalCounter = { day: '', count: 0 };
}
