import React, { useState, useRef, useMemo } from 'react'
import { useStore } from '../store'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Brush, ComposedChart, Area
} from 'recharts'
import { BarChart2, TrendingUp, PieChart as PieIcon, Download, Layers } from 'lucide-react'

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#22d3ee', '#f472b6', '#a3e635', '#2dd4bf', '#fb7185']

const CHART_TYPES = [
  { id: 'bar',      label: 'Bar',      icon: <BarChart2 size={13} /> },
  { id: 'line',     label: 'Line',     icon: <TrendingUp size={13} /> },
  { id: 'pie',      label: 'Pie',      icon: <PieIcon size={13} /> },
  { id: 'multiaxis',label: 'Multi-Axis', icon: <Layers size={13} /> },
]

const tooltipStyle = {
  background: '#09090b', border: '1px solid #27272a',
  borderRadius: 8, color: '#f8fafc', fontSize: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

export default function ChartPanel() {
  const { results, schema, addFilter, _doQuery, aggregations, fetchAggregations } = useStore()
  const [chartType, setChartType] = useState('bar')
  const [xField, setXField]       = useState('')
  const [yField, setYField]       = useState('')
  const [y2Field, setY2Field]     = useState('') // second Y axis for multi-axis
  const [showAgg, setShowAgg]     = useState(false)
  const chartRef = useRef(null)

  const numericFields = schema.filter(f => f.type === 'integer' || f.type === 'float')
  const stringFields  = schema.filter(f => f.type === 'string')

  const defaultX = xField || stringFields[0]?.name || ''
  const defaultY = yField || numericFields[0]?.name || ''
  const defaultY2= y2Field || numericFields[1]?.name || ''

  const getLabel = (name) => {
    const f = schema.find(s => s.name === name)
    return f?.label || name.replace(/(_s|_i|_f|_b|_dt)$/, '').replace(/_/g, ' ')
  }

  const chartData = useMemo(() => {
    if (!defaultX || !results.length) return []
    const agg = {}
    results.forEach(row => {
      const key = String(row[defaultX] ?? 'Unknown')
      if (!agg[key]) agg[key] = { name: key, count: 0 }
      agg[key].count += 1
      if (defaultY && row[defaultY] != null)
        agg[key][defaultY] = (agg[key][defaultY] || 0) + Number(row[defaultY])
      if (defaultY2 && row[defaultY2] != null)
        agg[key][defaultY2] = (agg[key][defaultY2] || 0) + Number(row[defaultY2])
    })
    return Object.values(agg).sort((a, b) => b.count - a.count).slice(0, 20)
  }, [results, defaultX, defaultY, defaultY2])

  const drillDown = (data) => {
    if (!data?.activePayload?.[0]) return
    const value = data.activePayload[0].payload.name
    useStore.getState().addFilter({ field: defaultX, type: 'text', value, op: 'AND' })
    _doQuery()
  }

  const exportSVG = () => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `chart_${Date.now()}.svg`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportPNG = () => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) return
    const canvas = document.createElement('canvas')
    const bbox = svg.getBoundingClientRect()
    canvas.width = bbox.width * 2; canvas.height = bbox.height * 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const img = new Image()
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `chart_${Date.now()}.png`; a.click()
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(blob)
  }

  const yKey = defaultY || 'count'
  const yLabel = defaultY ? getLabel(defaultY) : 'Count'
  const y2Key = defaultY2 || ''
  const y2Label = defaultY2 ? getLabel(defaultY2) : ''

  const handleShowAgg = () => {
    setShowAgg(v => !v)
    if (!showAgg) fetchAggregations()
  }

  return (
    <div className="chart-panel">
      {/* Controls */}
      <div className="chart-controls">
        <div className="chart-type-switcher">
          {CHART_TYPES.map(t => (
            <button key={t.id} onClick={() => setChartType(t.id)}
              className={`chart-type-btn ${chartType === t.id ? 'active' : ''}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="chart-field-group">
          <span className="chart-field-label">X</span>
          <select className="input chart-field-select" value={xField} onChange={e => setXField(e.target.value)}>
            <option value="">Auto ({getLabel(defaultX)})</option>
            {schema.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
          </select>
        </div>

        {chartType !== 'pie' && (
          <div className="chart-field-group">
            <span className="chart-field-label">Y</span>
            <select className="input chart-field-select" value={yField} onChange={e => setYField(e.target.value)}>
              <option value="">Count</option>
              {numericFields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>
          </div>
        )}

        {/* Second Y axis — only for multi-axis */}
        {chartType === 'multiaxis' && (
          <div className="chart-field-group">
            <span className="chart-field-label" style={{ color: '#f59e0b' }}>Y2</span>
            <select className="input chart-field-select" value={y2Field} onChange={e => setY2Field(e.target.value)}>
              <option value="">None</option>
              {numericFields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button className={`btn btn-sm ${showAgg ? 'btn-primary' : ''}`} onClick={handleShowAgg}>
          Σ Aggregations
        </button>
        <span className="chart-hint">Click to drill down</span>

        {/* Export dropdown */}
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={exportSVG}>
            <Download size={13} /> SVG
          </button>
        </div>
        <button className="btn btn-sm" onClick={exportPNG}>
          <Download size={13} /> PNG
        </button>
      </div>

      {/* Aggregations panel */}
      {showAgg && Object.keys(aggregations).length > 0 && (
        <div className="chart-agg-panel">
          {Object.entries(aggregations).map(([field, stats]) => (
            <div key={field} className="chart-agg-card">
              <div className="chart-agg-field">{getLabel(field)}</div>
              <div className="chart-agg-stats">
                {Object.entries(stats).map(([stat, val]) => (
                  <div key={stat} className="chart-agg-stat">
                    <span className="chart-agg-stat-label">{stat.toUpperCase()}</span>
                    <span className="chart-agg-stat-value">{Number(val).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="chart-area" ref={chartRef}>
        {chartData.length === 0 ? (
          <div className="chart-empty">
            <BarChart2 size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
            <p>No data to display</p>
            <p style={{ fontSize: 12, opacity: 0.5 }}>Run a query first</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} onClick={drillDown} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(37,99,235,0.05)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={yKey} name={yLabel} radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
                <Brush dataKey="name" height={18} stroke="#27272a" fill="#18181b" travellerWidth={5} />
              </BarChart>
            ) : chartType === 'line' ? (
              <LineChart data={chartData} onClick={drillDown}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey={yKey} name={yLabel}
                  stroke={COLORS[0]} strokeWidth={2.5}
                  dot={{ fill: COLORS[0], r: 3 }} activeDot={{ r: 6 }} />
                <Brush dataKey="name" height={18} stroke="#27272a" fill="#18181b" travellerWidth={5} />
              </LineChart>
            ) : chartType === 'multiaxis' ? (
              <ComposedChart data={chartData} onClick={drillDown}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
                {/* Left Y axis */}
                <YAxis yAxisId="left" tick={{ fill: COLORS[0], fontSize: 11 }} tickLine={false} axisLine={false} />
                {/* Right Y axis */}
                {y2Key && <YAxis yAxisId="right" orientation="right" tick={{ fill: '#f59e0b', fontSize: 11 }} tickLine={false} axisLine={false} />}
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey={yKey} name={yLabel} fill={COLORS[0]} radius={[4,4,0,0]} opacity={0.85} />
                {y2Key && (
                  <Line yAxisId="right" type="monotone" dataKey={y2Key} name={y2Label}
                    stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 3 }} />
                )}
                <Area yAxisId="left" type="monotone" dataKey={yKey} fill={COLORS[0]} stroke="none" opacity={0.08} />
                <Brush dataKey="name" height={18} stroke="#27272a" fill="#18181b" travellerWidth={5} />
              </ComposedChart>
            ) : (
              <PieChart>
                <Pie data={chartData} dataKey={yKey} nameKey="name"
                  cx="50%" cy="50%" outerRadius="65%" innerRadius="30%"
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
                  onClick={(data) => {
                    if (data?.name) { addFilter({ field: defaultX, type: 'text', value: data.name, op: 'AND' }); _doQuery() }
                  }}
                  style={{ cursor: 'pointer' }} paddingAngle={2}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats row */}
      {chartData.length > 0 && (
        <div className="chart-stats">
          {[
            { label: 'Points', value: chartData.length },
            { label: 'Max',    value: Math.max(...chartData.map(d => d[yKey] || 0)).toLocaleString() },
            { label: 'Min',    value: Math.min(...chartData.map(d => d[yKey] || 0)).toLocaleString() },
            { label: 'Avg',    value: Math.round(chartData.reduce((s,d) => s + (d[yKey] || 0), 0) / chartData.length).toLocaleString() },
            { label: 'Total',  value: chartData.reduce((s,d) => s + (d[yKey] || 0), 0).toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="chart-stat">
              <div className="chart-stat-label">{label}</div>
              <div className="chart-stat-value">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}