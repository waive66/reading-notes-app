import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!username.trim()) { setError('请输入用户名'); return }
    if (password.length < 4) { setError('密码至少4位'); return }

    const users = JSON.parse(localStorage.getItem('db_users') || '[]')
    if (users.find(u => u.username === username)) {
      setError('用户名已存在')
      return
    }
    users.push({ username, password: btoa(password) })
    localStorage.setItem('db_users', JSON.stringify(users))
    login(username)
    navigate('/')
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>心笺</h1>
        <p className="subtitle">创建一个新账号</p>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>用户名</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="给自己取个名字" required />
        </div>
        <div className="form-group">
          <label>密码</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少4位密码" required />
        </div>
        <button type="submit" className="btn btn-primary">注 册</button>
        <div className="auth-link">已有账号？<Link to="/login">去登录</Link></div>
      </form>
    </div>
  )
}
