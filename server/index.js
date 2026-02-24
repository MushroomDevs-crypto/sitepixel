import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { initDb } from './db.js'

import authRouter from './routes/auth.js'
import gridRouter from './routes/grid.js'
import purchaseRouter from './routes/purchase.js'
import paintRouter from './routes/paint.js'
import mediaRouter from './routes/media.js'
import linkButtonsRouter from './routes/link-buttons.js'
import { query } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const purchaseLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { message: 'Too many purchase requests. Try again later.' } })
const paintLimiter = rateLimit({ windowMs: 60_000, max: 60, message: { message: 'Too many paint requests. Try again later.' } })
const mediaLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { message: 'Too many media requests. Try again later.' } })

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1')
    res.json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'db_error' })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/grid', gridRouter)
app.use('/api/purchase', purchaseLimiter, purchaseRouter)
app.use('/api/paint', paintLimiter, paintRouter)
app.use('/api/media', mediaLimiter, mediaRouter)
app.use('/api/link-buttons', linkButtonsRouter)

const distPath = join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (req, res) => {
  res.sendFile(join(distPath, 'index.html'))
})

async function start() {
  try {
    await initDb()
    app.listen(PORT, () => {
      console.log(`[server] Running on port ${PORT}`)
    })
  } catch (err) {
    console.error('[server] Failed to start:', err)
    process.exit(1)
  }
}

start()
