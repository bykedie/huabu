import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './styles.css'
import './styles/canvas-shell-reference.css'
import './styles/canvas-controls-reference.css'
import './styles/canvas-nodes-reference.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
