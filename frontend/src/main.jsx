import { createRoot } from 'react-dom/client'
import './index.css'
import 'katex/dist/katex.min.css'
import App from './App.jsx'
import SettingsApp from './SettingsApp.jsx'
import DateModeApp from './DateModeApp.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const isSettingsMode = window.location.search.includes('mode=settings') || window.location.hash.includes('settings');
const isDateMode = window.location.search.includes('mode=date') || window.location.hash.includes('date');

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    {isSettingsMode ? <SettingsApp /> : isDateMode ? <DateModeApp /> : <App />}
  </ErrorBoundary>,
)
