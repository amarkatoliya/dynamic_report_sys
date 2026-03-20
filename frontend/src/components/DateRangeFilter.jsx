import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { Calendar, ChevronDown, Check, Clock } from 'lucide-react'

export default function DateRangeFilter() {
  const {
    dateRange, setDateRange, 
    dateField, setDateField, 
    schema, query
  } = useStore()

  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const dateFields = schema.filter(f => f.type === 'date' || f.name.endsWith('_dt'))

  const handleQuickSelect = (days) => {
    const to = new Date()
    const from = new Date()
    from.setDate(to.getDate() - days)
    
    const formatDate = (d) => d.toISOString().split('T')[0]
    
    setDateRange({ from: formatDate(from), to: formatDate(to) })
  }

  const handleThisYear = () => {
    const now = new Date()
    const from = `${now.getFullYear()}-01-01`
    const to = now.toISOString().split('T')[0]
    setDateRange({ from, to })
  }

  const handleDone = () => {
    setOpen(false)
    query()
  }

  return (
    <div className="date-range-filter" ref={ref}>
      <button className={`btn btn-sm ${dateRange.from || dateRange.to ? 'btn-active' : ''}`} onClick={() => setOpen(!open)}>
        <Calendar size={13} />
        <span>{dateRange.from || dateRange.to ? 'Date Filter Active' : 'Date Range'}</span>
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="dr-popover animate-scale-in">
          <div className="dr-header">
            <span className="dr-title">DATE RANGE FILTER</span>
            <button className="btn btn-xs btn-primary" onClick={handleDone}>Done</button>
          </div>

          <div className="dr-body">
            {/* Date Field Selection */}
            <div className="dr-section">
              <label className="dr-label">Date Field</label>
              <div className="dr-select-wrap">
                <select 
                  className="dr-select"
                  value={dateField}
                  onChange={(e) => setDateField(e.target.value)}
                >
                  <option value="">Select date field</option>
                  {dateFields.map(f => (
                    <option key={f.name} value={f.name}>{f.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="dr-select-chevron" />
              </div>
            </div>

            {/* Custom Range */}
            <div className="dr-grid">
              <div className="dr-section">
                <label className="dr-label">From</label>
                <input 
                  type="date" 
                  className="dr-input" 
                  value={dateRange.from}
                  onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                />
              </div>
              <div className="dr-section">
                <label className="dr-label">To</label>
                <input 
                  type="date" 
                  className="dr-input" 
                  value={dateRange.to}
                  onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                />
              </div>
            </div>

            {/* Quick Select */}
            <div className="dr-section">
              <label className="dr-label">Quick Select</label>
              <div className="dr-quick-grid">
                {[
                  { label: 'Last 7 days', days: 7 },
                  { label: 'Last 30 days', days: 30 },
                  { label: 'Last 90 days', days: 90 },
                ].map(opt => (
                  <button 
                    key={opt.label}
                    className="btn btn-xs btn-outline"
                    onClick={() => handleQuickSelect(opt.days)}
                  >
                    {opt.label}
                  </button>
                ))}
                <button className="btn btn-xs btn-outline" onClick={handleThisYear}>This year</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
