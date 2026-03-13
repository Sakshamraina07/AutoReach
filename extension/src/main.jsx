import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Recruiters from './pages/Recruiters.jsx'
import Template from './pages/Template.jsx'
import SendEmails from './pages/SendEmails.jsx'
import Setup from './pages/Setup.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Dashboard />} />
            <Route path="recruiters" element={<Recruiters />} />
            <Route path="templates" element={<Template />} />
            <Route path="send" element={<SendEmails />} />
            <Route path="setup" element={<Setup />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  </React.StrictMode>,
)
