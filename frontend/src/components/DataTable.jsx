import React, { useState, useRef, useCallback, useMemo } from 'react'
import { useStore } from '../store'
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

const ROW_HEIGHT = 38 // px per row
const OVERSCAN   = 5  // extra rows above/below viewport

// ── Virtual scroll hook ───────────────────────────────────────────────────────
function useVirtualScroll(totalItems, containerRef) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight]       = useState(400)

  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), [])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2
  const end   = Math.min(totalItems, start + visibleCount)

  // Observe container height
  React.useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [containerRef])

  return { start, end, onScroll, totalHeight: totalItems * ROW_HEIGHT, offsetTop: start * ROW_HEIGHT }
}

export default function DataTable() {
  const {
    results, total, loading, page, rows, setPage,
    selectedColumns, columnOrder, columnWidths, setColumnWidth,
    sort, setSort, schema, compareResult,
  } = useStore()

  const [resizing, setResizing] = useState(null)
  const [headerDragging, setHeaderDragging] = useState(null)
  const [headerDragOver, setHeaderDragOver] = useState(null)
  const startX   = useRef(0)
  const startW   = useRef(0)
  const scrollRef = useRef(null)

  // Use columnOrder if it covers all selected columns, else fall back to selectedColumns
  const orderedCols = columnOrder.length
    ? columnOrder.filter(c => selectedColumns.includes(c))
    : selectedColumns

  // If orderedCols is missing selected columns (stale columnOrder), use selectedColumns directly
  const missingCols = selectedColumns.filter(c => !orderedCols.includes(c))
  const allCols = missingCols.length ? [...orderedCols, ...missingCols] : orderedCols

  const displayCols = allCols.length
    ? allCols
    : results.length
      ? Object.keys(results[0]).filter(k => !k.startsWith('_') && k !== 'id')
      : []

  const getLabel = (name) => {
    const f = schema.find(s => s.name === name)
    return f?.label || name.replace(/(_s|_i|_f|_b|_dt)$/, '').replace(/_/g, ' ')
  }

  // Deduplicate columns by label so `price_i` and `price_f` become one visually
  const dedupedCols = useMemo(() => {
    const seen = new Set()
    const out = []
    displayCols.forEach(col => {
      const label = getLabel(col)
      if (!seen.has(label)) {
        seen.add(label)
        out.push({
          id: col,
          label,
          group: schema.filter(c => getLabel(c.name) === label).map(c => c.name)
        })
      }
    })
    return out
  }, [displayCols, schema])

  // Virtual scrolling
  const { start, end, onScroll, totalHeight, offsetTop } = useVirtualScroll(results.length, scrollRef)
  const visibleRows = results.slice(start, end)

  // Column resize
  const startResize = useCallback((e, col) => {
    e.preventDefault()
    setResizing(col)
    startX.current = e.clientX
    startW.current = columnWidths[col] || 140
    const onMove = (ev) => {
      const newW = Math.max(60, startW.current + ev.clientX - startX.current)
      setColumnWidth(col, newW)
    }
    const onUp = () => {
      setResizing(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [columnWidths, setColumnWidth])

  const highlights   = useStore(s => s.highlights)

  // ── Render cell with highlighting & merged values ──
  const renderCell = (row, col) => {
    // Determine which field in the group has data
    const valCol = col.group.find(g => row[g] != null && row[g] !== '') || col.id
    const val    = row[valCol] ?? ''
    
    // Check for highlight in ANY of the grouped fields
    let hl = null
    for (const g of col.group) {
        if (highlights?.[row.id]?.[g]?.[0]) {
            hl = highlights[row.id][g][0]
            break
        }
    }
    
    if (hl) {
      return <span dangerouslySetInnerHTML={{ __html: hl }} />
    }
    
    return <CellValue value={val} col={valCol} />
  }

  // Header drag-reorder
  const onHeaderDragStart = (e, colId) => {
    setHeaderDragging(colId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onHeaderDragOver = (e, colId) => {
    e.preventDefault()
    setHeaderDragOver(colId)
  }
  const onHeaderDrop = (e, targetColId) => {
    e.preventDefault()
    if (!headerDragging || headerDragging === targetColId) return
    
    // Find all physical fields for the source and target groups
    const sourceGroup = dedupedCols.find(c => c.id === headerDragging)?.group || []
    const targetGroup = dedupedCols.find(c => c.id === targetColId)?.group || []
    
    if (!sourceGroup.length || !targetGroup.length) return

    const newOrder = [...(columnOrder.length ? columnOrder : selectedColumns)]
    
    // Remove source fields
    sourceGroup.forEach(field => {
      const idx = newOrder.indexOf(field)
      if (idx !== -1) newOrder.splice(idx, 1)
    })
    
    // Find new insertion point (before the target group's first element)
    const targetIdx = newOrder.indexOf(targetGroup[0])
    newOrder.splice(targetIdx, 0, ...sourceGroup)
    
    setColumnOrder(newOrder)
    setHeaderDragging(null)
    setHeaderDragOver(null)
  }

  const handleSort = (col) => {
    if (!sort.startsWith(col)) setSort(`${col} asc`)
    else if (sort.endsWith('asc')) setSort(`${col} desc`)
    else setSort('score desc')
  }

  const getSortIcon = (col) => {
    if (!sort.startsWith(col)) return <ArrowUpDown size={11} className="sort-icon-dim" />
    if (sort.endsWith('asc'))  return <ArrowUp size={11} className="sort-icon-active" />
    return <ArrowDown size={11} className="sort-icon-active" />
  }

  const totalPages = Math.ceil(total / rows)
  const pages = []
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i)

  if (compareResult) {
    return <CompareView compareResult={compareResult} displayCols={displayCols} getLabel={getLabel} />
  }

  return (
    <div className="table-wrap">
      {/* Scrollable table with virtual rendering */}
      <div className="table-scroll" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <LoadingSkeleton cols={displayCols.length || 6} />
        ) : results.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="data-table">
            <colgroup>
              {dedupedCols.map(col => (
                <col key={col.id} style={{ width: columnWidths[col.id] || 140 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {dedupedCols.map(col => (
                  <th key={col.id} 
                    className={`th ${sort.startsWith(col.id) ? 'sorted' : ''} ${headerDragOver === col.id ? 'drag-over' : ''} ${headerDragging === col.id ? 'dragging' : ''}`}
                    draggable={!resizing}
                    onDragStart={e => onHeaderDragStart(e, col.id)}
                    onDragOver={e => onHeaderDragOver(e, col.id)}
                    onDrop={e => onHeaderDrop(e, col.id)}
                    onDragEnd={() => { setHeaderDragging(null); setHeaderDragOver(null) }}
                  >
                    <div className="th-inner" onClick={() => handleSort(col.id)}>
                      <span className="th-label">{col.label}</span>
                      {getSortIcon(col.id)}
                    </div>
                    <div className={`resize-handle ${resizing === col.id ? 'active' : ''}`}
                      onMouseDown={e => startResize(e, col.id)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Top spacer for virtual scroll */}
              {offsetTop > 0 && (
                <tr style={{ height: offsetTop }}>
                  <td colSpan={displayCols.length} />
                </tr>
              )}
              {visibleRows.map((row, ri) => (
                <tr key={row.id || (start + ri)} className={`tr ${(start + ri) % 2 === 1 ? 'alt' : ''}`}>
                  {dedupedCols.map(col => (
                    <td key={col.id} className="td"
                      style={{ maxWidth: columnWidths[col.id] || 140 }}
                      title={String(row[col.id] ?? '')}>
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Bottom spacer for virtual scroll */}
              {totalHeight - offsetTop - visibleRows.length * ROW_HEIGHT > 0 && (
                <tr style={{ height: totalHeight - offsetTop - visibleRows.length * ROW_HEIGHT }}>
                  <td colSpan={displayCols.length} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && total > 0 && <Pagination />}
    </div>
  )
}

const Pagination = () => {
  const { page, rows, total, setPage, nextCursor, setNextPage, loading } = useStore()
  const totalPages = Math.ceil(total / rows)

  if (total === 0) return null

  return (
    <div className="pagination animate-fade-in">
      <div className="pagination-info">
        Page <strong>{page}</strong> of {totalPages.toLocaleString()}
        <span className="pagination-total">({total.toLocaleString()} total)</span>
      </div>
      <div className="pagination-btns">
        <button className="btn btn-sm btn-icon" onClick={() => setPage(1)} disabled={page === 1 || loading}>
          <ChevronsLeft size={14} />
        </button>
        <button className="btn btn-sm btn-icon" onClick={() => setPage(page - 1)} disabled={page === 1 || loading}>
          <ChevronLeft size={14} />
        </button>
        
        {/* Cursor-based Next for better performance */}
        {nextCursor ? (
           <button className="btn btn-sm btn-primary" onClick={setNextPage} disabled={loading} style={{ gap: 6 }}>
             Next Page <ChevronRight size={14} />
           </button>
        ) : (
           <button className="btn btn-sm btn-icon" onClick={() => setPage(page + 1)} disabled={page === totalPages || loading}>
             <ChevronRight size={14} />
           </button>
        )}

        <button className="btn btn-sm btn-icon" onClick={() => setPage(totalPages)} disabled={page === totalPages || loading}>
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = d.getFullYear()
  return `${day}-${month}-${year}`
}

function CellValue({ value, col }) {
  if (value == null) return <span className="cell-null">—</span>
  if (typeof value === 'boolean') {
    return <span className={`badge ${value ? 'badge-success' : 'badge-error'}`}>{value ? 'true' : 'false'}</span>
  }
  if (col.endsWith('_dt') || (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/))) {
    return <span className="cell-date">{formatDate(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="cell-number">{value.toLocaleString()}</span>
  }
  return <span>{String(value)}</span>
}

function CompareView({ compareResult, displayCols, getLabel }) {
  const { current, compare, difference } = compareResult
  const pct = difference?.percentage
  const pctColor = pct > 0 ? 'var(--success)' : pct < 0 ? 'var(--error)' : 'var(--text2)'
  return (
    <div className="compare-view">
      <div className="compare-banner">
        <StatCard label="Current Period" value={current.total.toLocaleString()} color="var(--accent)" />
        <StatCard label="Compare Period" value={compare.total.toLocaleString()} color="var(--text2)" />
        <StatCard label="Change"
          value={`${pct > 0 ? '+' : ''}${pct ?? '—'}%`}
          sub={`${difference.absolute > 0 ? '+' : ''}${difference.absolute} records`}
          color={pctColor} />
      </div>
      <div className="compare-grid">
        {[{ label: 'Current Period', docs: current.docs, accent: 'var(--accent)' },
          { label: 'Compare Period', docs: compare.docs, accent: 'var(--text2)' }].map(({ label, docs, accent }) => (
          <div key={label} className="compare-half">
            <div className="compare-half-header" style={{ color: accent }}>{label}</div>
            <table className="data-table">
              <thead><tr>{displayCols.slice(0, 4).map(col => (
                <th key={col} className="th"><div className="th-inner">{getLabel(col)}</div></th>
              ))}</tr></thead>
              <tbody>{docs.map((row, i) => (
                <tr key={i} className="tr">{displayCols.slice(0, 4).map(col => (
                  <td key={col} className="td">{row[col] ?? '—'}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function LoadingSkeleton({ cols }) {
  return (
    <div className="skeleton-wrap">
      {[...Array(9)].map((_, i) => (
        <div key={i} className="skeleton-row" style={{ opacity: 1 - i * 0.08 }}>
          {[...Array(cols)].map((_, j) => (
            <div key={j} className="skeleton" style={{ flex: 1, height: 14, animationDelay: `${j * 0.04}s` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">◈</div>
      <div className="empty-state-title">No results found</div>
      <div className="empty-state-sub">Try adjusting your filters or click <strong>Index CSV</strong> to load data</div>
    </div>
  )
}