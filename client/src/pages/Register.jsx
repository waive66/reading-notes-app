import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, API } from '../App'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 4) {
      setError('密码至少需要4位字符')
      return
    }
    try {
      const res = await fetch(`${API}/auth/register`, {
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
        <p className="subtitle">创建一个新账号</p>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>用户名</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="给自己取个名字"
            required
          />
        </div>
        <div className="form-group">
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="至少4位密码"
            required
          />
        </div>
        <button type="submit" className="btn btn-primary">注 册</button>
        <div className="auth-link">
          已有账号？<Link to="/login">去登录</Link>
        </div>
      </form>
    </div>
  )
}
