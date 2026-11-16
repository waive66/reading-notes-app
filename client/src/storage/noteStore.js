// 日记数据的读取/写入层（v2 结构，兼容旧版纯 HTML 日记）
//
// 存储键沿用 n_<id>：
//   旧版本：值是一段 HTML 字符串
//   新版本：值是 JSON 字符串 { v:2, html, text, bg, updatedAt, ai }
// 读取时自动识别，旧日记会被原样保留（html 字段），不会丢内容。

export const AI_DEFAULTS = {
  enabled: false,
  mode: 'whole', // 'whole' 整篇分析 | 'live' 实时陪伴
  consentAt: null,
  live: {
    active: false,
    startedAt: null,
    analyzed: []
  },
  responses: []
};

// 每篇日记独立的背景：type = none | color | image
export const BG_DEFAULTS = { type: 'none', value: '' };

export const BG_PRESETS = [
  { key: 'none', name: '默认纸白', type: 'none', value: '' },
  { key: 'cream', name: '温暖米黄', type: 'color', value: '#FBF1DF' },
  { key: 'pink', name: '浅粉', type: 'color', value: '#FBE9EC' },
  { key: 'blue', name: '浅蓝', type: 'color', value: '#E7F0F7' },
  { key: 'green', name: '浅绿', type: 'color', value: '#E8F2E9' },
  { key: 'purple', name: '浅紫', type: 'color', value: '#F0EAF6' },
  { key: 'sand', name: '燕麦', type: 'color', value: '#F3EADC' },
  { key: 'mint', name: '薄荷', type: 'color', value: '#E6F3F1' }
];

function cloneDefaults() {
  return JSON.parse(JSON.stringify(AI_DEFAULTS));
}

export function emptyNote() {
  return { v: 2, html: '', text: '', bg: { ...BG_DEFAULTS }, updatedAt: null, ai: cloneDefaults() };
}

/** HTML -> 纯文本（用于 AI 与列表摘要），保留段落换行 */
export function htmlToText(html) {
  if (!html) return '';
  var d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('img').forEach(function (img) {
    img.replaceWith(document.createTextNode('\n[图片]\n'));
  });
  d.querySelectorAll('br').forEach(function (br) {
    br.replaceWith(document.createTextNode('\n'));
  });
  var blockTags = ['div', 'p', 'li', 'h1', 'h2', 'h3', 'figure'];
  blockTags.forEach(function (tag) {
    d.querySelectorAll(tag).forEach(function (el) {
      el.appendChild(document.createTextNode('\n'));
    });
  });
  var raw = d.textContent || '';
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function loadNote(id) {
  var raw = localStorage.getItem('n_' + id);
  // 旧版把背景图单独存在 bg_n_<id>，这里并进笔记数据，保证老用户不丢背景
  var legacyBg = localStorage.getItem('bg_n_' + id);

  if (!raw) {
    var empty = emptyNote();
    if (legacyBg) empty.bg = { type: 'image', value: legacyBg };
    return empty;
  }

  if (raw.charAt(0) === '{') {
    try {
      var obj = JSON.parse(raw);
      if (obj && obj.v === 2) {
        var ai = Object.assign(cloneDefaults(), obj.ai || {});
        ai.live = Object.assign(cloneDefaults().live, (obj.ai && obj.ai.live) || {});
        ai.responses = (obj.ai && obj.ai.responses) || [];
        var bg = Object.assign({}, BG_DEFAULTS, obj.bg || {});
        if ((!obj.bg || !obj.bg.type || obj.bg.type === 'none') && legacyBg) {
          bg = { type: 'image', value: legacyBg };
        }
        return {
          v: 2,
          html: obj.html || '',
          text: obj.text || '',
          bg: bg,
          updatedAt: obj.updatedAt || null,
          ai: ai
        };
      }
    } catch (e) {
      // 落到下面按旧格式处理
    }
  }
  // 旧版：纯 HTML
  var m = {
    v: 2,
    html: raw,
    text: htmlToText(raw),
    bg: legacyBg ? { type: 'image', value: legacyBg } : { ...BG_DEFAULTS },
    updatedAt: null,
    ai: cloneDefaults()
  };
  return m;
}

export function saveNote(id, note) {
  var payload = {
    v: 2,
    html: note.html || '',
    text: note.text || '',
    bg: note.bg || { ...BG_DEFAULTS },
    updatedAt: new Date().toISOString(),
    ai: note.ai || cloneDefaults()
  };
  try {
    localStorage.setItem('n_' + id, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function noteSummary(id) {
  var n = loadNote(id);
  var text = (n.text || '').replace(/\[图片\]/g, '').replace(/\s+/g, ' ').trim();
  var imgCount = (n.html.match(/<img/g) || []).length;
  return {
    text: text,
    imgCount: imgCount,
    bgType: (n.bg && n.bg.type) || 'none',
    bgValue: (n.bg && n.bg.value) || '',
    aiEnabled: !!(n.ai && n.ai.enabled),
    responseCount: (n.ai && n.ai.responses && n.ai.responses.length) || 0,
    updatedAt: n.updatedAt
  };
}

export function makeResponse(payload) {
  return Object.assign(
    {
      id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      mode: 'whole',
      excerpt: '',
      mock: false
    },
    payload
  );
}
