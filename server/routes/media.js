import { Router } from 'express'
import multer from 'multer'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const GRID_SIZE = 1000
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_MIME_TYPES = ['image/gif', 'image/png', 'image/jpeg', 'image/webp']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
})

function validateRect(x, y, width, height) {
  return (
    Number.isInteger(x) && Number.isInteger(y) &&
    Number.isInteger(width) && Number.isInteger(height) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= GRID_SIZE && y + height <= GRID_SIZE
  )
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
      'SELECT id, wallet, mime_type, x, y, width, height, created_at FROM media ORDER BY created_at DESC',
    )
    return res.json({
      media: result.rows.map((row) => ({
        id: row.id,
        wallet: row.wallet,
        mimeType: row.mime_type,
        url: `/api/media/${row.id}/file`,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
      })),
    })
  } catch (err) {
    console.error('[media] Error:', err)
    return res.status(500).json({ message: 'Failed to load media.' })
  }
})

router.get('/:id/file', async (req, res) => {
  try {
    const { id } = req.params
    const result = await query('SELECT file_data, mime_type FROM media WHERE id = $1', [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Media not found.' })
    }

    const { file_data, mime_type } = result.rows[0]
    res.setHeader('Content-Type', mime_type)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.send(file_data)
  } catch (err) {
    console.error('[media/file] Error:', err)
    return res.status(500).json({ message: 'Failed to serve media file.' })
  }
})

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const wallet = req.wallet
    const file = req.file

    if (!file) {
      return res.status(400).json({ message: 'File is required.' })
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ message: `Invalid file type: ${file.mimetype}` })
    }

    const x = Number(req.body.x)
    const y = Number(req.body.y)
    const width = Number(req.body.width)
    const height = Number(req.body.height)

    if (!validateRect(x, y, width, height)) {
      return res.status(400).json({ message: 'Invalid media rectangle.' })
    }

    const owns = await ownsEntireRect(wallet, x, y, width, height)
    if (!owns) {
      return res.status(403).json({ message: 'You do not own all pixels in this area.' })
    }

    const result = await query(
      'INSERT INTO media (wallet, file_data, mime_type, x, y, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [wallet, file.buffer, file.mimetype, x, y, width, height],
    )

    const mediaId = result.rows[0].id
    return res.json({
      media: {
        id: mediaId,
        wallet,
        mimeType: file.mimetype,
        url: `/api/media/${mediaId}/file`,
        x, y, width, height,
      },
    })
  } catch (err) {
    console.error('[media] Error:', err)
    return res.status(500).json({ message: 'Failed to upload media.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const result = await query(
      'DELETE FROM media WHERE id = $1 AND wallet = $2 RETURNING id',
      [id, req.wallet],
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Media not found or not owned by you.' })
    }

    return res.json({ deleted: true })
  } catch (err) {
    console.error('[media/delete] Error:', err)
    return res.status(500).json({ message: 'Failed to delete media.' })
  }
})

export default router
