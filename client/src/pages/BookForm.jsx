import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DB } from '../App'

export default function BookForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [coverPreview, setCoverPreview] = useState(null)
  const [coverData, setCoverData] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const fileRef = useRef(null)

  useEffect(() => {
    if (isEdit) { fetchBook() }
  }, [id])

  const fetchBook = async () => {
    const book = await DB.get('books', parseFloat(id))
    if (book) {
      setTitle(book.title)
      setAuthor(book.author || '')
      setCoverData(book.cover_image || '')
    } else {
      navigate('/')
    }
    setFetching(false)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setCoverData(ev.target.result)
        setCoverPreview(ev.target.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)

    if (isEdit) {
      await DB.update('books', parseFloat(id), { title, author, cover_image: coverData })
      navigate(`/books/${id}`)
    } else {
      const book = await DB.add('books', { username: JSON.parse(localStorage.getItem('currentUser') || '{}')?.username, title, author, cover_image: coverData })
      navigate(`/books/${book.id}`)
    }
  }

  if (fetching) return (
    <div className="book-form-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#8A7A6A', fontStyle: 'italic' }}>加载中...</p>
    </div>
  )

  return (
    <div className="book-form-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      background: 'radial-gradient(ellipse at center, rgba(60, 30, 15, 0.4) 0%, transparent 70%)'
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'rgba(40, 22, 14, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(212, 197, 178, 0.1)',
        borderRadius: 18,
        padding: '32px 28px',
        width: '100%',
        maxWidth: 440,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)'
      }}>
        <h1 style={{
          fontSize: 22,
          marginBottom: 24,
          color: '#D4C5B2',
          textAlign: 'center',
          letterSpacing: 1
        }}>
          {isEdit ? '编辑书籍' : '添加新书'}
        </h1>

        <div className="form-group">
          <label>书名 *</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="输入书名" required />
        </div>

        <div className="form-group">
          <label>作者</label>
          <input type="text" value={author} onChange={e => setAuthor(e.target.value)} placeholder="输入作者（可选）" />
        </div>

        <div className="form-group">
          <label>封面图片</label>
          <div className="file-input-wrapper" onClick={() => fileRef.current?.click()}>
            <div className="file-input-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              选择封面图片
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </div>
          {(coverPreview || coverData) && (
            <img src={coverPreview || coverData} alt="preview" className="preview-image" />
          )}
        </div>

        <div className="form-btns">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>取消</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !title.trim()}>
            {loading ? '保存中...' : isEdit ? '保存修改' : '添加书籍'}
          </button>
        </div>
      </form>
    </div>
  )
}
