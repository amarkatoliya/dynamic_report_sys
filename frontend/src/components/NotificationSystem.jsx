import React from 'react'
import { useStore } from '../store'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

export default function NotificationSystem() {
  const notifications = useStore(s => s.notifications)
  const removeNotification = useStore(s => s.removeNotification)

  if (notifications.length === 0) return null

  return (
    <div className="notification-container">
      {notifications.map(n => (
        <div key={n.id} className={`notification-toast ${n.type} animate-notification`}>
          <div className="notification-icon">
            {n.type === 'success' && <CheckCircle size={18} />}
            {n.type === 'error' && <AlertCircle size={18} />}
            {n.type === 'info' && <Info size={18} />}
          </div>
          <div className="notification-content">
            <div className="notification-message">{n.message}</div>
          </div>
          <button className="notification-close" onClick={() => removeNotification(n.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
