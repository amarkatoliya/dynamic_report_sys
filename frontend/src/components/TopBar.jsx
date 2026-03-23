import React, { useState, useCallback } from 'react'
import { useStore } from '../store'
import {
  Menu, RefreshCw, Download, Table2, BarChart2,
  Upload, ChevronDown, Check, Layers, Search, X, FileText,
  Calendar
} from 'lucide-react'
import DateRangeFilter from './DateRangeFilter'

// ── Excel export (uses SheetJS via CDN-free approach — pure JS XLSX) ──────────
function exportXLSX(results, selectedColumns, schema) {
  // Build CSV-compatible content but as XLSX using a simple workaround
  // Since SheetJS isn't in package.json, we use the HTML table trick
  const cols = selectedColumns.length ? selectedColumns : Object.keys(results[0] || {})
  const getLabel = (name) => {
    const f = schema.find(s => s.name === name)
    return f?.label || name.replace(/(_s|_i|_f|_b|_dt)$/, '').replace(/_/g, ' ')
  }

  // Build an HTML table, then use data URI for Excel
  let html = '<html><head><meta charset="UTF-8"></head><body><table>'
  html += '<tr>' + cols.map(c => `<th>${getLabel(c)}</th>`).join('') + '</tr>'
  results.forEach(row => {
    html += '<tr>' + cols.map(c => `<td>${row[c] ?? ''}</td>`).join('') + '</tr>'
  })
  html += '</table></body></html>'

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report_${Date.now()}.xls`
  a.click()
  URL.revokeObjectURL(url)
}

export default function TopBar() {
  const {
    _doQuery, loading, total, activeTab, setActiveTab,
    setSidebarOpen, sidebarOpen, rows, setRows,
    results, selectedColumns, schema,
    globalSearch, setGlobalSearch,
    timing, cached,
    sources, selectedSource, setSource,
    user, logout, exportAll,
    ingestionStatus, startIngestionPoll
  } = useStore()

  const [showExport, setShowExport]   = useState(false)
  const [triggering, setTriggering]   = useState(false)
  const [triggered, setTriggered]     = useState(false)
  const [showSearch, setShowSearch]   = useState(false)

  const exportCSV = () => {
    const cols = selectedColumns.length ? selectedColumns : Object.keys(results[0] || {})
    const getLabel = (name) => {
      const f = schema.find(s => s.name === name)
      return f?.label || name.replace(/(_s|_i|_f|_b|_dt)$/, '').replace(/_/g, ' ')
    }
    const header = cols.map(getLabel).join(',')
    const rows_data = results.map(r => cols.map(c => {
      const v = r[c] ?? ''
      return typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
        ? `"${v.replace(/"/g, '""')}"` : v
    }).join(','))
    const csv = [header, ...rows_data].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `report_${Date.now()}.csv`; a.click()
    URL.revokeObjectURL(url)
    setShowExport(false)
  }

  const triggerProducer = async () => {
    setTriggering(true)
    try {
      await fetch('/api/produce', { method: 'POST' })
      setTriggered(true)
      startIngestionPoll() // NEW: Start tracking progress live
      setTimeout(() => { setTriggered(false) }, 5000)
    } finally {
      setTriggering(false)
    }
  }

  const tabs = [
    { id: 'table',  icon: <Table2 size={13} />,   label: 'Table'  },
    { id: 'charts', icon: <BarChart2 size={13} />, label: 'Charts' },
  ]

  return (
    <div className="topbar">
      {/* Left */}
      <div className="topbar-left">
        <button className="topbar-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <Menu size={17} />
        </button>
        <div className="topbar-brand">
          <span className="topbar-title">Report Explorer</span>
          <span className="topbar-subtitle">
            {total.toLocaleString()} records
            {timing && <span style={{ marginLeft: 6, opacity: 0.6 }}>{timing}ms{cached ? ' ⚡cached' : ''}</span>}
          </span>
        </div>
      </div>

      {/* Center: tabs + global search */}
      <div className="topbar-center">
        <div className="topbar-tabs">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`topbar-tab ${activeTab === tab.id ? 'active' : ''}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Global Search */}
        <div className={`topbar-search-wrap ${showSearch ? 'active' : ''}`}>
          {showSearch ? (
            <>
              <Search size={13} className="topbar-search-icon" />
              <input
                autoFocus
                className="topbar-search-input"
                placeholder="Search all fields…"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setShowSearch(false)}
              />
              {globalSearch && (
                <button className="topbar-search-clear" onClick={() => setGlobalSearch('')}><X size={12} /></button>
              )}
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setShowSearch(true)}>
              <Search size={13} /> Search
            </button>
          )}
        </div>
      </div>

      {/* Ingestion Progress Bar (Part 3.1) */}
      {ingestionStatus && ingestionStatus.status !== 'idle' && (
        <div className="ingestion-status-overlay animate-slide-down">
          <div className="ingestion-status-bar">
            <div className="status-header">
              <span className="pulse-dot"></span>
              <span className="status-text">
                {ingestionStatus.status === 'producing' ? '📤 Extracting CSV...' : '📥 Indexing to Solr...'}
                <span className="file-name">({ingestionStatus.current_file})</span>
              </span>
              <span className="status-count">
                {ingestionStatus.indexed_rows || ingestionStatus.produced_rows} / {ingestionStatus.total_rows}
              </span>
            </div>
            <div className="status-track">
              <div className="status-fill" style={{ 
                width: `${ingestionStatus.total_rows > 0 ? (Math.min(100, ((ingestionStatus.indexed_rows || ingestionStatus.produced_rows) / ingestionStatus.total_rows) * 100)) : 0}%` 
              }}></div>
            </div>
            {ingestionStatus.status === 'completed' && (
              <div className="status-success">✅ Sync Complete! Data is live.</div>
            )}
          </div>
        </div>
      )}

      {/* Right */}
      <div className="topbar-right">
        <div className="topbar-select-group">
          <Layers size={12} className="topbar-select-icon" />
          <select className="topbar-select" value={rows} onChange={e => setRows(Number(e.target.value))}>
            {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} rows</option>)}
          </select>
        </div>

        {user?.role === 'admin' && (
          <button className={`btn btn-sm ${triggering || triggered ? 'btn-success-flash' : ''}`}
            onClick={triggerProducer} disabled={triggering}>
            {triggered ? <><Check size={13} /> Indexed!</> : <><Upload size={13} className={triggering ? 'animate-spin' : ''} /> Index CSV</>}
          </button>
        )}

        <DateRangeFilter />

        <button className="btn btn-icon btn-sm" onClick={_doQuery} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Export dropdown */}
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setShowExport(!showExport)}>
            <Download size={13} /> Export <ChevronDown size={11} style={{ opacity: .6 }} />
          </button>
          {showExport && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowExport(false)} />
              <div className="dropdown-menu" style={{ zIndex: 100, minWidth: 180 }}>
                <button className="dropdown-item" onClick={exportCSV}>📄 Export Current View (CSV)</button>
                <button className="dropdown-item" onClick={() => { exportXLSX(results, selectedColumns, schema); setShowExport(false) }}>
                  📊 Export Current View (Excel)
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <button className="dropdown-item" style={{ color: 'var(--accent)' }} onClick={() => { exportAll(); setShowExport(false) }}>
                  🚀 Export ALL Records (Full CSV)
                </button>
              </div>
            </>
          )}
        </div>

        {/* User Profile */}
        <div className="topbar-user">
          <div className="topbar-user-info">
            <span className="topbar-user-name">{user?.name}</span>
            <span className="topbar-user-role">{user?.role}</span>
          </div>
          <button className="btn btn-sm btn-icon" onClick={logout} title="Sign out">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}