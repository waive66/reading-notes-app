import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, API } from '../App'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      login(data.token, data.user)
      navigate('/')
    } catch (err) {
      setError('网络错误，请确保后端已启动')
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>📖 读书阁</h1>
        <p className="subtitle">登录以分享你的阅读感悟</p>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>用户名</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="输入用户名"
            required
          />
        </div>
        <div className="form-group">
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="输入密码"
            required
          />
        </div>
        <button type="submit" className="btn btn-primary">登 录</button>
        <div className="auth-link">
          还没有账号？<Link to="/register">立即注册</Link>
        </div>
      </form>
    </div>
  )
}
