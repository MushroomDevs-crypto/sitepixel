import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const GRID_SIZE = 1000

function validateRect(x, y, width, height) {
  return (
    Number.isInteger(x) && Number.isInteger(y) &&
    Number.isInteger(width) && Number.isInteger(height) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= GRID_SIZE && y + height <= GRID_SIZE
  )
}

function validateUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function ownsEntireRect(wallet, x, y, width, height) {
  const result = await query(
    'SELECT COUNT(*) as cnt FROM pixels WHERE owner = $1 AND x >= $2 AND x < $3 AND y >= $4 AND y < $5',
    [wallet, x, x + width, y, y + height],
  )
  return Number(result.rows[0].cnt) === width * height
}

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, wallet, x, y, width, height, text, url, created_at FROM link_buttons ORDER BY created_at DESC',
    )
    return res.json({
      linkButtons: result.rows.map((row) => ({
        id: row.id,
        wallet: row.wallet,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        text: row.text,
        url: row.url,
      })),
    })
  } catch (err) {
    console.error('[link-buttons] Error:', err)
    return res.status(500).json({ message: 'Failed to load link buttons.' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const wallet = req.wallet
    const { x, y, width, height, text, url } = req.body

    if (!validateRect(Number(x), Number(y), Number(width), Number(height))) {
      return res.status(400).json({ message: 'Invalid button rectangle.' })
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0 || text.length > 60) {
      return res.status(400).json({ message: 'Text is required (max 60 chars).' })
    }

    if (!url || !validateUrl(url)) {
      return res.status(400).json({ message: 'A valid http/https URL is required.' })
    }

    const owns = await ownsEntireRect(wallet, Number(x), Number(y), Number(width), Number(height))
    if (!owns) {
      return res.status(403).json({ message: 'You do not own all pixels in this area.' })
    }

    const result = await query(
      'INSERT INTO link_buttons (wallet, x, y, width, height, text, url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [wallet, Number(x), Number(y), Number(width), Number(height), text.trim(), url],
    )

    const id = result.rows[0].id
    return res.json({
      linkButton: {
        id,
        wallet,
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
        text: text.trim(),
        url,
      },
    })
  } catch (err) {
    console.error('[link-buttons] Error:', err)
    return res.status(500).json({ message: 'Failed to create link button.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const result = await query(
      'DELETE FROM link_buttons WHERE id = $1 AND wallet = $2 RETURNING id',
      [id, req.wallet],
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Link button not found or not owned by you.' })
    }

    return res.json({ deleted: true })
  } catch (err) {
    console.error('[link-buttons/delete] Error:', err)
    return res.status(500).json({ message: 'Failed to delete link button.' })
  }
})

export default router
