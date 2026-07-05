import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function apiDevPlugin() {
  return {
    name: 'api-dev',
    configureServer(server) {
      server.middlewares.use('/api/translate', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', async () => {
          const wrapped = {
            _code: 200,
            status(c) { this._code = c; return this },
            end() { res.statusCode = this._code; res.end() },
            json(data) {
              res.statusCode = this._code
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
            }
          }
          try {
            req.body = JSON.parse(Buffer.concat(chunks).toString())
            const mod = await server.ssrLoadModule('/api/translate.js')
            await mod.default(req, wrapped)
          } catch (e) {
            wrapped.status(500).json({ error: 'Dev API error: ' + e.message })
          }
        })
      })
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    apiDevPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Tradutor ES ↔ PT',
        short_name: 'Tradutor',
        description: 'Tradutor espanhol-português do dia a dia',
        theme_color: '#009c3b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      }
    })
  ]
})
