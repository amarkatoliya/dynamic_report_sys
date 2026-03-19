import React, { useState } from 'react'
import { useStore } from '../store'
import {
  BookMarked, X, Save, Trash2, Star, Check,
  FolderOpen, Share2, History, Crown, Copy
} from 'lucide-react'

export default function SavedViews() {
  const { views, saveView, loadView, deleteView, setDefaultView } = useStore()
  const [open, setOpen]       = useState(false)
  const [saving, setSaving]   = useState(false)
  const [newName, setNewName] = useState('')
  const [saved, setSaved]     = useState(false)
  const [makeDefault, setMakeDefault] = useState(false)
  const [shareId, setShareId] = useState(null)   // view id being "shared"
  const [tab, setTab]         = useState('views') // 'views' | 'history'

  const handleSave = async () => {
    if (!newName.trim()) return
    setSaving(true)
    await saveView(newName.trim(), makeDefault)
    setNewName('')
    setMakeDefault(false)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSetDefault = async (id) => {
    await setDefaultView(id)
  }

  const handleShare = (view) => {
    // Generate shareable JSON string (in a real app this would be a URL/link)
    const shareData = JSON.stringify({ name: view.name, columns: view.columns, filters: view.filters, sort: view.sort })
    navigator.clipboard?.writeText(shareData).catch(() => {})
    setShareId(view.id)
    setTimeout(() => setShareId(null), 2500)
  }

  return (
    <>
      <button onClick={() => setOpen(!open)} className={`views-fab ${open ? 'open' : ''}`} title="Saved Views">
        <BookMarked size={19} />
        {views.length > 0 && <span className="views-fab-badge">{views.length}</span>}
      </button>

      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} />}

      <div className={`views-drawer ${open ? 'open' : ''}`}>
        {/* Header */}
        <div className="views-drawer-header">
          <div className="views-drawer-title">
            <BookMarked size={15} className="icon-accent" />
            Saved Views
            {views.length > 0 && <span className="badge badge-accent">{views.length}</span>}
          </div>
          <button className="btn btn-icon btn-sm" onClick={() => setOpen(false)}><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="views-tabs">
          <button className={`views-tab ${tab === 'views' ? 'active' : ''}`} onClick={() => setTab('views')}>
            <FolderOpen size={13} /> Views
          </button>
          <button className={`views-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            <History size={13} /> History
          </button>
        </div>

        {tab === 'views' && (
          <>
            {/* Save new view */}
            <div className="views-save-section">
              <div className="section-label">Save Current View</div>
              <div className="views-save-row">
                <input className="input" placeholder="Enter view name..."
                  value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()} />
                <button className={`btn ${saved ? 'btn-saved' : 'btn-primary'} btn-icon`}
                  onClick={handleSave} disabled={saving || !newName.trim()} title="Save view">
                  {saved ? <Check size={14} /> : <Save size={14} />}
                </button>
              </div>
              <label className="views-default-toggle">
                <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />
                <Crown size={12} />
                Set as default view
              </label>
            </div>

            {/* Views list */}
            <div className="views-list">
              {views.length === 0 ? (
                <div className="views-empty">
                  <FolderOpen size={36} className="views-empty-icon" />
                  <p>No saved views yet</p>
                  <p className="views-empty-sub">Give your current setup a name and save it</p>
                </div>
              ) : (
                views.map(view => (
                  <ViewCard key={view.id} view={view}
                    onLoad={() => { loadView(view); setOpen(false) }}
                    onDelete={() => deleteView(view.id)}
                    onSetDefault={() => handleSetDefault(view.id)}
                    onShare={() => handleShare(view)}
                    shareId={shareId}
                  />
                ))
              )}
            </div>
          </>
        )}

        {tab === 'history' && (
          <div className="views-history">
            <div className="views-empty">
              <History size={36} className="views-empty-icon" />
              <p>Version history</p>
              <p className="views-empty-sub">Saved views show version numbers. Each save bumps the version.</p>
              {views.filter(v => v.version > 1).length === 0
                ? <p className="views-empty-sub" style={{ marginTop: 8 }}>No versioned views yet.</p>
                : views.filter(v => v.version > 1).map(v => (
                    <div key={v.id} className="view-history-row">
                      <span>{v.name}</span>
                      <span className="badge">v{v.version}</span>
                    </div>
                  ))
              }
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ViewCard({ view, onLoad, onDelete, onSetDefault, onShare, shareId }) {
  return (
    <div className="view-card">
      <div className="view-card-body">
        <div className="view-card-name">
          {view.is_default && <Crown size={12} style={{ color: '#f59e0b', marginRight: 5 }} />}
          {view.name}
        </div>
        <div className="view-card-meta">
          {view.columns?.length > 0 && <span className="badge">{view.columns.length} cols</span>}
          {view.filters?.length > 0 && <span className="badge badge-accent">{view.filters.length} filters</span>}
          {view.version > 1 && <span className="badge">v{view.version}</span>}
          {view.shared && <span className="badge badge-success"><Share2 size={9} /> Shared</span>}
          {view.is_default && <span className="badge badge-success"><Star size={9} /> Default</span>}
          <span className="view-card-date">{new Date(view.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="view-card-actions">
        <button className="btn btn-sm btn-primary" onClick={onLoad}>Load</button>
        <button className="btn btn-icon btn-sm" onClick={onShare} title="Copy config to clipboard"
          style={{ color: shareId === view.id ? 'var(--success)' : undefined }}>
          {shareId === view.id ? <Check size={13} /> : <Share2 size={13} />}
        </button>
        {!view.is_default && (
          <button className="btn btn-icon btn-sm" onClick={onSetDefault} title="Set as default">
            <Crown size={13} />
          </button>
        )}
        <button className="btn btn-icon btn-sm btn-danger" onClick={onDelete} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}