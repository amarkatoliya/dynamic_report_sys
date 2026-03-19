import React, { useState, useCallback } from 'react'
import { useStore } from '../store'
import { Eye, EyeOff, GripVertical, Search, ChevronDown, ChevronRight, Layers } from 'lucide-react'

const TYPE_ACCENT = {
  string:  '#6366f1',
  integer: '#0ea5e9',
  float:   '#0ea5e9',
  boolean: '#10b981',
  date:    '#f59e0b',
}

// Infer column group from field name/type (e.g. price fields → "Pricing")
function inferGroup(field) {
  const n = field.name.toLowerCase()
  const l = field.label.toLowerCase()
  if (n.includes('price') || n.includes('cost') || n.includes('map') || n.includes('margin'))  return 'Pricing'
  if (n.includes('date') || n.includes('_dt') || field.type === 'date')                         return 'Dates'
  if (n.includes('stock') || n.includes('qty') || n.includes('quantity'))                       return 'Inventory'
  if (n.includes('brand') || n.includes('category') || n.includes('type'))                      return 'Classification'
  if (n.includes('url') || n.includes('image') || n.includes('link'))                           return 'Media'
  if (n.includes('sku') || n.includes('id') || n.includes('code') || n.includes('parent'))      return 'Identifiers'
  if (field.type === 'boolean' || n.includes('violation') || n.includes('flag'))                return 'Flags'
  return 'General'
}

