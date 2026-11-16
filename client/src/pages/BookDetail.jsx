import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DB } from '../App'
import { loadNote, saveNote, htmlToText, makeResponse, BG_PRESETS, BG_DEFAULTS } from '../storage/noteStore'
import { compressImage, persistImage, deleteImage } from '../storage/imageStore'
import { analyze, describeRoute } from '../ai/aiClient'
import { loadConfig } from '../ai/aiConfig'
import { extractFresh, splitParagraphs, hashText } from '../ai/liveTracker'
import { formatDay } from './Home'

var FONTS = [
  { name: '宋体', value: "'Noto Serif SC','Songti SC',serif" },
  { name: '楷体', value: "'KaiTi','STKaiti','Noto Serif SC',serif" },
  { name: '黑体', value: "'Noto Sans SC','Microsoft YaHei',sans-serif" }
]

var COLORS = [
  { name: '墨黑', value: '#2B2B2B' }, { name: '深棕', value: '#5C4033' },
  { name: '赭石', value: '#A0522D' }, { name: '橄榄', value: '#6B7A3A' },
  { name: '竹青', value: '#4F7A6A' }, { name: '藏蓝', value: '#3C4A63' },
  { name: '紫檀', value: '#6B4A5B' }, { name: '灰蓝', value: '#5A6B7A' },
  { name: '暖橙', value: '#C2703D' }, { name: '金褐', value: '#8B6B3E' }
]

var SIZES = [14, 15, 16, 17, 18, 20, 22, 26]

