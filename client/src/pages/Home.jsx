import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, DB } from '../App'
import { noteSummary } from '../storage/noteStore'

var PLACEHOLDER_PHOTOS = [
  'linear-gradient(140deg,#F6D9C4,#E8B79B)',
  'linear-gradient(140deg,#E9E2C9,#CFC49B)',
  'linear-gradient(140deg,#DDE7DE,#B7CDBD)',
  'linear-gradient(140deg,#EADCE8,#CBB4C9)',
  'linear-gradient(140deg,#DCE5EF,#B7C8DC)',
  'linear-gradient(140deg,#F4E3C8,#DFC08F)'
]

function pad(n) { return n < 10 ? '0' + n : '' + n }

export function formatDay(iso) {
  var d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) d = new Date()
  var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return { md: (d.getMonth() + 1) + '月' + d.getDate() + '日', full: d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日', week: week, time: pad(d.getHours()) + ':' + pad(d.getMinutes()) }
}

export default function Home() {
  var [books, setBooks] = useState([])
  var [summaries, setSummaries] = useState({})
  var [loading, setLoading] = useState(true)
  var [showModal, setShowModal] = useState(false)
  var [newTitle, setNewTitle] = useState('')
  var [newSub, setNewSub] = useState('')
  var [saving, setSaving] = useState(false)
  var [deleteId, setDeleteId] = useState(null)
  var user = useAuth().user
  var logout = useAuth().logout
  var navigate = useNavigate()
  var today = formatDay()

  useEffect(function () {
    load()
  }, [user])

  function load() {
    DB.getAll('books').then(function (data) {
      var mine = data.filter(function (b) { return b.username === user.username })
      mine.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at) })
      setBooks(mine)
      var map = {}
      mine.forEach(function (b) { map[b.id] = noteSummary(b.id) })
      setSummaries(map)
      setLoading(false)
    })
  }

  useEffect(function () {
    if (showModal) {
      setNewTitle('')
      setNewSub(today.full + ' · ' + today.week)
      setSaving(false)
    }
  }, [showModal])

  async function createDiary() {
    if (!newTitle.trim()) return
    setSaving(true)
    var book = await DB.add('books', {
      username: user.username,
      title: newTitle.trim(),
      author: newSub.trim(),
      cover_image: ''
    })
    setShowModal(false)
    navigate('/books/' + book.id)
  }

  async function removeDiary(id, e) {
    e.stopPropagation()
    if (!confirm('删除这篇日记吗？删除后无法恢复。')) return
    await DB.delete('books', id)
    setDeleteId(null)
    load()
  }

  if (loading) {
    return (
      <div className="home warm-bg">
        <div className="loading-text">正在翻开你的日记本…</div>
      </div>
    )
  }

  var recent = books.slice(0, 6)

  return (
    <div className="home warm-bg">
      <header className="home-hero">
        <div className="hero-top">
          <span className="hero-date">{today.md} · {today.week}</span>
          <span className="hero-right">
            <span className="hero-user">{user.username}</span>
            <button className="hero-set" onClick={function () { navigate('/settings') }} title="设置">⚙</button>
            <button className="hero-logout" onClick={function () { logout(); navigate('/login') }}>离开</button>
          </span>
        </div>
        <h1 className="hero-title">心笺</h1>
        <p className="hero-sub">记录生活的点滴，也记录此刻的自己。</p>
        <button className="write-btn" onClick={function () { setShowModal(true) }}>
          <span className="write-icon">✎</span>
          写一篇日记
        </button>
      </header>

      <section className="ai-hint">
        <div className="ai-hint-head">
          <span className="ai-dot"></span>
          AI 情感陪伴
          <span className="ai-hint-tag">每篇日记独立开启</span>
        </div>
        <p className="ai-hint-body">
          关闭时完全离线，只属于你。开启后，仅把<strong>你选择分析的文字</strong>交给 AI，图片不会上传。
        </p>
      </section>

      <section className="recent">
        <div className="recent-head">
          <h2>最近的记录</h2>
          <span className="recent-count">{books.length} 篇</span>
        </div>

        {books.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">🕊</div>
            <p className="empty-title">还没有写下第一篇</p>
            <p className="empty-sub">今天发生了什么？哪怕只有一句话。</p>
            <button className="ghost-btn" onClick={function () { setShowModal(true) }}>开始记录</button>
          </div>
        ) : (
          <ul className="entry-list">
            {recent.map(function (b, i) {
              var s = summaries[b.id] || {}
              var d = formatDay(b.created_at)
              var bg = b.cover_image
              return (
                <li
                  key={b.id}
                  className={'entry-card' + (deleteId === b.id ? ' deleting' : '')}
                  onClick={function () {
                    if (deleteId === b.id) { setDeleteId(b.id); return }
                    navigate('/books/' + b.id)
                  }}
                  onContextMenu={function (e) { e.preventDefault(); setDeleteId(b.id) }}
                >
                  <div className="entry-left">
                    <div className="entry-date">
                      <span className="entry-day">{d.md}</span>
                      <span className="entry-week">{d.week}</span>
                    </div>
                    <h3 className="entry-title">{b.title}</h3>
                    {b.author ? <div className="entry-sub">{b.author}</div> : null}
                    <p className="entry-preview">
                      {s.text ? (s.text.length > 54 ? s.text.slice(0, 54) + '…' : s.text) : '还没有写正文'}
                    </p>
                    <div className="entry-meta">
                      {s.imgCount ? <span className="badge">🖼 {s.imgCount} 张图</span> : null}
                      {s.aiEnabled ? <span className="badge ai">AI 已开启</span> : null}
                      {s.responseCount ? <span className="badge ai">回应 {s.responseCount}</span> : null}
                    </div>
                  </div>
                  {bg ? (
                    <div className="entry-thumb"><img src={bg} alt="" /></div>
                  ) : (
                    <div className="entry-thumb placeholder" style={{ background: PLACEHOLDER_PHOTOS[i % PLACEHOLDER_PHOTOS.length] }}>
                      <span>{b.title.slice(0, 1)}</span>
                    </div>
                  )}
                  {deleteId === b.id ? (
                    <button className="entry-del" onClick={function (e) { removeDiary(b.id, e) }}>删除</button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {deleteId ? (
        <div className="delete-tip" onClick={function () { setDeleteId(null) }}>
          点右上角「删除」可移除这篇日记，点其他地方取消
        </div>
      ) : null}

      {showModal ? (
        <div className="modal-overlay" onClick={function () { setShowModal(false) }}>
          <div className="modal-card" onClick={function (e) { e.stopPropagation() }}>
            <h1>写一篇日记</h1>
            <p className="modal-sub">给今天起个名字，然后开始写。</p>
            <div className="form-group">
              <label>标题</label>
              <input
                type="text"
                value={newTitle}
                autoFocus
                onChange={function (e) { setNewTitle(e.target.value) }}
                placeholder="比如：雨天的独白"
                onKeyDown={function (e) { if (e.key === 'Enter') createDiary() }}
              />
            </div>
            <div className="form-group">
              <label>日期 / 一句说明（可选）</label>
              <input
                type="text"
                value={newSub}
                onChange={function (e) { setNewSub(e.target.value) }}
                placeholder="2026年11月16日 · 周日"
              />
            </div>
            <div className="form-btns">
              <button className="btn btn-secondary" onClick={function () { setShowModal(false) }}>取消</button>
              <button className="btn btn-primary" onClick={createDiary} disabled={saving || !newTitle.trim()}>
                {saving ? '创建中…' : '开始写'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
