// server.js — 自托管场景（Docker / 群晖 NAS）的生产入口，不依赖任何 Vercel 特有能力
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '5mb' }))

// 与 vercel.json 中的安全响应头保持一致
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

const API_ROUTES = [
  'announcement-images', 'announcements', 'error-report', 'exams',
  'login', 'redeploy', 'telemetry', 'time', 'update-check', 'users',
]

for (const name of API_ROUTES) {
  const mod = await import(`./server-build/api/${name}.js`)
  app.all(`/api/${name}`, mod.default)
}

const distDir = path.join(__dirname, 'dist')
app.use(express.static(distDir, { index: false, maxAge: '1y' }))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`Novora is running on port ${port}`))
