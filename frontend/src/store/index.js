import { create } from 'zustand'

const API = '/api'

// ── Debounce helper ───────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// ── Filter active check ───────────────────────────────────────────────────────
function isFilterActive(f) {
  if (!f.field && f.type !== 'nested') return false
  if (f.type === 'nested') return f.children?.some(c => isFilterActive(c))
  if (f.type === 'is_null' || f.type === 'not_null') return true
  if (f.type === 'range') return (f.min != null && f.min !== '') || (f.max != null && f.max !== '')
  if (f.type === 'date_range') return (f.from != null && f.from !== '') || (f.to != null && f.to !== '')
  if (f.type === 'boolean') return f.value != null && f.value !== ''
  if (f.type === 'multi_select' || f.type === 'not_in') return Array.isArray(f.value) && f.value.length > 0
  return f.value != null && f.value !== ''
}

export const useStore = create((set, get) => {

  // ── Debounced query (300ms) ───────────────────────────────────────────────
  const debouncedQuery = debounce(() => get()._executeQuery(), 300)

  return {
    // ── Auth ────────────────────────────────────────────────────────────────
    user:  JSON.parse(localStorage.getItem('user')) || null,
    token: localStorage.getItem('token') || null,

    login: async (username, password) => {
      try {
        const res = await fetch(`${API}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        
        localStorage.setItem('token', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))
        set({ token: data.token, user: data.user })
        
        // Refresh data after login
        get().fetchSources()
        get().fetchViews()
        get().fetchSchema()
        get().query()
      } catch (e) {
        throw e
      }
    },

    logout: () => {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      set({ token: null, user: null, results: [], total: 0, views: [] })
    },

    // ── Internal Fetch Helper with Auth ─────────────────────────────────────
    _fetch: async (url, options = {}) => {
      const s = get()
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
      if (s.token) headers['Authorization'] = `Bearer ${s.token}`

      const res = await fetch(url, { ...options, headers })
      
      if (res.status === 401) {
        get().logout()
        return null
      }
      
      return res
    },

    // ── Schema ──────────────────────────────────────────────────────────────
    schema: [],
    schemaLoading: false,
    sources: [],
    selectedSource: '',

    fetchSources: async () => {
      try {
        const res = await get()._fetch(`${API}/sources`)
        if (!res) return
        const data = await res.json()
        set({ sources: data.sources || [] })
      } catch (e) {
        console.error('Sources fetch failed', e)
      }
    },

    fetchSchema: async () => {
      const s = get()
      set({ schemaLoading: true })
      try {
        const url = new URL(`${API}/schema`, window.location.origin)
        if (s.selectedSource) url.searchParams.set('source', s.selectedSource)
        
        const res = await get()._fetch(url)
        if (!res) return
        const data = await res.json()
        const fields = data.fields || []
        set({ schema: fields })
        
        // Auto-select columns
        if (fields.length > 0) {
          if (!s.selectedSource) {
            // "All Source Files" is selected.
            // Explicitly match the exact columns from AF.csv (the normal CSV view)
            const exactDefaults = [
              'product_id_i',
              'Product_Name_s',
              'parent_sku_s',
              'Price_f',
              'Map_Price_f',
              'Type_s',
              'Brand_Name_s',
              'AF_SKU_s',
              'AF_URL_s',
              'Image_URL_s',
              'AF_PRICE_i'
            ];
            
            // Filter global columns to ONLY these exact fields, maintaining the order defined above if possible
            let cols = exactDefaults.filter(dc => fields.some(f => f.name === dc));

            // Fallback if none found
            if (cols.length === 0) {
              cols = fields.slice(0, 15).map(f => f.name);
            }

            set({ selectedColumns: cols, columnOrder: cols });
          } else {
            // A specific file like AF.csv is selected: Show all its columns
            const cols = fields.map(f => f.name);
            set({ selectedColumns: cols, columnOrder: cols });
          }
        }
      } catch (e) {
        console.error('Schema fetch failed', e)
      } finally {
        set({ schemaLoading: false })
      }
    },

    setSource: async (source) => {
      set({ selectedSource: source, page: 1 })
      await get().fetchSchema()
      get().query()
    },

    // ── Column Config ────────────────────────────────────────────────────────
    selectedColumns: [],
    columnWidths: {},
    columnOrder: [],
    columnGroups: [],                          // [{ label, columns: [] }]
    setSelectedColumns: (cols) => {
      const s = get()
      // Preserve existing order of selected items, then add newcomers to the end
      const newOrder = [
        ...s.columnOrder.filter(c => cols.includes(c)),
        ...cols.filter(c => !s.columnOrder.includes(c))
      ]
      set({ selectedColumns: cols, columnOrder: newOrder })
      get().query()
    },
    setColumnOrder: (order) => set({ columnOrder: order }),
    setColumnWidth: (col, width) => set(s => ({ columnWidths: { ...s.columnWidths, [col]: width } })),
    setColumnGroups: (groups) => set({ columnGroups: groups }),

    // ── Filters ──────────────────────────────────────────────────────────────
    filters: [],
    addFilter:    (filter) => set(s => ({ filters: [...s.filters, filter] })),
    updateFilter: (idx, patch) => set(s => ({
      filters: s.filters.map((f, i) => i === idx ? { ...f, ...patch } : f)
    })),
    removeFilter: (idx) => set(s => ({ filters: s.filters.filter((_, i) => i !== idx) })),
    clearFilters: () => set({ filters: [], page: 1 }),

    // ── Date ─────────────────────────────────────────────────────────────────
    dateRange:    { from: '', to: '' },
    dateCompare:  null,
    dateField:    '',
    setDateRange: (dr) => set({ dateRange: dr }),
    setDateCompare: (dc) => set({ dateCompare: dc }),
    setDateField: (df) => set({ dateField: df }),

    // ── Search (debounced) ────────────────────────────────────────────────────
    globalSearch: '',
    setGlobalSearch: (q) => {
      set({ globalSearch: q, page: 1 })
      debouncedQuery()
    },

    // ── Query / Results ───────────────────────────────────────────────────────
    results:       [],
    // ── Pagination ──
    page: 1,
    rows: 50,
    cursor: '*', // Initial cursor
    nextCursor: null,
    total: 0,
    sort: 'score desc',
    loading:       false,
    compareResult: null,
    error: null, // New: track API errors
    ingestionStatus: null, // { status, current, total, ... }
    schedules: [], // List of report schedules
    notifications: [], // [{ id, type, message }]
    ingestionStatus: null, // { status, current, total, ... }

    setPage: (p) => {
      // If moving forward by 1 page, we can potentially use cursor, 
      // but for simplicity in this MVP, we'll reset cursor if jumping
      if (p === 1) set({ cursor: '*' })
      set({ page: p })
      get().query()
    },
    setNextPage: () => {
      const s = get()
      if (s.nextCursor) {
        set({ cursor: s.nextCursor, page: s.page + 1 })
        get().query()
      }
    },
    setRows: (r) => {
      set({ rows: r, page: 1, cursor: '*' })
      get().query()
    },
    setSort: (s) => {
      set({ sort: s, page: 1, cursor: '*' })
      get().query()
    },

    // Public query (immediate)
    query: () => get()._executeQuery(),
    _doQuery: () => get()._executeQuery(),  // alias used by ChartPanel

    // Internal query executor
    _executeQuery: async () => {
      const s = get()
      set({ loading: true, compareResult: null })

      const activeFilters = s.filters.filter(isFilterActive)

      // ── Merged Fields Logic (Restore) ──
      let queryFields = s.selectedColumns.length ? [...s.selectedColumns] : ['*']
      if (queryFields[0] !== '*') {
        const expanded = new Set(queryFields)
        s.selectedColumns.forEach(c => {
          const def = s.schema.find(sf => sf.name === c)
          if (def) {
            s.schema.filter(sf => sf.label === def.label).forEach(sf => expanded.add(sf.name))
          }
        })
        queryFields = Array.from(expanded)
      }

      // ── Advanced Sorting (Restore) ──
      let finalSort = s.sort
      if (finalSort && !finalSort.startsWith('score')) {
        const [sField, sDir] = finalSort.split(' ')
        const def = s.schema.find(sf => sf.name === sField)
        if (def) {
          const groupNames = s.schema.filter(sf => sf.label === def.label).map(sf => sf.name)
          if (groupNames.length > 1) {
            let sortFunc = groupNames[groupNames.length - 1]
            for (let i = groupNames.length - 2; i >= 0; i--) {
              sortFunc = `def(${groupNames[i]},${sortFunc})`
            }
            finalSort = `${sortFunc} ${sDir}`
          }
        }
      }

      const body = {
        page:    s.page,
        rows:    s.rows,
        cursor:  s.cursor,
        sort:    finalSort,
        search:  s.globalSearch,
        fields:  queryFields,
        filters: activeFilters,
        dateCompare: s.dateCompare,
      }

      if (s.selectedSource) {
        body.filters.push({
          field: 'source_file_s',
          type: 'equals',
          value: s.selectedSource,
          op: 'AND'
        })
      }

      // ── Global Date Filter (Part 3.2 Addon) ──
      // Only add if user manually selected a field and a range (no defaults)
      if (s.dateField && (s.dateRange.from || s.dateRange.to)) {
        body.filters.push({
          field: s.dateField,
          type: 'date_range',
          from: s.dateRange.from,
          to: s.dateRange.to,
          op: 'AND'
        })
      }

      try {
        const res = await get()._fetch(`${API}/query`, {
          method:  'POST',
          body:    JSON.stringify(body),
        })
        if (!res) return
        
        const data = await res.json()
        
        if (!res.ok) {
           set({ error: data.error || `Server error (${res.status})`, results: [], total: 0, loading: false })
           return
        }

        set({ 
          results:       data.docs || [], 
          total:         data.total || 0,
          nextCursor:    data.nextCursor || null,
          highlights:    data.highlights || {},
          timing:        data.timing,
          compareResult: body.dateCompare ? data : null,
          error:         null, // Clear error on success
        })
      } catch (e) {
        console.error('Query failed', e)
        set({ error: e.message || 'An unexpected error occurred', results: [], total: 0 })
      } finally {
        set({ loading: false })
      }
    },

    // ── Ingestion Progress (SSE) ───────────────────────────────────────────
    startIngestionPoll: () => {
      // Use existing EventSource if active
      if (window._ingestionES) return

      const es = new EventSource(`${API}/events.php`)
      window._ingestionES = es

      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        set({ ingestionStatus: data })

        if (data.status === 'completed') {
          es.close()
          window._ingestionES = null
          get().addNotification('success', 'Data ingestion completed successfully.')
          setTimeout(() => {
            get().query()
            set({ ingestionStatus: null })
          }, 5000)
        } else if (data.status === 'error') {
          es.close()
          window._ingestionES = null
          get().addNotification('error', data.error || 'Ingestion failed.')
          set({ ingestionStatus: null })
        } else if (data.status === 'idle') {
           es.close()
           window._ingestionES = null
        }
      }

      es.onerror = () => {
        es.close()
        window._ingestionES = null
        set({ ingestionStatus: null })
        // We don't toast on error because browser reconnects automatically usually
      }
    },

    // ── Notifications (Part 3.3) ─────────────────────────────────────────────
    addNotification: (type, message) => {
      const id = Date.now()
      set(s => ({ notifications: [...s.notifications, { id, type, message }] }))
      setTimeout(() => get().removeNotification(id), 6000)
    },
    removeNotification: (id) => {
      set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }))
    },

    // ── Export ──────────────────────────────────────────────────────────────
    exportAll: async () => {
      const s = get()
      const body = {
        columns: s.selectedColumns.length ? s.selectedColumns : s.schema.slice(0, 10).map(f => f.name),
        search:  s.globalSearch,
        filters: s.filters.filter(isFilterActive),
        sort:    s.sort,
      }

      try {
        const res = await get()._fetch(`${API}/export`, {
          method: 'POST',
          body: JSON.stringify(body)
        })
        if (!res) return
        
        const blob = await res.blob()
        const url  = window.URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `report_full_${Date.now()}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } catch (e) {
        console.error('Export failed', e)
      }
    },

    // ── Facets ────────────────────────────────────────────────────────────────
    facets: {},
    fetchFacets: async (fields, filters = []) => {
      try {
        const res = await get()._fetch(`${API}/facets`, {
          method:  'POST',
          body:    JSON.stringify({ fields, limit: 50, filters }),
        })
        if (!res) return
        const data = await res.json()
        set(s => ({ facets: { ...s.facets, ...(data.facets || {}) } }))
      } catch (e) {
        console.error('Facets failed', e)
      }
    },

    // ── Chart Data (server-side full-dataset aggregation) ───────────────────────
    chartData: [],
    chartStats: {},
    chartLoading: false,
    fetchChartData: async ({ xField, yField, y2Field } = {}) => {
      const s = get()
      if (!xField) return

      set({ chartLoading: true })

      // Build the same active filters the table uses
      const activeFilters = s.filters.filter(isFilterActive)
      const body = {
        xField,
        yField: yField || null,
        y2Field: y2Field || null,
        filters: activeFilters,
        source: s.selectedSource || null,
        q: '*:*',
        limit: 30,
      }

      try {
        const res = await get()._fetch(`${API}/chart-data`, {
          method:  'POST',
          body:    JSON.stringify(body),
        })
        if (!res) return
        const data = await res.json()
        set({
          chartData:  data.data  || [],
          chartStats: data.stats || {},
        })
      } catch (e) {
        console.error('Chart data fetch failed', e)
      } finally {
        set({ chartLoading: false })
      }
    },

    // ── Aggregations ──────────────────────────────────────────────────────────
    aggregations: {},
    fetchAggregations: async (fields) => {
      const s = get()
      const numFields = fields || s.schema
        .filter(f => f.type === 'integer' || f.type === 'float')
        .map(f => f.name)

      if (!numFields.length) return

      try {
        const res = await get()._fetch(`${API}/aggregations`, {
          method:  'POST',
          body:    JSON.stringify({
            fields:  numFields,
            filters: s.filters.filter(isFilterActive),
            source:  s.selectedSource || null,
          }),
        })
        if (!res) return
        const data = await res.json()
        set({ aggregations: data.aggregations || {} })
      } catch (e) {
        console.error('Aggregations failed', e)
      }
    },

    // ── Saved Views ───────────────────────────────────────────────────────────
    views: [],
    fetchViews: async () => {
      try {
        const res = await get()._fetch(`${API}/views`)
        if (!res) return
        const data = await res.json()
        set({ views: data.views || [] })
      } catch (e) {}
    },
    saveView: async (name, isDefault = false) => {
      const s = get()
      await get()._fetch(`${API}/views`, {
        method:  'POST',
        body:    JSON.stringify({
          name,
          columns:    s.selectedColumns,
          filters:    s.filters,
          sort:       s.sort,
          is_default: isDefault,
        }),
      })
      get().fetchViews()
    },
    loadView: (view) => {
      set({
        selectedColumns: view.columns || [],
        columnOrder:     view.columns || [],
        filters:         view.filters || [],
        sort:            view.sort || 'score desc',
        page:            1,
      })
      get().query()
    },
    deleteView: async (id) => {
      await get()._fetch(`${API}/views`, {
        method:  'DELETE',
        body:    JSON.stringify({ id }),
      })
      get().fetchViews()
    },
    setDefaultView: async (id) => {
      await get()._fetch(`${API}/views/default`, {
        method:  'POST',
        body:    JSON.stringify({ id }),
      })
      get().fetchViews()
    },

    // ── Audit ─────────────────────────────────────────────────────────────────
    auditLogs: [],
    fetchAudit: async () => {
      try {
        const res = await get()._fetch(`${API}/audit`)
        if (!res) return
        const data = await res.json()
        set({ auditLogs: data.logs || [] })
      } catch (e) {}
    },

    // ── Schedules (Part 3.2) ──────────────────────────────────────────────────
    fetchSchedules: async () => {
      try {
        const res = await get()._fetch(`${API}/schedules`)
        if (!res) return
        const data = await res.json()
        set({ schedules: data.schedules || [] })
      } catch (e) {}
    },
    saveSchedule: async (sched) => {
      try {
        const res = await get()._fetch(`${API}/schedules`, {
          method: 'POST',
          body: JSON.stringify(sched)
        })
        if (res) {
          await get().fetchSchedules()
          return true
        }
      } catch (e) {}
      return false
    },
    deleteSchedule: async (id) => {
      try {
        const res = await get()._fetch(`${API}/schedules?id=${id}`, {
          method: 'DELETE'
        })
        if (res) {
          set({ schedules: get().schedules.filter(x => x.id !== id) })
        }
      } catch (e) {}
    },

    // ── UI State ──────────────────────────────────────────────────────────────
    activeTab:    'table',
    sidebarOpen:  true,
    setActiveTab:   (tab) => set({ activeTab: tab }),
    setSidebarOpen: (v)   => set({ sidebarOpen: v }),
  }
})