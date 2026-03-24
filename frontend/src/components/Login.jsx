import React, { useState } from 'react'
import { useStore } from '../store'
import { Lock, User, AlertCircle, Loader2, ArrowRight } from 'lucide-react'
import './Login.css'

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
      setError(e.message || 'Verification failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card animate-in">
        <div className="login-header">
          <div className="login-logo-container">
            <div className="login-logo-icon">◈</div>
          </div>
          <h1>DataSheet</h1>
          <p>Secure Intelligence Platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error-msg">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="login-input-group">
            <label htmlFor="username">Username</label>
            <div className="login-input-wrapper">
              <User size={18} className="login-input-icon" />
              <input
                id="username"
                type="text"
                placeholder="admin or viewer"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="login-input-group">
            <label htmlFor="password">Password</label>
            <div className="login-input-wrapper">
              <Lock size={18} className="login-input-icon" />
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="login-submit-btn" type="submit" disabled={loading}>
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p className="login-copyright">© 2026 Analytics Intelligence Cluster</p>
          <div className="login-credentials-tips">
            <div className="credential-badge">admin / password123</div>
            <div className="credential-badge">viewer / viewer123</div>
          </div>
        </div>
      </div>
    </div>
  )
}