export default function Sidebar() {
  const { schema, selectedColumns, setSelectedColumns, columnOrder, setColumnOrder } = useStore()
  const [search,      setSearch]      = useState('')
  const [dragging,    setDragging]    = useState(null)
  const [dragOver,    setDragOver]    = useState(null)
  const [groupMode,   setGroupMode]   = useState(false)
  const [collapsed,   setCollapsed]   = useState({})

  const usableSchema = schema.filter(f => !f.name.startsWith('_') && f.name !== 'id' && f.name !== 'score')

  // Deduplicate schema by label
  const dedupedSchema = []
  const schemaByLabel = new Map()
  usableSchema.forEach(f => {
    if (!schemaByLabel.has(f.label)) {
      const clone = { ...f, names: [f.name] }
      schemaByLabel.set(f.label, clone)
      dedupedSchema.push(clone)
    } else {
      schemaByLabel.get(f.label).names.push(f.name)
    }
  })

  const filtered = dedupedSchema.filter(f =>
    f.label.toLowerCase().includes(search.toLowerCase()) ||
    f.names.some(n => n.toLowerCase().includes(search.toLowerCase()))
  )

  const toggleColumn = (namesArr) => {
    const isSelected = namesArr.some(n => selectedColumns.includes(n))
    if (isSelected) {
      setSelectedColumns(selectedColumns.filter(c => !namesArr.includes(c)))
    } else {
      setSelectedColumns([...new Set([...selectedColumns, ...namesArr])])
    }
  }

  const toggleAll = () => {
    const allNames = usableSchema.map(f => f.name)
    if (selectedColumns.length === allNames.length) setSelectedColumns([])
    else setSelectedColumns(allNames)
  }

  const toggleGroup = (groupName, fields) => {
    const groupNames = fields.flatMap(f => f.names)
    const allSelected = groupNames.every(n => selectedColumns.includes(n))
    if (allSelected) setSelectedColumns(selectedColumns.filter(c => !groupNames.includes(c)))
    else setSelectedColumns([...new Set([...selectedColumns, ...groupNames])])
  }

  const toggleCollapse = (groupName) => {
    setCollapsed(c => ({ ...c, [groupName]: !c[groupName] }))
  }

  // Drag reorder
  const onDragStart = (e, name) => { setDragging(name); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver  = (e, name) => { e.preventDefault(); setDragOver(name) }
  const onDrop      = (e, name) => {
    e.preventDefault()
    if (!dragging || dragging === name) return
    const order = [...(columnOrder.length ? columnOrder : selectedColumns)]
    const fromIdx = order.indexOf(dragging)
    const toIdx   = order.indexOf(name)
    if (fromIdx === -1 || toIdx === -1) return
    order.splice(fromIdx, 1)
    order.splice(toIdx, 0, dragging)
    setColumnOrder(order)
    setDragging(null); setDragOver(null)
  }

  // Build groups
  const groups = {}
  filtered.forEach(f => {
    const g = inferGroup(f)
    if (!groups[g]) groups[g] = []
    groups[g].push(f)
  })

  const renderFieldRow = (field) => {
    const isSelected = field.names.some(n => selectedColumns.includes(n))
    const isOver     = dragOver === field.name
    return (
      <div key={field.name} draggable
        onDragStart={e => onDragStart(e, field.name)}
        onDragOver={e => onDragOver(e, field.name)}
        onDrop={e => onDrop(e, field.name)}
        onDragEnd={() => { setDragging(null); setDragOver(null) }}
        className={`sidebar-col-row ${isOver ? 'drag-over' : ''} ${dragging === field.name ? 'dragging' : ''} ${isSelected ? 'selected' : ''}`}>
        <GripVertical size={12} className="drag-handle" />
        <span className="type-dot" style={{ background: TYPE_ACCENT[field.type] || '#888' }} />
        <span className="col-row-label" onClick={() => toggleColumn(field.names)} title={field.names.join(', ')}>
          {field.label}
        </span>
        <button className="col-eye-btn" onClick={() => toggleColumn(field.names)} title={isSelected ? 'Hide' : 'Show'}>
          {isSelected ? <Eye size={13} className="eye-on" /> : <EyeOff size={13} className="eye-off" />}
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar-body">
      {/* Search */}
      <div className="sidebar-search-wrap">
        <Search size={13} className="sidebar-search-icon" />
        <input className="sidebar-search" placeholder="Search columns..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Header row */}
      <div className="sidebar-col-header">
        <span className="sidebar-col-label">
          Columns
          <span className="sidebar-col-count">{selectedColumns.length}/{usableSchema.length}</span>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${groupMode ? 'btn-primary' : ''}`} style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => setGroupMode(v => !v)} title="Toggle column grouping">
            <Layers size={11} />
          </button>
          <button className="btn btn-sm" onClick={toggleAll}>
            {selectedColumns.length === usableSchema.length ? 'None' : 'All'}
          </button>
        </div>
      </div>

      {/* Column list — flat or grouped */}
      <div className="sidebar-col-list">
        {groupMode ? (
          Object.entries(groups).map(([groupName, fields]) => {
            const allSel = fields.every(f => selectedColumns.includes(f.name))
            const someSel = fields.some(f => selectedColumns.includes(f.name))
            const isCollapsed = collapsed[groupName]
            return (
              <div key={groupName} className="sidebar-group">
                <div className="sidebar-group-header">
                  <button className="sidebar-group-toggle" onClick={() => toggleCollapse(groupName)}>
                    {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <span className="sidebar-group-name">{groupName}</span>
                    <span className="sidebar-group-count">{fields.filter(f => f.names.some(n => selectedColumns.includes(n))).length}/{fields.length}</span>
                  </button>
                  <button className={`sidebar-group-all ${allSel ? 'all-selected' : someSel ? 'partial' : ''}`}
                    onClick={() => toggleGroup(groupName, fields)}>
                    {allSel ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="sidebar-group-rows">
                    {fields.map(renderFieldRow)}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          filtered.map(renderFieldRow)
        )}
        {filtered.length === 0 && <div className="sidebar-empty">No columns match</div>}
      </div>

      {/* Type legend */}
      <div className="sidebar-legend">
        {Object.entries(TYPE_ACCENT).filter(([t]) => t !== 'float').map(([type, color]) => (
          <span key={type} className="legend-item">
            <span className="type-dot" style={{ background: color }} />{type}
          </span>
        ))}
      </div>
    </div>
  )
}