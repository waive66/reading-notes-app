import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Navbar() {
  var user = useAuth().user
  var logout = useAuth().logout
  var navigate = useNavigate()

  return React.createElement('nav', { className: 'navbar' },
    React.createElement('div', { className: 'navbar-inner' },
      React.createElement(Link, { to: '/', className: 'navbar-logo' }, '心', React.createElement('span', null, '札记')),
      React.createElement('div', { className: 'navbar-right' },
        React.createElement('span', { className: 'navbar-user' }, user ? user.username : ''),
        React.createElement('button', { className: 'navbar-logout', onClick: function() { logout(); navigate('/login') } }, '离开')
      )
    )
  )
}
