import React, { createContext, useContext, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Home from './pages/Home'
import BookDetail from './pages/BookDetail'
import BookForm from './pages/BookForm'
import Settings from './pages/Settings'

var DB = {
  async get(store, id) {
    var data = JSON.parse(localStorage.getItem('db_' + store) || '[]')
    return data.find(item => item.id === id)
  },
  async getAll(store) {
    return JSON.parse(localStorage.getItem('db_' + store) || '[]')
  },
  async add(store, item) {
    var data = await this.getAll(store)
    item.id = Date.now() + Math.random()
    item.created_at = new Date().toISOString()
    data.push(item)
    localStorage.setItem('db_' + store, JSON.stringify(data))
    return item
  },
  async update(store, id, updates) {
    var data = await this.getAll(store)
    var idx = data.findIndex(item => item.id === id)
    if (idx === -1) return null
    data[idx] = Object.assign({}, data[idx], updates)
    localStorage.setItem('db_' + store, JSON.stringify(data))
    return data[idx]
  },
  async delete(store, id) {
    var data = await this.getAll(store)
    var filtered = data.filter(item => item.id !== id)
    localStorage.setItem('db_' + store, JSON.stringify(filtered))
    return true
  }
}

export { DB }

var AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

function ProtectedRoute(children) {
  var auth = useAuth()
  // 冷启动时先等登录态从 localStorage 恢复，否则深链接会被误判为未登录而跳回首页
  if (auth.loading) return null
  if (!auth.user) return React.createElement(Navigate, { to: '/login' })
  return children.children
}

export default function App() {
  var [user, setUser] = useState(null)
  var [loading, setLoading] = useState(true)
  var location = useLocation()

  useEffect(function() {
    var savedUser = localStorage.getItem('currentUser')
    if (savedUser) setUser(JSON.parse(savedUser))
    setLoading(false)
  }, [])

  function login(username) { setUser({ username: username }) }
  function logout() { localStorage.removeItem('currentUser'); setUser(null) }

  return React.createElement(AuthContext.Provider, { value: { user: user, login: login, logout: logout, loading: loading } },
    React.createElement('div', { className: 'page-transition-wrapper', key: location.pathname },
      React.createElement(Routes, { location: location },
        React.createElement(Route, { path: '/login', element: !user ? React.createElement(Login, null) : React.createElement(Navigate, { to: '/' }) }),
        React.createElement(Route, { path: '/register', element: !user ? React.createElement(Register, null) : React.createElement(Navigate, { to: '/' }) }),
        React.createElement(Route, { path: '/', element: React.createElement(ProtectedRoute, null, React.createElement(Home, null)) }),
        React.createElement(Route, { path: '/books/new', element: React.createElement(ProtectedRoute, null, React.createElement(BookForm, null)) }),
        React.createElement(Route, { path: '/books/:id', element: React.createElement(ProtectedRoute, null, React.createElement(BookDetail, null)) }),
        React.createElement(Route, { path: '/books/:id/edit', element: React.createElement(ProtectedRoute, null, React.createElement(BookForm, null)) }),
        React.createElement(Route, { path: '/settings', element: React.createElement(ProtectedRoute, null, React.createElement(Settings, null)) })
      )
    )
  )
}
