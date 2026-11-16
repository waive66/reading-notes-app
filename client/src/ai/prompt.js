// 情绪分析用的系统提示词与响应解析（代理模式与服务端共用同一份规则）
export const SYSTEM_PROMPT = `你是一位认真阅读用户日记、理解其经历并提供陪伴的中文助手。请遵守：
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

export function buildUserPrompt(text, mode) {
  const hint = mode === 'live'
    ? '下面是用户刚刚新写或修改的片段（不是整篇日记），请只针对这段内容回应。'
    : '下面是用户这篇日记的完整文字，请结合上下文整体回应。';
  return `${hint}\n\n---\n${text}\n---`;
}

/** 从模型输出里抠出 JSON（容忍代码块、前后废话） */
export function parseModelJson(content) {
  if (!content) return null;
  let s = String(content).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return null;
  }
}

export function normalizeResult(obj, fallbackText) {
  const arr = Array.isArray(obj && obj.secondary_emotions)
    ? obj.secondary_emotions.filter((x) => typeof x === 'string').slice(0, 3)
    : [];
  return {
    primary_emotion: (obj && obj.primary_emotion) || '未识别',
    secondary_emotions: arr,
    understanding: (obj && obj.understanding) || '',
    reply: (obj && obj.reply) || String(fallbackText || '').slice(0, 500),
    suggestion: (obj && obj.suggestion) || '',
    crisis: !!(obj && obj.crisis),
    mock: false
  };
}
