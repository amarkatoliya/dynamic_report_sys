import React, { useState, useEffect } from 'react'
import { useStore } from '../store'
import { Activity, Database, Zap, Wifi, WifiOff } from 'lucide-react'

export default function StatusBar() {
  const { total, loading, results, filters } = useStore()
  const [apiStatus, setApiStatus] = useState('checking')

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        setApiStatus(res.ok ? 'ok' : 'error')
      } catch {
        setApiStatus('error')
      }
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  const activeFilters = filters.filter(f => f.field).length

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {/* API health */}
        <div className={`status-pill ${apiStatus}`}>
          {apiStatus === 'ok'
            ? <Wifi size={10} />
            : <WifiOff size={10} />
          }
          <span>{apiStatus === 'ok' ? 'Connected' : apiStatus === 'error' ? 'Offline' : 'Checking...'}</span>
        </div>

        <div className="statusbar-divider" />

        <div className="statusbar-item">
          <Database size={11} />
          <span>{total.toLocaleString()} total</span>
        </div>

        <div className="statusbar-item">
          <Activity size={11} />
          <span>{results.length} in view</span>
        </div>

        {activeFilters > 0 && (
          <div className="statusbar-item accent">
            <Zap size={11} />
            <span>{activeFilters} filter{activeFilters > 1 ? 's' : ''} active</span>
          </div>
        )}
      </div>

      <div className="statusbar-right">
        {loading && (
          <div className="statusbar-item accent">
            <span className="status-dot pulsing" />
            Querying Solr...
          </div>
        )}
        <span className="statusbar-version">DataLens v1.0</span>
      </div>
    </div>
  )
}
