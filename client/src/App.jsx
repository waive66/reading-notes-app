import React, { createContext, useContext, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Home from './pages/Home'
import BookDetail from './pages/BookDetail'
import BookForm from './pages/BookForm'
import Navbar from './components/Navbar'

// API 地址：部署到 Vercel 后改成你的后端地址
// 开发环境用 localhost，生产环境换成云端地址
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:3001/api'
  : 'https://reading-notes-api.up.railway.app/api'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

export { API }

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" />
  return children
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.id) {
            setUser(data)
          } else {
            localStorage.removeItem('token')
          }
          setLoading(false)
        })
        .catch(() => {
          localStorage.removeItem('token')
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [])

  const login = (token, userData) => {
    localStorage.setItem('token', token)
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/books/new" element={<ProtectedRoute><BookForm /></ProtectedRoute>} />
        <Route path="/books/:id" element={<ProtectedRoute><BookDetail /></ProtectedRoute>} />
        <Route path="/books/:id/edit" element={<ProtectedRoute><BookForm /></ProtectedRoute>} />
      </Routes>
    </AuthContext.Provider>
  )
}
