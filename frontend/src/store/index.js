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
  if (f.type === 'nested') return f.children?.some(c => c.field && (c.value || c.min || c.max || c.from || c.to))
  if (f.type === 'range') return (f.min != null && f.min !== '') || (f.max != null && f.max !== '')
  if (f.type === 'date_range') return (f.from != null && f.from !== '') || (f.to != null && f.to !== '')
  if (f.type === 'boolean') return f.value != null && f.value !== ''
  if (f.type === 'multi_select') return Array.isArray(f.value) && f.value.length > 0
  return f.value != null && f.value !== ''
}

export const useStore = create((set, get) => {

  // ── Debounced query (300ms) ───────────────────────────────────────────────
  const debouncedQuery = debounce(() => get()._executeQuery(), 300)

  return {
    // ── Schema ──────────────────────────────────────────────────────────────
    schema: [],
    schemaLoading: false,
    fetchSchema: async () => {
      set({ schemaLoading: true })
      try {
        const res  = await fetch(`${API}/schema`)
        const data = await res.json()
        const fields = data.fields || []
        set({ schema: fields })
        if (get().selectedColumns.length === 0 && fields.length > 0) {
          const cols = fields.slice(0, 8).map(f => f.name)
          set({ selectedColumns: cols, columnOrder: cols })
        }
      } catch (e) {
        console.error('Schema fetch failed', e)
      } finally {
        set({ schemaLoading: false })
      }
    },

    // ── Column Config ────────────────────────────────────────────────────────
    selectedColumns: [],
    columnWidths: {},
    columnOrder: [],
    columnGroups: [],                          // [{ label, columns: [] }]
    setSelectedColumns: (cols) => set({ selectedColumns: cols, columnOrder: cols }),
    setColumnOrder:     (order) => set({ columnOrder: order }),
    setColumnWidth:     (col, width) => set(s => ({ columnWidths: { ...s.columnWidths, [col]: width } })),
    setColumnGroups:    (groups) => set({ columnGroups: groups }),

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
    setDateRange: (dr) => set({ dateRange: dr }),
    setDateCompare: (dc) => set({ dateCompare: dc }),

    // ── Search (debounced) ────────────────────────────────────────────────────
    globalSearch: '',
    setGlobalSearch: (q) => {
      set({ globalSearch: q, page: 1 })
      debouncedQuery()
    },

    // ── Query / Results ───────────────────────────────────────────────────────
    results:       [],
    total:         0,
    page:          1,
    rows:          50,
    sort:          'score desc',
    loading:       false,
    compareResult: null,

    setPage: (page) => { set({ page }); get().query() },
    setRows: (rows) => { set({ rows, page: 1 }); get().query() },
    setSort: (sort) => { set({ sort, page: 1 }); get().query() },

    // Public query (immediate)
    query: () => get()._executeQuery(),
    _doQuery: () => get()._executeQuery(),  // alias used by ChartPanel

    // Internal query executor
    _executeQuery: async () => {
      const s = get()
      set({ loading: true, compareResult: null })

      const activeFilters = s.filters.filter(isFilterActive)

      // Ensure we query ALL underlying fields that share the same label (e.g. price_i AND price_f)
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

      // Automatically translate filters on "merged" columns into native OR nested groups
      const transformFilter = (f) => {
        if (f.type === 'nested') {
          return { ...f, children: (f.children || []).map(transformFilter) }
        }
        const def = s.schema.find(sf => sf.name === f.field)
        if (def) {
          const groupNames = s.schema.filter(sf => sf.label === def.label).map(sf => sf.name)
          if (groupNames.length > 1) {
            return {
              type: 'nested',
              op: f.op || 'AND',
              groupOp: 'OR',
              children: groupNames.map(g => ({ ...f, field: g, op: 'OR' }))
            }
          }
        }
        return f
      }

      const transformedFilters = activeFilters.map(transformFilter)

      // Transform generic sort to def(col1, col2) if merged
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
        rows:        s.rows,
        page:        s.page,
        sort:        finalSort,
        fields:      queryFields,
        filters:     transformedFilters,
        q:           s.globalSearch?.trim() ? `*${s.globalSearch.trim()}*` : '*:*',
        dateCompare: s.dateCompare,
      }

      try {
        const res  = await fetch(`${API}/query`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
        const data = await res.json()
        if (data.current) {
          set({ results: data.current.docs || [], total: data.current.total || 0, compareResult: data })
        } else {
          set({ results: data.docs || [], total: data.total || 0 })
        }
      } catch (e) {
        console.error('Query failed', e)
      } finally {
        set({ loading: false })
      }
    },

    // ── Facets ────────────────────────────────────────────────────────────────
    facets: {},
    fetchFacets: async (fields, filters = []) => {
      try {
        const res  = await fetch(`${API}/facets`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ fields, limit: 50, filters }),
        })
        const data = await res.json()
        set(s => ({ facets: { ...s.facets, ...(data.facets || {}) } }))
      } catch (e) {
        console.error('Facets failed', e)
      }
    },

    // ── Aggregations ──────────────────────────────────────────────────────────
    aggregations: {},
    fetchAggregations: async (fields) => {
      // Fetch sum/avg/count via facet stats from Solr through our API
      try {
        const res  = await fetch(`${API}/aggregations`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ fields }),
        })
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
        const res  = await fetch(`${API}/views`)
        const data = await res.json()
        set({ views: data.views || [] })
      } catch (e) {}
    },
    saveView: async (name, isDefault = false) => {
      const s = get()
      await fetch(`${API}/views`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`${API}/views`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      })
      get().fetchViews()
    },
    setDefaultView: async (id) => {
      await fetch(`${API}/views/default`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      })
      get().fetchViews()
    },

    // ── UI State ──────────────────────────────────────────────────────────────
    activeTab:    'table',
    sidebarOpen:  true,
    setActiveTab:   (tab) => set({ activeTab: tab }),
    setSidebarOpen: (v)   => set({ sidebarOpen: v }),
  }
})