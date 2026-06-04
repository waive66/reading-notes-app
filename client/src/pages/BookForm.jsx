import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth, API } from '../App'

export default function BookForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const fileRef = useRef()

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)
  const [currentCover, setCurrentCover] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEdit)

  useEffect(() => {
    if (isEdit) {
      fetchBook()
    }
  }, [id])

  const fetchBook = async () => {
    try {
      const res = await fetch(`${API}/books/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json()
      if (res.ok) {
        setTitle(data.title)
        setAuthor(data.author || '')
        setCurrentCover(data.cover_image || '')
      } else {
        navigate('/')
      }
    } catch (err) {
      navigate('/')
    } finally {
      setFetching(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setCoverFile(file)
      setCoverPreview(URL.createObjectURL(file))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('title', title)
      formData.append('author', author)
      if (coverFile) {
        formData.append('cover', coverFile)
      }

      const url = isEdit ? `${API}/books/${id}` : `${API}/books`
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData
      })

      const data = await res.json()
      if (res.ok) {
        navigate(`/books/${data.id}`)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="book-form-page">
        <p style={{ color: '#999' }}>加载中...</p>
      </div>
    )
  }

  return (
    <div className="book-form-page">
      <form className="book-form-card" onSubmit={handleSubmit}>
        <h1>{isEdit ? '编辑书籍' : '添加新书'}</h1>

        <div className="form-group">
          <label>书名 *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="输入书名"
            required
          />
        </div>

        <div className="form-group">
          <label>作者</label>
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="输入作者（可选）"
          />
        </div>

        <div className="form-group">
          <label>封面图片</label>
          <div className="file-input-wrapper">
            <div className="file-input-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              选择图片（jpg / png / gif / webp）
            </div>
            <input type="file" accept="image/*" ref={fileRef} onChange={handleFileChange} />
          </div>
          {coverPreview && (
            <img src={coverPreview} alt="preview" className="preview-image" />
          )}
          {!coverPreview && currentCover && (
            <img src={`${API.replace('/api', '')}${currentCover}`} alt="current cover" className="preview-image" />
          )}
        </div>

        <div className="form-btns">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading || !title.trim()}>
            {loading ? '保存中...' : isEdit ? '保存修改' : '添加书籍'}
          </button>
        </div>
      </form>
    </div>
  )
}
