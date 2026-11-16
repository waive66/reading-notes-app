// 口令比较：按 UTF-8 字节做定长比较，避免短路口令被时序侧信道猜出。
// 不使用 === 直接比较。
export function tokenOk(got, expected) {
  if (!got || !expected) return false;
  const a = new TextEncoder().encode(String(got));
  const b = new TextEncoder().encode(String(expected));
  // 长度不同也要走完整轮循环，避免提前返回泄露长度
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}
