import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import {
  Plus, X, Search, ChevronDown, Trash2,
  SlidersHorizontal, Calendar, Hash, Type, ToggleLeft,
  Filter, Zap, Check, AlertCircle, GitBranch, GitMerge
} from 'lucide-react'

// ── Type metadata ─────────────────────────────────────────────────────────────
const TYPE_META = {
  string:  { icon: Type,       color: '#6366f1', bg: '#eef2ff', label: 'Text'    },
  integer: { icon: Hash,       color: '#0ea5e9', bg: '#f0f9ff', label: 'Number'  },
  float:   { icon: Hash,       color: '#0ea5e9', bg: '#f0f9ff', label: 'Decimal' },
  boolean: { icon: ToggleLeft, color: '#10b981', bg: '#f0fdf4', label: 'Boolean' },
  date:    { icon: Calendar,   color: '#f59e0b', bg: '#fffbeb', label: 'Date'    },
}

function defaultFilterType(schemaType) {
  if (schemaType === 'integer' || schemaType === 'float') return 'range'
  if (schemaType === 'date')    return 'date_range'
  if (schemaType === 'boolean') return 'boolean'
  return 'text'
}

// ── Dropdown wrapper ──────────────────────────────────────────────────────────
function Dropdown({ trigger, children, className }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div onClick={() => setOpen(v => !v)}>{trigger(open)}</div>
      {open && (
        <div className={`fb-dropdown ${className || ''}`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

// ── Searchable field picker ───────────────────────────────────────────────────
function FieldPicker({ value, schema, onChange }) {
  const [search, setSearch] = useState('')
  const dedupedSchema = []
  const schemaByLabel = new Map()
  schema.forEach(f => {
    if (!schemaByLabel.has(f.label)) {
      schemaByLabel.set(f.label, f)
      dedupedSchema.push(f)
    }
  })

  const filtered = dedupedSchema.filter(f =>
    f.label.toLowerCase().includes(search.toLowerCase()) ||
    f.name.toLowerCase().includes(search.toLowerCase())
  )
  const selected = schema.find(f => f.name === value)
  const meta = selected ? (TYPE_META[selected.type] || TYPE_META.string) : null

  return (
    <Dropdown
      className="fb-field-dropdown"
      trigger={(open) => (
        <button className={`fb-field-btn ${open ? 'open' : ''} ${value ? 'has-value' : ''}`}>
          {selected ? (
            <>
              <span className="fb-field-type-dot" style={{ background: meta.color }} />
              <span className="fb-field-label">{selected.label}</span>
            </>
          ) : (
            <span className="fb-field-placeholder">
              <Filter size={12} style={{ marginRight: 4 }} /> Select field…
            </span>
          )}
          <ChevronDown size={12} className={`fb-chevron ${open ? 'rotated' : ''}`} />
        </button>
      )}
    >
      {(closeDropdown) => (
        <>
          <div className="fb-field-search-wrap" onClick={e => e.stopPropagation()}>
            <Search size={12} className="fb-field-search-icon" />
            <input autoFocus className="fb-field-search" placeholder="Search fields…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="fb-field-list">
            {filtered.length === 0 && <div className="fb-field-empty">No fields match</div>}
            {filtered.map(f => {
              const m = TYPE_META[f.type] || TYPE_META.string
              const Icon = m.icon
              return (
                <button key={f.name} className={`fb-field-option ${f.name === value ? 'active' : ''}`}
                  onClick={() => { onChange(f.name); closeDropdown(); }}>
                  <span className="fb-option-icon" style={{ color: m.color, background: m.bg }}><Icon size={11} /></span>
                  <span className="fb-option-label">{f.label}</span>
                  <span className="fb-option-type">{m.label}</span>
                  {f.name === value && <Check size={11} className="fb-option-check" />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </Dropdown>
  )
}

// ── Filter value input per type ───────────────────────────────────────────────
function FilterValueInput({ filter, facetOptions, onUpdate }) {
  switch (filter.type) {
    case 'range':
      return (
        <div className="fb-range">
          <input className="fb-input fb-range-input" type="number" placeholder="Min"
            value={filter.min ?? ''} onChange={e => onUpdate({ min: e.target.value })} />
          <span className="fb-range-sep">—</span>
          <input className="fb-input fb-range-input" type="number" placeholder="Max"
            value={filter.max ?? ''} onChange={e => onUpdate({ max: e.target.value })} />
        </div>
      )
    case 'date_range':
      return (
        <div className="fb-range">
          <input className="fb-input fb-date-input" type="date"
            value={filter.from ?? ''} onChange={e => onUpdate({ from: e.target.value })} />
          <span className="fb-range-sep">—</span>
          <input className="fb-input fb-date-input" type="date"
            value={filter.to ?? ''} onChange={e => onUpdate({ to: e.target.value })} />
        </div>
      )
    case 'boolean':
      return (
        <div className="fb-bool-group">
          {[{ val: 'true', label: 'True' }, { val: 'false', label: 'False' }].map(opt => (
            <button key={opt.val} className={`fb-bool-btn ${String(filter.value) === opt.val ? 'active' : ''}`}
              onClick={() => onUpdate({ value: opt.val === 'true' })}>{opt.label}</button>
          ))}
        </div>
      )
    case 'multi_select':
      if (!facetOptions || facetOptions.length === 0) {
        return (
          <div className="fb-no-facets">
            <AlertCircle size={12} /><span>Run query first to load options</span>
          </div>
        )
      }
      return (
        <div className="fb-multiselect">
          {facetOptions.slice(0, 12).map(opt => {
            const sel = Array.isArray(filter.value) && filter.value.includes(opt.value)
            return (
              <button key={opt.value} className={`fb-chip ${sel ? 'active' : ''}`}
                onClick={() => {
                  const cur = Array.isArray(filter.value) ? filter.value : []
                  onUpdate({ value: sel ? cur.filter(v => v !== opt.value) : [...cur, opt.value] })
                }}>
                {sel && <Check size={10} />}
                {opt.value}
                <span className="fb-chip-count">{opt.count}</span>
              </button>
            )
          })}
        </div>
      )
    default:
      return (
        <input className="fb-input fb-text-input" placeholder="Type value to search…"
          value={filter.value ?? ''} onChange={e => onUpdate({ value: e.target.value })} />
      )
  }
}

// ── Nested filter row (child of a group) ──────────────────────────────────────
function NestedFilterRow({ child, childIdx, parentIdx, schema, facets, updateFilter, removeFilter, fetchFacets }) {
  const facetOptions = child.field && facets[child.field] ? facets[child.field] : []
  const fieldMeta = schema.find(f => f.name === child.field)

  const handleFieldChange = (fieldName) => {
    const fs = schema.find(s => s.name === fieldName)
    if (!fs) return
    const newType = defaultFilterType(fs.type)
    const parent = useStore.getState().filters[parentIdx]
    const newChildren = [...(parent.children || [])]
    newChildren[childIdx] = { ...newChildren[childIdx], field: fieldName, type: newType, value: '', min: '', max: '', from: '', to: '' }
    updateFilter(parentIdx, { children: newChildren })
    if (fs.type === 'string') fetchFacets([fieldName])
  }

  const handleChildUpdate = (patch) => {
    const parent = useStore.getState().filters[parentIdx]
    const newChildren = [...(parent.children || [])]
    newChildren[childIdx] = { ...newChildren[childIdx], ...patch }
    updateFilter(parentIdx, { children: newChildren })
  }

  const handleRemove = () => {
    const parent = useStore.getState().filters[parentIdx]
    const newChildren = (parent.children || []).filter((_, i) => i !== childIdx)
    updateFilter(parentIdx, { children: newChildren })
  }

  const availableTypes = fieldMeta
    ? (fieldMeta.type === 'string'
        ? [{ value: 'text', label: 'Contains' }, { value: 'multi_select', label: 'Is One Of' }]
        : fieldMeta.type === 'integer' || fieldMeta.type === 'float'
          ? [{ value: 'range', label: 'Number Range' }]
          : fieldMeta.type === 'date'
            ? [{ value: 'date_range', label: 'Date Range' }]
            : [{ value: 'boolean', label: 'Is' }])
    : [{ value: 'text', label: 'Contains' }]

  return (
    <div className="fb-nested-row">
      {childIdx === 0 ? (
        <span className="fb-where-tag" style={{ fontSize: 9 }}>IF</span>
      ) : (
        <select className="fb-op-select" style={{ fontSize: 10 }}
          value={child.op || 'AND'}
          onChange={e => handleChildUpdate({ op: e.target.value })}>
          <option>AND</option>
          <option>OR</option>
        </select>
      )}
      <FieldPicker value={child.field || ''} schema={schema} onChange={handleFieldChange} />
      {child.field && availableTypes.length > 1 && (
        <select className="fb-type-select" value={child.type || 'text'}
          onChange={e => handleChildUpdate({ type: e.target.value, value: '', min: '', max: '', from: '', to: '' })}>
          {availableTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      )}
      {child.field && (
        <div style={{ flex: 1 }}>
          <FilterValueInput filter={child} facetOptions={facetOptions}
            onUpdate={handleChildUpdate} />
        </div>
      )}
      <button className="fb-remove-btn" style={{ padding: 4 }} onClick={handleRemove}><X size={11} /></button>
    </div>
  )
}

// ── Single filter card ────────────────────────────────────────────────────────
function FilterCard({ idx, filter, schema, facets, updateFilter, removeFilter, fetchFacets }) {
  const fieldMeta = schema.find(f => f.name === filter.field)
  const facetOptions = filter.field && facets[filter.field] ? facets[filter.field] : []
  const typeMeta = fieldMeta ? (TYPE_META[fieldMeta.type] || TYPE_META.string) : null

  const handleFieldChange = (fieldName) => {
    const fs = schema.find(s => s.name === fieldName)
    if (!fs) return
    const newType = defaultFilterType(fs.type)
    updateFilter(idx, { field: fieldName, type: newType, value: '', min: '', max: '', from: '', to: '' })
    if (fs.type === 'string') fetchFacets([fieldName])
  }

  const handleTypeChange = (newType) => {
    updateFilter(idx, { type: newType, value: '', min: '', max: '', from: '', to: '' })
    if (newType === 'multi_select' && filter.field) fetchFacets([filter.field])
  }

  const addNestedChild = () => {
    const children = [...(filter.children || []), { field: '', type: 'text', value: '', op: 'AND' }]
    updateFilter(idx, { children })
  }

  const availableTypes = fieldMeta
    ? (fieldMeta.type === 'string'
        ? [{ value: 'text', label: 'Contains' }, { value: 'multi_select', label: 'Is One Of' }]
        : fieldMeta.type === 'integer' || fieldMeta.type === 'float'
          ? [{ value: 'range', label: 'Number Range' }]
          : fieldMeta.type === 'date'
            ? [{ value: 'date_range', label: 'Date Range' }]
            : [{ value: 'boolean', label: 'Is' }])
    : [{ value: 'text', label: 'Contains' }]

  // Nested group card
  if (filter.type === 'nested') {
    const children = filter.children || []
    return (
      <div className="fb-card fb-card-nested">
        <div className="fb-card-header">
          <div className="fb-connector">
            {idx === 0 ? <span className="fb-where-tag">WHERE</span> : (
              <select className="fb-op-select" value={filter.op || 'AND'}
                onChange={e => updateFilter(idx, { op: e.target.value })}>
                <option>AND</option><option>OR</option>
              </select>
            )}
          </div>
          <span className="fb-nested-label"><GitBranch size={13} /> Group Filter</span>
          <select className="fb-type-select" value={filter.groupOp || 'AND'}
            onChange={e => updateFilter(idx, { groupOp: e.target.value })}>
            <option value="AND">ALL of (AND)</option>
            <option value="OR">ANY of (OR)</option>
          </select>
          <button className="fb-remove-btn" onClick={() => removeFilter(idx)}><X size={13} /></button>
        </div>
        <div className="fb-nested-body">
          {children.map((child, ci) => (
            <NestedFilterRow key={ci} child={child} childIdx={ci} parentIdx={idx}
              schema={schema} facets={facets} updateFilter={updateFilter}
              removeFilter={removeFilter} fetchFacets={fetchFacets} />
          ))}
          <button className="fb-add-child-btn" onClick={addNestedChild}>
            <Plus size={11} /> Add condition
          </button>
        </div>
      </div>
    )
  }

  // Normal filter card
  return (
    <div className="fb-card">
      <div className="fb-card-header">
        <div className="fb-connector">
          {idx === 0 ? <span className="fb-where-tag">WHERE</span> : (
            <select className="fb-op-select" value={filter.op || 'AND'}
              onChange={e => updateFilter(idx, { op: e.target.value })}>
              <option>AND</option><option>OR</option>
            </select>
          )}
        </div>
        <FieldPicker value={filter.field} schema={schema} onChange={handleFieldChange} />
        {filter.field && availableTypes.length > 1 && (
          <select className="fb-type-select" value={filter.type}
            onChange={e => handleTypeChange(e.target.value)}>
            {availableTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
        {filter.field && availableTypes.length === 1 && typeMeta && (
          <span className="fb-type-badge" style={{ color: typeMeta.color, background: typeMeta.bg }}>
            {availableTypes[0].label}
          </span>
        )}
        <button className="fb-remove-btn" onClick={() => removeFilter(idx)}><X size={13} /></button>
      </div>
      <div className="fb-card-body">
        {filter.field ? (
          <FilterValueInput filter={filter} facetOptions={facetOptions}
            onUpdate={(patch) => updateFilter(idx, patch)} />
        ) : (
          <span className="fb-card-hint">Select a field above to configure</span>
        )}
      </div>
    </div>
  )
}

// ── Active pills summary ──────────────────────────────────────────────────────
function ActivePills({ filters, schema, onRemove }) {
  const active = filters.map((f, i) => ({ f, i })).filter(({ f }) => {
    if (!f.field && f.type !== 'nested') return false
    if (f.type === 'nested') return f.children?.some(c => c.field)
    if (f.type === 'range') return (f.min != null && f.min !== '') || (f.max != null && f.max !== '')
    if (f.type === 'date_range') return f.from || f.to
    if (f.type === 'boolean') return f.value != null && f.value !== ''
    if (f.type === 'multi_select') return Array.isArray(f.value) && f.value.length > 0
    return f.value != null && f.value !== ''
  })
  if (active.length === 0) return null
  return (
    <div className="fb-pills-row">
      {active.map(({ f, i }) => {
        const fieldLabel = f.type === 'nested' ? 'Group' : (schema.find(s => s.name === f.field)?.label || f.field)
        let val = ''
        if (f.type === 'nested') val = `${f.children?.length || 0} conditions`
        else if (f.type === 'range') val = `${f.min ?? '…'} – ${f.max ?? '…'}`
        else if (f.type === 'date_range') val = `${f.from ?? '…'} – ${f.to ?? '…'}`
        else if (f.type === 'boolean') val = String(f.value)
        else if (f.type === 'multi_select') val = Array.isArray(f.value) ? f.value.join(', ') : ''
        else val = f.value
        return (
          <span key={i} className="fb-pill">
            <span className="fb-pill-field">{fieldLabel}</span>
            <span className="fb-pill-sep">:</span>
            <span className="fb-pill-value">{val}</span>
            <button className="fb-pill-remove" onClick={() => onRemove(i)}><X size={10} /></button>
          </span>
        )
      })}
    </div>
  )
}

// ── Date compare section ──────────────────────────────────────────────────────
function DateCompareSection({ dateRange, setDateRange, dateCompare, setDateCompare }) {
  const [enabled, setEnabled] = useState(!!dateCompare)

  const toggle = (v) => {
    setEnabled(v)
    if (!v) setDateCompare(null)
    else setDateCompare({ type: 'previous_period', from: dateRange.from, to: dateRange.to })
  }

  return (
    <div className="fb-datecompare">
      <div className="fb-datecompare-row">
        <Calendar size={13} className="fb-dc-icon" />
        <span className="fb-dc-label">Date Range</span>
        <input className="fb-input fb-date-input" type="date"
          value={dateRange.from}
          onChange={e => {
            const val = e.target.value
            setDateRange({ ...dateRange, from: val })
            if (enabled) setDateCompare({ ...(dateCompare || {}), from: val })
          }} />
        <span className="fb-range-sep">—</span>
        <input className="fb-input fb-date-input" type="date"
          value={dateRange.to}
          onChange={e => {
            const val = e.target.value
            setDateRange({ ...dateRange, to: val })
            if (enabled) setDateCompare({ ...(dateCompare || {}), to: val })
          }} />
        <label className="fb-dc-toggle">
          <input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)} />
          <GitMerge size={12} />
          Compare Period
        </label>
        {enabled && (
          <select className="fb-input" style={{ padding: '5px 8px', fontSize: 12 }}
            value={dateCompare?.type || 'previous_period'}
            onChange={e => setDateCompare({ ...(dateCompare || {}), type: e.target.value })}>
            <option value="previous_period">vs Previous Period</option>
            <option value="same_period_last_year">vs Same Period Last Year</option>
          </select>
        )}
      </div>
    </div>
  )
}

// ── Main FilterBuilder ────────────────────────────────────────────────────────
export default function FilterBuilder() {
  const {
    filters, addFilter, updateFilter, removeFilter, clearFilters,
    query, schema, facets, fetchFacets,
    dateRange, setDateRange, dateCompare, setDateCompare,
  } = useStore()
  const [expanded, setExpanded] = useState(true)

  const activeCount = filters.filter(f => {
    if (!f.field && f.type !== 'nested') return false
    if (f.type === 'nested') return f.children?.some(c => c.field)
    if (f.type === 'range') return (f.min != null && f.min !== '') || (f.max != null && f.max !== '')
    if (f.type === 'date_range') return f.from || f.to
    if (f.type === 'boolean') return f.value != null && f.value !== ''
    if (f.type === 'multi_select') return Array.isArray(f.value) && f.value.length > 0
    return f.value != null && f.value !== ''
  }).length

  const usableSchema = schema.filter(f =>
    !f.name.startsWith('_') && f.name !== 'id' && f.name !== 'score'
  )

  const addNormal = () => addFilter({ field: '', type: 'text', value: '', op: 'AND' })
  const addGroup  = () => addFilter({ type: 'nested', op: 'AND', groupOp: 'AND', children: [
    { field: '', type: 'text', value: '', op: 'AND' },
    { field: '', type: 'text', value: '', op: 'AND' },
  ]})

  return (
    <div className="fb-wrap">
      {/* Toolbar */}
      <div className="fb-toolbar">
        <div className="fb-toolbar-left">
          <button className="fb-toggle-btn" onClick={() => setExpanded(v => !v)}>
            <SlidersHorizontal size={14} />
            <span>Filters</span>
            {activeCount > 0 && <span className="fb-count-badge">{activeCount}</span>}
            <ChevronDown size={12} className={`fb-chevron ${expanded ? 'rotated' : ''}`} />
          </button>
          <ActivePills filters={filters} schema={usableSchema} onRemove={removeFilter} />
        </div>
        <div className="fb-toolbar-right">
          {filters.length > 0 && (
            <button className="fb-clear-btn" onClick={clearFilters}>
              <Trash2 size={13} /> Clear all
            </button>
          )}
          <button className="fb-add-btn" onClick={addNormal}><Plus size={13} /> Add Filter</button>
          <button className="fb-add-btn" style={{ color: '#8b5cf6', borderColor: '#c4b5fd' }} onClick={addGroup}>
            <GitBranch size={13} /> Add Group
          </button>
          <button className="fb-run-btn" onClick={() => query()}>
            <Zap size={13} /> Apply
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="fb-body">
          {/* Date compare row */}
          <DateCompareSection
            dateRange={dateRange} setDateRange={setDateRange}
            dateCompare={dateCompare} setDateCompare={setDateCompare}
          />

          {/* Filter cards */}
          {filters.length === 0 ? (
            <div className="fb-empty-state">
              <Filter size={22} className="fb-empty-icon" />
              <p>No filters — add one to narrow results</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="fb-add-btn" onClick={addNormal}><Plus size={13} /> Add Filter</button>
                <button className="fb-add-btn" style={{ color: '#8b5cf6', borderColor: '#c4b5fd' }} onClick={addGroup}>
                  <GitBranch size={13} /> Add Group
                </button>
              </div>
            </div>
          ) : (
            <div className="fb-cards">
              {filters.map((filter, idx) => (
                <FilterCard key={idx} idx={idx} filter={filter} schema={usableSchema}
                  facets={facets} updateFilter={updateFilter} removeFilter={removeFilter}
                  fetchFacets={fetchFacets} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}