import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Login() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('请输入用户名')
      return
    }
    const users = JSON.parse(localStorage.getItem('db_users') || '[]')
    const user = users.find(u => u.username === username)
    if (!user) {
      setError('用户不存在，请先注册')
      return
    }
    login(username)
    navigate('/')
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>心笺</h1>
        <p className="subtitle">登录，开始记录今天</p>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>用户名</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="你的名字" required />
        </div>
        <button type="submit" className="btn btn-primary">登 录</button>
        <div className="auth-link">还没有账号？<Link to="/register">立即注册</Link></div>
      </form>
    </div>
  )
}
