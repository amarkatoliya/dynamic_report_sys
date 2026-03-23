import React, { useState } from 'react'
import { useStore } from '../store'
import { Lock, User, AlertCircle, Loader2 } from 'lucide-react'

export default function Login() {
  const login = useStore(s => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !password) return
    
    setLoading(true)
    setError('')
    try {
      await login(username, password)
    } catch (e) {
      setError(e.message || 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">◈</div>
          <h1>DataSheet</h1>
          <p>Reporting & Analytics Platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="login-field">
            <label htmlFor="username">Username</label>
            <div className="login-input-wrap">
              <User size={18} className="login-icon" />
              <input
                id="username"
                type="text"
                placeholder="admin or viewer"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-input-wrap">
              <Lock size={18} className="login-icon" />
              <input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <p>© 2026 Reporting System Audit</p>
          <div className="login-help">
            <span>Admin: admin / password123</span>
            <span>Viewer: viewer / viewer123</span>
          </div>
        </div>
      </div>
    </div>
  )
}
