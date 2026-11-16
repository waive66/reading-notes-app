// 实时陪伴的增量识别：只挑出「新写入或实际修改过」的段落。
// 已分析过的段落以哈希记录在日记数据里，重开日记不会重复提交。

export function hashText(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(36);
}

export function splitParagraphs(text) {
  return (text || '')
    .split(/\n+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/**
 * 求出需要提交分析的段落。
 * @param {string} text 当前正文纯文本
 * @param {Array} analyzed 已分析记录 [{h,t}]
 * @param {number} maxChars 单次最多提交字符数（控制成本）
 */
export function extractFresh(text, analyzed, maxChars) {
  maxChars = maxChars || 1000;
  var known = {};
  (analyzed || []).forEach(function (a) { known[a.h] = true; });

  var paras = splitParagraphs(text);
  var fresh = [];
  var skipped = 0;
  var total = 0;

  for (var i = 0; i < paras.length; i++) {
    var p = paras[i];
    var h = hashText(p);
    if (known[h]) { skipped++; continue; }
    // 太短的片段（比如「嗯」）不单独送分析
    if (p.replace(/\[图片\]/g, '').length < 6) { continue; }
    if (total + p.length > maxChars) break;
    fresh.push({ h: h, t: p });
    total += p.length;
  }

  return {
    fresh: fresh,
    text: fresh.map(function (x) { return x.t; }).join('\n'),
    skipped: skipped
  };
}
