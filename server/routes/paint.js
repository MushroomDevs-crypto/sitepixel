import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const GRID_SIZE = 1000
const COLOR_REGEX = /^#[0-9a-f]{6}$/i
const MAX_PIXELS_PER_PAINT = 5000

router.post('/', requireAuth, async (req, res) => {
  try {
    const { pixels } = req.body
    const wallet = req.wallet

    if (!Array.isArray(pixels) || pixels.length === 0) {
      return res.status(400).json({ message: 'pixels array is required.' })
    }

    if (pixels.length > MAX_PIXELS_PER_PAINT) {
      return res.status(400).json({ message: `Maximum ${MAX_PIXELS_PER_PAINT} pixels per paint request.` })
    }

    for (const p of pixels) {
      if (
        !Number.isInteger(p.x) || !Number.isInteger(p.y) ||
        p.x < 0 || p.x >= GRID_SIZE || p.y < 0 || p.y >= GRID_SIZE
      ) {
        return res.status(400).json({ message: `Invalid coordinates: (${p.x}, ${p.y})` })
      }
      if (!COLOR_REGEX.test(p.color)) {
        return res.status(400).json({ message: `Invalid color: ${p.color}` })
      }
    }

    let updatedCount = 0
    for (const p of pixels) {
      const result = await query(
        'UPDATE pixels SET color = $1, updated_at = NOW() WHERE x = $2 AND y = $3 AND owner = $4',
        [p.color, p.x, p.y, wallet],
      )
      updatedCount += result.rowCount
    }

    return res.json({ updated: updatedCount })
  } catch (err) {
    console.error('[paint] Error:', err)
    return res.status(500).json({ message: 'Failed to save paint.' })
  }
})

router.post('/clear', requireAuth, async (req, res) => {
  try {
    const result = await query(
      "UPDATE pixels SET color = '#ffffff', updated_at = NOW() WHERE owner = $1 AND color != '#ffffff'",
      [req.wallet],
    )
    return res.json({ cleared: result.rowCount })
  } catch (err) {
    console.error('[paint/clear] Error:', err)
    return res.status(500).json({ message: 'Failed to clear colors.' })
  }
})

export default router
