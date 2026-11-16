import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

window.onerror = function(msg, url, line, col, err) {
  var el = document.getElementById('root')
  if (el) {
    el.innerHTML = '<div style="padding:40px;color:#e74c3c;font-family:sans-serif;background:#1A0F0A;min-height:100vh">'
      + '<h2>出错了</h2><pre style="white-space:pre-wrap;color:#D4C5B2">'
      + msg + '\n' + (err ? err.stack : '')
      + '</pre></div>'
  }
  return true
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
)