export default function BookDetail() {
  var id = useParams().id
  var navigate = useNavigate()

  var [book, setBook] = useState(null)
  var [loading, setLoading] = useState(true)
  var [text, setText] = useState('')
  var [ai, setAi] = useState(null)
  var [bg, setBg] = useState({ ...BG_DEFAULTS })
  var [styleOpen, setStyleOpen] = useState(false)
  var [bgOpen, setBgOpen] = useState(false)
  var [savedHint, setSavedHint] = useState('')
  var [busy, setBusy] = useState(false)
  var [aiError, setAiError] = useState('')
  var [consentOpen, setConsentOpen] = useState(false)
  var [cfg, setCfg] = useState(loadConfig())
  var [liveHint, setLiveHint] = useState('')

  var editorRef = useRef(null)
  var savedRange = useRef(null)
  var saveTimer = useRef(null)
  var liveTimer = useRef(null)
  var lastCallAt = useRef(0)
  var bgFileRef = useRef(null)
  var imgFileRef = useRef(null)
  var aiRef = useRef(null)
  var bgRef = useRef(null)
  var pendingHtml = useRef('')
  var hydrated = useRef(false)
  var stateRef = useRef({ html: '', text: '' })

  useEffect(function () { aiRef.current = ai }, [ai])
  useEffect(function () { bgRef.current = bg }, [bg])

  // ---------------- 加载 ----------------
  useEffect(function () {
    async function fetch() {
      var b = await DB.get('books', parseFloat(id))
      if (!b) { navigate('/'); return }
      setBook(b)
      var note = loadNote(id)
      setAi(note.ai)
      aiRef.current = note.ai
      setBg(note.bg || { ...BG_DEFAULTS })
      bgRef.current = note.bg || { ...BG_DEFAULTS }
      stateRef.current = { html: note.html, text: note.text || htmlToText(note.html) }
      pendingHtml.current = note.html || ''
      setText(stateRef.current.text)
      setLoading(false)
    }
    fetch()
  }, [id])

  // 编辑器挂载后只灌一次内容；之后由用户输入驱动，不再覆盖 DOM
  useEffect(function () {
    if (loading) return
    if (hydrated.current) return
    if (!editorRef.current) return
    editorRef.current.innerHTML = pendingHtml.current || ''
    hydrated.current = true
  }, [loading])

  // ---------------- 持久化 ----------------
  function persist(htmlOverride, textOverride, aiOverride, bgOverride) {
    var html = htmlOverride !== undefined ? htmlOverride : stateRef.current.html
    var plain = textOverride !== undefined ? textOverride : stateRef.current.text
    var aiState = aiOverride !== undefined ? aiOverride : aiRef.current
    var bgState = bgOverride !== undefined ? bgOverride : bgRef.current
    var r = saveNote(id, { html: html, text: plain, ai: aiState, bg: bgState })
    if (!r.ok) {
      setSavedHint('存储空间不足，请删除部分图片')
      setTimeout(function () { setSavedHint('') }, 2600)
      return false
    }
    setSavedHint('已保存')
    setTimeout(function () { setSavedHint('') }, 1400)
    return true
  }

  function currentText() {
    if (editorRef.current) return htmlToText(editorRef.current.innerHTML)
    return stateRef.current.text || ''
  }

  function updateAi(patch) {
    var next = Object.assign({}, aiRef.current, patch)
    aiRef.current = next
    setAi(next)
    return next
  }

  // ---------------- 编辑 ----------------
  function onInput() {
    var el = editorRef.current
    if (!el) return
    var plain = htmlToText(el.innerHTML)
    stateRef.current.html = el.innerHTML
    stateRef.current.text = plain
    setText(plain)

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(function () { persist() }, 600)

    scheduleLiveAnalyze()
  }

  function scheduleLiveAnalyze() {
    if (!aiRef.current || !aiRef.current.live || !aiRef.current.live.active) return
    if (liveTimer.current) clearTimeout(liveTimer.current)
    liveTimer.current = setTimeout(function () { runLive(true) }, cfg.debounceMs)
  }

  function rememberSelection() {
    var sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    var range = sel.getRangeAt(0)
    if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange()
    }
  }

  function restoreSelection() {
    var el = editorRef.current
    if (!el) return
    el.focus()
    if (savedRange.current) {
      var sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
  }

  // ---------------- 排版 ----------------
  function applyStyle(styleObj) {
    var sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSavedHint('请先选中一段文字')
      setTimeout(function () { setSavedHint('') }, 1800)
      return
    }
    var range = sel.getRangeAt(0)
    if (!editorRef.current || !editorRef.current.contains(range.commonAncestorContainer)) return
    var frag = range.extractContents()
    var span = document.createElement('span')
    Object.keys(styleObj).forEach(function (k) { span.style[k] = styleObj[k] })
    span.appendChild(frag)
    range.insertNode(span)

    var r2 = document.createRange()
    r2.selectNodeContents(span)
    sel.removeAllRanges()
    sel.addRange(r2)
    onInput()
  }

  function toggleBold() {
    var sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSavedHint('请先选中一段文字')
      setTimeout(function () { setSavedHint('') }, 1800)
      return
    }
    var node = sel.getRangeAt(0).commonAncestorContainer
    var w = window.getComputedStyle(node.nodeType === 1 ? node : node.parentNode).fontWeight
    applyStyle({ fontWeight: (parseInt(w, 10) >= 600) ? '400' : '700' })
  }

  // ---------------- 图片 ----------------
  async function onPickImage(e) {
    var file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setSavedHint('正在处理图片…')
    try {
      var dataUrl = await compressImage(file, 1280, 0.78)
      var saved = persistImage(dataUrl, 'img')
      insertFigure(saved.src, saved.name)
    } catch (err) {
      alert('图片处理失败：' + err.message)
    }
    setSavedHint('')
  }

  function insertFigure(src, name) {
    var el = editorRef.current
    if (!el) return
    restoreSelection()
    var fig = document.createElement('div')
    fig.className = 'doc-figure'
    fig.setAttribute('contenteditable', 'false')
    fig.setAttribute('data-img', name || '')
    fig.innerHTML =
      '<img src="' + src + '" alt="" />' +
      '<button class="img-del" type="button" contenteditable="false">删除图片</button>'

    var sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      var range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(fig)
      var para = document.createElement('div')
      para.appendChild(document.createElement('br'))
      fig.parentNode.insertBefore(para, fig.nextSibling)
      var r2 = document.createRange()
      r2.setStart(para, 0)
      r2.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r2)
    } else {
      el.appendChild(fig)
      var p2 = document.createElement('div')
      p2.appendChild(document.createElement('br'))
      el.appendChild(p2)
    }
    onInput()
  }

  function onEditorClick(e) {
    var t = e.target
    if (t && t.classList && t.classList.contains('img-del')) {
      e.preventDefault()
      var fig = t.closest('.doc-figure')
      if (!fig) return
      var name = fig.getAttribute('data-img')
      if (name) deleteImage(name)
      fig.remove()
      onInput()
    }
  }

  // ---------------- 背景 ----------------
  function applyBg(next) {
    setBg(next)
    bgRef.current = next
    persist(undefined, undefined, undefined, next)
    setSavedHint('背景已更新')
    setTimeout(function () { setSavedHint('') }, 1400)
  }

  async function onPickBgImage(e) {
    var file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      var dataUrl = await compressImage(file, 1600, 0.7)
      var saved = persistImage(dataUrl, 'bg')
      applyBg({ type: 'image', value: saved.src })
      setBgOpen(false)
    } catch (err) {
      alert('背景图片处理失败：' + err.message)
    }
  }

  // ---------------- AI ----------------
  function openConsent() { setConsentOpen(true) }

  function confirmEnable() {
    var next = updateAi({ enabled: true, consentAt: new Date().toISOString(), mode: 'whole' })
    setConsentOpen(false)
    persist(undefined, undefined, next)
  }

  function disableAI() {
    var next = updateAi({ enabled: false, live: Object.assign({}, aiRef.current.live, { active: false }) })
    if (liveTimer.current) clearTimeout(liveTimer.current)
    persist(undefined, undefined, next)
  }

  function setMode(mode) {
    if (mode === 'whole') {
      var next = updateAi({ mode: 'whole', live: Object.assign({}, aiRef.current.live, { active: false }) })
      if (liveTimer.current) clearTimeout(liveTimer.current)
      persist(undefined, undefined, next)
    } else {
      startLive()
    }
  }

  function startLive() {
    var paras = splitParagraphs(currentText())
    var baseline = paras.map(function (p) { return { h: hashText(p), t: '', baseline: true } })
    var next = updateAi({
      mode: 'live',
      live: { active: true, startedAt: new Date().toISOString(), analyzed: baseline }
    })
    persist(undefined, undefined, next)
    setLiveHint('已开始关注新写的内容，之前的内容不会被上传')
    setTimeout(function () { setLiveHint('') }, 3200)
  }

  function stopLive() {
    var next = updateAi({ live: Object.assign({}, aiRef.current.live, { active: false }) })
    if (liveTimer.current) clearTimeout(liveTimer.current)
    persist(undefined, undefined, next)
  }

  async function callModel(payload, mode) {
    if (!aiRef.current || !aiRef.current.enabled) {
      setAiError('当前日记未开启 AI，无法发送内容')
      return
    }
    if (busy) return
    setBusy(true)
    setAiError('')
    lastCallAt.current = Date.now()
    try {
      var res = await analyze({ text: payload.text, mode: mode, diaryId: id })
      if (!res.ok) {
        setAiError(res.error || '分析失败')
        return
      }
      var resp = makeResponse({
        mode: mode,
        excerpt: payload.excerpt,
        mock: !!res.meta.mock,
        provider: res.meta.providerId || '',
        model: res.meta.model || '',
        primary: res.data.primary_emotion,
        secondary: res.data.secondary_emotions || [],
        understanding: res.data.understanding || '',
        reply: res.data.reply || '',
        suggestion: res.data.suggestion || '',
        crisis: !!res.data.crisis
      })
      var cur = aiRef.current
      var nextAi = Object.assign({}, cur, {
        responses: [resp].concat(cur.responses || []).slice(0, 30)
      })
      if (mode === 'live' && payload.hashes) {
        var analyzed = (cur.live.analyzed || []).concat(
          payload.hashes.map(function (h) { return { h: h, t: '', at: new Date().toISOString() } })
        )
        nextAi.live = Object.assign({}, cur.live, { analyzed: analyzed })
      }
      aiRef.current = nextAi
      setAi(nextAi)
      persist(undefined, undefined, nextAi)
    } finally {
      setBusy(false)
    }
  }

  async function analyzeWhole() {
    var plain = currentText().trim()
    if (!plain) { setAiError('还没有写内容'); return }
    await callModel({ text: plain, excerpt: plain.slice(0, 40) }, 'whole')
  }

  async function runLive(isAuto) {
    var cur = aiRef.current
    if (!cur || !cur.enabled || !cur.live || !cur.live.active) return
    var fresh = extractFresh(currentText(), cur.live.analyzed, 1000)
    if (!fresh.fresh.length) {
      if (!isAuto) setLiveHint('没有新的内容需要分析')
      setTimeout(function () { setLiveHint('') }, 2200)
      return
    }
    var gap = Date.now() - lastCallAt.current
    var minGap = cfg.minIntervalMs
    if (isAuto && gap < minGap) {
      var wait = minGap - gap
      if (liveTimer.current) clearTimeout(liveTimer.current)
      liveTimer.current = setTimeout(function () { runLive(true) }, wait)
      setLiveHint('已暂停 ' + Math.ceil(wait / 1000) + ' 秒，避免频繁调用')
      return
    }
    await callModel({
      text: fresh.text,
      excerpt: fresh.text.slice(0, 40),
      hashes: fresh.fresh.map(function (x) { return x.h })
    }, 'live')
  }

  function removeResponse(rid) {
    var cur = aiRef.current
    var next = Object.assign({}, cur, {
      responses: (cur.responses || []).filter(function (r) { return r.id !== rid })
    })
    aiRef.current = next
    setAi(next)
    persist(undefined, undefined, next)
  }

  if (loading) return <div className="detail-page"><p className="loading-text">翻开这一页…</p></div>
  if (!book) return null

  var d = formatDay(book.created_at)
  var charCount = text.replace(/\[图片\]/g, '').replace(/\s/g, '').length
  var enabled = !!(ai && ai.enabled)
  var liveActive = !!(ai && ai.live && ai.live.active)
  var responses = (ai && ai.responses) || []
  var route = describeRoute()

  // 背景作用到「正文纸面」和「页面底色」两处
  var paperStyle = {}
  if (bg.type === 'color') paperStyle.background = bg.value
  if (bg.type === 'image') paperStyle.backgroundImage = 'url(' + bg.value + ')'
  var pageStyle = {}
  if (bg.type === 'color') pageStyle.background = 'linear-gradient(180deg, ' + bg.value + ' 0%, #FBF6EF 62%)'
  if (bg.type === 'image') pageStyle.background = '#F6EFE6'

  return (
    <div className="detail-page" style={pageStyle}>
      {bg.type === 'image' ? (
        <div className="detail-bg" style={{ backgroundImage: 'url(' + bg.value + ')' }}></div>
      ) : null}

      <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickBgImage} />
      <input ref={imgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />

      <div className="detail-topbar">
        <button className="icon-btn" onClick={function () { persist(); navigate('/') }}>←</button>
        <div className="topbar-right">
          <button className={'icon-btn text' + (styleOpen ? ' active' : '')}
            onClick={function () { setStyleOpen(!styleOpen); setBgOpen(false) }}>Aa</button>
          <button className={'icon-btn' + (bgOpen ? ' active' : '')}
            onClick={function () { setBgOpen(!bgOpen); setStyleOpen(false) }} title="背景">🎨</button>
          <button className="icon-btn" onClick={function () { imgFileRef.current && imgFileRef.current.click() }} title="插入图片">🖼</button>
        </div>
      </div>

      {styleOpen ? (
        <div className="style-panel">
          <div className="style-row">
            <span className="style-label">字体</span>
            {FONTS.map(function (f) {
              return <button key={f.name} className="font-btn" style={{ fontFamily: f.value }}
                onMouseDown={function (e) { e.preventDefault(); applyStyle({ fontFamily: f.value }) }}>{f.name}</button>
            })}
          </div>
          <div className="style-row">
            <span className="style-label">字号</span>
            {SIZES.map(function (s) {
              return <button key={s} className="size-btn"
                onMouseDown={function (e) { e.preventDefault(); applyStyle({ fontSize: s + 'px' }) }}>{s}</button>
            })}
          </div>
          <div className="style-row">
            <span className="style-label">颜色</span>
            {COLORS.map(function (c) {
              return <button key={c.name} className="color-btn" title={c.name} style={{ background: c.value }}
                onMouseDown={function (e) { e.preventDefault(); applyStyle({ color: c.value }) }}></button>
            })}
            <button className="bold-btn" onMouseDown={function (e) { e.preventDefault(); toggleBold() }}>B</button>
          </div>
          <div className="style-tip">选中文字后再点样式；图片可点「删除图片」移除</div>
        </div>
      ) : null}

      {bgOpen ? (
        <div className="bg-panel">
          <div className="bg-panel-head">
            <span>这篇日记的背景</span>
            <span className="bg-panel-sub">只影响这一篇</span>
          </div>
          <div className="bg-grid">
            {BG_PRESETS.map(function (item) {
              var active = (item.type === 'none' && bg.type === 'none') ||
                (item.type === 'color' && bg.type === 'color' && bg.value === item.value)
              return (
                <button key={item.key} className={'bg-swatch' + (active ? ' active' : '')}
                  onClick={function () { applyBg({ type: item.type, value: item.value }) }}>
                  <span className="bg-chip" style={{ background: item.type === 'none' ? '#FFFFFF' : item.value }}></span>
                  <span className="bg-name">{item.name}</span>
                </button>
              )
            })}
          </div>
          <div className="bg-actions">
            <button className="mini-btn" onClick={function () { bgFileRef.current && bgFileRef.current.click() }}>用照片做背景</button>
            {bg.type === 'image' ? (
              <button className="mini-btn" onClick={function () { applyBg({ type: 'none', value: '' }) }}>移除照片</button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={'paper' + (bg.type === 'image' ? ' paper-photo' : '')} style={paperStyle}>
        <div className="paper-head">
          <h1>{book.title}</h1>
          {book.author ? <div className="paper-sub">{book.author}</div> : null}
        </div>

        <div
          ref={editorRef}
          className="editor"
          contentEditable
          suppressContentEditableWarning
          onInput={onInput}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onClick={onEditorClick}
          data-placeholder="今天发生了什么？"
        ></div>

        <div className="paper-foot">
          <span>{charCount} 字</span>
          <span className="save-hint">{savedHint}</span>
        </div>
      </div>

      {/* ---------------- AI 情感陪伴 ---------------- */}
      <section className="ai-card">
        <div className="ai-card-head">
          <div className="ai-title">
            <span className="ai-dot"></span>
            AI 情感陪伴
            {enabled ? <span className="ai-on">已开启</span> : <span className="ai-off">未开启</span>}
          </div>
          <div className="ai-head-right">
            <button className="link-btn" onClick={function () { navigate('/settings') }}>服务设置</button>
            <label className="switch">
              <input type="checkbox" checked={enabled} onChange={function (e) {
                if (e.target.checked) openConsent(); else disableAI()
              }} />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        {!enabled ? (
          <p className="ai-desc">
            开启后，可以把<strong>这篇日记</strong>里你选择分析的文字交给 AI，获得理解与陪伴式回应。
            默认关闭；关闭时所有内容只留在这台设备上。
          </p>
        ) : (
          <div className="ai-body">
            <div className="route-line">
              当前：{route.text}
              <button className="link-btn" onClick={function () { navigate('/settings') }}>更换</button>
            </div>

            <div className="mode-switch">
              <button className={'mode-btn' + (ai.mode === 'whole' ? ' active' : '')}
                onClick={function () { setMode('whole') }}>
                <span className="mode-name">AI 整篇分析</span>
                <span className="mode-sub">理解整篇的事件与情绪</span>
              </button>
              <button className={'mode-btn' + (ai.mode === 'live' ? ' active' : '')}
                onClick={function () { setMode('live') }}>
                <span className="mode-name">AI 实时陪伴</span>
                <span className="mode-sub">只关注新写的内容</span>
              </button>
            </div>

            {ai.mode === 'whole' ? (
              <div className="mode-body">
                <p className="ai-desc">点击后会把这篇日记的完整文字发送给 AI，生成一段针对你经历的回应。</p>
                <button className="ai-action" disabled={busy} onClick={analyzeWhole}>
                  {busy ? '正在阅读这篇日记…' : '分析整篇笔记'}
                </button>
              </div>
            ) : (
              <div className="mode-body">
                <p className="ai-desc">
                  开启后，AI 只关注<strong>你接下来新写或修改的文字</strong>，不会重复上传已经分析过的内容，
                  也不会因为重新打开日记而重跑一遍。
                </p>
                <div className="live-row">
                  <button className={'ai-action' + (liveActive ? ' secondary' : '')}
                    onClick={function () { liveActive ? stopLive() : startLive() }}>
                    {liveActive ? '暂停实时陪伴' : '开始实时陪伴'}
                  </button>
                  <button className="ai-action ghost" disabled={busy || !liveActive}
                    onClick={function () { runLive(false) }}>
                    立即分析新内容
                  </button>
                </div>
                <div className="live-status">
                  {liveActive ? '正在关注新内容 · 停止输入 ' + Math.round(cfg.debounceMs / 1000) + ' 秒后自动分析' : '未开始'}
                </div>
                {liveHint ? <div className="live-hint">{liveHint}</div> : null}
              </div>
            )}

            {route.kind === 'mock' ? (
              <div className="mock-banner">
                当前为<strong>模拟模式</strong>：还没有配置可用的 AI 服务，结果由本地规则生成，用于走通界面与流程，不是真实模型输出。
              </div>
            ) : null}

            {aiError ? <div className="ai-error">{aiError}</div> : null}

            {busy ? (
              <div className="ai-loading">
                <span className="spinner"></span>
                AI 正在读你写的这段话…
              </div>
            ) : null}

            {responses.length === 0 && !busy ? (
              <div className="ai-empty">还没有回应。写下一些文字，再点上面的按钮。</div>
            ) : null}

            <div className="resp-list">
              {responses.map(function (r) {
                var t = formatDay(r.at)
                return (
                  <article key={r.id} className={'resp-card' + (r.crisis ? ' crisis' : '')}>
                    <div className="resp-head">
                      <div className="resp-tags">
                        <span className="emo-primary">{r.primary}</span>
                        {(r.secondary || []).map(function (s, i) { return <span key={i} className="emo-sub">{s}</span> })}
                        <span className="resp-mode">{r.mode === 'live' ? '实时' : '整篇'}</span>
                        {r.mock ? <span className="resp-mock">模拟</span> : null}
                      </div>
                      <div className="resp-head-right">
                        <span className="resp-time">{t.time}</span>
                        <button className="resp-del" onClick={function () { removeResponse(r.id) }}>删除</button>
                      </div>
                    </div>
                    {r.excerpt ? <div className="resp-excerpt">「{r.excerpt}…」</div> : null}
                    {r.understanding ? <p className="resp-understanding">{r.understanding}</p> : null}
                    <p className="resp-reply">{r.reply}</p>
                    {r.suggestion ? <p className="resp-suggestion">💡 {r.suggestion}</p> : null}
                    {r.crisis ? (
                      <div className="crisis-box">
                        如果你现在很难受，请联系身边可信任的人，或拨打全国心理援助热线 <strong>12356</strong>。
                        AI 不能替代专业帮助。
                      </div>
                    ) : null}
                    <div className="resp-note">AI 生成内容，仅供参考，不构成任何诊断或医疗建议</div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {consentOpen ? (
        <div className="modal-overlay" onClick={function () { setConsentOpen(false) }}>
          <div className="modal-card" onClick={function (e) { e.stopPropagation() }}>
            <h1>开启这篇日记的 AI 情感陪伴</h1>
            <ul className="consent-list">
              <li>开启后，可以把<strong>这篇日记中你选择分析的文字</strong>发送给第三方大模型服务。</li>
              <li>AI 会分析文字表达的情绪，并生成一段回应，帮助你梳理当下的感受。</li>
              <li><strong>图片不会发送</strong>给 AI，只发送文字。</li>
              <li>这是<strong>这篇日记的独立设置</strong>，不影响其他日记；你可以随时关闭。</li>
              <li>AI 的回应由模型生成，可能不准确，不构成心理诊断或医疗建议。</li>
            </ul>
            <div className="form-btns">
              <button className="btn btn-secondary" onClick={function () { setConsentOpen(false) }}>暂不开启</button>
              <button className="btn btn-primary" onClick={confirmEnable}>同意并开启</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
