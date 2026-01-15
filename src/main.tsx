import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'
import 'tippy.js/dist/tippy.css'


createRoot(document.getElementById('root')!).render(
  <App />,
)
