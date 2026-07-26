import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SettingsApp from './SettingsApp.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const isSettingsMode = window.location.search.includes('mode=settings') || window.location.hash.includes('settings');

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    {isSettingsMode ? <SettingsApp /> : <App />}
  </ErrorBoundary>,
)
