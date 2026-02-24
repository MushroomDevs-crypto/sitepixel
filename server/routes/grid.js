import { Router } from 'express'
import { query } from '../db.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const [pixelsResult, mediaResult, linkButtonsResult] = await Promise.all([
      query('SELECT x, y, owner, color FROM pixels'),
      query('SELECT id, wallet, mime_type, x, y, width, height, created_at FROM media ORDER BY created_at DESC'),
      query('SELECT id, wallet, x, y, width, height, text, url, created_at FROM link_buttons ORDER BY created_at DESC'),
    ])

    return res.json({
      pixels: pixelsResult.rows,
      media: mediaResult.rows.map((row) => ({
        id: row.id,
        wallet: row.wallet,
        mimeType: row.mime_type,
        url: `/api/media/${row.id}/file`,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
      })),
      linkButtons: linkButtonsResult.rows.map((row) => ({
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
    console.error('[grid] Error:', err)
    return res.status(500).json({ message: 'Failed to load grid.' })
  }
})

export default router
