import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function apiDevPlugin() {
  return {
    name: 'api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        const match = url.match(/^\/api\/([a-z0-9-]+)\/?$/)
        if (!match) return next()

        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', async () => {
          const wrapped = {
            _code: 200,
            _headers: {},
            status(code) { this._code = code; return this },
            setHeader(name, value) { this._headers[name] = value; return this },
            end(body) {
              if (res.writableEnded) return
              res.statusCode = this._code
              for (const [name, value] of Object.entries(this._headers)) res.setHeader(name, value)
              res.end(body)
            },
            json(data) {
              this.setHeader('Content-Type', 'application/json; charset=utf-8')
              this.end(JSON.stringify(data))
            },
          }
          try {
            const raw = Buffer.concat(chunks).toString()
            if (raw) {
              try { req.body = JSON.parse(raw) }
              catch { wrapped.status(400).json({ error: 'JSON inválido.' }); return }
            } else {
              req.body = {}
            }
            const mod = await server.ssrLoadModule(`/api/${match[1]}.js`)
            await mod.default(req, wrapped)
            if (!res.writableEnded) wrapped.end()
          } catch (error) {
            const missing = /failed to load|does not exist|ENOENT/i.test(String(error?.message || error))
            wrapped.status(missing ? 404 : 500).json({
              error: missing ? 'Não encontrado.' : 'Erro local da API.',
            })
          }
        })
      })
    },
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
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
})
