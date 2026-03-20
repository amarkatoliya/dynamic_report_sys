import React, { useEffect } from 'react'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import DataTable from './components/DataTable'
import ChartPanel from './components/ChartPanel'
import FilterBuilder from './components/FilterBuilder'
import SavedViews from './components/SavedViews'
import StatusBar from './components/StatusBar'
import './App.css'

export default function App() {
  const { 
    fetchSchema, fetchViews, query, activeTab, sidebarOpen, 
    fetchSources, sources, selectedSource, setSource 
  } = useStore()

  useEffect(() => {
    fetchSources()
    fetchViews()
    fetchSchema()
    query()
  }, [])

  return (
    <div className="app-layout">
      {/* Left Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">DataSheet</span>
        </div>
        <Sidebar />
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <TopBar />

        <div className="content-area">
          {/* Filters */}
          <FilterBuilder />

          {/* Results */}
          <div className="results-panel animate-fade-in">
            {activeTab === 'table' ? <DataTable /> : <ChartPanel />}
          </div>
        </div>

        <StatusBar />
      </main>

      {/* Saved Views Drawer */}
      <SavedViews />
    </div>
  )
}
