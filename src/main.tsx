import { createRoot } from 'react-dom/client'
import App from './App'
import { registerOffline } from './pwa'
import './studio.css'

createRoot(document.getElementById('root')!).render(<App />)
registerOffline().catch((error) => console.warn('Offline cache', error))
