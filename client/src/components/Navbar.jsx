import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          📚 读书<span>阁</span>
        </Link>
        <div className="navbar-right">
          <span className="navbar-user">👋 {user?.username}</span>
          <button className="navbar-logout" onClick={handleLogout}>退出登录</button>
        </div>
      </div>
    </nav>
  )
}
