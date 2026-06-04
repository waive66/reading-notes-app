import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, API } from '../App'

export default function Home() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    fetchBooks()
  }, [])

  const fetchBooks = async () => {
    try {
      const res = await fetch(`${API}/books`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json()
      setBooks(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const placeholderColors = [
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #f093fb, #f5576c)',
    'linear-gradient(135deg, #4facfe, #00f2fe)',
    'linear-gradient(135deg, #43e97b, #38f9d7)',
    'linear-gradient(135deg, #fa709a, #fee140)',
    'linear-gradient(135deg, #a18cd1, #fbc2eb)',
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #f83600, #f9d423)'
  ]

  if (loading) {
    return (
      <div className="home-page">
        <div className="container">
          <p style={{ textAlign: 'center', color: '#999', padding: '60px 0' }}>加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="home-page">
      <div className="container">
        <div className="home-header">
          <h2>📚 {user?.username} 的书架</h2>
          <Link to="/books/new" className="btn-add">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            添加书籍
          </Link>
        </div>

        {books.length === 0 ? (
          <div className="empty-state">
            <p style={{ fontSize: 48, marginBottom: 16 }}>📕</p>
            <p>还没有添加任何书籍</p>
            <p>点击上方按钮，开始记录你的阅读感悟吧！</p>
          </div>
        ) : (
          <div className="books-grid">
            {books.map((book, index) => (
              <div key={book.id} className="book-card" onClick={() => navigate(`/books/${book.id}`)}>
                {book.cover_image ? (
                  <img src={`${API.replace('/api', '')}${book.cover_image}`} alt={book.title} className="book-cover" />
                ) : (
                  <div className="book-cover-placeholder" style={{ background: placeholderColors[index % placeholderColors.length] }}>
                    📖
                  </div>
                )}
                <div className="book-info">
                  <h3>{book.title}</h3>
                  {book.author && <div className="author">{book.author}</div>}
                  <div className="notes-count">点击查看读书感悟 →</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
