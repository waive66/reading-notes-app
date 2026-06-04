import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth, API } from '../App'

export default function BookDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [book, setBook] = useState(null)
  const [notes, setNotes] = useState([])
  const [content, setContent] = useState('')
  const [editingNote, setEditingNote] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBook()
  }, [id])

  const fetchBook = async () => {
    try {
      const res = await fetch(`${API}/books/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json()
      if (!res.ok) {
        navigate('/')
        return
      }
      setBook(data)
      setNotes(data.notes || [])
    } catch (err) {
      console.error(err)
      navigate('/')
    } finally {
      setLoading(false)
    }
  }

  const addNote = async () => {
    if (!content.trim()) return
    try {
      const res = await fetch(`${API}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ book_id: Number(id), content })
      })
      const data = await res.json()
      if (res.ok) {
        setNotes([data, ...notes])
        setContent('')
      }
    } catch (err) {
      console.error(err)
    }
  }

  const startEdit = (note) => {
    setEditingNote(note.id)
    setEditContent(note.content)
  }

  const saveEdit = async (noteId) => {
    if (!editContent.trim()) return
    try {
      const res = await fetch(`${API}/notes/${noteId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ content: editContent })
      })
      const data = await res.json()
      if (res.ok) {
        setNotes(notes.map(n => n.id === noteId ? { ...n, content: data.content } : n))
        setEditingNote(null)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const deleteNote = async (noteId) => {
    if (!confirm('确定要删除这条感悟吗？')) return
    try {
      const res = await fetch(`${API}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      if (res.ok) {
        setNotes(notes.filter(n => n.id !== noteId))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const deleteBook = async () => {
    if (!confirm(`确定要删除《${book.title}》及其所有感悟吗？`)) return
    try {
      const res = await fetch(`${API}/books/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      if (res.ok) {
        navigate('/')
      }
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="book-detail-page">
        <div className="container">
          <p style={{ textAlign: 'center', color: '#999', padding: '60px 0' }}>加载中...</p>
        </div>
      </div>
    )
  }

  if (!book) return null

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  return (
    <div className="book-detail-page">
      <div className="container">
        <div style={{ marginBottom: 16 }}>
          <Link to="/" style={{ color: '#999', fontSize: 14 }}>← 返回书架</Link>
        </div>

        <div className="book-detail-header">
          {book.cover_image ? (
            <img src={`${API.replace('/api', '')}${book.cover_image}`} alt={book.title} className="book-detail-cover" />
          ) : (
            <div className="book-detail-cover-placeholder">📖</div>
          )}
          <div className="book-detail-meta">
            <h1>{book.title}</h1>
            {book.author && <div className="author">✍️ {book.author}</div>}
            <div className="book-actions">
              <button className="btn btn-secondary" onClick={() => navigate(`/books/${id}/edit`)}>
                编辑书籍
              </button>
              <button className="btn btn-danger" onClick={deleteBook}>
                删除
              </button>
            </div>
          </div>
        </div>

        <div className="notes-section">
          <h3>📝 读书感悟（{notes.length}）</h3>

          <div className="add-note-form">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="写下你读完这本书的感悟..."
            />
            <button className="btn btn-primary" onClick={addNote} disabled={!content.trim()}>
              发表感悟
            </button>
          </div>

          {notes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              还没有任何感悟，快来写下第一条吧！
            </div>
          ) : (
            notes.map(note => (
              <div key={note.id} className="note-card">
                {editingNote === note.id ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      style={{ width: '100%', minHeight: 80, padding: 10, border: '1.5px solid #e0ddd9', borderRadius: 8, fontSize: 15, marginBottom: 10 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 18px', fontSize: 13 }} onClick={() => saveEdit(note.id)}>保存</button>
                      <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 18px', fontSize: 13 }} onClick={() => setEditingNote(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="note-content">{note.content}</div>
                    <div className="note-meta">
                      <span>{formatDate(note.created_at)}</span>
                      <div className="note-actions">
                        <button onClick={() => startEdit(note)}>编辑</button>
                        <button className="delete-btn" onClick={() => deleteNote(note.id)}>删除</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
