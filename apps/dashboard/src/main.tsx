import React from 'react'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import 'reactflow/dist/style.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element not found')
}

const root = createRoot(container)

root.render(
  <React.StrictMode>
    <MantineProvider
      defaultColorScheme="light"
      theme={{
        fontFamily: 'Manrope, system-ui, sans-serif',
        headings: { fontFamily: 'Space Grotesk, system-ui, sans-serif', fontWeight: '600' },
        primaryColor: 'teal',
        defaultRadius: 'md',
      }}
    >
      <App />
    </MantineProvider>
  </React.StrictMode>
)
